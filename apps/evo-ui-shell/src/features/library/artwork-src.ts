// The one rule for the address a list tile paints. Pure: no preact.
//
// The library scan finds each album's local art once and carries its
// content hash as an optional `artwork_hash` on list rows. The device
// serves those bytes at `/api/v1/audio/artwork/<hash>` as immutable, so a
// tile that paints the hash makes no resolve call and is cached for good.
// The hash is of the `small` art - the size every list row requests. A
// tile that paints another size (the operator's medium / original on
// facet tiles) keeps its sized resolve address, and so does an album
// with no local art.

/** Where the device serves art by content hash. */
export const ARTWORK_HASH_PREFIX = "/api/v1/audio/artwork/";
/** The size the scan-time hash is of. */
export const HASHED_SIZE = "small";

const HASH_RE = /^[0-9a-f]{64}$/;

/** A wire `artwork_hash`: 64 lowercase hex characters (the device's own
 *  check on the hash route), or null. */
export function decodeArtworkHash(raw: unknown): string | null {
  return typeof raw === "string" && HASH_RE.test(raw) ? raw : null;
}

/** The immutable address for a content hash. */
export function artworkHashUrl(hash: string): string {
  return ARTWORK_HASH_PREFIX + hash;
}

/** The `size` a resolve address asks for, or null when it names none. */
function paintedSize(url: string): string | null {
  const q = url.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get("size");
}

/** The address a tile paints. `url` is the address the surface would
 *  paint today (already sized where the surface sizes it); null means
 *  the surface paints none, and that stands. The hash address is used
 *  only when that address asks for the small art. */
export function artworkSrc(hash: string | null, url: string | null): string | null {
  if (url === null) return null;
  if (hash === null) return url;
  return paintedSize(url) === HASHED_SIZE ? artworkHashUrl(hash) : url;
}

/** A resolve address re-requested after its art landed: a fresh load
 *  attempt (`_t`), never a forget. A hash address is immutable and is
 *  never re-requested. */
export function withLandingBust(url: string | null, landing: number): string | null {
  if (url === null || landing <= 0 || url.startsWith(ARTWORK_HASH_PREFIX)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_t=${landing}`;
}
