// Theme-resolved domain icons.
//
// Every collection surface declares which domain it belongs to. When a
// collection item has no per-item artwork, the surface renders the
// icon contributed by the active theme for that domain. The framework
// ships a default map; themes contribute overrides; this module is the
// resolver the renderer consults.
//
// In the current shell, "theme" is a CSS-class + token-set namespace
// (see styles.css `.theme-*` rules); the eventual canonical theme is a
// plugin contributing tokens + assets + `domain_icons`. This module is
// the in-shell expression of that contract: framework defaults plus a
// per-theme overrides table keyed by theme id. The shape ports cleanly
// to the plugin-tier contract when the plugin-side theme primitive
// lands.

import {
  Disc3,
  Folder,
  ListMusic,
  ListOrdered,
  Mic,
  Music2,
  Speaker
} from "lucide-preact";

/**
 * Stable identifiers for the collection domains the shell renders.
 * Surfaces look up their key to obtain the icon used as artwork
 * placeholder when no per-item artwork exists.
 */
export type DomainKey =
  | "audio.queue"
  | "audio.playlist"
  | "audio.browse.album"
  | "audio.browse.artist"
  | "audio.browse.track"
  | "audio.browse.folder"
  | "audio.search.result"
  | "multiroom.device";

/**
 * Component shape shared by every lucide-preact icon. Aliased from
 * Music2 so we do not depend on a versioned typing export.
 */
export type DomainIconComponent = typeof Music2;

/** Framework-default icon map. Used when no theme is loaded or when
 *  the active theme does not override the requested domain. */
const FRAMEWORK_DEFAULTS: Readonly<Record<DomainKey, DomainIconComponent>> = {
  "audio.queue": ListMusic,
  "audio.playlist": ListOrdered,
  "audio.browse.album": Disc3,
  "audio.browse.artist": Mic,
  "audio.browse.track": Music2,
  "audio.browse.folder": Folder,
  "audio.search.result": Music2,
  "multiroom.device": Speaker
};

/** Per-theme overrides. Keyed by theme id. Each map is partial -
 *  missing entries fall through to the framework default. */
const THEME_OVERRIDES: Readonly<
  Record<string, Partial<Record<DomainKey, DomainIconComponent>>>
> = {
  // Demo override so theme switching visibly changes domain placeholders
  // and the theme-overrides contract is observable end-to-end. Other
  // themes currently inherit the framework defaults; richer overrides
  // land per theme decision.
  liquid: {
    "audio.queue": ListOrdered
  }
};

/** Resolver function type. Render-time callers pass a domain key and
 *  receive the icon component to render (size + className + color are
 *  applied at the call site). */
export type DomainIconResolver = (domain: DomainKey) => DomainIconComponent;

/**
 * Build a resolver bound to a theme id. Composes the per-theme
 * overrides over the framework defaults. Cheap to recreate; safe to
 * memoise on theme change.
 */
export function makeDomainIconResolver(themeId: string): DomainIconResolver {
  return (domain) =>
    THEME_OVERRIDES[themeId]?.[domain] ?? FRAMEWORK_DEFAULTS[domain];
}
