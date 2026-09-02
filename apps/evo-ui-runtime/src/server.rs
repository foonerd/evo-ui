//! Hyper-based async server.
//!
//! Owns the single listener on `EVO_UI_HTTP_PORT` (default
//! 80). Routes:
//!
//! - `GET /api/ui/v1/health` — runtime health probe.
//! - `GET /api/ui/v1/capabilities` — UI capability flags.
//! - `GET|PATCH /api/ui/v1/settings` — authoritative UI
//!   settings store.
//! - `GET /api/ui/v1/ws` — long-poll event stream for
//!   UI-side settings changes (historical name — not an
//!   actual WebSocket).
//! - `GET /api/v1/ws` — **WebSocket upgrade proxy** to the
//!   framework's loopback HTTPS substrate. Operator browser
//!   talks to this on plain HTTP; the runtime opens an
//!   upstream WSS handshake and pumps frames bidirectionally.
//! - `* /api/v1/*` — **HTTP reverse-proxy** to the framework
//!   for every other wire-op route.
//! - everything else — static file serving from
//!   `EVO_UI_ACTIVE_RELEASE` (default `/opt/evo/ui/current`),
//!   with SPA fallback to `index.html` for unknown paths.
//!
//! The operator's browser only ever sees `http://<device>/`
//! end-to-end: no TLS, no cert, no SAN, no warning. The
//! framework's TLS handshake happens loopback-to-loopback
//! where its `SAN=localhost` is correct by construction.

use crate::proxy::{
    ProxyBody, bytes_body, is_framework_http, is_framework_ws_upgrade, proxy_error_response,
};
use crate::runtime::{EventHub, SettingsSnapshot};
use bytes::Bytes;
use http_body_util::BodyExt;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::io;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::time::timeout;

/// Server-wide state shared across every request.
pub struct ServerState {
    /// Filesystem root the static-asset handler serves from.
    pub active_release: PathBuf,
    /// Settings file backing the authoritative store.
    pub settings_file: PathBuf,
    /// Sibling backup of `settings_file` for crash recovery.
    pub settings_backup_file: PathBuf,
    /// In-memory settings snapshot (sync mutex; critical
    /// sections are short and file I/O sits inside).
    pub settings: Mutex<SettingsSnapshot>,
    /// Event hub for the long-poll settings stream.
    pub events: Arc<EventHub>,
    /// Reverse-proxy client to the framework's loopback
    /// HTTPS substrate. Held in a swappable slot: `Some` when a
    /// device-CA is loaded, `None` while bootstrapping without
    /// one (the proxy routes return 502 in that state). The
    /// `ca_watch` task swaps this in place when the CA appears or
    /// rotates, so a warm framework re-mint or an
    /// `--mode=reinstall` sequence self-heals without an
    /// evo-ui restart.
    pub framework_proxy: crate::ca_watch::SharedProxy,
    /// Set of `<rack>.<shelf>` keys the deployed catalogue
    /// admits. Loaded once at boot via
    /// `catalogue::load_catalogue_shelves`; consulted by
    /// `capabilities_response` so shelf-backed UI capabilities
    /// track catalogue admission without a source edit per
    /// plugin. Empty when the catalogue is missing / unreadable
    /// — the framework baseline still serves.
    pub admitted_shelves: std::collections::HashSet<String>,
}

/// Bind the listener and accept connections.
pub async fn serve(bind_addr: SocketAddr, state: Arc<ServerState>) -> io::Result<()> {
    let listener = TcpListener::bind(bind_addr).await?;
    tracing::info!(
        bind = %bind_addr,
        active_release = %state.active_release.display(),
        framework_proxy = state
            .framework_proxy
            .read()
            .map(|g| g.is_some())
            .unwrap_or(false),
        "evo-ui-runtime listening"
    );

    loop {
        let (stream, peer) = listener.accept().await?;
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let svc = service_fn(move |req: Request<Incoming>| {
                let state = Arc::clone(&state);
                async move { Ok::<_, hyper::Error>(handle(req, state, peer).await) }
            });
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, svc)
                .with_upgrades()
                .await
            {
                tracing::debug!(error = ?e, peer = %peer, "connection ended");
            }
        });
    }
}

