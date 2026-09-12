// CoverImg - THE canonical cover/artwork <img> for every art-bearing
// surface (track/queue rows, browse tiles, now-playing hero, stage).
//
// Why this exists: art URLs resolve lazily and can 404 while the device
// is still warming its cache (cold resolve, transient upstream). The old
// pattern hid a failed image by imperatively setting `style.display =
// "none"` on the element. That is sticky: the element stays hidden for
// its whole life, so when the SAME element is later handed a working src
// - the resolve finally succeeded, the operator hit Refresh, or the row
// scrolled to a different track - the recovered image never re-appears.
// It was the root of "artwork never updates / Refresh does nothing /
// blank forever after one failure".
//
// The fix is to manage broken-ness in state and key the <img> by its src:
//   - `key={src}` remounts a fresh element on every src change, so a new
//     URL always gets a clean load attempt (no inherited hidden style).
//   - `broken` resets whenever src changes, so a recovered URL re-shows.
//   - while broken (or src is null) we render `fallback` (a placeholder
//     glyph / gradient), never a broken-image box.
//
// This does NOT retry or re-resolve on its own - that policy (bounded
// self-heal, refresh=1 on manual Refresh) lives in the owning surface,
// which drives recovery by handing CoverImg a new src.

import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

interface CoverImgProps {
  /** Resolved artwork URL, or null when there is nothing to show. */
  src: string | null;
  className?: string;
  alt?: string;
  /** Rendered when src is null OR the image failed to load. Defaults to
   *  nothing (surfaces that paint their own placeholder behind the img). */
  fallback?: ComponentChildren;
}

export function CoverImg({ src, className, alt = "", fallback = null }: CoverImgProps) {
  const [broken, setBroken] = useState(false);
  // Any src change is a fresh load attempt - clear the broken flag so the
  // new URL can render and try again.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (src === null || broken) {
    return <>{fallback}</>;
  }
  return (
    <img
      key={src}
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
