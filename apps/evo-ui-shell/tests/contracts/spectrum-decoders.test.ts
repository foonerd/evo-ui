// Contract tests for the evo.audio.playback spectrum_frame decoders.
//
// The wire is demand-driven (payload-truth): the frame declares its own
// bins (32/64/128/256) and channels (1 mono / 2 stereo), and the decoder
// adapts the working buffers to it - no fixed 256x2 shape. Mono frames
// carry a zero-length correlation. These tests pin that contract so the
// centre-stage Visualizer is verifiable without live audio capture.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSpectrumFrameInto,
  decodeSpectrumFrameHappeningInto,
  emptySpectrumBuffers,
  SPECTRUM_SUBJECT_TYPE,
  SPECTRUM_WIRE_VERSION
} from "../../src/features/playback/spectrum-decoders.ts";

/** Synthesise a wire-shaped spectrum frame at any bins/channels. Stereo
 *  sends [L, R] per array and a bins-long correlation; mono sends a
 *  single-channel array and a zero-length correlation (framework shape). */
function buildFrame(opts?: {
  v?: number;
  bins?: number;
  channels?: number;
  rateHz?: number;
  atMs?: number;
  magL?: (i: number) => number;
  magR?: (i: number) => number;
  peakL?: (i: number) => number;
  peakR?: (i: number) => number;
  corr?: (i: number) => number;
  onsets?: { sub_bass?: boolean; bass?: boolean; mid?: boolean; high?: boolean };
}): Record<string, unknown> {
  const v = opts?.v ?? SPECTRUM_WIRE_VERSION;
  const bins = opts?.bins ?? 256;
  const channels = opts?.channels ?? 2;
  const rateHz = opts?.rateHz ?? 30;
  const atMs = opts?.atMs ?? 1_000;
  const magL = Array.from({ length: bins }, (_, i) => (opts?.magL ? opts.magL(i) : 0));
  const magR = Array.from({ length: bins }, (_, i) => (opts?.magR ? opts.magR(i) : 0));
  const peakL = Array.from({ length: bins }, (_, i) => (opts?.peakL ? opts.peakL(i) : 0));
  const peakR = Array.from({ length: bins }, (_, i) => (opts?.peakR ? opts.peakR(i) : 0));
  const magnitudes = channels === 2 ? [magL, magR] : [magL];
  const peak_hold = channels === 2 ? [peakL, peakR] : [peakL];
  const correlation =
    channels === 2
      ? Array.from({ length: bins }, (_, i) => (opts?.corr ? opts.corr(i) : 0))
      : [];
  return {
    v,
    bins,
    channels,
    rate_hz: rateHz,
    magnitudes,
    peak_hold,
    onsets: {
      sub_bass: opts?.onsets?.sub_bass ?? false,
      bass: opts?.onsets?.bass ?? false,
      mid: opts?.onsets?.mid ?? false,
      high: opts?.onsets?.high ?? false
    },
    correlation,
    at_ms: atMs
  };
}

// --- variable shape: stereo --------------------------------------

test("decodes a 256x2 stereo frame, bin-major interleave", () => {
  const out = emptySpectrumBuffers();
  const ok = decodeSpectrumFrameInto(
    buildFrame({
      bins: 256,
      channels: 2,
      magL: (i) => i / 256,
      magR: (i) => 1 - i / 256,
      peakL: () => 0.5,
      peakR: () => 0.25,
      corr: () => 0.75,
      onsets: { sub_bass: true, bass: false, mid: true, high: false },
      atMs: 12345
    }),
    out
  );
  assert.equal(ok, true);
  assert.equal(out.bins, 256);
  assert.equal(out.channels, 2);
  assert.equal(out.atMs, 12345);
  assert.equal(out.rateHz, 30);
  assert.equal(out.magnitudes.length, 256 * 2);
  assert.equal(out.correlation.length, 256);
  assert.equal(out.magnitudes[0], 0); // L0
  assert.equal(out.magnitudes[1], 1); // R0
  assert.equal(out.magnitudes[2], 1 / 256); // L1
  assert.equal(out.magnitudes[3], 1 - 1 / 256); // R1
  assert.equal(out.peakHold[0], 0.5);
  assert.equal(out.peakHold[1], 0.25);
  assert.equal(out.correlation[0], 0.75);
  assert.equal(out.onsets.subBass, true);
  assert.equal(out.onsets.mid, true);
});

