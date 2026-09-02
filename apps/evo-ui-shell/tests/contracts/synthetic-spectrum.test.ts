import test from "node:test";
import assert from "node:assert/strict";

import {
  emptySpectrumBuffers,
} from "../../src/features/playback/spectrum-decoders.ts";
import {
  SYNTHETIC_PATTERNS,
  writeSyntheticFrame,
} from "../../src/features/playback/synthetic-spectrum.ts";

// The studio synthetic source writes at the full 256x2 preview shape.
const SYNTH_BINS = 256;
const SYNTH_CHANNELS = 2;

test("every pattern writes in-range frames in the wire dialect", () => {
  for (const pattern of SYNTHETIC_PATTERNS) {
    const buf = emptySpectrumBuffers();
    writeSyntheticFrame(buf, pattern, 1234);
    assert.equal(buf.magnitudes.length, SYNTH_BINS * SYNTH_CHANNELS);
    for (let i = 0; i < buf.magnitudes.length; i++) {
      assert.ok(buf.magnitudes[i] >= 0 && buf.magnitudes[i] <= 1, `${pattern}[${i}]`);
      assert.ok(buf.peakHold[i] >= buf.magnitudes[i] - 1e-6, `${pattern} peak>=mag`);
    }
    assert.ok(buf.atMs > 0, `${pattern} freshness stamp set`);
    assert.ok(buf.receivedWallMs > 0, `${pattern} receipt stamp set`);
    assert.equal(buf.rateHz, 30);
  }
});

test("silence is true silence delivered as a FRESH frame (not the fallback synth)", () => {
  const buf = emptySpectrumBuffers();
  writeSyntheticFrame(buf, "silence", 500);
  assert.ok(buf.magnitudes.every((v) => v === 0));
  assert.ok(buf.atMs > 0);
});

test("sweep moves: the loudest bin travels over time", () => {
  const buf = emptySpectrumBuffers();
  const loudest = (t: number) => {
    writeSyntheticFrame(buf, "sweep", t);
    let best = 0, bi = 0;
    for (let i = 0; i < SYNTH_BINS; i++) {
      const v = buf.magnitudes[i * SYNTH_CHANNELS];
      if (v > best) { best = v; bi = i; }
    }
    return bi;
  };
  const a = loudest(0);
  const b = loudest(900);
  assert.notEqual(a, b);
});

test("pulse: kick sets bass onsets near the beat, clears between beats", () => {
  const buf = emptySpectrumBuffers();
  writeSyntheticFrame(buf, "pulse", 600); // phase 0 = kick
  assert.equal(buf.onsets.bass, true);
  assert.equal(buf.onsets.subBass, true);
  writeSyntheticFrame(buf, "pulse", 900); // mid-beat
  assert.equal(buf.onsets.bass, false);
});

test("peak-hold decays ~12 dB/s but never below the live magnitude", () => {
  const buf = emptySpectrumBuffers();
  writeSyntheticFrame(buf, "pulse", 600); // kick charges the peaks
  const charged = buf.peakHold[0];
  for (let t = 610; t < 1190; t += 33) writeSyntheticFrame(buf, "pulse", t);
  assert.ok(buf.peakHold[0] < charged, "decayed");
  assert.ok(buf.peakHold[0] >= buf.magnitudes[0] - 1e-6, "floor at live magnitude");
});
