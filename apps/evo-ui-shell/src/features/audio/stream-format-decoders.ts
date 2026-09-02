// Pure decoders for the audio.playback stream_format subject.
//
// The playback warden publishes a stream_format subject. Its state
// payload - { v, effective: AudioFormat, source: AudioFormat | null }
// - arrives inline on the framework's subject_state_changed
// happening (subject_type "audio_playback_stream_format"), in the
// happening's new_state field.
//
// AudioFormat is internally tagged on "kind": pcm / dsd /
// encoded_passthrough. effective is the format reaching the DAC
// (post-resampling, post-DoP); source is what the decoder produced
// from the file - null when not separately knowable, in which case
// the consumer treats source as equal to effective.
//
// Kept pure and Preact-free so the contract tests exercise them
// against synthesised wire frames.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intField(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** PCM frames - rate x bit-depth x channels. */
export interface PcmFormat {
  kind: "pcm";
  /** Codec token: pcm_s16_le, pcm_s24_le, pcm_s32_le, pcm_f32. */
  codec: string;
  rateHz: number;
  channels: number;
}

/** DSD bitstream - rate x transport x channels. */
export interface DsdFormat {
  kind: "dsd";
  /** DSD64 / DSD128 / DSD256 / DSD512. */
  rate: string;
  /** dop or native_usb. */
  transport: string;
  channels: number;
}

/** Bitrate carried by a lossy encoded source. Tagged-kind enum
 *  symmetric with the framework's wire-serde shape:
 *  - Cbr: constant bitrate, the file's actual kbps.
 *  - Vbr: variable bitrate, the file's declared average kbps.
 *  - Unknown: the source parser cannot recover a value from a
 *    bounded file-head probe. The UI renders codec-specific
 *    "VBR" copy in this case rather than fabricate a number. */
export type EncodedBitrate =
  | { kind: "cbr"; kbps: number }
  | { kind: "vbr"; avgKbps: number }
  | { kind: "unknown" };

/** Encoded-bitstream passthrough (MP3 / AAC / Vorbis / Opus / WMA /
 *  Musepack / AC3 / DTS / ...). Bitrate is optional: paths that do
 *  not introspect the file (admission-time format negotiation,
 *  pre-source-probe envelopes) carry the field as null. */
export interface EncodedFormat {
  kind: "encoded_passthrough";
  codec: string;
  rateHz: number;
  channels: number;
  /** Per-codec data rate from the source probe; null when the
   *  producer did not introspect the file. */
  bitrate: EncodedBitrate | null;
}

export type AudioFormat = PcmFormat | DsdFormat | EncodedFormat;

/** Decoded stream_format subject state.
 *
 * All three live fields are always present in the envelope per the
 * wire contract; each may be null when not yet known. The decoder
 * returns a non-null StreamFormat for any well-formed envelope -
 * including the seeded-empty one announced at plugin load before
 * the first publish. Consumers branch on the individual fields,
 * not on the envelope itself.
 */
export interface StreamFormat {
  /** Format reaching the DAC (post-resampling, post-DoP). Null
   *  until the first route-change publish. */
  effective: AudioFormat | null;
  /** Format the decoder produced from the file, derived from the
   *  source file's authoritative header (DSD rate from DSF/DFF,
   *  PCM rate/bit-depth from FLAC STREAMINFO / WAV fmt chunk /
   *  AIFF COMM, encoded bitrate + rate for lossy codecs).
   *  Null when the source file is unreachable on the local
   *  filesystem, the codec is not in the probe set, or the file
   *  head doesn't carry an authoritative shape. */
  source: AudioFormat | null;
  /** Lowercase source codec token derived from the playing
   *  file's extension (flac / mp3 / dsf / dff / wav / aiff / ape
   *  / alac / wavpack / tta / shorten / vorbis / opus / aac /
   *  wma / musepack / mod / speex). Null on unknown extension,
   *  no-current-song, or stream URL without an extension. */
  sourceCodec: string | null;
}

/** Decode one AudioFormat value. Returns null when the value is not
 *  a recognised internally-tagged audio-format object. */
export function decodeAudioFormat(raw: unknown): AudioFormat | null {
  if (!isObject(raw)) return null;
  const kind = raw["kind"];
  if (kind === "pcm") {
    const codec = stringField(raw, "codec");
    const rateHz = intField(raw, "rate_hz");
    const channels = intField(raw, "channels");
    if (codec === null || rateHz === null || channels === null) return null;
    return { kind: "pcm", codec, rateHz, channels };
  }
  if (kind === "dsd") {
    const rate = stringField(raw, "rate");
    const transport = stringField(raw, "transport");
    const channels = intField(raw, "channels");
    if (rate === null || transport === null || channels === null) return null;
    return { kind: "dsd", rate, transport, channels };
  }
  if (kind === "encoded_passthrough") {
    const codec = stringField(raw, "codec");
    const rateHz = intField(raw, "rate_hz");
    const channels = intField(raw, "channels");
    if (codec === null || rateHz === null || channels === null) return null;
    return {
      kind: "encoded_passthrough",
      codec,
      rateHz,
      channels,
      bitrate: decodeEncodedBitrate(raw["bitrate_kbps"])
    };
  }
  return null;
}

