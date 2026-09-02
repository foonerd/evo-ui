import test from "node:test";
import assert from "node:assert/strict";

import {
  colorAtStops,
  isVizColorMode,
  isVizPalette,
  paletteSwatchCss,
  resolvePaletteStops,
  VIZ_COLOR_MODES,
  VIZ_PALETTES,
} from "../../src/features/playback/viz-palettes.ts";

const HEX = /^#[0-9a-f]{6}$/;

test("every curated palette resolves to >= 3 valid hex stops", () => {
  for (const pal of VIZ_PALETTES) {
    if (pal === "theme") continue;
    const stops = resolvePaletteStops(pal, "#000000");
    assert.ok(stops.length >= 3, `${pal}: has ${stops.length} stops`);
    for (const s of stops) {
      assert.match(s, HEX, `${pal}: stop ${s}`);
    }
  }
});

test("theme palette derives base/accent/tip from a hex accent", () => {
  const stops = resolvePaletteStops("theme", "#38e0c8");
  assert.equal(stops.length, 3);
  assert.equal(stops[1], "#38e0c8"); // accent verbatim in the middle
  assert.match(stops[0], HEX);
  assert.match(stops[2], HEX);
  assert.notEqual(stops[0], stops[2]);
});

test("theme palette falls back to a visible teal on non-hex accents", () => {
  // Themes may declare oklch()/var() - the meter must never render
  // invisible because the accent could not be parsed.
  const stops = resolvePaletteStops("theme", "oklch(0.8 0.15 180)");
  assert.equal(stops[1], "#38e0c8");
});

test("colorAtStops interpolates: endpoints exact, midpoint mixed, clamped", () => {
  const stops = ["#000000", "#ffffff"] as const;
  assert.equal(colorAtStops(stops, 0), "#000000");
  assert.equal(colorAtStops(stops, 1), "#ffffff");
  assert.equal(colorAtStops(stops, 0.5), "#808080");
  assert.equal(colorAtStops(stops, -5), "#000000"); // clamps low
  assert.equal(colorAtStops(stops, 5), "#ffffff"); // clamps high
  // Multi-stop: t=0.5 of three stops lands exactly on the middle one.
  assert.equal(colorAtStops(["#ff0000", "#00ff00", "#0000ff"], 0.5), "#00ff00");
});

test("validators accept the vocabularies and refuse junk", () => {
  for (const p of VIZ_PALETTES) assert.ok(isVizPalette(p));
  for (const m of VIZ_COLOR_MODES) assert.ok(isVizColorMode(m));
  assert.equal(isVizPalette("rainbow"), false);
  assert.equal(isVizPalette(null), false);
  assert.equal(isVizColorMode("bar-index"), false);
  assert.equal(isVizColorMode(undefined), false);
});

test("swatch css carries the SAME stops the renderer resolves", () => {
  // Single-truth guard: the chip must be built from the palette's
  // resolved stops, in order - a divergence means the chip lies.
  for (const pal of VIZ_PALETTES) {
    const css = paletteSwatchCss(pal);
    if (pal === "theme") {
      assert.ok(css.includes("var(--primary)"), "theme chip tracks the live accent");
      continue;
    }
    const stops = resolvePaletteStops(pal, "#000000");
    assert.equal(css, `linear-gradient(90deg, ${stops.join(", ")})`);
  }
});
