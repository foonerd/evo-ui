// HeartbeatPanel - the centered "I am doing something"
// affordance for long-running operations.
//
// Always full-viewport-centered (position: fixed). The parent
// picks whether to render a scrim that blocks background
// input. The card itself stays interactive in both modes so
// the optional Cancel button works.
//
// Use cases this is meant for:
// - Music library scan (background indexing; sublabel updates
//   with running counts like "Scanned 4,231 tracks").
// - WiFi scan (foreground; brief but worth announcing).
// - Firmware update (scrim mode; concurrent gestures would be
//   incoherent).
// - Roster snap when the operator explicitly chose the heavy
//   gesture path.
//
// Min-duration semantics match HeartbeatOverlay: once shown,
// the panel stays for at least one heartbeat tick (1500 ms by
// default) so the operator always sees one full beat. This
// also gives the sublabel content time to render before the
// panel retires for genuinely instant operations.
//
// The panel does not portal: it relies on position:fixed to
// escape any ancestor card. If the shell ever introduces a
// transform/filter on the root container, this component will
// need to migrate to a portal.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

interface HeartbeatPanelProps {
  /** Parent's "currently waiting" boolean. */
  visible: boolean;
  /** Short status line shown beneath the glyph. */
  headline?: string;
  /** Optional updating detail line (counts, current item, etc.). */
  sublabel?: ComponentChildren;
  /** Render a translucent scrim that blocks background input. */
  scrim?: boolean;
  /** Minimum visible duration in ms. Default 1500 (one tick). */
  minDurationMs?: number;
  /** Optional cancel handler. When provided, renders a button. */
  onCancel?: () => void;
  /** Button text for the cancel action. Default "Cancel". */
  cancelLabel?: string;
  /** Semantic intent, so the same panel is never misread. "loading"
   *  = content is being fetched (a large collection / slow source);
   *  "working" = an operator-initiated heavy verb is running;
   *  "reconnecting" = a connection is being re-established. Adds a
   *  modifier class for styling; the default preserves the current
   *  look. The distinction matters most for "loading", which must not
   *  read as a connection fault. */
  mode?: "loading" | "working" | "reconnecting";
}

/** Production panel implementation. Renders a full-viewport-
 *  centered card with the xl heartbeat glyph + headline +
 *  sublabel + optional cancel button. Min-duration matches
 *  HeartbeatOverlay (1500 ms / one tick). */
export function HeartbeatPanel({
  visible,
  headline,
  sublabel,
  scrim = false,
  minDurationMs = 1500,
  onCancel,
  cancelLabel = "Cancel",
  mode
}: HeartbeatPanelProps) {
  // shown is the rendered truth; visible is the parent's truth.
  // The panel stays shown for at least minDurationMs after
  // visible flips to false so the operator always perceives
  // one full heartbeat tick.
  const [shown, setShown] = useState(visible);
  const shownSinceRef = useRef<number | null>(visible ? Date.now() : null);
  const pendingHideHandle = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      if (pendingHideHandle.current !== null) {
        window.clearTimeout(pendingHideHandle.current);
        pendingHideHandle.current = null;
      }
      if (!shown) {
        shownSinceRef.current = Date.now();
        setShown(true);
      } else if (shownSinceRef.current === null) {
        shownSinceRef.current = Date.now();
      }
      return;
    }
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

  if (!shown) return null;

  const rootClass = [
    "evo-heartbeat-panel-root",
    scrim ? "evo-heartbeat-panel-root-scrim" : "",
    mode !== undefined ? `evo-heartbeat-panel-root--${mode}` : ""
  ]
    .filter((c) => c.length > 0)
    .join(" ");

  return (
    <div className={rootClass} role="status" aria-live="polite">
      <div className="evo-heartbeat-panel-card">
        <span className="evo-heartbeat evo-heartbeat-xl" aria-hidden="true">
          <span className="evo-heartbeat-glyph"></span>
        </span>
        {headline !== undefined ? (
          <p className="evo-heartbeat-panel-headline">{headline}</p>
        ) : null}
        {sublabel !== undefined ? (
          <p className="evo-heartbeat-panel-sublabel">{sublabel}</p>
        ) : null}
        {onCancel !== undefined ? (
          <button
            type="button"
            className="evo-heartbeat-panel-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
