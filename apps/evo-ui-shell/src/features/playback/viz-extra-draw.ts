// Extra visualizer presets. Pure canvas paint over the same 1:1 bin
// buffer the core presets use - no remapping, no downsample. Several
// styles read the extra per-frame signals the framework already emits
// (peak-hold and 4-band onsets), threaded in via FrameSignals so the
// paint can show falling peak caps and flash on the beat. Colour stays
// owned by the palette axis except where a style's identity IS colour
// (prism = colour-by-frequency).

import { colorAtStops, type VizColorMode } from "./viz-palettes";

/** Same paint contract as Visualizer.tsx - kept local so this module
 *  does not import the component graph. */
export interface VizPaint {
  readonly legacy: boolean;
  readonly mode: VizColorMode;
  readonly stops: readonly string[];
  readonly theme: string;
  readonly avg: number;
}

/** Decaying beat envelopes, one per perceptual band, 0..1. Set to 1 on
 *  an onset's rising edge and decayed each frame by the render loop. */
export interface OnsetEnv {
  sub: number;
  bass: number;
  mid: number;
  high: number;
}

/** Extra per-frame music signals threaded from the wire into the draw
 *  path. `peak` mirrors the displayed buffer's layout (bins*channels,
 *  bin-major interleaved, dB-curved + interpolated the same way the
 *  magnitudes are) so a style can read a bin's held peak the same way it
 *  reads its live level. `corr` is per-bin L/R correlation on stereo
 *  (length bins) or empty on mono. */
export interface FrameSignals {
  peak: Float32Array;
  onset: OnsetEnv;
  corr: Float32Array;
  channels: 1 | 2;
}

/** Frame-to-frame state for presets that need history. */
export interface VizEffectState {
  ghost: Float32Array | null;
  trail: Float32Array[];
  spin: number;
  /** Offscreen spectrogram buffer for the waterfall preset - scrolled
   *  and appended one row per frame instead of repainting every cell. */
  spectro: HTMLCanvasElement | null;
  spectroCtx: CanvasRenderingContext2D | null;
  ensure: (len: number) => void;
}

const TRAIL_DEPTH = 22;

export function createVizEffectState(): VizEffectState {
  return {
    ghost: null,
    trail: [],
    spin: 0,
    spectro: null,
    spectroCtx: null,
    ensure(len: number) {
      if (this.ghost !== null && this.ghost.length === len) return;
      this.ghost = new Float32Array(len);
      this.trail = [];
    },
  };
}

function columnLayout(
  width: number,
  n: number
): { pitch: number; colW: number } {
  const pitch = width / Math.max(1, n);
  const gap = pitch * 0.1;
  const colW = Math.max(1, pitch - gap);
  return { pitch, colW };
}

function readBin(
  displayed: Float32Array,
  idx: number,
  ch: 0 | 1,
  channels: 1 | 2
): number {
  if (channels === 1) return displayed[idx];
  return displayed[idx * 2 + ch];
}

function monoAt(
  displayed: Float32Array,
  i: number,
  channels: 1 | 2
): number {
  if (channels === 1) return displayed[i];
  return (readBin(displayed, i, 0, 2) + readBin(displayed, i, 1, 2)) * 0.5;
}

/** Read a bin's held-peak from the signals buffer (same layout as the
 *  displayed buffer). Falls back to the live value when no peak signal
 *  is threaded (keeps the styles robust if called without signals). */
function peakMonoAt(
  sig: FrameSignals | undefined,
  fallback: Float32Array,
  i: number,
  channels: 1 | 2
): number {
  if (sig === undefined || sig.peak.length !== fallback.length) {
    return monoAt(fallback, i, channels);
  }
  return monoAt(sig.peak, i, channels);
}

const COLOUR_RGBA_CACHE = new Map<string, [number, number, number]>();

function withAlpha(colour: string, alpha: number): string {
  let rgb = COLOUR_RGBA_CACHE.get(colour);
  if (!rgb) {
    rgb = resolveRgb(colour);
    COLOUR_RGBA_CACHE.set(colour, rgb);
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function resolveRgb(colour: string): [number, number, number] {
  if (typeof document === "undefined") return [0, 212, 170];
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return [0, 212, 170];
  ctx.fillStyle = "#000000";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2]];
}