// --- variable shape: mono ----------------------------------------

test("decodes a 64x1 mono frame; correlation is zero-length", () => {
  const out = emptySpectrumBuffers();
  const ok = decodeSpectrumFrameInto(
    buildFrame({ bins: 64, channels: 1, magL: (i) => i / 64, peakL: () => 0.3 }),
    out
  );
  assert.equal(ok, true);
  assert.equal(out.bins, 64);
  assert.equal(out.channels, 1);
  assert.equal(out.magnitudes.length, 64);
  assert.equal(out.correlation.length, 0);
  assert.equal(out.magnitudes[0], 0);
  assert.equal(out.magnitudes[1], 1 / 64); // exact (power-of-two fraction)
  assert.ok(Math.abs(out.peakHold[1] - 0.3) < 1e-6); // Float32 rounding
});

// --- demand-driven reshape ---------------------------------------

test("reshapes the buffers when the frame shape changes mid-stream", () => {
  const out = emptySpectrumBuffers();
  assert.equal(decodeSpectrumFrameInto(buildFrame({ bins: 256, channels: 2 }), out), true);
  assert.equal(out.magnitudes.length, 512);
  assert.equal(out.correlation.length, 256);
  // Operator drops to 32-bin stereo: buffers must resize.
  assert.equal(decodeSpectrumFrameInto(buildFrame({ bins: 32, channels: 2 }), out), true);
  assert.equal(out.bins, 32);
  assert.equal(out.magnitudes.length, 64);
  assert.equal(out.correlation.length, 32);
  // Then to 128-bin mono: correlation collapses to zero-length.
  assert.equal(decodeSpectrumFrameInto(buildFrame({ bins: 128, channels: 1 }), out), true);
  assert.equal(out.bins, 128);
  assert.equal(out.channels, 1);
  assert.equal(out.magnitudes.length, 128);
  assert.equal(out.correlation.length, 0);
});

// --- empty seed + clamp ------------------------------------------

test("decodes the empty-frame seed (capture loop pre-first-FFT)", () => {
  const out = emptySpectrumBuffers();
  const ok = decodeSpectrumFrameInto(buildFrame({ atMs: 0 }), out);
  assert.equal(ok, true);
  assert.equal(out.atMs, 0);
  for (let i = 0; i < 256; i++) {
    assert.equal(out.magnitudes[i * 2], 0);
    assert.equal(out.magnitudes[i * 2 + 1], 0);
    assert.equal(out.correlation[i], 0);
  }
});

test("clamps per-bin magnitudes to [0, 1]", () => {
  const out = emptySpectrumBuffers();
  const ok = decodeSpectrumFrameInto(
    buildFrame({
      magL: (i) => (i === 0 ? -0.4 : i === 1 ? 1.7 : 0.5),
      magR: (i) => (i === 0 ? 2.3 : 0.3),
      peakL: (i) => (i === 0 ? -1 : 0.4),
      corr: (i) => (i === 0 ? -3 : i === 1 ? 5 : 0.5)
    }),
    out
  );
  assert.equal(ok, true);
  assert.equal(out.magnitudes[0], 0); // -0.4 -> 0
  assert.equal(out.magnitudes[1], 1); // 2.3 -> 1
  assert.equal(out.magnitudes[2], 1); // 1.7 -> 1
  assert.equal(out.peakHold[0], 0); // -1 -> 0
  assert.equal(out.correlation[0], 0);
  assert.equal(out.correlation[1], 1);
});

