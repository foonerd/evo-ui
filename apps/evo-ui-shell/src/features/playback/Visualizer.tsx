// Audio spectrum visualiser.
//
// The wire-tier subject carries the canonical maximum (256 mel-scale
// bins, stereo L+R, Float32 magnitudes in [0, 1], 30 Hz). The renderer
// downsamples to the operator's chosen `bin_count` and channel-collapses
// when `channel_mode = mono`. The source plugin computes one FFT
// regardless of seat count or seat-preference diversity; downsample
// lives entirely on the renderer side.
//
// The audio.terminus plugin publishes the
// `audio_playback_spectrum_frame` subject on the
// `evo.audio.playback` scheme. The useSpectrum hook in this directory
// owns the read-then-subscribe wire bind and decodes frames into a
// stable SpectrumFrameBuffers ref this component consumes via the
// optional `frameSource` prop. When `frameSource.current.atMs` is
// fresh (within FRAME_FRESHNESS_MS) the renderer feeds the wire
// magnitudes through the downsample/draw paths unchanged; otherwise the
// display DECAYS TO SILENCE (there is no synthetic fallback - that path
// was retired; a stale/absent wire frame renders flat, never a made-up
// pattern). The draw paths are agnostic to which source filled the
// target buffer.
//
// Presets via `ui.visualizer.preset` (see VISUALIZER_PRESETS):
// classic meters (bars / led / spectrum / glow / mirror), organic
// lines (wave / ribbon / echo / trail / fluid), atmosphere
// (aurora / prism / pulse / dots), spatial (radial / waterfall),
// plus "off". Extra FX live in ./viz-extra-draw.ts.
//
// Beyond magnitudes, the renderer threads the framework's peak-hold
// and 4-band onset signals to the draw path (FrameSignals): led shows
// a falling peak cap, dots sit at held peaks and pop on onsets, pulse
// flashes on the beat. `decay` scales the gravity fall (lazy..aggressive).
//
// Stereo: bars / led / spectrum / glow / fluid / ribbon / aurora
// split L above / R below where natural; wave / echo / trail /
// pulse / dots / radial / waterfall / prism use mono-collapse
// or channel-aware treatment per draw path. Mono averages upstream.
//
// COLOUR is owned by the palette axis (./viz-palettes.ts): the
// operator picks a palette (theme-derived default or a curated stop
// set) and a colour mode (gradient along the meter / frequency
// across the bins / level-following). The pair (theme, gradient) is
// the LEGACY paint and renders exactly as before palettes existed,
// including the bars preset's green/yellow/red LED language.

import { useEffect, useRef } from "preact/hooks";
import type { SpectrumFrameBuffers } from "./spectrum-decoders";
import { dbTransform } from "./spectrum-db-curve";
import {
  colorAtStops,
  resolvePaletteStops,
  type VizColorMode,
  type VizPaletteId,
} from "./viz-palettes";
import {
  createVizEffectState,
  drawAurora,
  drawPrism,
  drawDots,
  drawEcho,
  drawGlow,
  drawLed,
  drawPulse,
  drawRadial,
  drawRibbon,
  drawTrail,
  drawWaterfall,
  type FrameSignals,
} from "./viz-extra-draw";
import type { VisualizerPresetId } from "./local-prefs";

export type VisualizerPreset = VisualizerPresetId;
export type VisualizerBinCount = 32 | 64 | 128 | 256;
export type VisualizerChannelMode = "mono" | "stereo";

export interface VisualizerProps {
  /** System master switch. When false the visualiser is OFF regardless
   *  of the style - nothing renders, no loop, no subscription. */
  enabled: boolean;
  /** The rendering style. `preset === "off"` also renders nothing (it is
   *  the "off" config); any other value is a live style. */
  preset: VisualizerPreset;
  binCount?: VisualizerBinCount;
  channelMode?: VisualizerChannelMode;
  heightPx?: number;
  /** Wire-side spectrum source, owned by useSpectrum. When its latest
   *  frame was RECEIVED within FRAME_FRESHNESS_MS the renderer draws the
   *  real magnitudes; otherwise the display decays to silence and the
   *  render loop stops until live frames resume. No synthetic fallback -
   *  the visualiser only ever shows real audio or nothing. */
  frameSource?: { readonly current: SpectrumFrameBuffers };
  /** Operator-tunable sensitivity, in dB. Applied as a gain
   *  offset before the dB-axis clamp. Default 0 dB. Range is
   *  enforced at the call-site (-20..+20). Positive bumps quiet
   *  content up the meter; negative pulls hot content down to
   *  recover headroom. */
  sensitivityDb?: number;
  /** Colour palette (viz-palettes.ts). "theme" derives stops from
   *  the active theme accent. Default "theme". */
  palette?: VizPaletteId;
  /** How palette colours map onto the render: "gradient" along the
   *  meter height, "frequency" across the bins, "level" following
   *  amplitude. Default "gradient". The pair
   *  (palette="theme", colorMode="gradient") is the LEGACY paint -
   *  it preserves the pre-palette rendering exactly, including the
   *  bars preset's green/yellow/red LED language. */
  colorMode?: VizColorMode;
  /** Decay speed of the gravity fall, 1 (lazy, slow settle) .. 10
   *  (aggressive, snappy). 5 is the audioMotion-class baseline. Scales
   *  GRAVITY only; the attack (rise) stays fixed. */
  decay?: number;
}