/** Frequency-mapped colour for a bin. Palette-driven when the operator
 *  chose one; a full spectral rainbow on the default (legacy) paint so
 *  the "prism" style reads as colour-by-pitch out of the box. */
function freqHue(paint: VizPaint, n: number, i: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  if (paint.legacy) return `hsl(${Math.round(t * 300)}, 90%, 58%)`;
  return colorAtStops(paint.stops, t);
}

function tipColour(
  paint: VizPaint,
  n: number,
  i: number,
  v: number
): string {
  if (paint.legacy) return paint.theme;
  if (paint.mode === "frequency") {
    return colorAtStops(paint.stops, n <= 1 ? 0 : i / (n - 1));
  }
  if (paint.mode === "level") return colorAtStops(paint.stops, v);
  return colorAtStops(paint.stops, Math.min(1, v));
}

function paletteStroke(
  ctx: CanvasRenderingContext2D,
  paint: VizPaint,
  width: number,
  height: number
): string | CanvasGradient {
  if (paint.legacy) return paint.theme;
  if (paint.mode === "level") return colorAtStops(paint.stops, paint.avg);
  if (paint.mode === "frequency") {
    const g = ctx.createLinearGradient(0, 0, width, 0);
    const count = paint.stops.length;
    for (let i = 0; i < count; i++) {
      g.addColorStop(count === 1 ? 0 : i / (count - 1), paint.stops[i]);
    }
    return g;
  }
  const g = ctx.createLinearGradient(0, height, 0, 0);
  const count = paint.stops.length;
  for (let i = 0; i < count; i++) {
    g.addColorStop(count === 1 ? 0 : i / (count - 1), paint.stops[i]);
  }
  return g;
}

/** Stroke a mono spectrum line across the buffer, optional y offset. */
function strokeMonoLine(
  ctx: CanvasRenderingContext2D,
  buf: Float32Array,
  n: number,
  channels: 1 | 2,
  step: number,
  height: number,
  style: string | CanvasGradient,
  lineWidth: number,
  yOffset: number
): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = monoAt(buf, i, channels);
    const x = i * step;
    const y = height - v * height * 0.92 + yOffset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Classic LED meter - always green/yellow/red segments, plus a bright
 *  HELD peak-cap segment that falls slowly (the framework peak-hold).
 *  The peak cap is what separates it from the palette `bars` meter and
 *  gives the eye a transient to track. Palette never overrides G/Y/R. */
export function drawLed(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  sig?: FrameSignals
): void {
  const { pitch, colW } = columnLayout(width, n);
  const cellH = 3;
  const cellGap = 1;
  const cellPitch = cellH + cellGap;

  const stack = (
    travel: number,
    baselineY: number,
    direction: "up" | "down",
    valueAt: (i: number) => number,
    peakAt: (i: number) => number
  ) => {
    const totalCells = Math.max(1, Math.floor(travel / cellPitch));
    const greenCells = Math.floor(totalCells * 0.6);
    const yellowCells = Math.floor(totalCells * 0.25);
    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      const cellsLit = Math.min(totalCells, Math.round(v * totalCells));
      const x = i * pitch;
      for (let c = 0; c < cellsLit; c++) {
        ctx.fillStyle =
          c < greenCells
            ? "#3fbf3f"
            : c < greenCells + yellowCells
              ? "#ffd633"
              : "#e34646";
        const offset = c * cellPitch;
        const y =
          direction === "up"
            ? baselineY - offset - cellH
            : baselineY + offset + cellGap;
        ctx.fillRect(x, y, colW, cellH);
      }
      // Held peak-cap: one bright segment at the peak-hold height.
      const pk = Math.min(1, peakAt(i));
      const pkCell = Math.min(totalCells - 1, Math.round(pk * totalCells));
      if (pkCell > 0 && pkCell >= cellsLit - 1) {
        const offset = pkCell * cellPitch;
        const y =
          direction === "up"
            ? baselineY - offset - cellH
            : baselineY + offset + cellGap;
        ctx.fillStyle = "#f7fbff";
        ctx.fillRect(x, y, colW, cellH);
      }
    }
  };

  if (channels === 1) {
    stack(
      height,
      height,
      "up",
      (i) => displayed[i],
      (i) => peakMonoAt(sig, displayed, i, 1)
    );
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    stack(
      halfH, midY, "up",
      (i) => readBin(displayed, i, 0, 2),
      (i) => (sig ? readBin(sig.peak, i, 0, 2) : readBin(displayed, i, 0, 2))
    );
    stack(
      halfH, midY, "down",
      (i) => readBin(displayed, i, 1, 2),
      (i) => (sig ? readBin(sig.peak, i, 1, 2) : readBin(displayed, i, 1, 2))
    );
  }
}