async fn handle(
    req: Request<Incoming>,
    state: Arc<ServerState>,
    peer: SocketAddr,
) -> Response<ProxyBody> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    // Framework proxy paths. Snapshot the swappable proxy slot with a
    // brief read-lock and clone out (the clone is cheap — an Arc'd
    // rustls connector + host/port) so the lock is never held across
    // the proxied await.
    if is_framework_ws_upgrade(&req) {
        let proxy = state
            .framework_proxy
            .read()
            .ok()
            .and_then(|g| g.as_ref().cloned());
        return match proxy {
            Some(proxy) => match proxy.proxy_ws_upgrade(req, peer.ip()).await {
                Ok(resp) => resp,
                Err(e) => {
                    tracing::warn!(error = %e, "ws proxy failed");
                    proxy_error_response(e)
                }
            },
            None => bad_gateway("framework proxy not configured"),
        };
    }
    if is_framework_http(req.uri()) {
        let proxy = state
            .framework_proxy
            .read()
            .ok()
            .and_then(|g| g.as_ref().cloned());
        return match proxy {
            Some(proxy) => match proxy.proxy_http(req, peer.ip()).await {
                Ok(resp) => resp,
                Err(e) => {
                    tracing::warn!(error = %e, "http proxy failed");
                    proxy_error_response(e)
                }
            },
            None => bad_gateway("framework proxy not configured"),
        };
    }

    // UI-runtime-owned surfaces.
    match (method.clone(), path.as_str()) {
        (Method::GET, "/api/ui/v1/health") => health_response(),
        (Method::GET, "/api/ui/v1/capabilities") => capabilities_response(&state),
        (Method::GET, "/api/ui/v1/settings") => settings_get(&state),
        (Method::PATCH, "/api/ui/v1/settings") => settings_patch(req, state).await,
        (Method::GET, "/api/ui/v1/ws") => settings_stream(req, state).await,
        (_, p) if p.starts_with("/api/") => not_found_api(p),
        (Method::GET, _) | (Method::HEAD, _) => serve_static(req, &state).await,
        _ => method_not_allowed(),
    }
}

fn health_response() -> Response<ProxyBody> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let body = serde_json::json!({
        "status": "ok",
        "timestamp": ts.to_string(),
        "version": env!("CARGO_PKG_VERSION"),
    });
    json_response(StatusCode::OK, body)
}

/// Emit the capability map the operator's browser reads at
/// bootstrap. Split into two layers:
///
/// - **Framework baseline** — `framework.proxy` / `framework.ws`
///   / `ui.settings*` — always `"supported"`; these depend on
///   the runtime itself, not on any admitted plugin.
/// - **Shelf-derived** — every capability in
///   `catalogue::SHELF_TO_CAPABILITY` whose source shelf appears
///   in `state.admitted_shelves`. Adding a new capability to
///   the UI = one row in the catalogue mapping table + shelf
///   declared in the deployed catalogue; no per-capability
///   source edit here. The status held per shelf reflects the
///   promotion gate (e.g. `network.settings` stays `"partial"`
///   until the S8 rig matrix passes).
fn capabilities_response(state: &Arc<ServerState>) -> Response<ProxyBody> {
    let mut capabilities = serde_json::Map::new();
    capabilities.insert(
        "framework.proxy".into(),
        serde_json::Value::String("supported".into()),
    );
    capabilities.insert(
        "framework.ws".into(),
        serde_json::Value::String("supported".into()),
    );
    capabilities.insert(
        "ui.settings".into(),
        serde_json::Value::String("supported".into()),
    );
    capabilities.insert(
        "ui.settings.realtime".into(),
        serde_json::Value::String("supported".into()),
    );
    for (cap, status) in crate::catalogue::derive_capabilities(&state.admitted_shelves) {
        capabilities.insert(
            cap.to_string(),
            serde_json::Value::String(status.to_string()),
        );
    }
    let body = serde_json::json!({
        "version": 1,
        "capabilities": capabilities,
        "notes": [
            "operator browser reaches framework via this runtime's reverse-proxy on http://<device>/api/v1/*",
            "framework HTTPS substrate is loopback-only; cert never crosses to the operator's browser",
            "shelf-derived capabilities track the deployed catalogue at /opt/evo/catalogue/default.toml (override via EVO_UI_CATALOGUE_PATH)"
        ]
    });
    json_response(StatusCode::OK, body)
}

fn settings_get(state: &Arc<ServerState>) -> Response<ProxyBody> {
    let snapshot = match state.settings.lock() {
        Ok(g) => g.clone(),
        Err(_) => return server_error("settings lock poisoned"),
    };
    json_response(StatusCode::OK, snapshot.as_value())
}

