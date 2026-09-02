// Visualizer palettes - the colour axis, orthogonal to the preset
// shape. Curated palettes as DATA (name + colour stops), in the same
// spirit as the style-layer tokens: the operator picks a palette,
// never types raw colours. "theme" derives its stops from the active
// theme accent so the default stays theme-coherent.
//
// Colour modes (concepts inspired by the audioMotion-analyzer
// feature set; implementation and palette designs are our own - the
// reference is AGPL-licensed and no code is taken from it):
//   gradient  - stops painted along the meter height
//   frequency - colour travels across the bins (classic rainbow)
//   level     - colour follows amplitude (quiet cool, loud hot)
//
// Pure module: no preact, no canvas - contract-tested directly.

export type VizPaletteId =
  | "theme" | "prism" | "aurora" | "ember" | "ice" | "violet" | "mono";
export type VizColorMode = "gradient" | "frequency" | "level";

export const VIZ_PALETTES: readonly VizPaletteId[] = [
  "theme", "prism", "aurora", "ember", "ice", "violet", "mono",
];
export const VIZ_COLOR_MODES: readonly VizColorMode[] = [
  "gradient", "frequency", "level",
];

export function isVizPalette(v: unknown): v is VizPaletteId {
  return typeof v === "string" && (VIZ_PALETTES as readonly string[]).includes(v);
}
export function isVizColorMode(v: unknown): v is VizColorMode {
  return typeof v === "string" && (VIZ_COLOR_MODES as readonly string[]).includes(v);
}

/** Curated stop sets, base -> tip (index 0 = low end of the meter /
 *  low frequency / quiet, last = tip / high / loud). Own designs. */
const STOPS: Record<Exclude<VizPaletteId, "theme">, readonly string[]> = {
  prism: ["#d94a4a", "#e8a33d", "#e6d34f", "#4fc46a", "#3fa9dd", "#7a5fd0"],
  aurora: ["#0b6e63", "#2fd3a6", "#57e0d0", "#7a8bf0", "#a06ee0"],
  ember: ["#5a1010", "#c23a1a", "#f07f26", "#ffc24d", "#ffe9a6"],
  ice: ["#0d3f66", "#1f6fa8", "#3fa3d6", "#8fd0ea", "#e8f7ff"],
  violet: ["#2a1454", "#5a2fa0", "#8a4fd0", "#c07fe8", "#efc9ff"],
  mono: ["#2a2f36", "#6a737d", "#c8d2dc", "#ffffff"],
};

/* ---------------- colour math (pure) ---------------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (ra === null || rb === null) return a;
  return rgbToHex(
    ra[0] + (rb[0] - ra[0]) * t,
    ra[1] + (rb[1] - ra[1]) * t,
    ra[2] + (rb[2] - ra[2]) * t
  );
}

/** Colour at position t (0..1) along the stop set. Clamped; equal
 *  spacing between stops. */
export function colorAtStops(stops: readonly string[], t: number): string {
  if (stops.length === 0) return "#ffffff";
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** CSS background for a palette swatch chip - same stop data the
 *  renderer uses, so the chip never lies. "theme" tracks the live
 *  --primary custom property. */
export function paletteSwatchCss(palette: VizPaletteId): string {
  if (palette === "theme") {
    return (
      "linear-gradient(90deg, " +
      "color-mix(in srgb, var(--primary) 55%, black), var(--primary), " +
      "color-mix(in srgb, var(--primary) 65%, white))"
    );
  }
  return `linear-gradient(90deg, ${STOPS[palette].join(", ")})`;
}

/** Resolve a palette to concrete stops. `themeAccent` feeds the
 *  "theme" palette: base = accent toward the background dark, tip =
 *  accent toward white - the current accent look, expressed as
 *  stops. Non-hex accents (oklch/var output) fall back to a neutral
 *  teal so the meter never renders invisible. */
export function resolvePaletteStops(
  palette: VizPaletteId,
  themeAccent: string
): readonly string[] {
  if (palette !== "theme") return STOPS[palette];
  const accent = hexToRgb(themeAccent) !== null ? themeAccent : "#38e0c8";
  return [mix(accent, "#000000", 0.45), accent, mix(accent, "#ffffff", 0.35)];
}
