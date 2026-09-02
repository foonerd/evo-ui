//! Catalogue-driven capability derivation.
//!
//! The steward's catalogue file (`/opt/evo/catalogue/default.toml`
//! by default) declares every rack + shelf the distribution
//! admits. This module parses that file at UI runtime boot and
//! surfaces the set of admitted shelf names so the capability
//! projection can advertise the UI capabilities that map to them
//! — no source edit needed when a new plugin lands on a new
//! shelf, provided the catalogue declares it.
//!
//! Failure discipline: missing or unparseable catalogue returns
//! an empty set, NOT an error. The runtime still boots and
//! serves the framework baseline capabilities — the operator's
//! bootstrap surface must not depend on the network / metadata
//! plugin plane being reachable. Callers that need to
//! distinguish "no catalogue" from "empty catalogue" inspect
//! the return of [`load_catalogue_shelves`].
//!
//! Only structure required by the derivation is parsed —
//! `[[racks]] name` + `[[racks.shelves]] name`. Ignoring the
//! rest of the catalogue (subject types, relation predicates,
//! plugin bindings) keeps this scanner narrow and forward-
//! compatible with catalogue evolution.

use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

/// One admitted shelf, fully qualified as `<rack>.<shelf>` to
/// match the catalogue's shelf-address convention. Used by
/// [`derive_capabilities`] as the lookup key.
pub type ShelfKey = String;

#[derive(Debug, Deserialize)]
struct CatalogueRaw {
    #[serde(default)]
    racks: Vec<RackRaw>,
}

#[derive(Debug, Deserialize)]
struct RackRaw {
    #[serde(default)]
    name: String,
    #[serde(default)]
    shelves: Vec<ShelfRaw>,
}

#[derive(Debug, Deserialize)]
struct ShelfRaw {
    #[serde(default)]
    name: String,
}

/// Parse the catalogue at `path` and return the set of admitted
/// `<rack>.<shelf>` keys. Empty set on any parse or I/O error —
/// see the module doc for the rationale.
pub fn load_catalogue_shelves(path: &Path) -> HashSet<ShelfKey> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "catalogue unreadable; UI capability derivation \
                 falls back to framework baseline",
            );
            return HashSet::new();
        }
    };
    let raw: CatalogueRaw = match toml::from_str(&text) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "catalogue parse failed; UI capability derivation \
                 falls back to framework baseline",
            );
            return HashSet::new();
        }
    };
    let mut out = HashSet::new();
    for rack in raw.racks {
        let rack_name = rack.name.trim();
        if rack_name.is_empty() {
            continue;
        }
        for shelf in rack.shelves {
            let shelf_name = shelf.name.trim();
            if shelf_name.is_empty() {
                continue;
            }
            out.insert(format!("{rack_name}.{shelf_name}"));
        }
    }
    out
}

/// One UI capability derived from an admitted shelf. Mapping is
/// deliberately conservative — a shelf must be COVERED by
/// operator-facing widgets before it appears here; declaring
/// the shelf alone is not enough. Held at `partial` until the
/// hardware acceptance matrix signs off.
///
/// The tuple is `(shelf_key, capability_key, status)`. Adding a
/// new capability = add one row here. The runtime consults the
/// admitted-shelves set against this table on every capability
/// request.
const SHELF_TO_CAPABILITY: &[(&str, &str, &str)] = &[
    // Settings → Network operator surface — scan / join,
    // DHCP|static (eth+STA), hotspot, flight, captive, preferred
    // radio, country + band gates. Wired against the current
    // wire contract; hardware acceptance across the supported
    // target triples remains the promotion gate before this
    // flips to "supported".
    ("networking.link", "network.settings", "partial"),
];

/// Return the capabilities the runtime should advertise given
/// the admitted shelf set. Each returned entry is `(capability_
/// key, status)`. Callers merge these into the framework
/// baseline (`framework.proxy` / `framework.ws` / `ui.settings*`)
/// to produce the final capability map.
pub fn derive_capabilities(
    admitted_shelves: &HashSet<ShelfKey>,
) -> Vec<(&'static str, &'static str)> {
    SHELF_TO_CAPABILITY
        .iter()
        .filter(|(shelf, _, _)| admitted_shelves.contains(*shelf))
        .map(|(_, cap, status)| (*cap, *status))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(contents: &str) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        f
    }

    #[test]
    fn missing_catalogue_yields_empty_set() {
        let bogus = std::path::PathBuf::from("/tmp/does-not-exist-abc123");
        assert!(load_catalogue_shelves(&bogus).is_empty());
    }

    #[test]
    fn empty_toml_yields_empty_set() {
        let f = write_temp("");
        assert!(load_catalogue_shelves(f.path()).is_empty());
    }

    #[test]
    fn malformed_toml_yields_empty_set() {
        let f = write_temp("this is not toml [[[");
        assert!(load_catalogue_shelves(f.path()).is_empty());
    }

    #[test]
    fn parses_networking_link_from_catalogue() {
        let f = write_temp(
            r#"
[[racks]]
name = "networking"

[[racks.shelves]]
name = "link"

[[racks.shelves]]
name = "reachable"
"#,
        );
        let shelves = load_catalogue_shelves(f.path());
        assert!(shelves.contains("networking.link"));
        assert!(shelves.contains("networking.reachable"));
    }

    #[test]
    fn ignores_unrelated_toml_fields() {
        // Catalogue carries subject types, relation predicates,
        // and per-rack charter alongside the shelf declarations.
        // The parser must ignore everything it does not need.
        let f = write_temp(
            r#"
[[subjects]]
name = "track"
description = "unrelated"

[[racks]]
name = "audio"
family = "domain"
kinds = ["transformer"]
charter = "long charter text"

[[racks.shelves]]
name = "playback"
shape = 1
description = "long shelf description"

[[relations]]
predicate = "track_of_album"
"#,
        );
        let shelves = load_catalogue_shelves(f.path());
        assert_eq!(shelves.len(), 1);
        assert!(shelves.contains("audio.playback"));
    }

    #[test]
    fn derive_returns_network_settings_when_link_admitted() {
        let mut set = HashSet::new();
        set.insert("networking.link".to_string());
        let caps = derive_capabilities(&set);
        assert!(caps.contains(&("network.settings", "partial")));
    }

    #[test]
    fn derive_omits_network_settings_when_link_not_admitted() {
        let set = HashSet::new();
        let caps = derive_capabilities(&set);
        assert!(!caps.iter().any(|(k, _)| *k == "network.settings"));
    }

    #[test]
    fn derive_ignores_unmapped_shelves() {
        // A shelf that the catalogue declares but the runtime
        // has no widget mapping for must NOT produce a phantom
        // capability entry.
        let mut set = HashSet::new();
        set.insert("audio.playback".to_string());
        set.insert("storage.mount".to_string());
        let caps = derive_capabilities(&set);
        assert!(caps.is_empty());
    }
}