/** Soft single-hue glow ribbons + a bright spine. Calm atmosphere. */
export function drawAurora(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n);
  const midY = height / 2;
  const halfH = midY - 2;
  const drawHalf = (
    direction: "up" | "down",
    valueAt: (i: number) => number
  ) => {
    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      if (v <= 0.02) continue;
      const x = i * step + step * 0.5;
      const h = v * halfH;
      const tipY = direction === "up" ? midY - h : midY + h;
      const tip = tipColour(paint, n, i, v);
      const glowW = Math.max(2, step * 1.35);
      const grad = ctx.createLinearGradient(x, midY, x, tipY);
      grad.addColorStop(0, withAlpha(tip, 0));
      grad.addColorStop(0.35, withAlpha(tip, 0.18));
      grad.addColorStop(1, withAlpha(tip, 0.55));
      ctx.fillStyle = grad;
      ctx.fillRect(x - glowW * 0.5, Math.min(midY, tipY), glowW, h);
    }
    ctx.strokeStyle = paletteStroke(ctx, paint, width, height);
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      const x = i * step + step * 0.5;
      const y = direction === "up" ? midY - v * halfH : midY + v * halfH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  const valueAt = (i: number) => monoAt(displayed, i, channels);
  drawHalf("up", valueAt);
  drawHalf("down", valueAt);
}

/** Prism: a wall of vertical bands where COLOUR maps to pitch (rainbow
 *  on the default paint, palette-by-frequency otherwise) and brightness
 *  tracks energy. Additive blend so overlapping bands bloom. This is the
 *  colour-forward showcase - distinct from aurora's single hue. */
export function drawPrism(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n);
  const midY = height / 2;
  const halfH = midY - 1;
  const bandW = Math.max(1, step * 0.96);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const v = monoAt(displayed, i, channels);
    if (v <= 0.015) continue;
    const x = i * step;
    const hue = freqHue(paint, n, i);
    const h = v * halfH;
    // Faint full-height wash keyed to the band's hue, then a bright core
    // that grows with energy - the wall shimmers by pitch.
    ctx.fillStyle = withAlpha(hue, 0.05 + v * 0.12);
    ctx.fillRect(x, 0, bandW, height);
    ctx.fillStyle = withAlpha(hue, 0.25 + v * 0.6);
    ctx.fillRect(x, midY - h, bandW, h * 2);
  }
  ctx.restore();
}

/** Echo: the live line plus ONE slow, colour-shifted delayed copy
 *  offset above it - a single crisp reflection, not a wake. Distinct
 *  from trail's many-layer comet. */
export function drawEcho(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  state: VizEffectState
): void {
  state.ensure(displayed.length);
  const ghost = state.ghost!;
  const step = width / Math.max(1, n - 1);

  const echoColour = paint.legacy
    ? withAlpha(paint.theme, 0.45)
    : withAlpha(paint.stops[paint.stops.length - 1], 0.5);
  strokeMonoLine(ctx, ghost, n, channels, step, height, echoColour, 2.5, -5);
  strokeMonoLine(
    ctx, displayed, n, channels, step, height,
    paletteStroke(ctx, paint, width, height), 1.75, 0
  );

  // Slow lag => the echo visibly trails the live line by a beat.
  for (let i = 0; i < displayed.length; i++) {
    ghost[i] += (displayed[i] - ghost[i]) * 0.05;
  }
}