/** Per-frame paint context threaded into every draw function - the
 *  single colour authority for the renderer. */
interface VizPaint {
  /** theme+gradient: render exactly as before palettes existed. */
  readonly legacy: boolean;
  readonly mode: VizColorMode;
  readonly stops: readonly string[];
  /** Resolved theme primary (legacy paths + fallbacks). */
  readonly theme: string;
  /** Mean displayed level this frame, 0..1 (drives "level" mode
   *  for area/stroke presets). */
  readonly avg: number;
}

/** Whole-meter style for area fills and strokes:
 *  gradient -> vertical stops (yBase bottom of travel, yTip top),
 *  frequency -> horizontal stops across the width,
 *  level -> flat colour at the frame's mean level. */
function paletteAreaStyle(
  ctx: CanvasRenderingContext2D,
  paint: VizPaint,
  yBase: number,
  yTip: number,
  width: number
): string | CanvasGradient {
  if (paint.legacy) return paint.theme;
  if (paint.mode === "level") return colorAtStops(paint.stops, paint.avg);
  const grad =
    paint.mode === "frequency"
      ? ctx.createLinearGradient(0, 0, Math.max(1, width), 0)
      : ctx.createLinearGradient(0, yBase, 0, yTip);
  const count = paint.stops.length;
  for (let i = 0; i < count; i++) {
    grad.addColorStop(count === 1 ? 0 : i / (count - 1), paint.stops[i]);
  }
  return grad;
}

// Canonical wire shape (256 mel bins, stereo, 30 Hz).
const WIRE_BIN_COUNT = 256;
const WIRE_CHANNELS = 2;
const DEFAULT_BIN_COUNT: VisualizerBinCount = 256;
const DEFAULT_CHANNEL_MODE: VisualizerChannelMode = "mono";
const DEFAULT_HEIGHT = 64;
const FRAME_UPDATE_HZ = 30;
const FRAME_UPDATE_INTERVAL_MS = 1000 / FRAME_UPDATE_HZ;
// AnalyserNode-class exponential smoothing (audioMotion default 0.5).
// Applied on attack toward the wire target; decay uses gravity instead.
const SMOOTHING = 0.5;
// Gravity fall in [0,1] magnitude units / s² (audioMotion-class decay).
const GRAVITY = 8.0;
// Reference rate for converting SMOOTHING into a per-frame attack factor.
const SMOOTHING_REF_HZ = 60;
// A wire frame is considered fresh enough to drive the visual when it
// was RECEIVED (browser-local receivedWallMs) within this many ms of
// now. The framework emits at 30 Hz (~33 ms cadence) and may pace down
// to 15 Hz (~67 ms) under backpressure, so 250 ms gives a 4x margin on
// the slowest documented cadence before the visual is treated as idle.
const FRAME_FRESHNESS_MS = 250;
// When no live frame is arriving, the render loop stops entirely (no
// requestAnimationFrame) and a low-rate timer polls for resumption. 5 Hz
// is imperceptible latency on resume and negligible CPU vs a 60 Hz draw.
const IDLE_POLL_MS = 200;
// Display is "at rest" once every interpolated bar has decayed below
// this. Below it the last motion is invisible, so the loop may stop.
const REST_EPSILON = 0.002;

/** True when every bar has decayed to (invisible) rest - the loop may
 *  stop drawing without a visible freeze. */
function isAtRest(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] > REST_EPSILON) return false;
  }
  return true;
}

// dB-axis curve + constants live in ./spectrum-db-curve so the
// contract tests can import them without pulling in this
// component's JSX. See that module for the math and rationale.

