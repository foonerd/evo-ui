// Synthetic spectrum source for the visualizer STUDIO - the designer
// tunes presets against deterministic, always-moving frames instead
// of whatever happens to be playing (agreed studio direction). The
// generator speaks the exact SpectrumFrameBuffers dialect the wire
// decoder fills: in-place Float32Array writes, fresh atMs so the
// Visualizer takes its wire path (sensitivity applies), peak-hold
// with the framework's ~12 dB/s decay, onsets on pulse kicks.
//
// Pure functions + one tiny interval driver; no preact. The write
// function is contract-tested directly.

import { type SpectrumFrameBuffers } from "./spectrum-decoders.ts";

// The studio previews at the full 256x2 shape so presets are tuned
// against the richest wire the framework can emit.
const SYNTH_BINS = 256;
const SYNTH_CHANNELS = 2;

export type SyntheticPattern = "sweep" | "pulse" | "noise" | "silence";
export const SYNTHETIC_PATTERNS: readonly SyntheticPattern[] = [
  "sweep", "pulse", "noise", "silence",
];

/** ~12 dB/s peak decay at ~30 fps: 10^(-12/20 * dt). */
const PEAK_DECAY_PER_FRAME = Math.pow(10, (-12 / 20) * (1 / 30));

/** Deterministic per-bin jitter (no RNG state; reproducible). */
function jitter(bin: number, tMs: number): number {
  const x = Math.sin(bin * 12.9898 + tMs * 0.00073) * 43758.5453;
  return x - Math.floor(x); // [0, 1)
}

/** Write one synthetic frame into `buf` in place. `tMs` drives the
 *  animation phase (pass a real clock for live motion). */
export function writeSyntheticFrame(
  buf: SpectrumFrameBuffers,
  pattern: SyntheticPattern,
  tMs: number
): void {
  // Ensure the buffer is at the studio preview shape (the frame source
  // starts at the default demand shape; the decoder dialect lets us
  // reshape in place).
  const len = SYNTH_BINS * SYNTH_CHANNELS;
  if (buf.magnitudes.length !== len) {
    buf.magnitudes = new Float32Array(len);
    buf.peakHold = new Float32Array(len);
  }
  if (buf.correlation.length !== SYNTH_BINS) {
    buf.correlation = new Float32Array(SYNTH_BINS);
  }
  buf.bins = SYNTH_BINS;
  buf.channels = SYNTH_CHANNELS;
  const { magnitudes, peakHold, correlation } = buf;
  let kick = false;

  for (let i = 0; i < SYNTH_BINS; i++) {
    let m = 0;
    if (pattern === "sweep") {
      // A gaussian bump gliding across the bins every 3 s, with a
      // faint second harmonic half a sweep behind.
      const c = ((tMs % 3000) / 3000) * SYNTH_BINS;
      const c2 = (c + SYNTH_BINS / 2) % SYNTH_BINS;
      const g = (center: number, sigma: number) => {
        const d = Math.min(Math.abs(i - center), SYNTH_BINS - Math.abs(i - center));
        return Math.exp(-(d * d) / (2 * sigma * sigma));
      };
      m = 0.9 * g(c, 14) + 0.35 * g(c2, 22);
    } else if (pattern === "pulse") {
      // A beat every 600 ms: bass-weighted energy envelope + a
      // little shimmer so the top half of the meter lives too.
      const phase = tMs % 600;
      const env = Math.exp(-phase / 160);
      const bassProfile = Math.exp(-i / 42);
      m = env * bassProfile + 0.10 * env * jitter(i, tMs);
      if (phase < 66) kick = true;
    } else if (pattern === "noise") {
      // Pink-sloped hash noise: dense motion, higher bins quieter.
      const slope = 1 - i / (SYNTH_BINS * 1.35);
      m = slope * (0.25 + 0.55 * jitter(i, tMs));
    } // silence: m stays 0
    m = Math.min(1, Math.max(0, m));

    // Slight L/R divergence so stereo mode has something to show.
    const l = m;
    const r = Math.min(1, Math.max(0, m * (0.85 + 0.3 * jitter(i + 512, tMs))));
    magnitudes[i * SYNTH_CHANNELS] = l;
    magnitudes[i * SYNTH_CHANNELS + 1] = r;

    const phL = Math.max(peakHold[i * SYNTH_CHANNELS] * PEAK_DECAY_PER_FRAME, l);
    const phR = Math.max(peakHold[i * SYNTH_CHANNELS + 1] * PEAK_DECAY_PER_FRAME, r);
    peakHold[i * SYNTH_CHANNELS] = phL;
    peakHold[i * SYNTH_CHANNELS + 1] = phR;

    correlation[i] = pattern === "noise" ? 0.4 : 0.9;
  }

  buf.onsets = {
    subBass: pattern === "pulse" && kick,
    bass: pattern === "pulse" && kick,
    mid: false,
    high: false,
  };
  buf.atMs = Date.now();
  // Browser-local receipt stamp is the Visualizer's freshness clock, so
  // the studio preview reads as live and takes the wire path.
  buf.receivedWallMs = Date.now();
  buf.rateHz = 30;
}

/** Drive `buf` at ~30 fps until stopped. */
export function startSyntheticSpectrum(
  buf: SpectrumFrameBuffers,
  pattern: () => SyntheticPattern
): () => void {
  const t0 = Date.now();
  const id = window.setInterval(() => {
    writeSyntheticFrame(buf, pattern(), Date.now() - t0);
  }, 33);
  return () => window.clearInterval(id);
}
