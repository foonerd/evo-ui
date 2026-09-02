// HeartbeatOverlay - the framework's canonical wait affordance.
//
// Renders a pulsing brand glyph + two ripple rings while the
// parent reports a wait in progress. The visual is ported from
// evoframework.org's hero-heartbeat (see static/css/site.css)
// and re-themed against the shell's --primary token so each
// theme keeps its own colour identity.
//
// Operator contract:
// - Every wait that crosses ~one network round trip should show
//   the heartbeat. Sub-tick (<1500 ms) responses still flash the
//   overlay for one full tick so the operator gets a consistent
//   "yes, we asked" beat regardless of how fast the answer was.
// - The minimum visible duration enforces this: once shown,
//   the overlay stays for at least minDurationMs (default 1500 ms,
//   one heartbeat tick) even if `visible` flips to false earlier.
// - The label, when given, renders right of the glyph in
//   inline mode. Standalone mode renders the glyph alone.
//
// The overlay is intentionally non-modal and non-blocking: it
// does not consume input. Consumers are responsible for any
// disabling of affordances during the wait.

import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

export type HeartbeatSize = "sm" | "md" | "lg" | "xl";

interface HeartbeatOverlayProps {
  /** Parent's "currently waiting" boolean. */
  visible: boolean;
  /** Optional label rendered alongside the glyph. */
  label?: string;
  /** Glyph size; default md (22x22). */
  size?: HeartbeatSize;
  /** Render glyph + label as a row, vs glyph standalone. */
  inline?: boolean;
  /** Minimum visible duration in ms. Default 1500 (one tick). */
  minDurationMs?: number;
  /** ARIA live region politeness. Default polite. */
  ariaLive?: "polite" | "off" | "assertive";
  /** Optional render-when-not-shown content. Useful when the
   *  overlay occupies a slot that should otherwise show a
   *  resting affordance (e.g. a freshness timestamp). */
  fallback?: ComponentChildren;
}

export function HeartbeatOverlay({
  visible,
  label,
  size = "md",
  inline = false,
  minDurationMs = 1500,
  ariaLive = "polite",
  fallback
}: HeartbeatOverlayProps) {
  // shown is the rendered truth; visible is the parent's truth.
  // They can disagree for up to minDurationMs after visible flips
  // off so the operator always sees at least one full heartbeat
  // tick.
  const [shown, setShown] = useState(visible);
  const shownSinceRef = useRef<number | null>(visible ? Date.now() : null);
  const pendingHideHandle = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      // Cancel any pending hide and show immediately.
      if (pendingHideHandle.current !== null) {
        window.clearTimeout(pendingHideHandle.current);
        pendingHideHandle.current = null;
      }
      if (!shown) {
        shownSinceRef.current = Date.now();
        setShown(true);
      } else if (shownSinceRef.current === null) {
        // Defensive: keep the timestamp coherent across re-shows.
        shownSinceRef.current = Date.now();
      }
      return;
    }
    // visible === false: hold the overlay shown until the min
    // duration has elapsed, then hide.
    if (!shown) return;
    const since = shownSinceRef.current ?? Date.now();
    const elapsed = Date.now() - since;
    const remaining = Math.max(0, minDurationMs - elapsed);
    pendingHideHandle.current = window.setTimeout(() => {
      pendingHideHandle.current = null;
      shownSinceRef.current = null;
      setShown(false);
    }, remaining);
    return () => {
      if (pendingHideHandle.current !== null) {
        window.clearTimeout(pendingHideHandle.current);
        pendingHideHandle.current = null;
      }
    };
  }, [visible, shown, minDurationMs]);

  if (!shown) {
    return fallback === undefined ? null : <>{fallback}</>;
  }

  const sizeClass =
    size === "sm"
      ? "evo-heartbeat-sm"
      : size === "lg"
        ? "evo-heartbeat-lg"
        : size === "xl"
          ? "evo-heartbeat-xl"
          : "";
  const wrapperClass = ["evo-heartbeat", sizeClass].filter((s) => s !== "").join(" ");

  if (inline) {
    return (
      <span className="evo-heartbeat-inline" role="status" aria-live={ariaLive}>
        <span className={wrapperClass} aria-hidden="true">
          <span className="evo-heartbeat-glyph"></span>
        </span>
        {label !== undefined ? (
          <span className="evo-heartbeat-inline-label">{label}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={wrapperClass}
      role="status"
      aria-live={ariaLive}
      aria-label={label}
    >
      <span className="evo-heartbeat-glyph"></span>
    </span>
  );
}