/** Soft filled columns with bloom at the tip. */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const { pitch, colW } = columnLayout(width, n);
  const drawCol = (
    baselineY: number,
    travel: number,
    direction: "up" | "down",
    valueAt: (i: number) => number
  ) => {
    // Fake the bloom with a wide translucent halo rect + a bright core,
    // instead of a per-column gradient and a per-column shadowBlur (both
    // ruinous at fullscreen). Two plain fillRects per bin.
    const haloExtra = colW * 1.2;
    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      if (v <= 0.01) continue;
      const h = v * travel;
      const x = i * pitch;
      const tip = tipColour(paint, n, i, v);
      const y = direction === "up" ? baselineY - h : baselineY;
      ctx.fillStyle = withAlpha(tip, 0.12);
      ctx.fillRect(x - haloExtra * 0.5, y, colW + haloExtra, h);
      ctx.fillStyle = withAlpha(tip, 0.85);
      ctx.fillRect(x, y, colW, h);
    }
  };

  if (channels === 1) {
    drawCol(height, height * 0.95, "up", (i) => displayed[i]);
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    drawCol(midY, halfH, "up", (i) => readBin(displayed, i, 0, 2));
    drawCol(midY, halfH, "down", (i) => readBin(displayed, i, 1, 2));
  }
}

/** Thick fabric band - stroke width tracks amplitude. */
export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint
): void {
  const step = width / Math.max(1, n - 1);
  const maxW = Math.max(3, height * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const strokeChan = (
    baselineY: number,
    travel: number,
    direction: "up" | "down",
    valueAt: (i: number) => number,
    alpha: number
  ) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n - 1; i++) {
      const v0 = valueAt(i);
      const v1 = valueAt(i + 1);
      const y0 =
        direction === "up"
          ? baselineY - v0 * travel
          : baselineY + v0 * travel;
      const y1 =
        direction === "up"
          ? baselineY - v1 * travel
          : baselineY + v1 * travel;
      ctx.strokeStyle = tipColour(paint, n, i, (v0 + v1) * 0.5);
      ctx.lineWidth = 1.5 + ((v0 + v1) * 0.5) * maxW;
      ctx.beginPath();
      ctx.moveTo(i * step, y0);
      ctx.lineTo((i + 1) * step, y1);
      ctx.stroke();
    }
    ctx.restore();
  };

  if (channels === 1) {
    strokeChan(height, height * 0.9, "up", (i) => displayed[i], 1);
  } else {
    const midY = height / 2;
    const halfH = midY - 1;
    strokeChan(midY, halfH, "up", (i) => readBin(displayed, i, 0, 2), 1);
    strokeChan(midY, halfH, "down", (i) => readBin(displayed, i, 1, 2), 0.75);
  }
}

