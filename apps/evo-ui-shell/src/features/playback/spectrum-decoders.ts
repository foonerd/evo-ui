// Pure decoders for the evo.audio.playback spectrum_frame subject.
//
// The audio.terminus plugin (shelf "audio.terminus") publishes a
// spectrum_frame subject (scheme "evo.audio.playback", value
// "spectrum_frame", subject_type "audio_playback_spectrum_frame").
// Its state payload v1 -
//   { v, bins, channels, rate_hz,
//     magnitudes: [[256 f32 L], [256 f32 R]],
//     peak_hold:  [[256 f32 L], [256 f32 R]],
//     onsets:     { sub_bass, bass, mid, high },
//     correlation: [256 f32],
//     at_ms }
// - arrives inline on the framework's subject_state_changed
// happening in the happening's new_state field, on first render
// (via the get_spectrum_frame read on the audio.terminus shelf)
// and on every change.
//
// The wire shape is fixed at bins=256, channels=2, rate_hz=30. The
// renderer downsamples / channel-collapses to the operator's
// chosen visualisation shape; decode here only validates and
// shovels the payload into stable Float32Array buffers (no
// per-frame allocation) so the canvas loop reads pre-decoded
// data on every draw.
//
// Kept pure and Preact-free so the contract tests exercise these
// against synthesised wire frames - mirrors now-playing-decoders.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function boolField(o: Record<string, unknown>, k: string): boolean {
  return o[k] === true;
}

/** Wire constants. The payload version is `v: 1`; raise this matcher
 *  when the framework increments the wire version. Bins and channels
 *  are demand-driven (payload-truth): the frame declares its own shape
 *  and the decoder adapts, rather than pinning one shape. */
export const SPECTRUM_WIRE_VERSION = 1;
/** Allowed demand-driven bin counts (framework enum). */
const VALID_BINS = new Set([32, 64, 128, 256]);
/** Default shape before the first frame lands - matches the UI's
 *  default demand (bin_count 256, mono) so an idle pre-audio surface has
 *  a sane, valid buffer to decay against. */
const DEFAULT_BINS = 256;
const DEFAULT_CHANNELS = 1;

/** Subject addressing constants - mirrored from the plugin's
 *  spectrum_subject.rs. The happening decoder filters on
 *  subject_type; the consumer reads use the shelf + verb. */
export const SPECTRUM_SUBJECT_TYPE = "audio_playback_spectrum_frame";
export const SPECTRUM_SHELF = "audio.terminus";
export const SPECTRUM_READ_VERB = "get_spectrum_frame";

/** Decoded onset cluster. The framework computes spectral-flux
 *  onset detection per perceptual band; UI consumers light up a
 *  per-band visual flash on the rising edge of each flag. */
export interface SpectrumOnsets {
  subBass: boolean;
  bass: boolean;
  mid: boolean;
  high: boolean;
}

/** Stable working buffers for one decoded spectrum frame. The
 *  decoder writes into these in place so the canvas loop reads
 *  pre-decoded data on every draw without allocating per-frame
 *  garbage. Callers construct one set per subscription and
 *  pass them to `decodeSpectrumFrameInto`. */
export interface SpectrumFrameBuffers {
  /** Frame bin count (32 / 64 / 128 / 256) - payload-truth from the
   *  wire, mirrors the current spectrum demand. The buffers below are
   *  sized to this; on a demand-driven shape change the decoder
   *  reallocates them within 1-2 frames. */
  bins: number;
  /** Frame channel count (1 mono / 2 stereo) - payload-truth. */
  channels: number;
  /** Interleaved bin-major magnitudes in [0, 1]:
   *  [b0c0, b0c1, b1c0, b1c1, ...] for stereo, [b0, b1, ...] for mono.
   *  Length = bins * channels. */
  magnitudes: Float32Array;
  /** Same layout/length as `magnitudes`: perceptual peak-hold per
   *  bin (~12 dB/s decay applied framework-side). */
  peakHold: Float32Array;
  /** Per-bin L/R correlation in [0, 1]. Length = bins on stereo,
   *  0 on mono (the framework sends a zero-length correlation for a
   *  single-channel frame). Consumers MUST guard on length. */
  correlation: Float32Array;
  /** Latest decoded onset cluster. Replaced on every decode (the
   *  cluster is small so a fresh object per frame is fine; the
   *  hot path is the Float32Array writes above). */
  onsets: SpectrumOnsets;
  /** Frame timestamp from the wire (ms since epoch), the DEVICE
   *  clock. 0 when the read returns the empty-frame seed before the
   *  first FFT compute. Used for interpolation/ordering only - NOT
   *  for freshness: comparing a device timestamp against the browser
   *  clock breaks on any device/browser clock skew (a rig whose clock
   *  runs behind the browser makes every real frame look "stale" and
   *  the visualiser falls back to the synthetic demo). */
  atMs: number;
  /** Browser-local wall-clock time (Date.now()) at which this frame
   *  was decoded/received. Freshness is measured against THIS - both
   *  endpoints are the browser's own clock, so device/browser skew
   *  cannot false-trigger the synthetic fallback. 0 = never decoded. */
  receivedWallMs: number;
  /** Actual wire cadence in Hz reported by the framework (target
   *  30; tier-adaptive [15, 60]). Renderers use this to pace any
   *  inter-frame interpolation. */
  rateHz: number;
}

/** Build a fresh set of stable working buffers in the cold state
 *  (all-zero magnitudes / peak_hold / correlation, all-false
 *  onsets, atMs=0, rateHz=30). The decoder writes into these in
 *  place; nothing in the decoder ever allocates a new
 *  Float32Array. */
