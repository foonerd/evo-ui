// Resolve the current artist's image for the fullscreen artwork
// slideshow, using the SAME cache-first resolver the Browse/library
// tiles use (`artwork.resolve_artist_artwork` on the artwork.providers
// shelf, fanart.tv-backed). It is a light metadata lookup, not a fresh
// image download: the framework caches the result, and the image bytes
// cache in the browser after first load. Returns null when there is no
// transport, no artist, no key, or no match - the slideshow then simply
// shows what it does have (the cover).

import { useEffect, useRef, useState } from "preact/hooks";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";

const ARTWORK_SHELF = "artwork.providers";
const RESOLVE_ARTIST_ARTWORK = "artwork.resolve_artist_artwork";

export function useArtistImage(artist: string | null): string | null {
  const transport = tryUseFrameworkTransport();
  // Per-artist memo so re-opening the slideshow never re-asks.
  const cache = useRef<Map<string, string | null>>(new Map());
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (artist === null || artist.length === 0 || transport === null) {
      setUrl(null);
      return undefined;
    }
    const memo = cache.current.get(artist);
    if (memo !== undefined) {
      setUrl(memo);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const r = await pluginRequest(transport, ARTWORK_SHELF, RESOLVE_ARTIST_ARTWORK, {
        v: 1,
        artist
      });
      let resolved: string | null = null;
      if (
        r.error === undefined &&
        r.value !== null &&
        typeof r.value === "object"
      ) {
        const u = (r.value as Record<string, unknown>)["image_url"];
        if (typeof u === "string" && u.length > 0) resolved = u;
      }
      cache.current.set(artist, resolved);
      if (!cancelled) setUrl(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [artist, transport]);

  return artist === null ? null : url;
}
