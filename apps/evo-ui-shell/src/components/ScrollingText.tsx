// ScrollingText - overflow-aware text with THREE operator modes
// (ruled: scroll, wrap, truncate - across ALL designs):
//   scroll   - gentle ticker when the text actually overflows;
//              dwells at each end, pauses on pointer, honours
//              prefers-reduced-motion (falls back to the wrap clamp)
//   wrap     - N-line clamp + ellipsis
//   truncate - single line + ellipsis
// Used by the now-playing title/artist/album on BOTH the stage and
// the pivot compact surface.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export type TextOverflowMode = "scroll" | "wrap" | "truncate";

interface ScrollingTextProps {
  text: string;
  mode: TextOverflowMode;
  className?: string;
  /** Lines to clamp to in wrap mode (and reduced-motion fallback). */
  clampLines?: number;
  /** Ticker travel speed in px/sec. */
  speed?: number;
  /** Optional rich content (e.g. classical strip parts). Falls back to text. */
  children?: ComponentChildren;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ScrollingText({
  text,
  mode,
  className,
  clampLines = 2,
  speed = 45,
  children
}: ScrollingTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [reduced, setReduced] = useState(reducedMotion());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Measure overflow whenever the text or the box size changes. Only
  // meaningful in scroll mode (wrap mode clamps instead).
  useEffect(() => {
    const measure = (): void => {
      const vp = viewportRef.current;
      const inner = innerRef.current;
      if (vp === null || inner === null) {
        return;
      }
      const over = inner.scrollWidth - vp.clientWidth;
      setOverflowPx(over > 1 ? over : 0);
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro !== null && viewportRef.current !== null) {
      ro.observe(viewportRef.current);
    }
    return () => ro?.disconnect();
  }, [text, mode]);

  const animating = mode === "scroll" && !reduced && overflowPx > 0 && !paused;
  // truncate stays truncate; wrap mode, or reduced-motion scroll,
  // falls back to the wrap clamp; otherwise scroll.
  const effectiveMode: TextOverflowMode =
    mode === "truncate" ? "truncate" : mode === "wrap" || reduced ? "wrap" : "scroll";

  // Travel time one-way + a dwell at each end; the keyframes split the
  // total into out / hold / back / hold. Duration scales with distance
  // so the px/sec speed stays roughly constant across title lengths.
  const travelMs = Math.round((overflowPx / speed) * 1000);
  const dwellMs = 1400;
  const totalMs = travelMs * 2 + dwellMs * 2;

  const innerStyle = animating
    ? {
        "--marquee-distance": `${overflowPx}px`,
        animationDuration: `${totalMs}ms`
      }
    : undefined;

  return (
    <span
      ref={viewportRef}
      className={
        "scrolling-text" + (className !== undefined ? " " + className : "")
      }
      data-mode={effectiveMode}
      data-animating={animating ? "true" : "false"}
      style={
        effectiveMode === "wrap"
          ? ({ "--clamp-lines": String(clampLines) } as Record<string, string>)
          : undefined
      }
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
      title={text}
    >
      <span
        ref={innerRef}
        className={
          animating ? "scrolling-text-inner is-animating" : "scrolling-text-inner"
        }
        style={innerStyle as Record<string, string> | undefined}
      >
        {children ?? text}
      </span>
    </span>
  );
}