/** Decode the tagged-kind bitrate_kbps wire field on
 *  encoded_passthrough. Returns null when the field is absent,
 *  malformed, or carries a kind token the UI does not recognise. */
function decodeEncodedBitrate(raw: unknown): EncodedBitrate | null {
  if (!isObject(raw)) return null;
  const kind = raw["kind"];
  if (kind === "cbr") {
    const kbps = intField(raw, "kbps");
    if (kbps === null) return null;
    return { kind: "cbr", kbps };
  }
  if (kind === "vbr") {
    const avgKbps = intField(raw, "avg_kbps");
    if (avgKbps === null) return null;
    return { kind: "vbr", avgKbps };
  }
  if (kind === "unknown") {
    return { kind: "unknown" };
  }
  return null;
}

/** Decode a stream_format subject-state payload
 *  ({ v, effective, source, source_codec }) into a StreamFormat.
 *  Returns null only when the input is not an object - any
 *  well-formed envelope decodes, including the seeded-empty one
 *  with all three live fields null. Consumers branch on the
 *  individual fields. */
export function decodeStreamFormat(raw: unknown): StreamFormat | null {
  if (!isObject(raw)) return null;
  return {
    effective: decodeAudioFormat(raw["effective"]),
    source: decodeAudioFormat(raw["source"]),
    sourceCodec: stringField(raw, "source_codec")
  };
}

/** Decode a stream_format reading from a happening frame. Returns
 *  null when the frame is not a subject_state_changed happening for
 *  the audio_playback_stream_format subject. Unwraps a leading
 *  { happening: ... } envelope. */
export function decodeStreamFormatHappening(
  raw: unknown
): StreamFormat | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_playback_stream_format") return null;
  return decodeStreamFormat(frame["new_state"]);
}

/** Human-readable PCM bit-depth label for a codec token. */
function pcmDepthLabel(codec: string): string {
  switch (codec) {
    case "pcm_s16_le":
      return "16-bit";
    case "pcm_s24_le":
      return "24-bit";
    case "pcm_s32_le":
      return "32-bit";
    case "pcm_f32":
      return "32-bit float";
    default:
      return codec;
  }
}

/** Human-readable channel-count label. */
function channelLabel(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return `${channels}ch`;
}

/** Format a sample rate in Hz as a kHz string (44100 -> "44.1 kHz",
 *  192000 -> "192 kHz"). */
function rateLabel(rateHz: number): string {
  const khz = rateHz / 1000;
  const text = Number.isInteger(khz) ? String(khz) : khz.toFixed(1);
  return `${text} kHz`;
}

/** Operator-readable one-line label for an AudioFormat. */
export function formatAudioFormat(f: AudioFormat): string {
  if (f.kind === "pcm") {
    return `${rateLabel(f.rateHz)} / ${pcmDepthLabel(f.codec)} / ${channelLabel(f.channels)}`;
  }
  if (f.kind === "dsd") {
    const transport =
      f.transport === "dop"
        ? "DoP"
        : f.transport === "native_usb"
          ? "native USB"
          : f.transport;
    return `${f.rate} (${transport}) / ${channelLabel(f.channels)}`;
  }
  // encoded_passthrough: include the carried bitrate when known.
  // Cbr renders as "192 kbps", Vbr as "245 kbps VBR", Unknown as
  // bare "VBR" (codec-specific; Opus / variable-without-marker
  // legitimately have no average). Bitrate-absent payloads fall
  // back to the rate-only label.
  const head = `${f.codec.toUpperCase()} ${rateLabel(f.rateHz)}`;
  const rate =
    f.bitrate === null
      ? ""
      : f.bitrate.kind === "cbr"
        ? ` / ${f.bitrate.kbps} kbps`
        : f.bitrate.kind === "vbr"
          ? ` / ${f.bitrate.avgKbps} kbps VBR`
          : " / VBR";
  return `${head}${rate} / ${channelLabel(f.channels)}`;
}

/** True when two AudioFormats are identical - lets the readout
 *  collapse the source line when it would just repeat effective. */
export function audioFormatsEqual(a: AudioFormat, b: AudioFormat): boolean {
  return formatAudioFormat(a) === formatAudioFormat(b);
}
