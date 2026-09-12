// Operator preference for the artwork image size the browse tiles
// request. The distribution artwork HTTP endpoint serves per-size variants
// (small / medium WebP, original source); tiles default to `small` so a
// 44px thumbnail never pulls a full-res original. This preference lets
// the operator raise the browse-tile size (e.g. for a large panel).
//
// Applies to our-endpoint artwork only (mpd-* schemes carry a `size`
// query param). External provider images (artist portraits from the
// online cascade) are not our-endpoint and are left untouched.

import { storedBearer } from "../../runtime/bearer";

export type ArtworkSize = "small" | "medium" | "original";

/** Outcome of an artwork clear (DELETE /api/v1/audio/artwork). */
export interface ArtworkClearResult {
  /** True only on a 2xx. A 401/403 (no write capability) is ok=false -
   *  the caller MUST NOT report success or blank the tile on false. */
  ok: boolean;
  /** Counts the server evicted, when it reports them (null otherwise). */
  indexEntriesRemoved: number | null;
  assetsDeleted: number | null;
}

/** Evict artwork through the one destructive server gesture. Targeted
 *  when `target` is given (that subject only), all-scope otherwise.
 *
 *  DELETE is write:audio-gated, so the operator bearer MUST ride the
 *  request - a bare fetch is refused on any device that does not grant
 *  write to an anonymous LAN principal, and silently reporting success
 *  on that refusal is exactly the lie this whole surface has been about.
 *  Removes online-fetched artwork (asset bytes + resolve-index + plugin
 *  memo); local folder/embedded art is a different plugin and is kept. */
export async function clearArtwork(target?: {
  scheme: string;
  value: string;
}): Promise<ArtworkClearResult> {
  const query =
    target === undefined
      ? ""
      : "?scheme=" +
        encodeURIComponent(target.scheme) +
        "&value=" +
        encodeURIComponent(target.value);
  const headers: Record<string, string> = {};
  const tok = storedBearer();
  if (tok !== undefined) headers["Authorization"] = `Bearer ${tok}`;
  const fail: ArtworkClearResult = {
    ok: false,
    indexEntriesRemoved: null,
    assetsDeleted: null
  };
  if (typeof fetch === "undefined") return fail;
  try {
    const res = await fetch(`/api/v1/audio/artwork${query}`, {
      method: "DELETE",
      headers
    });
    if (!res.ok) return fail;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const num = (k: string): number | null => {
      const v =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)[k]
          : undefined;
      return typeof v === "number" ? v : null;
    };
    return {
      ok: true,
      indexEntriesRemoved: num("index_entries_removed"),
      assetsDeleted: num("assets_deleted")
    };
  } catch {
    return fail;
  }
}

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
