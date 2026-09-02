//! Runtime configuration + authoritative state types.
//!
//! Owns:
//! - [`RuntimeConfig`] — environment-driven configuration
//!   for the listener bind, the active release path, and the
//!   framework-proxy upstream.
//! - [`SettingsSnapshot`] — authoritative UI settings store
//!   with atomic file persistence + revisioned mutation.
//! - [`EventHub`] — async-aware single-slot event channel
//!   for the `/api/ui/v1/ws` long-poll stream.
//! - [`RuntimeError`] — error taxonomy.
//!
//! The HTTP serving layer lives in [`crate::server`]; the
//! framework reverse-proxy lives in [`crate::proxy`].

use std::env;
use std::fmt::{Display, Formatter};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

/// Environment-driven runtime configuration.
#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    /// Filesystem root for runtime state.
    pub runtime_root: PathBuf,
    /// Active release directory served at `/`.
    pub active_release: PathBuf,
    /// Authoritative settings file.
    pub settings_file: PathBuf,
    /// Sibling backup of the settings file.
    pub settings_backup_file: PathBuf,
    /// HTTP listener port. Locked at 80 per the operator-UX
    /// invariant (the operator's browser hits a bare hostname
    /// without specifying a port).
    pub http_port: u16,
    /// Reserved HTTPS port (the runtime does not currently
    /// bind it — the framework's HTTPS substrate handles
    /// external-API-consumer TLS on its own listener).
    pub https_port: u16,
    /// When true, the runtime exits after bootstrap without
    /// binding the listener. Used by install scripts to
    /// validate config + lay down the settings file before
    /// starting the long-lived service.
    pub bootstrap_only: bool,
    /// Framework HTTPS host the reverse-proxy connects to.
    /// Default `127.0.0.1`.
    pub framework_https_host: String,
    /// Framework HTTPS port the reverse-proxy connects to.
    /// Default `8443`.
    pub framework_https_port: u16,
    /// Path to the device CA cert used as the trust root for
    /// the loopback upstream TLS handshake. Default
    /// `/var/lib/evo/https/https/ca.crt`.
    pub framework_ca_cert: PathBuf,
    /// Path to the deployed catalogue file. Parsed at boot so
    /// the capability projection derives shelf-backed UI
    /// capabilities from the actual catalogue rather than a
    /// hand-maintained source-side list. Default
    /// `/opt/evo/catalogue/default.toml` (matches the audio +
    /// vendor bootstrap installers).
    pub catalogue_path: PathBuf,
}

