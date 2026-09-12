// Resolve the current artist's image for the fullscreen artwork
// slideshow. Single paint path: this returns the VALIDATED byte endpoint
// URL (scheme=artist-name), the same serve path the browse tiles paint -
// never a raw provider image_url from the resolve verb. That verb URL was
// the second, unvalidated paint path: it could hand back a placeholder
// silhouette the serve path would reject, so the fullscreen zoom showed a
// grey blob where the tile showed nothing.
//
// The byte endpoint applies pixel placeholder rejection (size=large is
// measured; Original is a passthrough that fails open, so it is NOT used
// here for portraits). A 200 means a real validated image; a 404 means
// none, and we return null so the slideshow simply omits the frame rather
// than showing a broken image. One deliberate lookup per artist, memoised.

import { useEffect, useRef, useState } from "preact/hooks";

function artistByteUrl(artist: string): string {
  return (
    "/api/v1/audio/artwork?scheme=artist-name&value=" +
    encodeURIComponent(artist) +
    "&size=large"
  );
}

export function useArtistImage(artist: string | null): string | null {
  // Per-artist memo so re-opening the slideshow never re-asks.
  const cache = useRef<Map<string, string | null>>(new Map());
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (artist === null || artist.length === 0 || typeof fetch === "undefined") {
      setUrl(null);
      return undefined;
    }
    const memo = cache.current.get(artist);
    if (memo !== undefined) {
      setUrl(memo);
      return undefined;
    }
    let cancelled = false;
    const byteUrl = artistByteUrl(artist);
    void (async () => {
      let resolved: string | null = null;
      // Only a SUCCESS is memoised. A miss is NOT cached, because a miss
      // today is not necessarily "no portrait" - the byte endpoint maps an
      // admission/queue timeout to the same failure as an honest absence,
      // so caching it null would strand the artist on a glyph forever (the
      // exact permanent-negative bug this hook shipped with). Not caching
      // means the next deliberate zoom re-asks; once the serve path
      // distinguishes 503 (transient, retry) from 404 (absent, cache),
      // this can memoise the honest-404 too.
      try {
        const res = await fetch(byteUrl, { method: "GET" });
        if (res.ok) {
          resolved = byteUrl;
          cache.current.set(artist, resolved);
        }
      } catch {
        // Network error - not cached; the slideshow shows the cover only.
      }
      if (!cancelled) setUrl(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [artist]);

  return artist === null ? null : url;
}
