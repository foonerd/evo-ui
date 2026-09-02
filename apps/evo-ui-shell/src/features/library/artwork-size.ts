// Operator preference for the artwork image size the browse tiles
// request. The framework artwork endpoint serves per-size variants
// (small / medium WebP, original source); tiles default to `small` so a
// 44px thumbnail never pulls a full-res original. This preference lets
// the operator raise the browse-tile size (e.g. for a large panel).
//
// Applies to our-endpoint artwork only (mpd-* schemes carry a `size`
// query param). External provider images (artist portraits from the
// online cascade) are not our-endpoint and are left untouched.

export type ArtworkSize = "small" | "medium" | "original";

export const ARTWORK_SIZE_KEY = "evo.ui.artworkSize";
export const ARTWORK_SIZES: readonly ArtworkSize[] = [
  "small",
  "medium",
  "original"
];

export function readArtworkSize(): ArtworkSize {
  if (typeof window === "undefined") return "small";
  try {
    const v = window.localStorage.getItem(ARTWORK_SIZE_KEY);
    return v === "medium" || v === "original" ? v : "small";
  } catch {
    return "small";
  }
}

export function writeArtworkSize(size: ArtworkSize): void {
  try {
    window.localStorage.setItem(ARTWORK_SIZE_KEY, size);
  } catch {
    // Storage unavailable (private mode / quota) - the default
    // `small` still applies; nothing to surface.
  }
}

/** Rewrite (or append) the `size` query param on an our-endpoint
 *  artwork URL. Leaves non-`/audio/artwork` URLs untouched so an
 *  external provider portrait URL is never mangled. */
export function applyArtworkSize(url: string, size: ArtworkSize): string {
  if (!url.includes("/audio/artwork")) return url;
  if (/[?&]size=/.test(url)) {
    return url.replace(/([?&]size=)[^&]*/, `$1${size}`);
  }
  return url + (url.includes("?") ? "&" : "?") + "size=" + size;
}