// --- rejects -----------------------------------------------------

test("rejects a non-object payload; buffer untouched", () => {
  const out = emptySpectrumBuffers();
  out.atMs = 999;
  assert.equal(decodeSpectrumFrameInto(null, out), false);
  assert.equal(decodeSpectrumFrameInto("nope", out), false);
  assert.equal(decodeSpectrumFrameInto([], out), false);
  assert.equal(out.atMs, 999);
});

test("rejects a wrong wire-version payload", () => {
  const out = emptySpectrumBuffers();
  assert.equal(decodeSpectrumFrameInto(buildFrame({ v: 2 }), out), false);
});

test("rejects a bins value outside the framework enum", () => {
  const out = emptySpectrumBuffers();
  // 100 is not one of 32/64/128/256.
  assert.equal(decodeSpectrumFrameInto(buildFrame({ bins: 100, channels: 2 }), out), false);
});

test("rejects a channels value outside {1, 2}", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame();
  (frame as Record<string, unknown>).channels = 3;
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

test("rejects when a channel magnitude array is the wrong length", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame({ bins: 64, channels: 2 });
  (frame as Record<string, unknown>).magnitudes = [
    Array.from({ length: 64 }, () => 0),
    [0, 1, 2] // != bins
  ];
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

test("rejects stereo correlation that is not bins-long", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame({ bins: 64, channels: 2 });
  (frame as Record<string, unknown>).correlation = [0, 1];
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

test("rejects mono correlation that is not zero-length", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame({ bins: 64, channels: 1 });
  (frame as Record<string, unknown>).correlation = [0.1, 0.2];
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

test("rejects when at_ms is non-finite", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame();
  (frame as Record<string, unknown>).at_ms = "now";
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

test("rejects when onsets cluster is missing", () => {
  const out = emptySpectrumBuffers();
  const frame = buildFrame();
  delete (frame as Record<string, unknown>).onsets;
  assert.equal(decodeSpectrumFrameInto(frame, out), false);
});

// --- decodeSpectrumFrameHappeningInto -----------------------------

test("decodes a subject_state_changed happening for the spectrum subject", () => {
  const out = emptySpectrumBuffers();
  const happening = {
    type: "subject_state_changed",
    subject_type: SPECTRUM_SUBJECT_TYPE,
    new_state: buildFrame({ atMs: 42, magL: (i) => (i === 0 ? 0.8 : 0) })
  };
  const ok = decodeSpectrumFrameHappeningInto(happening, out);
  assert.equal(ok, true);
  assert.equal(out.atMs, 42);
  assert.ok(out.receivedWallMs > 0);
  assert.ok(Math.abs(out.magnitudes[0] - 0.8) < 1e-6);
});

test("unwraps a leading { happening: ... } envelope", () => {
  const out = emptySpectrumBuffers();
  const wrapped = {
    happening: {
      type: "subject_state_changed",
      subject_type: SPECTRUM_SUBJECT_TYPE,
      new_state: buildFrame({ atMs: 99 })
    }
  };
  assert.equal(decodeSpectrumFrameHappeningInto(wrapped, out), true);
  assert.equal(out.atMs, 99);
});

test("rejects a different subject_type; buffer untouched", () => {
  const out = emptySpectrumBuffers();
  out.atMs = 555;
  const happening = {
    type: "subject_state_changed",
    subject_type: "audio_playback_now_playing",
    new_state: buildFrame({ atMs: 1 })
  };
  assert.equal(decodeSpectrumFrameHappeningInto(happening, out), false);
  assert.equal(out.atMs, 555);
});

test("rejects a non-subject_state_changed happening type", () => {
  const out = emptySpectrumBuffers();
  const happening = {
    type: "custody_taken",
    subject_type: SPECTRUM_SUBJECT_TYPE,
    new_state: buildFrame()
  };
  assert.equal(decodeSpectrumFrameHappeningInto(happening, out), false);
});