async fn settings_patch(req: Request<Incoming>, state: Arc<ServerState>) -> Response<ProxyBody> {
    let body_bytes = match req.collect().await {
        Ok(c) => c.to_bytes(),
        Err(_) => return bad_request("invalid request body"),
    };
    let patch: SettingsPatchRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => return bad_request("invalid json patch payload"),
    };
    if patch.changes.is_empty() {
        return bad_request("settings patch must include changes");
    }
    let (new_value, viz_changed) = {
        let mut guard = match state.settings.lock() {
            Ok(g) => g,
            Err(_) => return server_error("settings lock poisoned"),
        };
        if let Some(base) = patch.base_revision {
            if base != guard.revision {
                return json_response(
                    StatusCode::CONFLICT,
                    serde_json::json!({
                        "error": "revision_mismatch",
                        "currentRevision": guard.revision
                    }),
                );
            }
        }
        let changed = guard.apply_patch(&patch.changes);
        let viz_changed = changed && changes_touch_visualizer(&patch.changes);
        if changed {
            if let Err(e) = guard.store_atomic(&state.settings_file) {
                return server_error(&format!("settings save failed: {e}"));
            }
            if let Err(e) = guard.store_atomic(&state.settings_backup_file) {
                return server_error(&format!("settings backup save failed: {e}"));
            }
            let payload = serde_json::json!({
                "revision": guard.revision,
                "changedKeys": patch.changes.keys().cloned().collect::<Vec<String>>(),
            });
            state.events.publish("ui.settings.changed", payload);
        }
        (guard.as_value(), viz_changed)
    };
    // A visualiser-knob change re-asserts the device demand via the single
    // retrying apply path (shared with boot + framework-reconnect). The
    // response never waits on the device round-trip.
    if viz_changed {
        tokio::spawn(reassert_spectrum_demand(Arc::clone(&state)));
    }
    json_response(StatusCode::OK, new_value)
}

/// True when a settings patch touches a visualizer knob that drives the
/// device spectrum producer. Renderer-only knobs (palette, color_mode,
/// sensitivity_db) never leave the UI and are deliberately excluded.
fn changes_touch_visualizer(changes: &serde_json::Map<String, serde_json::Value>) -> bool {
    changes.keys().any(|k| {
        matches!(
            k.as_str(),
            "ui.visualizer.enabled"
                | "ui.visualizer.preset"
                | "ui.visualizer.bin_count"
                | "ui.visualizer.channel_mode"
                | "ui.visualizer.frequency_scale"
        )
    })
}