export function Visualizer({
  enabled,
  preset,
  binCount = DEFAULT_BIN_COUNT,
  channelMode = DEFAULT_CHANNEL_MODE,
  heightPx = DEFAULT_HEIGHT,
  frameSource,
  sensitivityDb = 0,
  palette = "theme",
  colorMode = "gradient",
  decay = 5
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Wire-shape buffers: 256 bins x 2 channels. Interleaved as
  // [L0, R0, L1, R1, ..., L255, R255] to match a natural projection-WS
  // payload shape.
  const currentRef = useRef<Float32Array>(new Float32Array(WIRE_BIN_COUNT * WIRE_CHANNELS));
  const targetRef = useRef<Float32Array>(new Float32Array(WIRE_BIN_COUNT * WIRE_CHANNELS));
  const velocityRef = useRef<Float32Array>(new Float32Array(WIRE_BIN_COUNT * WIRE_CHANNELS));

  useEffect(() => {
    if (!enabled || preset === "off") {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let frameId = 0;
    let idleTimer = 0;
    let lastTargetUpdate = 0;
    let lastMotionTs = 0;
    let primary = readCssColor("--primary", "#00d4aa");
    let stops = resolvePaletteStops(palette, primary);
    const legacyPaint = palette === "theme" && colorMode === "gradient";
    const effectState = createVizEffectState();
    // Peak-hold display buffers (same layout + dB curve as the
    // magnitudes) and decaying onset beat envelopes, threaded to the
    // draw path as FrameSignals. Reshaped alongside the magnitude
    // buffers on a demand-driven size change.
    let peakTarget = new Float32Array(currentRef.current.length);
    let peakCurrent = new Float32Array(currentRef.current.length);
    const onsetEnv = { sub: 0, bass: 0, mid: 0, high: 0 };
    const EMPTY_CORR = new Float32Array(0);
    const gravity = GRAVITY * (Math.max(1, Math.min(10, decay)) / 5);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // The wire frame IS the display shape - the demand mirrors the
    // operator's bin_count / channel_mode, so the renderer draws it 1:1,
    // no downsample. Shape is payload-truth read from the frame; the
    // interpolation buffers follow it and reshape on a demand change.
    // Seed from the props (the operator's choice) so the surface renders
    // at the right shape before the first frame lands.
    let dispBins: number = binCount;
    let dispChannels: number = channelMode === "stereo" ? 2 : 1;
    const ensureShape = (bins: number, channels: number): void => {
      const len = bins * channels;
      if (currentRef.current.length !== len) {
        currentRef.current = new Float32Array(len);
        targetRef.current = new Float32Array(len);
        velocityRef.current = new Float32Array(len);
        peakTarget = new Float32Array(len);
        peakCurrent = new Float32Array(len);
      }
      dispBins = bins;
      dispChannels = channels;
    };
    ensureShape(dispBins, dispChannels);

    const draw = (now: number) => {
      if (lastMotionTs === 0) {
        lastMotionTs = now;
      }
      const dtSec = Math.min(0.05, Math.max(0.001, (now - lastMotionTs) / 1000));
      lastMotionTs = now;
      if (now - lastTargetUpdate >= FRAME_UPDATE_INTERVAL_MS) {
        // Draw the wire-side spectrum when its latest frame is fresh; the
        // hook writes frameSource.current in place on every frame, read
        // directly with no copy. When there is no fresh frame the display
        // decays to silence (below) - never fabricated.
        const wire = frameSource?.current;
        const wallNowMs = Date.now();
        // Freshness is measured against the browser-local RECEIPT time,
        // never the device frame timestamp (wire.atMs). Comparing the
        // device clock to Date.now() falsely flags every real frame as
        // stale on any rig whose clock runs behind the browser, which
        // would decay the visualiser to silence even though live audio is
        // arriving (observed: a rig ~0.8s behind decayed to flat; a rig
        // with near-zero skew showed real audio). There is NO synthetic
        // fallback - a not-fresh frame means the display decays to
        // silence, nothing made-up.
        const wireFresh =
          wire !== undefined &&
          wire.receivedWallMs > 0 &&
          wallNowMs - wire.receivedWallMs <= FRAME_FRESHNESS_MS;
        // Diagnostic surface - reachable as window.__spectrumDiag in
        // DevTools. Records which source the Visualizer pulled from
        // and why. Same instance the useSpectrum hook writes to.
        if (typeof window !== "undefined") {
          const w = window as unknown as Record<string, unknown>;
          const diag = w["__spectrumDiag"] as Record<string, unknown> | undefined;
          if (diag !== undefined) {
            diag["vizFrameCount"] = ((diag["vizFrameCount"] as number) || 0) + 1;
            if (wireFresh) {
              diag["vizWireFreshCount"] = ((diag["vizWireFreshCount"] as number) || 0) + 1;
            } else {
              // Not-fresh: the display decays to silence (NO synthetic
              // fallback - that path was retired). Named honestly so the
              // on-rig diag does not imply a "demo mode" that no longer
              // exists.
              diag["vizStaleDecayCount"] = ((diag["vizStaleDecayCount"] as number) || 0) + 1;
              if (wire !== undefined) {
                diag["vizStaleReason"] =
                  wire.receivedWallMs === 0
                    ? "never_decoded"
                    : `stale_by_${wallNowMs - wire.receivedWallMs}ms`;
              } else {
                diag["vizStaleReason"] = "no_frame_source";
              }
            }
          }
        }
        if (wireFresh && wire !== undefined) {
          // Follow the frame's shape (payload-truth). A demand-driven
          // reshape resets the interpolation buffers so we never lerp
          // across sizes.
          if (wire.bins * wire.channels !== targetRef.current.length) {
            ensureShape(wire.bins, wire.channels);
          }
          dbTransform(wire.magnitudes, targetRef.current, sensitivityDb);
          // Peak-hold through the same dB curve so caps line up with the
          // bars; onset flags set the beat envelopes (decayed each frame).
          dbTransform(wire.peakHold, peakTarget, sensitivityDb);
          if (wire.onsets.subBass) onsetEnv.sub = 1;
          if (wire.onsets.bass) onsetEnv.bass = 1;
          if (wire.onsets.mid) onsetEnv.mid = 1;
          if (wire.onsets.high) onsetEnv.high = 1;
        } else {
          // No fresh real frame (silence / paused / stopped / device not
          // producing): decay to silence. NEVER fabricate a signal - a
          // made-up animation lies about following audio and, worse, keeps
          // a low-power core drawing 60 Hz over nothing real.
          targetRef.current.fill(0);
          peakTarget.fill(0);
        }
        lastTargetUpdate = now;
        primary = readCssColor("--primary", primary);
        // Theme palette follows live theme swaps; curated palettes
        // resolve to the same stops every time (cheap either way).
        stops = resolvePaletteStops(palette, primary);
      }
      advanceMotion(
        currentRef.current,
        velocityRef.current,
        targetRef.current,
        dtSec,
        gravity
      );
      // Ease the peak-hold display toward the wire peaks and decay the
      // onset beat envelopes (half-life ~140 ms) so styles read a smooth
      // cap and a short flash rather than a 1-frame spike.
      const onsetDecay = Math.pow(0.5, dtSec / 0.14);
      onsetEnv.sub *= onsetDecay;
      onsetEnv.bass *= onsetDecay;
      onsetEnv.mid *= onsetDecay;
      onsetEnv.high *= onsetDecay;
      for (let i = 0; i < peakCurrent.length; i++) {
        peakCurrent[i] += (peakTarget[i] - peakCurrent[i]) * 0.3;
      }

      // Draw the wire shape 1:1 - currentRef already holds
      // [dispBins * dispChannels] bin-major interleaved magnitudes at the
      // frame's own shape. Both are framework-enum values (validated by
      // the decoder), so the cast to the draw signature is safe.
      const displayed = currentRef.current;
      const displayBins = dispBins as VisualizerBinCount;
      const displayChannels = dispChannels as 1 | 2;

      // Mean displayed level (drives "level" colour mode on the
      // area/stroke presets). One pass over the displayed floats.
      let avg = 0;
      if (!legacyPaint && colorMode === "level") {
        let sum = 0;
        for (let i = 0; i < displayed.length; i++) sum += displayed[i];
        avg = displayed.length > 0 ? sum / displayed.length : 0;
      }
      const paint: VizPaint = {
        legacy: legacyPaint,
        mode: colorMode,
        stops,
        theme: primary,
        avg,
      };

      const signals: FrameSignals = {
        peak: peakCurrent,
        onset: onsetEnv,
        corr: frameSource?.current.correlation ?? EMPTY_CORR,
        channels: displayChannels,
      };

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      ctx.clearRect(0, 0, cssW, cssH);

      switch (preset) {
        case "bars":
          drawBars(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "led":
          drawLed(ctx, displayed, displayBins, displayChannels, cssW, cssH, signals);
          break;
        case "spectrum":
          drawSpectrum(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "glow":
          drawGlow(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "wave":
          drawWave(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "ribbon":
          drawRibbon(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "echo":
          drawEcho(
            ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, effectState
          );
          break;
        case "trail":
          drawTrail(
            ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, effectState
          );
          break;
        case "fluid":
          drawFluid(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "aurora":
          drawAurora(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "prism":
          drawPrism(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
        case "pulse":
          drawPulse(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, signals);
          break;
        case "dots":
          drawDots(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, signals);
          break;
        case "radial":
          drawRadial(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, effectState);
          break;
        case "waterfall":
          drawWaterfall(
            ctx, displayed, displayBins, displayChannels, cssW, cssH, paint, effectState
          );
          break;
        case "mirror":
          drawMirror(ctx, displayed, displayBins, displayChannels, cssW, cssH, paint);
          break;
      }

      // Reschedule only while live data is arriving OR the bars are
      // still settling to rest. Once there is no fresh frame AND the
      // display has decayed to rest, STOP the loop entirely (zero render
      // cost) and hand off to a low-rate poll that restarts it the moment
      // live audio resumes. This is the one canonical path: the render
      // loop exists only when there is real audio to draw - it retires
      // the free-running-over-fabricated-data CPU sink.
      const latest = frameSource?.current;
      const liveNow =
        latest !== undefined &&
        latest.receivedWallMs > 0 &&
        Date.now() - latest.receivedWallMs <= FRAME_FRESHNESS_MS;
      if (liveNow || !isAtRest(currentRef.current)) {
        frameId = requestAnimationFrame(draw);
      } else {
        frameId = 0;
        scheduleIdleWatch();
      }
    };

    const scheduleIdleWatch = (): void => {
      idleTimer = window.setTimeout(() => {
        idleTimer = 0;
        const w = frameSource?.current;
        const live =
          w !== undefined &&
          w.receivedWallMs > 0 &&
          Date.now() - w.receivedWallMs <= FRAME_FRESHNESS_MS;
        if (live) {
          frameId = requestAnimationFrame(draw);
        } else {
          scheduleIdleWatch();
        }
      }, IDLE_POLL_MS);
    };

    frameId = requestAnimationFrame(draw);

    return () => {
      if (frameId !== 0) cancelAnimationFrame(frameId);
      if (idleTimer !== 0) window.clearTimeout(idleTimer);
      ro.disconnect();
    };
  }, [enabled, preset, binCount, channelMode, frameSource, sensitivityDb, palette, colorMode, decay]);

  if (!enabled || preset === "off") {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="visualizer-canvas"
      style={`height: ${heightPx}px;`}
      aria-hidden="true"
    />
  );
}

/* ---------- internals ---------- */

function readCssColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value.length > 0 ? value : fallback;
}

/**
 * audioMotion-class temporal motion: exponential attack toward the
 * wire target (AnalyserNode smoothing), gravity-accelerated fall on
 * decay. Keeps the silhouette responsive to attacks without the
 * sticky scrape of a single lerp factor on both edges.
 */
function advanceMotion(
  current: Float32Array,
  velocity: Float32Array,
  target: Float32Array,
  dtSec: number,
  gravity: number
): void {
  const attack = 1 - Math.pow(SMOOTHING, dtSec * SMOOTHING_REF_HZ);
  for (let i = 0; i < current.length; i++) {
    const t = target[i];
    if (t >= current[i]) {
      current[i] += (t - current[i]) * attack;
      velocity[i] = 0;
    } else {
      velocity[i] += gravity * dtSec;
      const next = current[i] - velocity[i] * dtSec;
      if (next <= t) {
        current[i] = t;
        velocity[i] = 0;
      } else {
        current[i] = next;
      }
    }
  }
}

/* ---------- draw helpers ---------- */

/**
 * Discrete-column layout for the bars / mirror presets. Fits `n`
 * columns into `width` for ANY bin count: the per-column slot
 * (`pitch`) is derived from the width, and the gap shrinks with the
 * pitch so a dense meter never overruns the canvas. Columns are
 * positioned at `i * pitch`, so the last column's right edge is
 * `(n - 1) * pitch + colW <= width` - no clipping when the operator
 * picks a high bin count on a narrow panel.
 *
 * The old layout kept a fixed 2px gap and clamped only the bar width
 * to a 1px floor; at 256 bins that needed 256 x 3px = 768px and the
 * top frequency bins fell off the right edge of any cell narrower
 * than that. Deriving the slot from the width removes that failure.
 */
function columnLayout(
  width: number,
  n: number
): { pitch: number; colW: number } {
  const pitch = width / Math.max(1, n);
  // ~90% fill (audioMotion barSpace ≈ 0.1).
  const gap = pitch * 0.1;
  const colW = Math.max(1, pitch - gap);
  return { pitch, colW };
}

function readBin(displayed: Float32Array, idx: number, ch: 0 | 1, channels: 1 | 2): number {
  if (channels === 1) {
    return displayed[idx];
  }
  return displayed[idx * 2 + ch];
}

/**
 * Bars: classic LED-segment meter. Each displayed bin is a column of
 * discrete cells with gaps. Segments illuminate from the bottom up;
 * cell colour transitions green -> yellow -> red as the stack rises,
 * matching commercial analyser convention. NOT theme-tinted: the
 * green / yellow / red palette IS the visual language of an audio
 * meter and overriding it with a theme colour breaks the read.
 *
 * Stereo: midline split. L stack rises from midline upward, R stack
 * rises from midline downward, each with its own segment cascade.
 */
function drawBars(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const { pitch, colW } = columnLayout(width, n);

  if (channels === 1) {
    drawLedColumn(ctx, n, colW, pitch, height, height, "up", (i) => displayed[i], paint);
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    drawLedColumn(ctx, n, colW, pitch, halfH, midY, "up", (i) =>
      readBin(displayed, i, 0, 2), paint
    );
    drawLedColumn(ctx, n, colW, pitch, halfH, midY, "down", (i) =>
      readBin(displayed, i, 1, 2), paint
    );
  }
}

/**
 * Spectrum: filled area beneath the spectrum profile with sharp peaks
 * and a solid outline along the top edge. Theme-tinted. Distinct from
 * fluid (which uses dense gradient lines + sparkles) and from bars
 * (which uses LED segments).
 *
 * Stereo: midline split. L body fills upward from midline, R body
 * fills downward, with channel alpha distinction (L stronger, R muted).
 */
function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n - 1);

  if (channels === 1) {
    const style = paletteAreaStyle(ctx, paint, height, 0, width);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(i * step, height - displayed[i] * height);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = style;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = height - displayed[i] * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    // Vertical palette gradients run midline -> channel tip so both
    // halves read base-to-tip; frequency / level styles are shared.
    const upStyle = paletteAreaStyle(ctx, paint, midY, midY - halfH, width);
    const downStyle = paletteAreaStyle(ctx, paint, midY, midY + halfH, width);
    // Left fill above midline
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(i * step, midY - readBin(displayed, i, 0, 2) * halfH);
    }
    ctx.lineTo(width, midY);
    ctx.closePath();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = upStyle;
    ctx.fill();
    // Right fill below midline (channel alpha-distinguished)
    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(i * step, midY + readBin(displayed, i, 1, 2) * halfH);
    }
    ctx.lineTo(width, midY);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = downStyle;
    ctx.fill();
    ctx.restore();

    // Outlines on each channel
    ctx.strokeStyle = upStyle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = midY - readBin(displayed, i, 0, 2) * halfH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = downStyle;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = midY + readBin(displayed, i, 1, 2) * halfH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * Render a single channel's LED-segment column stack. Caller controls
 * the column width / gap, the available pixel travel (`travel`), the
 * baseline `y` from which cells stack, and the direction ("up" => cells
 * stack from baseline upward; "down" => downward, used for the stereo
 * lower half).
 */
function drawLedColumn(
  ctx: CanvasRenderingContext2D,
  n: number,
  colW: number,
  pitch: number,
  travel: number,
  baselineY: number,
  direction: "up" | "down",
  valueAt: (i: number) => number,
  paint: VizPaint
): void {
  const cellH = 4;
  const cellGap = 1;
  const cellPitch = cellH + cellGap;
  const totalCells = Math.max(1, Math.floor(travel / cellPitch));
  const greenCells = Math.floor(totalCells * 0.6);
  const yellowCells = Math.floor(totalCells * 0.25);

  // Palette paint precomputation (never per-cell string math):
  // gradient -> one colour per cell ROW (position along the travel),
  // frequency / level -> one colour per COLUMN. Legacy keeps the
  // green/yellow/red LED language - that palette IS the meter's
  // visual vocabulary and only an explicit palette choice overrides it.
  let rowColours: string[] | null = null;
  if (!paint.legacy && paint.mode === "gradient") {
    rowColours = [];
    for (let c = 0; c < totalCells; c++) {
      rowColours.push(
        colorAtStops(paint.stops, totalCells <= 1 ? 1 : c / (totalCells - 1))
      );
    }
  }

  for (let i = 0; i < n; i++) {
    const v = valueAt(i);
    const cellsLit = Math.min(totalCells, Math.round(v * totalCells));
    const x = i * pitch;
    let colColour: string | null = null;
    if (!paint.legacy && paint.mode === "frequency") {
      colColour = colorAtStops(paint.stops, n <= 1 ? 0 : i / (n - 1));
    } else if (!paint.legacy && paint.mode === "level") {
      colColour = colorAtStops(paint.stops, v);
    }
    for (let c = 0; c < cellsLit; c++) {
      let colour: string;
      if (rowColours !== null) {
        colour = rowColours[c];
      } else if (colColour !== null) {
        colour = colColour;
      } else if (c < greenCells) {
        colour = "#3fbf3f";
      } else if (c < greenCells + yellowCells) {
        colour = "#ffd633";
      } else {
        colour = "#e34646";
      }
      ctx.fillStyle = colour;
      const offset = c * cellPitch;
      const y = direction === "up" ? baselineY - offset - cellH : baselineY + offset + cellGap;
      ctx.fillRect(x, y, colW, cellH);
    }
  }
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n - 1);
  ctx.strokeStyle = paletteAreaStyle(ctx, paint, height, 0, width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (channels === 1) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = height - displayed[i] * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // L solid, R muted.
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = height - readBin(displayed, i, 0, 2) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = height - readBin(displayed, i, 1, 2) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * Fluid: dense thin vertical lines with a vertical gradient on each
 * line (theme primary at the line's tip fading to a softer hue toward
 * the baseline) plus sparkle dots floating above high-amplitude bins.
 * The visual reads as an organic / shimmering spectrum rather than
 * the classic discrete-bar analyser.
 *
 * Stereo: lines from midline outward. Upper half = L, lower half = R.
 * Same sparkle treatment applied to both channels.
 */
function drawFluid(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n);
  // ~90% of column pitch (audioMotion barSpace ≈ 0.1) — dense glass,
  // not sparse 2.5px needles.
  const lineW = Math.max(1, step * 0.9);
  const sparkleThreshold = 0.55;

  const drawChannel = (
    valueAt: (i: number) => number,
    baselineY: number,
    direction: "up" | "down",
    travel: number
  ) => {
    // Gradient mode: ONE shared vertical gradient spanning the full
    // travel with EVERY palette stop at its height fraction. Each
    // line reveals the spectrum up to its own height - quiet lines
    // stay in the base hues, loud ones climb through every
    // intermediate hue to the tip (the vertical analogue of the
    // frequency mode's horizontal progression). One gradient per
    // channel per frame instead of one per line.
    let sharedGrad: CanvasGradient | null = null;
    if (!paint.legacy && paint.mode === "gradient") {
      const farY = direction === "up" ? baselineY - travel : baselineY + travel;
      sharedGrad = ctx.createLinearGradient(0, baselineY, 0, farY);
      const count = paint.stops.length;
      for (let i = 0; i < count; i++) {
        sharedGrad.addColorStop(count === 1 ? 0 : i / (count - 1), paint.stops[i]);
      }
    }

    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      if (v <= 0.01) {
        continue;
      }
      const x = i * step + step * 0.5;
      const lineH = v * travel;
      const tipY = direction === "up" ? baselineY - lineH : baselineY + lineH;
      const startY = direction === "up" ? baselineY : baselineY + 1;

      // Tip colour: legacy = theme primary. Palette modes -
      // frequency: the bin's hue; level AND gradient: the palette
      // colour at the height this line reaches (sparkles always
      // twinkle in the hue the line tip carries).
      const tip = paint.legacy
        ? paint.theme
        : paint.mode === "frequency"
          ? colorAtStops(paint.stops, n <= 1 ? 0 : i / (n - 1))
          : colorAtStops(paint.stops, v);

      let stroke: string | CanvasGradient;
      if (sharedGrad !== null) {
        stroke = sharedGrad;
      } else {
        // Per-line fade: bright tip, softer base (legacy look,
        // and the frequency / level palette modes).
        const base = paint.legacy ? paint.theme : paint.stops[0];
        const gradient = ctx.createLinearGradient(0, startY, 0, tipY);
        gradient.addColorStop(0, withAlphaHex(base, 0.15));
        gradient.addColorStop(0.7, tip);
        gradient.addColorStop(1, tip);
        stroke = gradient;
      }

      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineW;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, tipY);
      ctx.stroke();

      // Sparkles above peaks: small dots that twinkle off random
      // jitter each frame, alpha-proportional to amplitude.
      if (v > sparkleThreshold && Math.random() < (v - sparkleThreshold) * 1.6) {
        const offsetX = (Math.random() - 0.5) * step * 1.4;
        const offsetY = (direction === "up" ? -1 : 1) * (Math.random() * 6 + 2);
        const sparkleY = tipY + offsetY;
        const radius = 1 + Math.random() * 1.2;
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.random() * 0.55;
        ctx.fillStyle = tip;
        ctx.beginPath();
        ctx.arc(x + offsetX, sparkleY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  if (channels === 1) {
    drawChannel((i) => displayed[i], height, "up", height);
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    drawChannel((i) => readBin(displayed, i, 0, 2), midY, "up", halfH);
    drawChannel((i) => readBin(displayed, i, 1, 2), midY, "down", halfH);
  }
}

/**
 * Build an rgba(...) string from a CSS colour. The renderer's theme
 * colour arrives as whatever the theme declares (oklch, hex, hsl) and
 * gradients need a value with explicit alpha. Resolve through a 1x1
 * canvas trick to get rgba components, then synthesise the alpha-
 * adjusted string.
 *
 * Cached per (colour, alpha) call to keep the per-frame cost low; the
 * cache is intentionally small (one entry per distinct colour we
 * resolve, two alpha steps in practice).
 */
const COLOUR_RGBA_CACHE = new Map<string, [number, number, number]>();

function withAlphaHex(colour: string, alpha: number): string {
  let rgb = COLOUR_RGBA_CACHE.get(colour);
  if (!rgb) {
    rgb = resolveColourToRgb(colour);
    COLOUR_RGBA_CACHE.set(colour, rgb);
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function resolveColourToRgb(colour: string): [number, number, number] {
  if (typeof document === "undefined") {
    return [0, 212, 170];
  }
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) {
    return [0, 212, 170];
  }
  ctx.fillStyle = "#000000";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2]];
}

function drawMirror(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const { pitch, colW: barW } = columnLayout(width, n);
  const midY = height / 2;

  // Fill authority: legacy = flat theme. gradient = one MIRRORED
  // vertical gradient (base hues at the midline, tip hues at both
  // edges - matches the bars' outward growth). frequency / level =
  // per-bar flat colour resolved in the loop.
  if (paint.legacy) {
    ctx.fillStyle = paint.theme;
  } else if (paint.mode === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    const count = paint.stops.length;
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? 1 : i / (count - 1);
      grad.addColorStop(0.5 - f / 2, paint.stops[i]);
      grad.addColorStop(0.5 + f / 2, paint.stops[i]);
    }
    ctx.fillStyle = grad;
  }
  const perBar = !paint.legacy && paint.mode !== "gradient";
  const barColour = (i: number, v: number): void => {
    if (!perBar) return;
    ctx.fillStyle =
      paint.mode === "frequency"
        ? colorAtStops(paint.stops, n <= 1 ? 0 : i / (n - 1))
        : colorAtStops(paint.stops, v);
  };

  if (channels === 1) {
    for (let i = 0; i < n; i++) {
      // A silent bin must read as empty canvas, NOT a forced 0.5px bar - the
      // old Math.max(0.5, ..) floor painted a continuous fake hairline across
      // silent high bins. Skip below sub-pixel.
      const halfH = displayed[i] * height * 0.5;
      if (halfH < 0.5) continue;
      const x = i * pitch;
      barColour(i, displayed[i]);
      ctx.fillRect(x, midY - halfH, barW, halfH * 2);
    }
  } else {
    // Channel-natural mirror: L above, R below. Same silent-bin rule per
    // channel - no floor, skip a channel's bar when it is sub-pixel so
    // silence is empty, not a drawn line.
    const half = midY - 1;
    for (let i = 0; i < n; i++) {
      const l = readBin(displayed, i, 0, 2);
      const r = readBin(displayed, i, 1, 2);
      const lH = l * half;
      const rH = r * half;
      if (lH < 0.5 && rH < 0.5) continue;
      const x = i * pitch;
      barColour(i, Math.max(l, r));
      if (lH >= 0.5) ctx.fillRect(x, midY - lH, barW, lH);
      if (rH >= 0.5) ctx.fillRect(x, midY + 1, barW, rH);
    }
  }
}