impl RuntimeConfig {
    /// Build from environment variables, falling back to
    /// platform defaults when unset.
    pub fn from_env() -> Self {
        let runtime_root = env::var("EVO_UI_RUNTIME_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/opt/evo/ui"));
        let active_release = env::var("EVO_UI_ACTIVE_RELEASE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| runtime_root.join("current"));
        let settings_file = env::var("EVO_UI_SETTINGS_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| runtime_root.join("data/settings.json"));
        let settings_backup_file = env::var("EVO_UI_SETTINGS_BACKUP_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| runtime_root.join("data/settings.json.bak"));

        let http_port = env::var("EVO_UI_HTTP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(80);
        let https_port = env::var("EVO_UI_HTTPS_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(443);
        let bootstrap_only = env::var("EVO_UI_BOOTSTRAP_ONLY")
            .ok()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let framework_https_host =
            env::var("EVO_UI_FRAMEWORK_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let framework_https_port = env::var("EVO_UI_FRAMEWORK_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(8443);
        let framework_ca_cert = env::var("EVO_UI_FRAMEWORK_CA_CERT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/var/lib/evo/https/https/ca.crt"));

        let catalogue_path = env::var("EVO_UI_CATALOGUE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/opt/evo/catalogue/default.toml"));

        Self {
            runtime_root,
            active_release,
            settings_file,
            settings_backup_file,
            http_port,
            https_port,
            bootstrap_only,
            framework_https_host,
            framework_https_port,
            framework_ca_cert,
            catalogue_path,
        }
    }

    /// Refuse start when the port policy is violated.
    pub fn validate(&self) -> Result<(), RuntimeError> {
        if self.http_port == 0 {
            return Err(RuntimeError::InvalidConfig(
                "HTTP port must be non-zero".to_string(),
            ));
        }
        if self.https_port == 0 {
            return Err(RuntimeError::InvalidConfig(
                "HTTPS port must be non-zero".to_string(),
            ));
        }
        if self.http_port == self.https_port {
            return Err(RuntimeError::InvalidConfig(
                "HTTP and HTTPS ports must differ".to_string(),
            ));
        }
        if self.http_port != 80 {
            return Err(RuntimeError::InvalidConfig(
                "HTTP port policy violation: port 80 must stay available".to_string(),
            ));
        }
        Ok(())
    }
}

/// Authoritative UI settings snapshot. Revisioned + atomic-
/// persistable. Mutations consume a `&mut self`; the server
/// path holds the snapshot behind a `Mutex` for short
/// critical sections.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingsSnapshot {
    /// Monotonic revision incremented on every changing
    /// patch.
    pub revision: u64,
    /// Key-value bag of settings. The runtime does not
    /// interpret values; the UI shell + ADRs name keys.
    pub settings: serde_json::Map<String, serde_json::Value>,
}

impl SettingsSnapshot {
    /// Build the default-policy snapshot used on first boot.
    pub fn default_policy() -> Self {
        let mut settings = serde_json::Map::new();
        settings.insert(
            "ui.theme".to_string(),
            serde_json::Value::String("evo-default".to_string()),
        );
        settings.insert(
            "playback.volume.step".to_string(),
            serde_json::Value::from(5u64),
        );
        settings.insert(
            "network.http.always_on".to_string(),
            serde_json::Value::Bool(true),
        );
        settings.insert(
            "network.http.mode".to_string(),
            serde_json::Value::String("serve".to_string()),
        );
        settings.insert(
            "network.https.enabled".to_string(),
            serde_json::Value::Bool(false),
        );
        settings.insert(
            "network.https.cert.mode".to_string(),
            serde_json::Value::String("device-ca".to_string()),
        );

        Self {
            revision: 1,
            settings,
        }
    }

    /// Load from a previously-persisted JSON file.
    pub fn load(path: &PathBuf) -> Result<Self, RuntimeError> {
        let bytes = fs::read(path).map_err(RuntimeError::Io)?;
        serde_json::from_slice::<Self>(&bytes).map_err(RuntimeError::Serde)
    }

    /// Persist atomically via tempfile + rename.
    pub fn store_atomic(&self, path: &PathBuf) -> Result<(), RuntimeError> {
        let parent = path.parent().ok_or_else(|| {
            RuntimeError::InvalidConfig("settings destination has no parent directory".to_string())
        })?;
        fs::create_dir_all(parent).map_err(RuntimeError::Io)?;
        let temp_path = path.with_extension("tmp");
        let payload = serde_json::to_vec_pretty(self).map_err(RuntimeError::Serde)?;
        {
            let mut file = File::create(&temp_path).map_err(RuntimeError::Io)?;
            file.write_all(&payload).map_err(RuntimeError::Io)?;
            file.sync_all().map_err(RuntimeError::Io)?;
        }
        fs::rename(&temp_path, path).map_err(RuntimeError::Io)?;
        Ok(())
    }

    /// Apply a key-value patch. Returns `true` when at least
    /// one mapping changed (and the revision is incremented).
    pub fn apply_patch(&mut self, changes: &serde_json::Map<String, serde_json::Value>) -> bool {
        let mut changed = false;
        for (key, value) in changes {
            let prior = self.settings.insert(key.clone(), value.clone());
            if prior.as_ref() != Some(value) {
                changed = true;
            }
        }
        if changed {
            self.revision = self.revision.saturating_add(1);
        }
        changed
    }

    /// JSON envelope returned by `/api/ui/v1/settings`.
    pub fn as_value(&self) -> serde_json::Value {
        serde_json::json!({
            "revision": self.revision,
            "settings": self.settings,
        })
    }
}

/// Async-aware single-slot event channel for the settings
/// stream long-poll.
#[derive(Default)]
pub struct EventHub {
    state: std::sync::Mutex<EventState>,
    notify: Notify,
}

#[derive(Default)]
struct EventState {
    seq: u64,
    latest: Option<UiEventFrame>,
}

/// One published event frame.
#[derive(Clone, Debug, Serialize)]
pub struct UiEventFrame {
    /// Event name (e.g. `ui.settings.changed`).
    pub event: String,
    /// Monotonic sequence number across the hub.
    pub seq: u64,
    /// Free-form payload.
    pub payload: serde_json::Map<String, serde_json::Value>,
}

impl EventHub {
    /// Publish an event. Wakes every waiter; waiters whose
    /// `since` matches the new `seq` return immediately.
    pub fn publish(&self, event: &str, payload: serde_json::Value) {
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        state.seq = state.seq.saturating_add(1);
        let payload_map = match payload {
            serde_json::Value::Object(map) => map,
            value => {
                let mut map = serde_json::Map::new();
                map.insert("value".to_string(), value);
                map
            }
        };
        state.latest = Some(UiEventFrame {
            event: event.to_string(),
            seq: state.seq,
            payload: payload_map,
        });
        drop(state);
        self.notify.notify_waiters();
    }

    /// Async wait for the next event whose `seq > since`.
    /// Returns `None` when the hub has no event newer than
    /// `since` and the caller cancels (the timeout in
    /// [`crate::server`] wraps this in a `tokio::time::timeout`).
    pub async fn wait_next_async(self: &Arc<Self>, since: u64) -> Option<UiEventFrame> {
        loop {
            // Check current state under the std mutex; the
            // critical section is short.
            {
                let state = self.state.lock().ok()?;
                if let Some(frame) = state.latest.as_ref() {
                    if frame.seq > since {
                        return Some(frame.clone());
                    }
                }
            }
            // Subscribe BEFORE re-checking to avoid racing
            // against a `publish` that fires between the
            // check and the await.
            let notified = self.notify.notified();
            // Re-check after subscribing.
            {
                let state = self.state.lock().ok()?;
                if let Some(frame) = state.latest.as_ref() {
                    if frame.seq > since {
                        return Some(frame.clone());
                    }
                }
            }
            notified.await;
        }
    }
}

/// Runtime error taxonomy.
#[derive(Debug)]
pub enum RuntimeError {
    /// Configuration is invalid; refuse start.
    InvalidConfig(String),
    /// Active release path missing or incomplete.
    MissingActiveRelease(String),
    /// I/O failure during persistence.
    Io(std::io::Error),
    /// JSON serialisation / deserialisation failure.
    Serde(serde_json::Error),
    /// Listener / network error.
    Http(String),
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(m) => write!(f, "{m}"),
            Self::MissingActiveRelease(m) => write!(f, "{m}"),
            Self::Io(e) => write!(f, "{e}"),
            Self::Serde(e) => write!(f, "{e}"),
            Self::Http(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for RuntimeError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("evo-ui-runtime-tests-{nanos}"))
    }

    #[test]
    fn default_paths_match_runtime_policy() {
        let cfg = RuntimeConfig::from_env();
        assert_eq!(cfg.runtime_root, PathBuf::from("/opt/evo/ui"));
        assert_eq!(cfg.active_release, PathBuf::from("/opt/evo/ui/current"));
        assert_eq!(
            cfg.settings_file,
            PathBuf::from("/opt/evo/ui/data/settings.json")
        );
    }

    #[test]
    fn default_framework_proxy_targets_loopback() {
        let cfg = RuntimeConfig::from_env();
        assert_eq!(cfg.framework_https_host, "127.0.0.1");
        assert_eq!(cfg.framework_https_port, 8443);
        assert_eq!(
            cfg.framework_ca_cert,
            PathBuf::from("/var/lib/evo/https/https/ca.crt")
        );
    }

    #[test]
    fn default_catalogue_path_matches_bootstrap_install_target() {
        // Every distribution's bootstrap installs the catalogue
        // at /opt/evo/catalogue/default.toml; the runtime must
        // point at that same location or the shelf-derived
        // capability projection silently falls back to the
        // framework baseline on every rig.
        let cfg = RuntimeConfig::from_env();
        assert_eq!(
            cfg.catalogue_path,
            PathBuf::from("/opt/evo/catalogue/default.toml")
        );
    }

    #[test]
    fn default_settings_include_port_and_tls_policy_keys() {
        let snapshot = SettingsSnapshot::default_policy();
        assert_eq!(snapshot.revision, 1);
        assert_eq!(
            snapshot.settings.get("network.http.always_on"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn settings_round_trip_atomic_store_and_load() {
        let dir = unique_temp_dir();
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("settings.json");
        let snapshot = SettingsSnapshot::default_policy();
        snapshot.store_atomic(&path).expect("store settings");
        let loaded = SettingsSnapshot::load(&path).expect("load settings");
        assert_eq!(loaded.revision, snapshot.revision);
        assert_eq!(loaded.settings.len(), snapshot.settings.len());
    }

    #[test]
    fn settings_patch_increments_revision_only_when_changed() {
        let mut snapshot = SettingsSnapshot::default_policy();
        let initial_revision = snapshot.revision;

        let mut no_change = serde_json::Map::new();
        no_change.insert(
            "ui.theme".to_string(),
            serde_json::Value::String("evo-default".to_string()),
        );
        assert!(!snapshot.apply_patch(&no_change));
        assert_eq!(snapshot.revision, initial_revision);

        let mut changed = serde_json::Map::new();
        changed.insert(
            "ui.theme".to_string(),
            serde_json::Value::String("night".to_string()),
        );
        assert!(snapshot.apply_patch(&changed));
        assert_eq!(snapshot.revision, initial_revision + 1);
    }

    #[tokio::test]
    async fn event_hub_publishes_and_wakes_waiter() {
        let hub = Arc::new(EventHub::default());
        let hub_clone = Arc::clone(&hub);
        let join = tokio::spawn(async move { hub_clone.wait_next_async(0).await });
        // Give the waiter a moment to subscribe.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        hub.publish("test.event", serde_json::json!({"k": "v"}));
        let frame = join.await.unwrap();
        let frame = frame.expect("frame");
        assert_eq!(frame.event, "test.event");
        assert_eq!(frame.seq, 1);
    }

    #[tokio::test]
    async fn event_hub_returns_immediately_on_existing_event() {
        let hub = Arc::new(EventHub::default());
        hub.publish("first", serde_json::json!({}));
        let frame = hub.wait_next_async(0).await.expect("frame");
        assert_eq!(frame.seq, 1);
    }
}
