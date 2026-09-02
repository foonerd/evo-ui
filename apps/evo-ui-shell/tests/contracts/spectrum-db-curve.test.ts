// Contract tests for the Visualizer's dB-axis transform.
//
// The wire delivers linear amplitude in [0, 1]; the Visualizer
// maps each bin through 20 * log10 with an operator sensitivity
// offset and clamps into the [-60, 0] dBFS window normalised to
// [0, 1] for the renderer. The math is small but easy to get
// wrong - reference points pinned here so a regression is
// caught by the failing test.

import test from "node:test";
import assert from "node:assert/strict";
import { dbTransform } from "../../src/features/playback/spectrum-db-curve.ts";

// The dB window is [-60, 0] with a span of 60 dB. Reference
// points must match the constants in Visualizer.tsx.
const DB_SPAN = 60;

function makeMags(values: number[]): Float32Array {
  const buf = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) buf[i] = values[i];
  return buf;
}

test("mag = 1.0 (0 dBFS) maps to 1.0 on the meter", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([1.0]), out, 0);
  assert.ok(Math.abs(out[0] - 1.0) < 1e-6);
});

test("mag = 0.001 (-60 dBFS) lands at the meter floor (0)", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([0.001]), out, 0);
  assert.ok(out[0] <= 1e-6, `got ${out[0]}`);
});

test("mag = 0.1 (-20 dBFS) maps to about 0.667 on the meter", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([0.1]), out, 0);
  // -20 dB inside [-60, 0] window: (60 - 20) / 60 = 0.6667
  assert.ok(Math.abs(out[0] - (40 / DB_SPAN)) < 1e-4);
});

test("mag = 0.022 (-33.15 dBFS) renders around 45 percent of the meter", () => {
  // The live-rig reading the user observed; sanity-check the
  // exact display position against the dB curve so the docs and
  // code can't drift apart.
  const out = new Float32Array(1);
  dbTransform(makeMags([0.022]), out, 0);
  const dB = 20 * Math.log10(0.022); // about -33.15
  const expected = (DB_SPAN + dB) / DB_SPAN;
  assert.ok(Math.abs(out[0] - expected) < 1e-4);
  assert.ok(out[0] > 0.4 && out[0] < 0.5, `expected ~0.45, got ${out[0]}`);
});

test("mag = 0 clamps to 0 (no log10 blow-up)", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([0]), out, 0);
  assert.equal(out[0], 0);
});

test("mag below the linear-floor sentinel clamps to 0", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([1e-12]), out, 0);
  assert.equal(out[0], 0);
});

test("mag above 1.0 clamps to 1.0 (no overflow above the ceiling)", () => {
  const out = new Float32Array(1);
  dbTransform(makeMags([2.5]), out, 0);
  assert.equal(out[0], 1);
});

test("positive sensitivity boosts quiet bins", () => {
  const out0 = new Float32Array(1);
  const outBoost = new Float32Array(1);
  dbTransform(makeMags([0.022]), out0, 0);
  dbTransform(makeMags([0.022]), outBoost, 10);
  // +10 dB on -33 dBFS = -23 dBFS, which renders higher than -33.
  assert.ok(outBoost[0] > out0[0]);
  // Specifically 10/60 higher.
  assert.ok(Math.abs((outBoost[0] - out0[0]) - 10 / DB_SPAN) < 1e-4);
});

test("negative sensitivity cuts hot bins", () => {
  const out0 = new Float32Array(1);
  const outCut = new Float32Array(1);
  dbTransform(makeMags([0.5]), out0, 0);
  dbTransform(makeMags([0.5]), outCut, -10);
  assert.ok(outCut[0] < out0[0]);
  assert.ok(Math.abs((out0[0] - outCut[0]) - 10 / DB_SPAN) < 1e-4);
});

test("interleaved stereo writes both channels in place", () => {
  // [L0, R0, L1, R1] - mimic the renderer's interleaved layout.
  const mags = makeMags([1.0, 0.001, 0.1, 0.5]);
  const out = new Float32Array(4);
  dbTransform(mags, out, 0);
  assert.ok(Math.abs(out[0] - 1.0) < 1e-6); // L0: 0 dBFS
  assert.ok(out[1] <= 1e-6); // R0: -60 dBFS
  assert.ok(Math.abs(out[2] - 40 / DB_SPAN) < 1e-4); // L1: -20 dBFS
  assert.ok(out[3] > 0.85 && out[3] < 0.95); // R1: -6 dBFS
});