/** Persistence comet - a long, smoothly fading wake from prior frames. */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  state: VizEffectState
): void {
  state.ensure(displayed.length);
  const step = width / Math.max(1, n - 1);
  const layers = state.trail;
  layers.push(new Float32Array(displayed));
  while (layers.length > TRAIL_DEPTH) layers.shift();

  // One gradient for every layer (was rebuilt per layer).
  const stroke = paletteStroke(ctx, paint, width, height);
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const age = (li + 1) / layers.length;
    const alpha = 0.04 + age * age * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.75 + age * 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = monoAt(layer, i, channels);
      const x = i * step;
      const y = height - v * height * 0.92;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Spectrum mapped onto a slowly rotating ring, mirrored for fullness
 *  with a soft bloom. */
export function drawRadial(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  state?: VizEffectState
): void {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outer = Math.min(width, height) * 0.46;
  const inner = outer * 0.32;
  const spin = state ? state.spin : 0;
  // lineWidth is constant across spokes - set once. No per-spoke
  // shadowBlur: it is the single most expensive canvas op and 2*bins of
  // them per frame is what made this choppy at fullscreen.
  const lw = Math.max(1.2, ((outer * Math.PI) / n) * 0.9);
  ctx.lineCap = "round";
  ctx.lineWidth = lw;

  // Two mirrored sweeps (0..pi and pi..2pi) so the ring is full even
  // with a short, wide stage.
  for (let i = 0; i < n; i++) {
    const v = monoAt(displayed, i, channels);
    if (v <= 0.01) continue;
    ctx.strokeStyle = tipColour(paint, n, i, v);
    const r = inner + v * (outer - inner);
    for (const side of [1, -1] as const) {
      const a = -Math.PI / 2 + side * (i / n) * Math.PI + spin;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  if (state) state.spin = (state.spin + 0.004) % (Math.PI * 2);
}

/** Scrolling spectrogram strip + live edge. */
export function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  state: VizEffectState
): void {
  // Persistent offscreen spectrogram. Each frame we SCROLL the whole
  // image down by one row and paint only the newest spectrum across the
  // top - O(bins) draws per frame instead of O(rows*bins) (the old path
  // repainted ~56*256 cells every frame, which stalled at fullscreen).
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (
    state.spectro === null ||
    state.spectroCtx === null ||
    state.spectro.width !== w ||
    state.spectro.height !== h
  ) {
    if (typeof document === "undefined") return;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    state.spectro = c;
    state.spectroCtx = c.getContext("2d");
  }
  const octx = state.spectroCtx;
  if (octx === null) return;

  const rowH = 2;
  octx.drawImage(state.spectro, 0, rowH); // scroll down one row
  octx.clearRect(0, 0, w, rowH); // clear the newly exposed top band
  const colW = w / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const v = monoAt(displayed, i, channels);
    if (v <= 0.02) continue;
    octx.fillStyle = withAlpha(tipColour(paint, n, i, v), 0.2 + v * 0.8);
    octx.fillRect(i * colW, 0, Math.max(1, colW), rowH);
  }
  ctx.drawImage(state.spectro, 0, 0);
}

/** Beat bloom: a bass-driven radial wash that FLASHES on sub/bass
 *  onsets, over a fine full-spectrum spine. Reads the beat, not just
 *  the level. */
export function drawPulse(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  sig?: FrameSignals
): void {
  const bassBins = Math.max(4, Math.floor(n * 0.12));
  let bass = 0;
  for (let i = 0; i < bassBins; i++) bass += monoAt(displayed, i, channels);
  bass /= bassBins;

  const beat = sig ? Math.max(sig.onset.sub, sig.onset.bass) : 0;
  const energy = Math.min(1, bass + beat * 0.6);
  const wash = tipColour(paint, n, 0, energy);
  const grad = ctx.createRadialGradient(
    width * 0.5, height, 0,
    width * 0.5, height, Math.max(width, height) * (0.7 + beat * 0.5)
  );
  grad.addColorStop(0, withAlpha(wash, 0.08 + energy * 0.5));
  grad.addColorStop(1, withAlpha(wash, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const step = width / Math.max(1, n - 1);
  ctx.strokeStyle = paletteStroke(ctx, paint, width, height);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = monoAt(displayed, i, channels);
    const x = i * step;
    const y = height - v * height * 0.88;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Peak constellation - dots sit at each bin's HELD peak, and pop
 *  brighter/larger when a mid/high onset fires. */
export function drawDots(
  ctx: CanvasRenderingContext2D,
  displayed: Float32Array,
  n: number,
  channels: 1 | 2,
  width: number,
  height: number,
  paint: VizPaint,
  sig?: FrameSignals
): void {
  const step = width / Math.max(1, n);
  const threshold = 0.06;
  const pop = sig ? Math.max(sig.onset.mid, sig.onset.high) : 0;
  const TAU = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const live = monoAt(displayed, i, channels);
    const pk = peakMonoAt(sig, displayed, i, channels);
    const v = Math.max(live, pk);
    if (v < threshold) continue;
    const x = i * step + step * 0.5;
    const y = height - v * height * 0.9;
    const tip = tipColour(paint, n, i, v);
    const r = 1.2 + v * 3.5 + pop * 1.5;
    // Soft halo + core with two plain arcs - no per-dot shadowBlur.
    ctx.fillStyle = withAlpha(tip, 0.16 + pop * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = withAlpha(tip, 0.55 + v * 0.4);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}
