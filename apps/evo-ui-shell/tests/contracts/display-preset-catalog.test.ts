import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseDiagonalInches,
  parseDisplayPresetCatalog,
  parseResolutionPair,
  resolveDiagonalInches
} from "../../src/runtime/display-preset-catalog.ts";

test("parseResolutionPair handles WxH and WxH@Hz", () => {
  assert.deepEqual(parseResolutionPair("1280x720"), { w: 1280, h: 720 });
  assert.deepEqual(parseResolutionPair("480x272M@60"), { w: 480, h: 272 });
  assert.equal(parseResolutionPair("n/a"), null);
});

test("parseDiagonalInches from preset name", () => {
  assert.equal(parseDiagonalInches('Waveshare 4.3" HDMI'), 4.3);
  assert.equal(parseDiagonalInches("Generic 1080p"), null);
});

test("parseDiagonalInches accepts spelled and hyphenated units", () => {
  assert.equal(parseDiagonalInches("Pimoroni 2.1-inch round"), 2.1);
  assert.equal(parseDiagonalInches("Waveshare 7 inch DSI"), 7);
  assert.equal(parseDiagonalInches("Joy-IT 5-in HDMI"), 5);
  // bare resolution numbers must not read as a diagonal
  assert.equal(parseDiagonalInches("Generic 800x480 HDMI"), null);
});

test("resolveDiagonalInches prefers explicit field, then name, then description", () => {
  assert.equal(
    resolveDiagonalInches({ name: 'Waveshare 4.3" HDMI', diagonal_inches: 4.5 }),
    4.5
  );
  assert.equal(resolveDiagonalInches({ name: 'Waveshare 4.3" HDMI' }), 4.3);
  assert.equal(
    resolveDiagonalInches({ name: "HyperPixel Round", description: "2.1-inch round DPI" }),
    2.1
  );
  assert.equal(resolveDiagonalInches({ name: "Generic 800x480 HDMI" }), null);
});

test("round and square small panels resolve a real diagonal from json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = join(here, "../../public/display-presets.json");
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const catalog = parseDisplayPresetCatalog(raw);
  const round = catalog.entries.find((e) => e.id === "hyperpixel2r");
  assert.ok(round, "hyperpixel2r present");
  assert.equal(round!.diagonalInches, 2.1);
});

test("display_presets.json yields parseable catalogue", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = join(here, "../../public/display-presets.json");
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const catalog = parseDisplayPresetCatalog(raw);
  assert.ok(catalog.entries.length >= 180);
  const bar = catalog.entries.find((e) => e.id === "waveshare-11.9-hdmi");
  assert.ok(bar);
  assert.equal(bar!.widthPx, 1480);
  assert.equal(bar!.heightPx, 320);
});