export function emptySpectrumBuffers(): SpectrumFrameBuffers {
  return {
    bins: DEFAULT_BINS,
    channels: DEFAULT_CHANNELS,
    magnitudes: new Float32Array(DEFAULT_BINS * DEFAULT_CHANNELS),
    peakHold: new Float32Array(DEFAULT_BINS * DEFAULT_CHANNELS),
    correlation: new Float32Array(0),
    onsets: { subBass: false, bass: false, mid: false, high: false },
    atMs: 0,
    receivedWallMs: 0,
    rateHz: 30
  };
}

/** Pull an `len`-length number array out of a wire field, validating
 *  shape strictly. Returns null when absent / wrong-length /
 *  non-array. Per-element clamp to [0, 1] is the caller's
 *  responsibility - keeps this helper general. */
function readBinArray(v: unknown, len: number): number[] | null {
  if (!Array.isArray(v) || v.length !== len) {
    return null;
  }
  return v as number[];
}

/** Decode a spectrum-frame state payload into the supplied
 *  buffers. Writes the magnitudes / peak_hold / correlation
 *  arrays in place; replaces the small onsets cluster and
 *  scalar fields. Returns true on a clean decode, false on any
 *  shape mismatch (buffers are left untouched on rejection so
 *  the renderer continues drawing the last good frame). */
export function decodeSpectrumFrameInto(
  raw: unknown,
  out: SpectrumFrameBuffers
): boolean {
  if (!isObject(raw)) return false;
  if (raw["v"] !== SPECTRUM_WIRE_VERSION) return false;

  // Shape is payload-truth: the frame declares its own bins/channels
  // (mirroring the current demand). Validate against the framework
  // enum, then decode into a buffer sized to THIS frame.
  const bins = raw["bins"];
  const channels = raw["channels"];
  if (typeof bins !== "number" || !VALID_BINS.has(bins)) return false;
  if (channels !== 1 && channels !== 2) return false;

  // magnitudes / peak_hold arrive as one `bins`-long array per
  // channel: [[bins]] on mono, [[bins],[bins]] on stereo.
  const mags = raw["magnitudes"];
  const peaks = raw["peak_hold"];
  if (!Array.isArray(mags) || mags.length !== channels) return false;
  if (!Array.isArray(peaks) || peaks.length !== channels) return false;
  const magCh: number[][] = [];
  const peakCh: number[][] = [];
  for (let c = 0; c < channels; c += 1) {
    const m = readBinArray(mags[c], bins);
    const p = readBinArray(peaks[c], bins);
    if (m === null || p === null) return false;
    magCh.push(m);
    peakCh.push(p);
  }

  // Correlation is bins-long on stereo, EXACTLY zero-length on mono
  // (the framework omits per-bin correlation for a single channel).
  const corrRaw = raw["correlation"];
  const corrLen = channels === 2 ? bins : 0;
  if (!Array.isArray(corrRaw) || corrRaw.length !== corrLen) return false;

  const onsetsRaw = raw["onsets"];
  if (!isObject(onsetsRaw)) return false;

  const atMsRaw = raw["at_ms"];
  if (!isFiniteNumber(atMsRaw)) return false;

  const rateRaw = raw["rate_hz"];
  if (!isFiniteNumber(rateRaw) || rateRaw <= 0) return false;

  // Shape validated. Reallocate the working buffers ONLY when the frame
  // shape actually changed (a demand-driven reshape); steady state
  // writes in place with zero per-frame allocation.
  const wantLen = bins * channels;
  if (out.magnitudes.length !== wantLen) {
    out.magnitudes = new Float32Array(wantLen);
    out.peakHold = new Float32Array(wantLen);
  }
  if (out.correlation.length !== corrLen) {
    out.correlation = new Float32Array(corrLen);
  }
  out.bins = bins;
  out.channels = channels;

  // Commit, transposing per-channel arrays into the bin-major
  // interleave the renderer reads. Per-element clamp to [0, 1] guards a
  // misbehaving producer from distorting the meter scale.
  for (let i = 0; i < bins; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const m = typeof magCh[c][i] === "number" ? magCh[c][i] : 0;
      const p = typeof peakCh[c][i] === "number" ? peakCh[c][i] : 0;
      out.magnitudes[i * channels + c] = clamp01(m);
      out.peakHold[i * channels + c] = clamp01(p);
    }
    if (corrLen > 0) {
      const cc = typeof corrRaw[i] === "number" ? (corrRaw[i] as number) : 0;
      out.correlation[i] = clamp01(cc);
    }
  }
  out.onsets = {
    subBass: boolField(onsetsRaw, "sub_bass"),
    bass: boolField(onsetsRaw, "bass"),
    mid: boolField(onsetsRaw, "mid"),
    high: boolField(onsetsRaw, "high")
  };
  out.atMs = Math.round(atMsRaw);
  // Browser-local receipt stamp - the freshness clock. Set on every
  // successful decode (both the seed read and the live happening path
  // delegate here), so freshness never depends on the device clock.
  out.receivedWallMs = Date.now();
  out.rateHz = Math.round(rateRaw);
  return true;
}

/** Decode a spectrum-frame reading from a happening frame.
 *  Returns true (and writes into `out`) when the frame is a
 *  subject_state_changed happening for the
 *  audio_playback_spectrum_frame subject; false (buffers
 *  untouched) otherwise. Unwraps a leading { happening: ... }
 *  envelope - mirrors decodeNowPlayingHappening / wire
 *  conventions. */
export function decodeSpectrumFrameHappeningInto(
  raw: unknown,
  out: SpectrumFrameBuffers
): boolean {
  if (!isObject(raw)) return false;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return false;
  if (frame["subject_type"] !== SPECTRUM_SUBJECT_TYPE) return false;
  return decodeSpectrumFrameInto(frame["new_state"], out);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
