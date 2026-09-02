//! Device-CA hot-reload watcher.
//!
//! The reverse-proxy's rustls trust root is the framework device-CA
//! at `framework_ca_cert` (default `/var/lib/evo/https/https/ca.crt`,
//! override `EVO_UI_FRAMEWORK_CA_CERT`). Historically the runtime read
//! it ONCE at startup: if the file was absent it initialised with the
//! proxy disabled for the whole session, and if the CA rotated the
//! runtime kept trusting the old bundle until a manual
//! `systemctl restart evo-ui.service`.
//!
//! This watcher closes that class. It observes the CA path and, when
//! the file's content changes and parses as a CA bundle, rebuilds the
//! [`FrameworkProxy`] and swaps it into the shared slot the server
//! reads per request. Two transitions matter:
//!
//! - **enabled**: the file appears after a boot that started without
//!   it (cold-boot ordering, `--mode=reinstall` where the runtime
//!   restarts before the fresh CA lands). `None` -> `Some`.
//! - **reload**: the file's bytes change while already trusted
//!   (framework HTTPS re-mint, operator cert rotation). The trust
//!   root is rebuilt in place.
//!
//! Semantics (quality bar):
//! - **Idempotent.** Keyed on a SHA-256 fingerprint of the bytes; a
//!   spurious wake with unchanged content is a no-op.
//! - **Fail-safe.** A read error (file transiently absent) or a parse
//!   error (permission drop, truncated/malformed cert mid-write) logs
//!   at WARN and PRESERVES the previous proxy — never tears it down.
//! - **Non-blocking read.** Runs on its own task; the per-request read
//!   path only takes a short read-lock on the shared slot.
//!
//! Mechanism is a short poll rather than inotify: it needs no
//! syscall-wrapper dependency, is immune to the tempfile+rename(2)
//! atomic-replace miss that trips a bare inode watch, and a 2s cadence
//! comfortably meets the "reloads within 30s" acceptance.

use crate::proxy::FrameworkProxy;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

/// Swappable proxy slot shared between the server (reader) and this
/// watcher (writer). `None` = proxy not configured; framework routes
/// answer 502 until a CA lands.
pub type SharedProxy = Arc<RwLock<Option<FrameworkProxy>>>;

/// Poll cadence. See the module note on why a poll, not inotify.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// SHA-256 of the CA-bundle bytes, the idempotency key.
pub fn fingerprint(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

/// First 8 hex chars of a fingerprint, for the reload log line.
pub fn hex8(fp: &[u8; 32]) -> String {
    let mut s = String::with_capacity(8);
    for b in &fp[..4] {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Spawn the background reload loop.
///
/// `initial_fingerprint` is the fingerprint of the CA the runtime
/// already loaded at startup (or `None` if it booted without one), so
/// the first poll does not needlessly rebuild an unchanged, already-
/// trusted bundle.
pub fn spawn(
    shared: SharedProxy,
    ca_path: PathBuf,
    upstream_host: String,
    upstream_port: u16,
    initial_fingerprint: Option<[u8; 32]>,
    // Invoked after every successful proxy (re)build - enable or reload.
    // The runtime uses it to re-assert device-side state (e.g. the
    // visualiser demand) so it matches the operator's stored settings the
    // moment the framework becomes reachable again (redeploy, CA rotate).
    on_ready: std::sync::Arc<dyn Fn() + Send + Sync>,
) {
    tokio::spawn(async move {
        let mut last = initial_fingerprint;
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            let bytes = match tokio::fs::read(&ca_path).await {
                Ok(b) => b,
                // Absent/unreadable: keep whatever we have, no churn.
                Err(_) => continue,
            };
            let fp = fingerprint(&bytes);
            if Some(fp) == last {
                continue; // unchanged — idempotent no-op
            }

            match FrameworkProxy::from_ca_pem(
                upstream_host.clone(),
                upstream_port,
                &bytes,
                &ca_path.display().to_string(),
            ) {
                Ok(proxy) => {
                    let was_configured = shared.read().map(|g| g.is_some()).unwrap_or(false);
                    if let Ok(mut g) = shared.write() {
                        *g = Some(proxy);
                    }
                    last = Some(fp);
                    tracing::info!(
                        ca = %ca_path.display(),
                        ca_fp = %hex8(&fp),
                        framework_proxy = true,
                        transition = if was_configured { "reload" } else { "enabled" },
                        "framework reverse-proxy CA hot-reloaded"
                    );
                    // Framework is reachable now (fresh CA / re-mint /
                    // redeploy). Re-assert device-side state so it matches
                    // the operator's stored settings without a manual poke.
                    (on_ready)();
                }
                Err(e) => {
                    // Malformed / permission drop / mid-write truncation:
                    // preserve the previous proxy, do not tear it down.
                    // Record the fingerprint so we do not re-warn every
                    // tick for the same bad bytes; a subsequent good
                    // write changes the fingerprint and retries.
                    tracing::warn!(
                        error = %e,
                        ca = %ca_path.display(),
                        ca_fp = %hex8(&fp),
                        "device-CA change detected but load failed; keeping previous proxy"
                    );
                    last = Some(fp);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_content_addressed() {
        let a = fingerprint(b"-----BEGIN CERTIFICATE-----\n");
        let a2 = fingerprint(b"-----BEGIN CERTIFICATE-----\n");
        let b = fingerprint(b"-----BEGIN CERTIFICATE-----\nX");
        assert_eq!(
            a, a2,
            "same bytes must fingerprint identically (idempotency key)"
        );
        assert_ne!(a, b, "different bytes must fingerprint differently");
    }

    #[test]
    fn hex8_is_eight_lowercase_hex_chars() {
        let fp = fingerprint(b"abc");
        let h = hex8(&fp);
        assert_eq!(h.len(), 8);
        assert!(
            h.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
    }
}
