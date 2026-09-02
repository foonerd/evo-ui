// Value-driven fill for the themed range slider. WebKit (the kiosk's WPE
// engine) has no native progress-fill pseudo-element, so the track is a
// linear-gradient driven by a `--range-fill` custom property. This helper
// returns the style object; the CSS in styles.css consumes it. Firefox
// fills natively via ::-moz-range-progress and ignores this. Percent is
// clamped 0-100. For a 0..100 slider, pass the value directly.

import type { JSX } from "preact";

export function rangeFill(percent: number): JSX.CSSProperties {
  const clamped = Math.max(0, Math.min(100, percent));
  return { ["--range-fill"]: `${clamped}%` } as unknown as JSX.CSSProperties;
}
