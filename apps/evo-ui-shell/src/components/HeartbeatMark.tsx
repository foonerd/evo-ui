// THE evo mark - the landing page hero (evoframework.org
// public/css/site.css hero-mark family), theme-driven: every colour
// resolves from the active theme's variables using the site's own
// color-mix recipes. This component is the ONLY full-mark
// implementation in the app (ruled 2026-07-14 after the artwork
// placeholder drifted twice as a hand-drawn imitation).
//
// Anatomy (all six pieces, none optional in "stage" size):
//   stage  - the hosting box IS the open stage; the whole footprint
//            fits inside it, so the halos can never be clipped
//   card   - rounded-square panel at ~60% of the stage
//   halos  - two static circles between card edge and stage edge
//   heart  - beating glyph at 38% of the card (lub-dub, 1.5s)
//   ripples- two rounded-square rings bursting per beat
//   dots   - three ambient floating dots
//
// The SMALL version (like multiroom's waits) is the existing
// evo-heartbeat glyph markup - glyph + ripples only, no card, no
// halos, no dots - identical to HeartbeatOverlay's visual core.

import type { JSX } from "preact";

export function HeartbeatMark(props: { size?: "stage" | "sm" }): JSX.Element {
  if (props.size === "sm") {
    return (
      <span className="evo-heartbeat evo-heartbeat-sm hb-mark-sm" aria-hidden="true">
        <span className="evo-heartbeat-glyph"></span>
      </span>
    );
  }
  // 1:1 with the approved sheet: the dots are children of the CARD
  // (file structure), offset relative to it - dot 3 rides just off
  // the card's right edge, inside the isolated stage.
  return (
    <span className="hb-mark" aria-hidden="true">
      <span className="hb-mark-card">
        <span className="evo-heartbeat-glyph hb-mark-heart"></span>
        <span className="hb-mark-dot hb-mark-dot-1"></span>
        <span className="hb-mark-dot hb-mark-dot-2"></span>
        <span className="hb-mark-dot hb-mark-dot-3"></span>
      </span>
    </span>
  );
}