/// Derive the `audio.spectrum.set_demand` payload from current settings.
/// Two inputs gate production and both must pass (this is the framework
/// parity the operator asked for):
///   - `ui.visualizer.enabled` - the SYSTEM master switch (the toggle in
///     the designer). Absent defaults to true.
///   - `ui.visualizer.preset` - the style; `"off"` also disables. Absent
///     defaults to the enabled "bars" style.
///
/// `demand.enabled = master_switch && preset != "off"`. channel_mode
/// mono -> 1 channel, stereo -> 2.
fn derive_spectrum_demand(
    settings: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    // Absent master switch -> OFF. Virgin settings must NOT opt the device
    // into producing spectrum on the boot/reconnect re-assert without an
    // operator gesture; this matches the framework's disabled demand
    // default. The switch is written explicitly the first time the operator
    // toggles it in the studio.
    let master_on = settings
        .get("ui.visualizer.enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let preset_on = settings
        .get("ui.visualizer.preset")
        .and_then(|v| v.as_str())
        .map(|s| s != "off")
        .unwrap_or(true);
    let enabled = master_on && preset_on;
    // Dense log×256 is the music-analyser product default.
    let bins = settings
        .get("ui.visualizer.bin_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(256);
    let channels = match settings
        .get("ui.visualizer.channel_mode")
        .and_then(|v| v.as_str())
    {
        Some("stereo") => 2,
        _ => 1,
    };
    // Analyser frequency-scale dimension. The producer (terminus) owns the
    // banking math; the UI only carries the operator's choice on the wire.
    // Clamp to the known enum and default to "log" for absent OR unrecognised
    // values, matching the framework's parse boundary. This is deliberate:
    // the framework hard-fails an unknown variant, so a stale/garbage setting
    // must never reach set_demand and break the whole demand write.
    let frequency_scale = match settings
        .get("ui.visualizer.frequency_scale")
        .and_then(|v| v.as_str())
    {
        Some("mel") => "mel",
        Some("linear") => "linear",
        _ => "log",
    };
    serde_json::json!({
        "v": 1,
        "enabled": enabled,
        "bins": bins,
        "channels": channels,
        "rate_hz_target": 30,
        "frequency_scale": frequency_scale,
    })
}

/// Push the current visualiser demand (derived from the persisted
/// settings) to the framework, regardless of whether a settings change
/// just happened. Called on boot and on every framework-proxy
/// (re)connect so the device's demand state always matches the operator's
/// stored system switch + config across cold start, reboot, and framework
/// redeploy - not only after a manual toggle. Fire-and-forget; no-op if
/// the proxy is not ready yet (the CA watcher retries this on connect).
/// Outcome of one attempt to push + validate the spectrum demand.
enum ApplyOutcome {
    /// Terminus acknowledged AND its `applied` envelope matches what we
    /// sent (at least `applied.enabled == requested.enabled`).
    Applied,
    /// Transport failed, OR a 2xx returned an error / not-applied body, OR
    /// the `applied` envelope disagrees with the request. Retryable.
    NotApplied(String),
    /// The framework proxy is not wired yet (CA not provisioned / framework
    /// not up). Retryable, but not an error to log loudly.
    NoProxy,
}

/// The ONE validated apply path. Derives the demand from the current
/// stored settings, originates the set_demand wire-op, and only reports
/// success when terminus's `applied` envelope confirms `enabled` matches
/// the operator's intent. A 2xx HTTP status alone is NOT success - the
/// framework can return 200 with a no-responder / not-ready / error body,
/// and terminus can echo an `applied.enabled` that differs from what we
/// asked for. Every caller (settings-patch, boot re-assert, reconnect
/// hook, reconcile loop) goes through here so "applied" means one thing.
async fn try_apply_demand(state: &Arc<ServerState>) -> ApplyOutcome {
    let demand = match state.settings.lock() {
        Ok(g) => derive_spectrum_demand(&g.settings),
        Err(_) => return ApplyOutcome::NotApplied("settings lock poisoned".to_string()),
    };
    let proxy = state
        .framework_proxy
        .read()
        .ok()
        .and_then(|g| g.as_ref().cloned());
    let Some(proxy) = proxy else {
        return ApplyOutcome::NoProxy;
    };
    match proxy
        .originate_request("audio.terminus", "audio.spectrum.set_demand", &demand)
        .await
    {
        Ok(resp) => {
            // "Applied" means terminus echoed back EVERY production dimension
            // we sent, not just enabled: if it clamped bins or ignored the
            // frequency scale, the device is not producing what the operator
            // asked for, which is a retryable not-applied. Compare the applied
            // envelope field-for-field against the derived demand.
            let applied = resp.get("applied");
            let echoes =
                |field: &str| -> bool { applied.and_then(|a| a.get(field)) == demand.get(field) };
            if applied.is_some()
                && echoes("enabled")
                && echoes("bins")
                && echoes("channels")
                && echoes("frequency_scale")
            {
                ApplyOutcome::Applied
            } else {
                ApplyOutcome::NotApplied(format!(
                    "terminus applied={applied:?} does not match derived demand={demand}"
                ))
            }
        }
        Err(e) => ApplyOutcome::NotApplied(e.to_string()),
    }
}

/// Short validated re-assert for the SETTINGS-PATCH path (operator just
/// toggled the switch / changed a knob). A few quick tries to ride over a
/// transient proxy miss; the reconnect hook and the reconcile loop are the
/// backstops if the framework is mid-restart. "Applied" here means
/// terminus confirmed the demand, not merely that HTTP returned 2xx.
pub async fn reassert_spectrum_demand(state: Arc<ServerState>) {
    const BACKOFF_MS: [u64; 3] = [0, 250, 750];
    for (attempt, delay) in BACKOFF_MS.iter().enumerate() {
        if *delay > 0 {
            tokio::time::sleep(Duration::from_millis(*delay)).await;
        }
        match try_apply_demand(&state).await {
            ApplyOutcome::Applied => {
                tracing::info!(attempt, "spectrum demand applied + validated by terminus");
                return;
            }
            ApplyOutcome::NotApplied(why) => {
                tracing::warn!(attempt, reason = %why, "spectrum demand not applied; retrying")
            }
            ApplyOutcome::NoProxy => { /* CA not ready; try again / give up quietly */ }
        }
    }
    tracing::warn!(
        "spectrum demand not applied after short retry; reconnect hook + reconcile loop will re-drive"
    );
}

/// Patient VALIDATED re-assert for the BOOT / framework-(re)connect path.
/// The framework (evo.service on the loopback HTTPS port) can come up AFTER
/// this runtime, so the first originate attempts get `Connection refused`;
/// and even once reachable a 2xx can carry a not-ready body. This loop
/// keeps re-deriving + re-pushing with a growing backoff until terminus
/// CONFIRMS the demand (validated), or a generous ceiling. Re-derives each
/// attempt so a settings change during the wait is respected.
pub async fn reassert_spectrum_demand_until_applied(state: Arc<ServerState>) {
    // 0,0.5,1,2,4,8,8,... capped 8s, ~2 min total window.
    let mut delay_ms: u64 = 0;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
        delay_ms = (delay_ms.max(500) * 2).min(8_000);

        match try_apply_demand(&state).await {
            ApplyOutcome::Applied => {
                tracing::info!(
                    "spectrum demand applied + validated by terminus (boot/reconnect sync)"
                );
                return;
            }
            ApplyOutcome::NotApplied(why) => {
                tracing::debug!(reason = %why, "spectrum demand not applied yet; will retry")
            }
            ApplyOutcome::NoProxy => {
                tracing::debug!("framework proxy not ready yet; will retry")
            }
        }
        if Instant::now() >= deadline {
            tracing::warn!(
                "spectrum demand boot re-assert did not validate within the boot window"
            );
            return;
        }
    }
}

/// Ongoing reconcile loop. Terminus keeps demand in RAM and boots
/// `disabled_default`, so any terminus reload / redeploy silently resets
/// the producer to OFF while the operator's stored intent is still ON.
/// There is NO demand READ verb stocked on the shelf, so we cannot poll
/// terminus and diff; instead, whenever stored intent is ON we idempotently
/// re-push the validated demand on a slow cadence. If terminus already
/// matches, the re-push validates as a no-op; if terminus was reset, the
/// re-push restores it - convergence without a read verb. When intent is
/// OFF we push nothing: terminus's disabled_default already matches, so a
/// reset is harmless and a re-push would be needless device chatter.
pub async fn spawn_demand_reconcile(state: Arc<ServerState>) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // First tick fires immediately; skip it so boot re-assert owns t=0.
    tick.tick().await;
    loop {
        tick.tick().await;
        let want_on = match state.settings.lock() {
            Ok(g) => derive_spectrum_demand(&g.settings)
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            Err(_) => continue,
        };
        if !want_on {
            continue;
        }
        match try_apply_demand(&state).await {
            ApplyOutcome::Applied => {
                tracing::debug!("reconcile: spectrum demand still applied (or restored)")
            }
            ApplyOutcome::NotApplied(why) => {
                tracing::warn!(reason = %why, "reconcile: spectrum demand not applied; will retry next tick")
            }
            ApplyOutcome::NoProxy => { /* framework down; nothing to reconcile against */ }
        }
    }
}

