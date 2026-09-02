mod ca_watch;
mod catalogue;
mod proxy;
mod runtime;
mod server;

use proxy::FrameworkProxy;
use runtime::{EventHub, RuntimeConfig, RuntimeError, SettingsSnapshot};
use server::{ServerState, serve};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, RwLock};

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .init();

    if let Err(error) = run().await {
        tracing::error!(error = %error, "evo-ui-runtime failed");
        eprintln!("evo-ui-runtime failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), RuntimeError> {
    let config = RuntimeConfig::from_env();
    config.validate()?;

    // 1. Settings store — load or initialise.
    let data_dir = config.settings_file.parent().ok_or_else(|| {
        RuntimeError::InvalidConfig("settings file has no parent directory".to_string())
    })?;
    std::fs::create_dir_all(data_dir).map_err(RuntimeError::Io)?;
    let snapshot = if config.settings_file.exists() {
        SettingsSnapshot::load(&config.settings_file)?
    } else {
        let initial = SettingsSnapshot::default_policy();
        initial.store_atomic(&config.settings_file)?;
        initial
    };
    snapshot.store_atomic(&config.settings_backup_file)?;

    // 2. Boot-only mode — exit before binding.
    if config.bootstrap_only {
        tracing::info!(
            runtime_root = %config.runtime_root.display(),
            active_release = %config.active_release.display(),
            settings_revision = snapshot.revision,
            "evo-ui-runtime bootstrap-only complete"
        );
        return Ok(());
    }

    // 3. Validate active release.
    if !config.active_release.exists() {
        return Err(RuntimeError::MissingActiveRelease(format!(
            "active release path missing: {}",
            config.active_release.display()
        )));
    }
    let index = config.active_release.join("index.html");
    if !index.exists() {
        return Err(RuntimeError::MissingActiveRelease(format!(
            "missing index.html in active release: {}",
            config.active_release.display()
        )));
    }

    // 4. Framework reverse-proxy. Construction failure
    //    (e.g. CA cert not yet provisioned) is a soft fail:
    //    the runtime continues with the static + UI-runtime
    //    API surface; framework-proxy routes return 502 with
    //    a clear "proxy not configured" message until the
    //    operator wires the CA path.
    let initial_proxy = match FrameworkProxy::new(
        config.framework_https_host.clone(),
        config.framework_https_port,
        &config.framework_ca_cert,
    ) {
        Ok(p) => {
            tracing::info!(
                upstream = %format!(
                    "{}:{}",
                    config.framework_https_host, config.framework_https_port
                ),
                ca = %config.framework_ca_cert.display(),
                "framework reverse-proxy ready"
            );
            Some(p)
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                ca = %config.framework_ca_cert.display(),
                "framework reverse-proxy NOT configured \
                 (CA cert load failed); /api/v1/* routes \
                 will return 502 until the CA is provisioned \
                 (the CA watcher self-heals this without a restart)"
            );
            None
        }
    };
    // Swappable slot the server reads per request; the watcher below
    // writes it when the CA appears or rotates. Fingerprint the CA the
    // runtime just loaded (if any) so the first poll does not rebuild
    // an already-trusted, unchanged bundle.
    let initial_fingerprint = std::fs::read(&config.framework_ca_cert)
        .ok()
        .map(|bytes| ca_watch::fingerprint(&bytes));
    let framework_proxy: ca_watch::SharedProxy = Arc::new(RwLock::new(initial_proxy));
    let had_initial_proxy = framework_proxy.read().map(|g| g.is_some()).unwrap_or(false);
    // ca_watch is spawned AFTER the server state exists (below) so its
    // on-(re)connect hook can re-assert device-side state (the visualiser
    // demand) from the settings store.

    // 5. Load the deployed catalogue and derive the shelf-set
    //    the capability projection consults. Failure is soft:
    //    the runtime still boots and advertises the framework
    //    baseline capabilities; only the shelf-mapped
    //    capabilities (network.settings, ...) go absent.
    let admitted_shelves = catalogue::load_catalogue_shelves(&config.catalogue_path);
    tracing::info!(
        catalogue = %config.catalogue_path.display(),
        shelf_count = admitted_shelves.len(),
        "catalogue loaded for capability derivation"
    );

    // 6. Server state.
    let state = Arc::new(ServerState {
        active_release: config.active_release.clone(),
        settings_file: config.settings_file.clone(),
        settings_backup_file: config.settings_backup_file.clone(),
        settings: Mutex::new(snapshot),
        events: Arc::new(EventHub::default()),
        framework_proxy: Arc::clone(&framework_proxy),
        admitted_shelves,
    });

    // 7. CA hot-reload watcher. Its on-(re)connect hook re-asserts the
    //    visualiser demand so the framework's producer state always
    //    matches the operator's stored system switch after a framework
    //    redeploy or CA rotation.
    {
        let st = Arc::clone(&state);
        ca_watch::spawn(
            framework_proxy,
            config.framework_ca_cert.clone(),
            config.framework_https_host.clone(),
            config.framework_https_port,
            initial_fingerprint,
            std::sync::Arc::new(move || {
                tokio::spawn(server::reassert_spectrum_demand_until_applied(Arc::clone(
                    &st,
                )));
            }),
        );
    }
    // Boot re-assert: if the CA was already present at startup, push the
    // stored visualiser demand (cold start / reboot). PATIENT retry - the
    // framework (evo.service) usually comes up AFTER this runtime, so the
    // first originate attempts get Connection refused; keep retrying until
    // it lands so the device demand matches the operator's switch after a
    // reboot without a manual poke.
    if had_initial_proxy {
        tokio::spawn(server::reassert_spectrum_demand_until_applied(Arc::clone(
            &state,
        )));
    }

    // 7b. Ongoing reconcile: terminus keeps demand in RAM and boots
    //     disabled_default, so a terminus reload/redeploy silently drops the
    //     producer to OFF while stored intent is ON. There is no demand READ
    //     verb, so a slow idempotent validated re-push (only when intent is
    //     ON) converges the device back to intent after any terminus reset.
    tokio::spawn(server::spawn_demand_reconcile(Arc::clone(&state)));

    // 8. Bind + serve.
    let bind: SocketAddr = ([0, 0, 0, 0], config.http_port).into();
    serve(bind, state)
        .await
        .map_err(|e| RuntimeError::Http(e.to_string()))
}