#[cfg(test)]
mod demand_tests {
    use super::{changes_touch_visualizer, derive_spectrum_demand};

    fn map(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn only_production_knobs_trigger() {
        // The system switch (enabled) and the preset both gate the
        // producer, alongside bins and channel mode.
        assert!(changes_touch_visualizer(&map(&[(
            "ui.visualizer.enabled",
            serde_json::json!(true)
        )])));
        assert!(changes_touch_visualizer(&map(&[(
            "ui.visualizer.preset",
            serde_json::json!("bars")
        )])));
        assert!(changes_touch_visualizer(&map(&[(
            "ui.visualizer.bin_count",
            serde_json::json!(64)
        )])));
        assert!(changes_touch_visualizer(&map(&[(
            "ui.visualizer.frequency_scale",
            serde_json::json!("mel")
        )])));
        // Renderer-only knobs must NOT trigger a device write.
        assert!(!changes_touch_visualizer(&map(&[(
            "ui.visualizer.palette",
            serde_json::json!("aurora")
        )])));
        assert!(!changes_touch_visualizer(&map(&[(
            "ui.visualizer.sensitivity_db",
            serde_json::json!(-6)
        )])));
    }

    #[test]
    fn frequency_scale_defaults_to_log_and_clamps() {
        // Absent -> log (matches the framework parse boundary).
        let d = derive_spectrum_demand(&map(&[("ui.visualizer.enabled", serde_json::json!(true))]));
        assert_eq!(d["frequency_scale"], serde_json::json!("log"));
        // Explicit mel / linear pass through verbatim.
        for s in ["mel", "linear", "log"] {
            let d = derive_spectrum_demand(&map(&[(
                "ui.visualizer.frequency_scale",
                serde_json::json!(s),
            )]));
            assert_eq!(d["frequency_scale"], serde_json::json!(s));
        }
        // Garbage/stale value must NOT reach set_demand (framework hard-fails
        // an unknown variant); clamp to log.
        let d = derive_spectrum_demand(&map(&[(
            "ui.visualizer.frequency_scale",
            serde_json::json!("bogus"),
        )]));
        assert_eq!(d["frequency_scale"], serde_json::json!("log"));
    }

    #[test]
    fn master_switch_off_disables_regardless_of_preset() {
        // System switch off -> off, even with a live style preset.
        let d = derive_spectrum_demand(&map(&[
            ("ui.visualizer.enabled", serde_json::json!(false)),
            ("ui.visualizer.preset", serde_json::json!("wave")),
        ]));
        assert_eq!(d["enabled"], serde_json::json!(false));
    }

    #[test]
    fn master_on_with_style_enables() {
        let d = derive_spectrum_demand(&map(&[
            ("ui.visualizer.enabled", serde_json::json!(true)),
            ("ui.visualizer.preset", serde_json::json!("wave")),
        ]));
        assert_eq!(d["enabled"], serde_json::json!(true));
    }

    #[test]
    fn preset_off_is_disabled_even_with_master_on() {
        // linear has no honest-resolution ceiling, so bins pass through - lets
        // this assert the full-count path independently of the log clamp.
        let d = derive_spectrum_demand(&map(&[
            ("ui.visualizer.enabled", serde_json::json!(true)),
            ("ui.visualizer.preset", serde_json::json!("off")),
            ("ui.visualizer.bin_count", serde_json::json!(128)),
            ("ui.visualizer.channel_mode", serde_json::json!("stereo")),
            ("ui.visualizer.frequency_scale", serde_json::json!("linear")),
        ]));
        assert_eq!(d["enabled"], serde_json::json!(false));
        assert_eq!(d["bins"], serde_json::json!(128));
        assert_eq!(d["channels"], serde_json::json!(2));
        assert_eq!(d["rate_hz_target"], serde_json::json!(30));
    }

    #[test]
    fn log_mel_linear_all_pass_through_at_bins_256() {
        // The log honest-max clamp is retired: every scale carries
        // the operator's full bin count, including dense log×256.
        for s in ["log", "mel", "linear"] {
            let d = derive_spectrum_demand(&map(&[
                ("ui.visualizer.frequency_scale", serde_json::json!(s)),
                ("ui.visualizer.bin_count", serde_json::json!(256)),
            ]));
            assert_eq!(d["frequency_scale"], serde_json::json!(s));
            assert_eq!(d["bins"], serde_json::json!(256));
        }
        let log32 = derive_spectrum_demand(&map(&[
            ("ui.visualizer.frequency_scale", serde_json::json!("log")),
            ("ui.visualizer.bin_count", serde_json::json!(32)),
        ]));
        assert_eq!(log32["bins"], serde_json::json!(32));
    }

    #[test]
    fn master_on_live_preset_is_enabled_with_mono() {
        let d = derive_spectrum_demand(&map(&[
            ("ui.visualizer.enabled", serde_json::json!(true)),
            ("ui.visualizer.preset", serde_json::json!("bars")),
            ("ui.visualizer.bin_count", serde_json::json!(64)),
            ("ui.visualizer.channel_mode", serde_json::json!("mono")),
        ]));
        assert_eq!(d["enabled"], serde_json::json!(true));
        assert_eq!(d["channels"], serde_json::json!(1));
    }

    #[test]
    fn virgin_settings_default_off() {
        // No master switch stored -> OFF (opt-in). A virgin device must
        // not start capture on the re-assert without an operator gesture.
        let d = derive_spectrum_demand(&map(&[]));
        assert_eq!(d["enabled"], serde_json::json!(false));
        assert_eq!(d["bins"], serde_json::json!(256));
        assert_eq!(d["channels"], serde_json::json!(1));
        assert_eq!(d["frequency_scale"], serde_json::json!("log"));
    }

    #[test]
    fn master_absent_but_style_present_still_off() {
        // preset set but the switch never written -> still off (opt-in).
        let d =
            derive_spectrum_demand(&map(&[("ui.visualizer.preset", serde_json::json!("wave"))]));
        assert_eq!(d["enabled"], serde_json::json!(false));
    }
}

async fn settings_stream(req: Request<Incoming>, state: Arc<ServerState>) -> Response<ProxyBody> {
    let query = req.uri().query().unwrap_or("");
    let since = parse_query_param_u64(query, "since").unwrap_or(0);
    let timeout_ms = parse_query_param_u64(query, "timeout_ms")
        .map(|v| v.clamp(1000, 60_000))
        .unwrap_or(25_000);
    let deadline = Duration::from_millis(timeout_ms);

    let wait = state.events.wait_next_async(since);
    match timeout(deadline, wait).await {
        Ok(Some(frame)) => {
            let value = serde_json::to_value(&frame).unwrap_or_else(
                |_| serde_json::json!({ "event": "error", "seq": 0, "payload": {} }),
            );
            json_response(StatusCode::OK, value)
        }
        Ok(None) | Err(_) => Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(bytes_body(Bytes::new()))
            .expect("204 builder"),
    }
}

fn not_found_api(path: &str) -> Response<ProxyBody> {
    plain_response(
        StatusCode::NOT_FOUND,
        &format!("api route not found: {path}"),
    )
}

async fn serve_static(req: Request<Incoming>, state: &Arc<ServerState>) -> Response<ProxyBody> {
    let url_path = req.uri().path();
    let resolved = match resolve_static_path(&state.active_release, url_path) {
        Some(p) => p,
        None => return plain_response(StatusCode::BAD_REQUEST, "invalid path"),
    };
    let exists = tokio::fs::metadata(&resolved).await.is_ok();
    let target = if exists {
        resolved
    } else {
        // SPA fallback — every unknown path resolves to
        // index.html so the shell's hash router handles
        // deep links without a 404.
        state.active_release.join("index.html")
    };
    match tokio::fs::read(&target).await {
        Ok(bytes) => {
            let content_type = content_type_for_path(&target);
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", content_type)
                .header("cache-control", "no-store")
                .body(bytes_body(Bytes::from(bytes)))
                .unwrap_or_else(|_| server_error("response build failed"))
        }
        Err(_) => plain_response(StatusCode::NOT_FOUND, "not found"),
    }
}

fn method_not_allowed() -> Response<ProxyBody> {
    plain_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
}

fn bad_request(msg: &str) -> Response<ProxyBody> {
    plain_response(StatusCode::BAD_REQUEST, msg)
}

fn server_error(msg: &str) -> Response<ProxyBody> {
    plain_response(StatusCode::INTERNAL_SERVER_ERROR, msg)
}

fn bad_gateway(msg: &str) -> Response<ProxyBody> {
    plain_response(StatusCode::BAD_GATEWAY, msg)
}

fn plain_response(status: StatusCode, body: &str) -> Response<ProxyBody> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(bytes_body(Bytes::from(body.to_string())))
        .expect("plain response builder")
}

fn json_response(status: StatusCode, body: serde_json::Value) -> Response<ProxyBody> {
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header("content-type", "application/json; charset=utf-8")
        .body(bytes_body(Bytes::from(bytes)))
        .expect("json response builder")
}

fn parse_query_param_u64(query: &str, key: &str) -> Option<u64> {
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=')?;
        if k == key {
            return v.parse().ok();
        }
    }
    None
}

fn resolve_static_path(root: &Path, url_path: &str) -> Option<PathBuf> {
    let trimmed = url_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Some(root.join("index.html"));
    }
    // Refuse any path containing parent traversal or
    // absolute components.
    let candidate = PathBuf::from(trimmed);
    for c in candidate.components() {
        if !matches!(c, Component::Normal(_)) {
            return None;
        }
    }
    Some(root.join(candidate))
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        Some("map") => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[derive(serde::Deserialize)]
struct SettingsPatchRequest {
    #[serde(rename = "baseRevision")]
    base_revision: Option<u64>,
    changes: serde_json::Map<String, serde_json::Value>,
}
