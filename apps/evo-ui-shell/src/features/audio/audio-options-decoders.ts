// Pure decoders + transition-state reducer for the audio.options
// shape-2 contract (org.evoframework.playback.options) and the
// hardware.audio verify_install surface.
//
// Extracted as a standalone module so every decoder + the
// mixer-transition state reducer can be unit-tested without the
// Preact runtime or the WS transport. Wire shapes are sourced from
// the plugin source in evo-device-audio (the catalogue schema marks
// payload_in/payload_out tbd-review, so the plugin is authoritative):
//
//   org.evoframework.playback.options/src/lib.rs    - Settings, setters
//   org.evoframework.playback.options/src/transition.rs - lifecycle
//   org.evoframework.hardware.audio-config/src/verify.rs - verify report
//
// Helpers isObject / stringField / numberField / boolField are
// duplicated locally so this module has a flat dependency graph.

import type { EqBand } from "./eq-decoders";

// =============================================================
// audio.options.settings subject
// =============================================================

/** Mixer-type domain. Snake-case wire strings, matching the
 *  framework's `MixerType` serde enum. */
export type MixerType = "hardware" | "software" | "none";

/** Perceived-loudness curve domain. Snake-case wire strings,
 *  matching the framework's `VolumeCurve` serde enum. */
export type VolumeCurve = "linear" | "log" | "natural";

/** Resampling / SRC policy. Mirrors the framework's
 *  `ResamplingPolicy`. Sent (snake-cased) to options.set_resampling. */
export interface ResamplingPolicy {
  /** Resample the source to the target format, or pass it native. */
  enabled: boolean;
  /** Target bit depth: "" (match source) / "16" / "24" / "32" /
   *  "f" (32-bit float). */
  targetBitdepth: string;
  /** Target sample rate: "" (match source) / "44100" / "48000" /
   *  "88200" / "96000" / "176400" / "192000". */
  targetSamplerate: string;
  /** SRC quality: "" / "quick" / "low" / "medium" / "high" /
   *  "very_high". */
  quality: string;
}

/** The framework default resampling policy (off, all native). */
export const DEFAULT_RESAMPLING: ResamplingPolicy = {
  enabled: false,
  targetBitdepth: "",
  targetSamplerate: "",
  quality: ""
};

/** Decode the `resampling` sub-object of the settings payload. A
 *  missing / non-object value yields the framework default. */
export function decodeResamplingPolicy(raw: unknown): ResamplingPolicy {
  if (!isObject(raw)) return { ...DEFAULT_RESAMPLING };
  return {
    enabled: boolField(raw, "enabled") ?? false,
    targetBitdepth: stringField(raw, "target_bitdepth") ?? "",
    targetSamplerate: stringField(raw, "target_samplerate") ?? "",
    quality: stringField(raw, "quality") ?? ""
  };
}

/** Decoded `audio.options.settings` subject state. Mirrors the
 *  framework's `Settings` struct; only the fields the operator UI
 *  renders are surfaced here. */
export interface AudioOptionsSettings {
  /** Mixer-type choice. Drives the delivery plugin's pcm chain. */
  mixerType: MixerType;
  /** ALSA mixer device coordinate (`hw:CARD=DAC`, `hw:0`, ...).
   *  Empty string means unset. Required-when hardware mode. */
  mixerDevice: string;
  /** ALSA mixer control name (`Master`, `PCM`, ...). Empty string
   *  means unset. Required-when hardware mode. */
  mixerControl: string;
  /** Operator-facing startup-volume floor 0..=100, restored on
   *  plugin load / steward restart. Default 30. */
  startupVolumePercent: number;
  /** Operator-imposed maximum-volume ceiling 0..=100. Default 100
   *  (no cap). Invariant: startupVolumePercent <= maxVolumePercent. */
  maxVolumePercent: number;
  /** Perceived-loudness mapping curve. Default "linear". */
  volumeCurve: VolumeCurve;
  /** Bound output device - the canonical `hw:N,M` alsa_id of a
   *  delivery.list_outputs row. Empty string means the framework
   *  default (the distribution's first detected playback card). */
  outputDevice: string;
  /** Bit-perfect DoP: carry DSD over a PCM transport. */
  dop: boolean;
  /** Volume normalization (loudness levelling) on / off. */
  volumeNormalization: boolean;
  /** Resampling / SRC policy. */
  resampling: ResamplingPolicy;
  /** Exclusive (hog) device mode. When true the chain pins
   *  bit-perfect at the card terminus; resampling and softvol are
   *  suppressed. Default false. */
  exclusiveMode: boolean;
  /** Between-track crossfade duration in seconds, 0..=30. 0
   *  disables crossfade. Default 0. */
  crossfadeSeconds: number;
  /** Gapless playback flag. Default true. */
  gapless: boolean;
  /** Parametric-EQ A/B engagement. When false the stream passes
   *  unchanged even in eq_only mode. Default false. */
  eqEngaged: boolean;
  /** The 10 parametric-EQ bands. Always exactly 10, flat-default
   *  (1 kHz / 0 dB / Q 1.0) when absent. */
  eqBands: EqBand[];
}

function coerceMixerType(raw: unknown): MixerType {
  return raw === "hardware" || raw === "none" ? raw : "software";
}

function coerceVolumeCurve(raw: unknown): VolumeCurve {
  return raw === "log" || raw === "natural" ? raw : "linear";
}

/** Clamp a decoded volume percent into the framework's 0..=100
 *  domain. Non-numeric / non-finite input falls back to `fallback`. */
function clampPercent(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

/** Decode the `audio.options.settings` subject payload into typed
 *  settings. Returns null when the payload is not an object - the
 *  caller surfaces that as a settings-unavailable state rather than
 *  rendering controls bound to garbage.
 *
 *  Tolerant of missing fields: each maps to its framework default
 *  (mixer_type=software, volume_curve=linear, startup=30, max=100,
 *  device/control empty) so a partial payload still yields a
 *  renderable settings object. */
export function decodeAudioOptionsSettings(
  raw: unknown
): AudioOptionsSettings | null {
  if (!isObject(raw)) return null;
  return {
    mixerType: coerceMixerType(raw["mixer_type"]),
    mixerDevice: stringField(raw, "mixer_device") ?? "",
    mixerControl: stringField(raw, "mixer_control") ?? "",
    startupVolumePercent: clampPercent(raw["startup_volume_percent"], 30),
    maxVolumePercent: clampPercent(raw["max_volume_percent"], 100),
    volumeCurve: coerceVolumeCurve(raw["volume_curve"]),
    outputDevice: stringField(raw, "output_device") ?? "",
    dop: boolField(raw, "dop") ?? false,
    volumeNormalization: boolField(raw, "volume_normalization") ?? false,
    resampling: decodeResamplingPolicy(raw["resampling"]),
    exclusiveMode: boolField(raw, "exclusive_mode") ?? false,
    crossfadeSeconds: clampCrossfadeSeconds(raw["crossfade_seconds"]),
    gapless: boolField(raw, "gapless") ?? true,
    eqEngaged: boolField(raw, "eq_engaged") ?? false,
    eqBands: decodeEqBandsField(raw["eq_bands"])
  };
}

// Local eq_bands decode. Kept in-module so this file stays
// dependency-free for the contract harness (its node runner cannot
// resolve extensionless cross-module imports). The canonical
// decoder + domain constants live in eq-decoders.ts; this mirrors
// it - 10 clamped bands, flat default (1 kHz / 0 dB / Q 1.0).
function decodeEqBandsField(raw: unknown): EqBand[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EqBand[] = [];
  for (let i = 0; i < 10; i++) {
    const e = list[i];
    let freqHz = 1000;
    let gainDb = 0;
    let q = 1;
    if (typeof e === "object" && e !== null) {
      const r = e as Record<string, unknown>;
      if (typeof r["freq_hz"] === "number") freqHz = r["freq_hz"];
      if (typeof r["gain_db"] === "number") gainDb = r["gain_db"];
      if (typeof r["q"] === "number") q = r["q"];
    }
    if (!Number.isFinite(freqHz)) freqHz = 1000;
    if (!Number.isFinite(gainDb)) gainDb = 0;
    if (!Number.isFinite(q)) q = 1;
    out.push({
      freqHz: Math.round(Math.min(20000, Math.max(20, freqHz))),
      gainDb: Math.min(15, Math.max(-15, gainDb)),
      q: Math.min(30, Math.max(0.1, q))
    });
  }
  return out;
}

/** Crossfade-seconds domain bound enforced by the framework setter
 *  (options.set_crossfade_seconds refuses above this). */
export const CROSSFADE_SECONDS_MAX = 30;

/** Clamp a decoded crossfade-seconds value into 0..=30. Non-numeric
 *  / non-finite input falls back to 0 (crossfade disabled). */
export function clampCrossfadeSeconds(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  if (rounded < 0) return 0;
  if (rounded > CROSSFADE_SECONDS_MAX) return CROSSFADE_SECONDS_MAX;
  return rounded;
}

// =============================================================
// emit_test_tone payload (audio.playback warden course-correct)
// =============================================================

/** Channel routing for the output test tone. */
export type TestToneChannel = "left" | "right" | "both";

/** Framework domains for the emit_test_tone payload. */
export const TEST_TONE_FREQ_MIN = 20;
export const TEST_TONE_FREQ_MAX = 20000;
export const TEST_TONE_DURATION_MIN_MS = 100;
export const TEST_TONE_DURATION_MAX_MS = 10000;

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}

/** Build the emit_test_tone course-correct payload, clamping every
 *  field into the framework domains so a UI typo never reaches the
 *  warden's structured refusal. freq 20..=20000 Hz, duration
 *  100..=10000 ms, channel left / right / both. */
export function buildTestTonePayload(
  freqHz: number,
  durationMs: number,
  channel: TestToneChannel
): { v: number; freq_hz: number; duration_ms: number; channel: string } {
  const ch: TestToneChannel =
    channel === "left" || channel === "right" || channel === "both"
      ? channel
      : "both";
  return {
    v: 1,
    freq_hz: clampInt(freqHz, TEST_TONE_FREQ_MIN, TEST_TONE_FREQ_MAX, 1000),
    duration_ms: clampInt(
      durationMs,
      TEST_TONE_DURATION_MIN_MS,
      TEST_TONE_DURATION_MAX_MS,
      1500
    ),
    channel: ch
  };
}

// =============================================================
// audio.delivery outputs (delivery.list_outputs + the
// evo.audio.delivery:outputs subject)
// =============================================================
//
// The delivery.alsa plugin enumerates physical ALSA outputs - one
// row per card+subdevice, already collapsed and classified
// framework-side. Wire shape confirmed against the framework
// reference implementation:
//   { v: 1, outputs: [ <AlsaOutput row>, ... ] }
// The reactive evo.audio.delivery:outputs subject carries the bare
// row array.

/** Output classification, framework-derived. Drives the
 *  Destination chips. Lowercase wire strings. */
export type OutputClass =
  | "i2s"
  | "hdmi"
  | "usb"
  | "analog"
  | "spdif"
  | "bluetooth"
  | "unknown";

/** Whether the catalogue matched the card. An `unmapped` row
 *  carries the raw card name as its label. */
export type CatalogProvenance = "curated" | "unmapped";

/** One physical audio output, decoded from a delivery.list_outputs
 *  row. */
export interface AlsaOutput {
  /** ALSA card number (N in hw:N,M). */
  cardIdx: number;
  /** ALSA subdevice number (M in hw:N,M). */
  deviceIdx: number;
  /** Raw ALSA card name. A stable identifier, not for display
   *  unless the row is unmapped. */
  cardName: string;
  /** Canonical `hw:N,M` id - the value used to select this
   *  output. */
  alsaId: string;
  /** Operator-facing label. Render this. */
  label: string;
  /** Framework-derived output class. */
  outputClass: OutputClass;
  /** ALSA mixer control the catalogue declares, or null when the
   *  output exposes no in-card mixer. */
  defaultMixerControl: string | null;
  /** Whether the catalogue matched this card. */
  catalogProvenance: CatalogProvenance;
  /** Catalogue flag: hide from the primary output list. */
  hidden: boolean;
  /** Catalogue flag: do not offer the generic-mixer fallback. */
  ignoreGenericMixer: boolean;
}

const OUTPUT_CLASS_VALUES: ReadonlySet<string> = new Set([
  "i2s",
  "hdmi",
  "usb",
  "analog",
  "spdif",
  "bluetooth",
  "unknown"
]);

function coerceOutputClass(raw: unknown): OutputClass {
  return typeof raw === "string" && OUTPUT_CLASS_VALUES.has(raw)
    ? (raw as OutputClass)
    : "unknown";
}

/** Decode one delivery.list_outputs row. Returns null when the row
 *  lacks the `alsa_id` needed to select it. */
function decodeAlsaOutput(raw: unknown): AlsaOutput | null {
  if (!isObject(raw)) return null;
  const alsaId = stringField(raw, "alsa_id");
  if (alsaId === null || alsaId.length === 0) return null;
  const cardName = stringField(raw, "card_name") ?? alsaId;
  return {
    cardIdx: numberField(raw, "card_idx") ?? 0,
    deviceIdx: numberField(raw, "device_idx") ?? 0,
    cardName,
    alsaId,
    label: stringField(raw, "label") ?? cardName,
    outputClass: coerceOutputClass(raw["output_class"]),
    defaultMixerControl: stringField(raw, "default_mixer_control"),
    catalogProvenance:
      raw["catalog_provenance"] === "curated" ? "curated" : "unmapped",
    hidden: boolField(raw, "hidden") ?? false,
    ignoreGenericMixer: boolField(raw, "ignore_generic_mixer") ?? false
  };
}

/** Decode the delivery.list_outputs response or the
 *  evo.audio.delivery:outputs subject state. Accepts the wrapped
 *  `{ v, outputs: [...] }` envelope or the bare row array (the
 *  subject form). Rows missing an alsa_id are skipped. Anything
 *  unusable yields [] - the Destination then shows "no outputs". */
export function decodeAlsaOutputs(raw: unknown): AlsaOutput[] {
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isObject(raw) && Array.isArray(raw["outputs"])) {
    list = raw["outputs"];
  } else {
    return [];
  }
  const out: AlsaOutput[] = [];
  for (const entry of list as unknown[]) {
    const decoded = decodeAlsaOutput(entry);
    if (decoded !== null) out.push(decoded);
  }
  return out;
}

/** Operator-relevant outputs: drop catalogue-hidden rows and the
 *  ALSA Loopback (a framework-internal pipeline card, never an
 *  operator output). */
export function visibleOutputs(
  outputs: ReadonlyArray<AlsaOutput>
): AlsaOutput[] {
  return outputs.filter((o) => !o.hidden && o.cardName !== "Loopback");
}

/** Find the output matching a persisted selection (the settings
 *  `outputDevice`), matched on the canonical `alsa_id`. Returns
 *  null when nothing matches. */
export function findSelectedOutput(
  outputs: ReadonlyArray<AlsaOutput>,
  outputDevice: string
): AlsaOutput | null {
  if (outputDevice.length === 0) return null;
  return outputs.find((o) => o.alsaId === outputDevice) ?? null;
}

/** Display order of the output-class chips. */
export const OUTPUT_CLASS_ORDER: ReadonlyArray<OutputClass> = [
  "i2s",
  "hdmi",
  "analog",
  "usb",
  "spdif",
  "bluetooth",
  "unknown"
];

/** Human-readable label for an output class. `unknown` is the
 *  bucket for unmapped / unclassifiable outputs. */
export function outputClassLabel(c: OutputClass): string {
  switch (c) {
    case "i2s":
      return "I2S DAC";
    case "hdmi":
      return "HDMI";
    case "usb":
      return "USB audio";
    case "analog":
      return "Analog";
    case "spdif":
      return "S/PDIF";
    case "bluetooth":
      return "Bluetooth";
    default:
      return "Other";
  }
}

// =============================================================
// audio.mixer_transition.* lifecycle happenings
// =============================================================

/** One decoded mixer-transition lifecycle happening. The four
 *  event types are mutually exclusive per `started` per the
 *  options.v2 contract (`mixer-transition-lifecycle-happenings`):
 *  every `started` is followed by exactly one of applied /
 *  rolled_back / failed. */
export type MixerTransitionEvent =
  | { kind: "started"; from: MixerType; to: MixerType }
  | {
      kind: "applied";
      from: MixerType;
      to: MixerType;
      /** Step-1 readback level the orchestrator carried forward. */
      carriedLevel: number;
      /** Step-6 readback - the post-transition EFFECTIVE level.
       *  Per invariant I6 (operator truth) the UI volume slider
       *  tracks THIS value, not the pre-transition slider. */
      effectiveLevel: number;
    }
  | {
      kind: "rolled_back";
      from: MixerType;
      to: MixerType;
      /** Phase the original failure occurred at. */
      atPhase: string;
      /** Operator-readable diagnostic. */
      reason: string;
    }
  | {
      kind: "failed";
      from: MixerType;
      to: MixerType;
      atPhase: string;
      reason: string;
    };

/** The four lifecycle happening event-type strings. */
export const MIXER_TRANSITION_EVENT_TYPES = {
  started: "audio.mixer_transition.started",
  applied: "audio.mixer_transition.applied",
  rolledBack: "audio.mixer_transition.rolled_back",
  failed: "audio.mixer_transition.failed"
} as const;

/** Decode a happening into a `MixerTransitionEvent`.
 *
 *  `eventType` is the happening's event_type string; `payload` is
 *  the PluginEvent payload. Returns null when the event_type is not
 *  one of the four mixer-transition types, or when the payload is
 *  structurally unusable (not an object, missing from/to). A null
 *  return means "not a mixer-transition event, ignore it" - the
 *  caller never surfaces null as an error.
 *
 *  `from`/`to` fall back to "software" only as a last resort; they
 *  are always present in the framework's emitted payloads. */
export function decodeMixerTransitionEvent(
  eventType: string,
  payload: unknown
): MixerTransitionEvent | null {
  if (!isObject(payload)) return null;
  const from = coerceMixerType(payload["from"]);
  const to = coerceMixerType(payload["to"]);
  switch (eventType) {
    case MIXER_TRANSITION_EVENT_TYPES.started:
      return { kind: "started", from, to };
    case MIXER_TRANSITION_EVENT_TYPES.applied:
      return {
        kind: "applied",
        from,
        to,
        carriedLevel: clampPercent(payload["carried_level"], 0),
        effectiveLevel: clampPercent(payload["effective_level"], 0)
      };
    case MIXER_TRANSITION_EVENT_TYPES.rolledBack:
      return {
        kind: "rolled_back",
        from,
        to,
        atPhase: stringField(payload, "at_phase") ?? "unknown",
        reason: stringField(payload, "reason") ?? "No diagnostic provided."
      };
    case MIXER_TRANSITION_EVENT_TYPES.failed:
      return {
        kind: "failed",
        from,
        to,
        atPhase: stringField(payload, "at_phase") ?? "unknown",
        reason: stringField(payload, "reason") ?? "No diagnostic provided."
      };
    default:
      return null;
  }
}

/** A plugin-event happening reduced to its event_type + payload. */
export interface PluginEventFrame {
  eventType: string;
  payload: unknown;
}

/** Extract the `(event_type, payload)` pair from a happening frame.
 *
 *  The framework emits mixer-transition lifecycle events as
 *  `Happening::PluginEvent`. The exact serialised wire shape is not
 *  yet pinned in a UI-visible schema, so this extractor is tolerant
 *  of the plausible serde encodings and unwraps a leading
 *  `{ happening: ... }` envelope first:
 *
 *    { event_type, payload }
 *    { PluginEvent: { event_type, payload } }
 *    { variant: "plugin_event", event_type, payload }
 *    { kind: "PluginEvent", event_type, payload }
 *
 *  Returns null when no event_type string can be located - the
 *  caller treats null as "not a plugin event, ignore it". Once the
 *  shape-2 plugin is on a rig, the live shape confirms which branch
 *  fires; the tolerant set means no rework if it is any of these. */
export function extractPluginEvent(raw: unknown): PluginEventFrame | null {
  if (!isObject(raw)) return null;
  // Unwrap an outer { happening: ... } envelope.
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  // Unwrap an externally-tagged { PluginEvent: { ... } } enum.
  const inner = isObject(frame["PluginEvent"])
    ? frame["PluginEvent"]
    : frame;
  const eventType = stringField(inner, "event_type");
  if (eventType === null) return null;
  return { eventType, payload: inner["payload"] ?? inner };
}

// =============================================================
// Mixer-transition UI state reducer
// =============================================================

/** UI-facing phase of the mixer transition. Drives the three
 *  affordances:
 *
 *  - `applying`   -> the non-dismissable "Applying audio mode" overlay
 *                    + the audio-control lockout.
 *  - `applied`    -> transient; the overlay clears, the volume slider
 *                    snaps to `effectiveLevel`, a brief pulse fires.
 *                    The surface dismisses this back to `idle` after
 *                    the pulse.
 *  - `rolled_back`-> a non-modal dismissable banner.
 *  - `failed`     -> a modal requiring explicit acknowledgement.
 *  - `idle`       -> nothing shown; controls live. */
export type MixerTransitionPhase =
  | { kind: "idle" }
  | { kind: "applying"; from: MixerType; to: MixerType }
  | {
      kind: "applied";
      from: MixerType;
      to: MixerType;
      carriedLevel: number;
      effectiveLevel: number;
    }
  | {
      kind: "rolled_back";
      from: MixerType;
      to: MixerType;
      atPhase: string;
      reason: string;
    }
  | {
      kind: "failed";
      from: MixerType;
      to: MixerType;
      atPhase: string;
      reason: string;
    };

/** The initial / cleared transition phase. */
export const IDLE_TRANSITION: MixerTransitionPhase = { kind: "idle" };

/** Action fed to {@link reduceMixerTransition}. Either a decoded
 *  lifecycle happening, or a `dismiss` (operator closed the banner /
 *  acknowledged the modal, or the applied-pulse timer fired). */
export type MixerTransitionAction =
  | { kind: "event"; event: MixerTransitionEvent }
  | { kind: "dismiss" };

/** Pure reducer mapping the current transition phase + an action to
 *  the next phase.
 *
 *  Design notes addressing the brief's invariants:
 *
 *  - A `started` event always enters `applying`, regardless of the
 *    current phase. A fresh transition supersedes a stale banner /
 *    modal that the operator never dismissed.
 *  - A terminal event (`applied` / `rolled_back` / `failed`) is
 *    honoured from ANY phase, not only from `applying`. The brief's
 *    happenings are mutually exclusive per `started`, but a UI that
 *    mounted mid-transition (or a dropped `started` frame) must
 *    still react to the terminal event it does see.
 *  - `dismiss` always returns to `idle`. The surface uses it for the
 *    applied-pulse timeout, the rolled_back banner's dismiss/auto-
 *    dismiss, and the failed modal's explicit acknowledgement. */
export function reduceMixerTransition(
  phase: MixerTransitionPhase,
  action: MixerTransitionAction
): MixerTransitionPhase {
  if (action.kind === "dismiss") {
    return IDLE_TRANSITION;
  }
  const ev = action.event;
  switch (ev.kind) {
    case "started":
      return { kind: "applying", from: ev.from, to: ev.to };
    case "applied":
      return {
        kind: "applied",
        from: ev.from,
        to: ev.to,
        carriedLevel: ev.carriedLevel,
        effectiveLevel: ev.effectiveLevel
      };
    case "rolled_back":
      return {
        kind: "rolled_back",
        from: ev.from,
        to: ev.to,
        atPhase: ev.atPhase,
        reason: ev.reason
      };
    case "failed":
      return {
        kind: "failed",
        from: ev.from,
        to: ev.to,
        atPhase: ev.atPhase,
        reason: ev.reason
      };
  }
}

/** True while a transition is mid-flight - the surface blocks every
 *  audio-routing control (mixer-type selector, volume slider,
 *  output-device picker, DAC selection, resampling toggle) while
 *  this holds. Per brief section 1. */
export function isTransitionInFlight(phase: MixerTransitionPhase): boolean {
  return phase.kind === "applying";
}

// =============================================================
// hardware.audio.verify_install
// =============================================================

/** Aggregated verify_install verdict. Worst-case wins:
 *  ok = every probe passed; partial = some passed; failed = none. */
export type VerifyStatus = "ok" | "partial" | "failed";

/** One verify_install probe outcome. */
export interface VerifyProbe {
  /** Probe id: board_profile / catalogue / sudoers_grant /
   *  modder_staging_dir. */
  name: string;
  /** Probe verdict. */
  ok: boolean;
  /** Operator-readable diagnostic; on failure carries the
   *  remediation hint (typically "run the bootstrap script"). */
  diagnostic: string;
}

/** Decoded verify_install report. */
export interface VerifyInstallReport {
  status: VerifyStatus;
  probes: ReadonlyArray<VerifyProbe>;
}

function coerceVerifyStatus(raw: unknown): VerifyStatus {
  return raw === "ok" || raw === "partial" ? raw : "failed";
}

/** Decode the `hardware.audio.verify_install` response. The wire
 *  envelope is `{ v, report: { status, probes: [...] } }`; this
 *  decoder accepts either the wrapped envelope or a bare report
 *  object (defensive against the wrapper being dropped).
 *
 *  Returns null when no report object can be found - the caller
 *  surfaces that as a self-test-failed-to-run state. */
export function decodeVerifyInstallReport(
  raw: unknown
): VerifyInstallReport | null {
  if (!isObject(raw)) return null;
  const report = isObject(raw["report"]) ? raw["report"] : raw;
  const probesRaw = report["probes"];
  if (!Array.isArray(probesRaw)) return null;
  const probes: VerifyProbe[] = [];
  for (const entry of probesRaw) {
    if (!isObject(entry)) continue;
    const name = stringField(entry, "name");
    if (name === null) continue;
    probes.push({
      name,
      ok: boolField(entry, "ok") ?? false,
      diagnostic:
        stringField(entry, "diagnostic") ?? "No diagnostic provided."
    });
  }
  return { status: coerceVerifyStatus(report["status"]), probes };
}

// =============================================================
// hardware.audio - DAC selection + DSP controls
// =============================================================
//
// Wire shapes confirmed live + against the plugin source:
//   current_config        -> { v, active: {...} }
//   list_dac_catalogue    -> { v, profile, catalogue: [...] }
//   dsp.list_controls     -> { v, capabilities: {...} }
//   select_dac/clear_dac  -> { v, status, outcome: { reboot_required } }
// The active_config / dsp_capabilities / pending_reboot subjects
// carry the same shapes for the subscribe path.

/** Active DAC config (hardware.audio.current_config / the
 *  active_config subject). A null catalogueId means no DAC is
 *  resolved. */
export interface ActiveDacConfig {
  overlay: string;
  catalogueId: string | null;
  displayName: string | null;
  alsacardHint: string | null;
  mixerHint: string | null;
  bootConfigPath: string;
}

/** Decode current_config / the active_config subject state. */
export function decodeActiveDacConfig(raw: unknown): ActiveDacConfig | null {
  if (!isObject(raw)) return null;
  const active = isObject(raw["active"]) ? raw["active"] : raw;
  return {
    overlay: stringField(active, "overlay") ?? "",
    catalogueId: nullableStr(active["catalogue_id"]),
    displayName: nullableStr(active["display_name"]),
    alsacardHint: nullableStr(active["alsacard_hint"]),
    mixerHint: nullableStr(active["mixer_hint"]),
    bootConfigPath: stringField(active, "boot_config_path") ?? ""
  };
}

/** One DAC catalogue entry. */
export interface DacCatalogueEntry {
  id: string;
  displayName: string;
  overlay: string;
  needsRebootOnApply: boolean;
}

/** Decode the hardware.audio.list_dac_catalogue response. Entries
 *  with no id are skipped; a malformed payload yields []. */
export function decodeDacCatalogue(raw: unknown): DacCatalogueEntry[] {
  if (!isObject(raw)) return [];
  const list = raw["catalogue"];
  if (!Array.isArray(list)) return [];
  const out: DacCatalogueEntry[] = [];
  for (const e of list) {
    if (!isObject(e)) continue;
    const id = stringField(e, "id");
    if (id === null || id.length === 0) continue;
    out.push({
      id,
      displayName: stringField(e, "display_name") ?? id,
      overlay: stringField(e, "overlay") ?? "",
      needsRebootOnApply: boolField(e, "needs_reboot_on_apply") ?? true
    });
  }
  return out;
}

/** DSP control domain kind, from value_domain.kind. Drives the
 *  rendered widget. */
export type DspControlKind = "enum" | "integer" | "db_scale" | "boolean";

/** One resolved DSP control. */
export interface DspControl {
  /** ALSA mixer-control name - the `control` arg of set_control. */
  name: string;
  /** Operator-facing label. */
  label: string;
  /** Domain kind. */
  kind: DspControlKind;
  /** Enum legal values (kind === "enum"). May be empty when the
   *  framework resolved the control but did not enumerate its
   *  options - the UI then still shows `currentValue` but offers no
   *  alternatives. */
  enumValues: ReadonlyArray<string>;
  /** Operator-facing description of the control's effect, or "" when
   *  the catalogue declares none. */
  description: string;
  /** Catalogue-recommended value for this control, or null when none
   *  is declared. */
  recommendedDefault: string | null;
  /** Integer / db_scale bounds; null when unbounded. */
  rangeMin: number | null;
  rangeMax: number | null;
  /** Current value, or null when amixer could not read it. */
  currentValue: string | number | boolean | null;
  /** True when amixer exposed the control on the bound card. */
  bound: boolean;
}

/** Decoded DSP capability set. */
export interface DspCapabilities {
  dacId: string | null;
  advancedSettingsEnabled: boolean;
  controls: ReadonlyArray<DspControl>;
}

function decodeDspControl(raw: unknown): DspControl | null {
  if (!isObject(raw)) return null;
  const name = stringField(raw, "name");
  if (name === null || name.length === 0) return null;
  const domain: Record<string, unknown> = isObject(raw["value_domain"])
    ? raw["value_domain"]
    : {};
  const domainKind = stringField(domain, "kind");
  const kind: DspControlKind =
    domainKind === "integer" ||
    domainKind === "db_scale" ||
    domainKind === "boolean"
      ? domainKind
      : "enum";
  const rawValues = domain["values"];
  const enumValues = Array.isArray(rawValues)
    ? rawValues.filter((v): v is string => typeof v === "string")
    : [];
  const cv = raw["current_value"];
  const currentValue =
    typeof cv === "string" || typeof cv === "number" || typeof cv === "boolean"
      ? cv
      : null;
  return {
    name,
    label: stringField(raw, "human_label") ?? name,
    kind,
    enumValues,
    description: stringField(raw, "description") ?? "",
    recommendedDefault: nullableStr(raw["recommended_default"]),
    rangeMin: numberField(domain, "min"),
    rangeMax: numberField(domain, "max"),
    currentValue,
    bound: boolField(raw, "bound") ?? false
  };
}

/** Decode the hardware.audio.dsp.list_controls response (or the
 *  dsp_capabilities subject state). Accepts the `{ v, capabilities }`
 *  envelope or a bare capabilities object. */
export function decodeDspCapabilities(raw: unknown): DspCapabilities | null {
  if (!isObject(raw)) return null;
  const caps = isObject(raw["capabilities"]) ? raw["capabilities"] : raw;
  const controlsRaw = caps["controls"];
  const controls: DspControl[] = [];
  if (Array.isArray(controlsRaw)) {
    for (const c of controlsRaw) {
      const decoded = decodeDspControl(c);
      if (decoded !== null) controls.push(decoded);
    }
  }
  return {
    dacId: nullableStr(caps["dac_id"]),
    advancedSettingsEnabled:
      boolField(caps, "advanced_settings_enabled") ?? false,
    controls
  };
}

/** Decode the reboot_required flag from a select_dac / clear_dac
 *  response. */
export function decodeDacRebootRequired(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  const outcome = isObject(raw["outcome"]) ? raw["outcome"] : raw;
  return boolField(outcome, "reboot_required") ?? false;
}

// =============================================================
// system.power - host reboot + power-off verbs
// =============================================================
//
// The system.power shelf carries reboot_device + power_off_device,
// each step_up:system_admin gated at the framework dispatcher. The
// UI dispatches them through the canonical `request` op and
// surfaces the result. Wire shape follows the shelf's published
// schema and the framework's list_plugins surface.

/** Plugin id of the reference host-power plugin. The reboot button
 *  is shown only when a plugin of this id is admitted - a vendor
 *  build that suppressed it (locked-down kiosk) hides the button. */
export const SYSTEM_POWER_PLUGIN = "org.evoframework.system.power";

/** Extract plugin ids from a `list_plugins` wire response. Accepts
 *  the `{ plugins: [...] }` envelope or a bare array; each row is an
 *  object with a `name` (reverse-DNS plugin id) or a bare string.
 *  Anything unusable yields []. */
export function decodePluginNames(raw: unknown): string[] {
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isObject(raw) && Array.isArray(raw["plugins"])) {
    list = raw["plugins"];
  } else {
    return [];
  }
  const out: string[] = [];
  for (const entry of list as unknown[]) {
    if (typeof entry === "string" && entry.length > 0) {
      out.push(entry);
    } else if (isObject(entry)) {
      const name = stringField(entry, "name") ?? stringField(entry, "id");
      if (name !== null && name.length > 0) out.push(name);
    }
  }
  return out;
}

/** Outcome of a system.power verb dispatch (reboot_device or
 *  power_off_device). `accepted` means the verb ran and the host is
 *  shutting down - the connection dropping as PID 1 stops is also
 *  `accepted`, not a failure. */
export type PowerVerbOutcome =
  | { kind: "accepted" }
  | { kind: "not_authorised"; message: string }
  | { kind: "step_up_required"; message: string }
  | { kind: "error"; message: string };

/** Classify the error envelope of a system.power verb dispatch
 *  (reboot_device / power_off_device) into a UI-facing outcome.
 *
 *  - no error envelope                 -> accepted (verb ran)
 *  - connection dropped / aborted      -> accepted (host shutting down)
 *  - PermissionDenied/step_up_required -> step_up_required
 *  - PermissionDenied/scope_not_granted-> not_authorised
 *  - any other error                   -> error
 *
 *  The transport-drop-is-success rule matters because the host's
 *  init system tears the framework down before the wire response
 *  always reaches the caller (power.v1.toml: "fire-and-shutdown"). */
export function classifyPowerVerbOutcome(
  error: { code?: string; message?: string; subclass?: string } | undefined
): PowerVerbOutcome {
  if (error === undefined) return { kind: "accepted" };
  const code = (error.code ?? "").toLowerCase();
  if (code === "connection_closed" || code === "aborted") {
    return { kind: "accepted" };
  }
  const subclass = (error.subclass ?? "").toLowerCase();
  const message =
    error.message !== undefined && error.message.length > 0
      ? error.message
      : "The device refused the reboot request.";
  if (subclass.includes("step_up_required")) {
    return { kind: "step_up_required", message };
  }
  if (subclass.includes("scope_not_granted") || code.includes("permission")) {
    return { kind: "not_authorised", message };
  }
  return { kind: "error", message };
}

// =============================================================
// hardware.audio-modder - custom DAC overlays
// =============================================================
//
// The modder shelf admits operator-uploaded device-tree-blob
// overlays as catalogue rows. list_overlays returns
//   { v, surface_state, allowlist_status, overlays: [{row,state}] }
// register_overlay takes the row + the raw DTBO bytes + the digest
// + a CONFIRM:<id> token. Wire shapes confirmed against the plugin
// source (RegisterOverlayPayload / UserOverlayRow /
// modder_overlays_state in org.evoframework.hardware.audio-config).

/** Activation state of a registered user overlay. */
export type ModderOverlayState =
  | { kind: "active" }
  | { kind: "refused"; reason: string };

/** One registered custom-DAC overlay row + its activation state. */
export interface ModderOverlay {
  id: string;
  displayName: string;
  /** Bus topology: i2s / usb / spdif / hdmi / analog / bluetooth. */
  interface: string;
  /** dtoverlay token written to the boot config on select_dac. */
  overlay: string;
  dtboSha256: string;
  alsaCardHint: string;
  inCardMixer: string;
  dspOptions: ReadonlyArray<string>;
  overrideBase: boolean;
  state: ModderOverlayState;
}

/** Decoded list_overlays response / the modder_overlays subject. */
export interface ModderSurface {
  /** False when the distribution disabled the modder surface;
   *  register / remove then refuse. */
  surfaceEnabled: boolean;
  /** False when no operator-signed allowlist is installed; register
   *  then refuses with AllowlistEntryMissing. */
  allowlistLoaded: boolean;
  overlays: ReadonlyArray<ModderOverlay>;
}

/** Interface (bus-topology) values the register form offers, in
 *  display order. */
export const MODDER_INTERFACES: ReadonlyArray<string> = [
  "i2s",
  "hdmi",
  "analog",
  "usb",
  "spdif",
  "bluetooth"
];

function decodeModderOverlayState(raw: unknown): ModderOverlayState {
  // UserOverlayState is internally tagged on `kind`, snake_case:
  // { kind: "active" } or { kind: "refused", reason: "..." }.
  if (isObject(raw)) {
    const kind = stringField(raw, "kind");
    if (kind === "active") return { kind: "active" };
    if (kind === "refused") {
      return {
        kind: "refused",
        reason: stringField(raw, "reason") ?? "No diagnostic provided."
      };
    }
  }
  // Unrecognised: surface as refused so the UI never implies a row
  // is usable when it could not read the state.
  return { kind: "refused", reason: "Overlay state was unreadable." };
}

function decodeModderOverlay(raw: unknown): ModderOverlay | null {
  if (!isObject(raw)) return null;
  const row = isObject(raw["row"]) ? raw["row"] : null;
  if (row === null) return null;
  const id = stringField(row, "id");
  if (id === null || id.length === 0) return null;
  const dspRaw = row["dsp_options"];
  const dspOptions = Array.isArray(dspRaw)
    ? dspRaw.filter((v): v is string => typeof v === "string")
    : [];
  return {
    id,
    displayName: stringField(row, "display_name") ?? id,
    interface: stringField(row, "interface") ?? "i2s",
    overlay: stringField(row, "overlay") ?? "",
    dtboSha256: stringField(row, "dtbo_sha256_hex") ?? "",
    alsaCardHint: stringField(row, "alsa_card_hint") ?? "",
    inCardMixer: stringField(row, "in_card_mixer") ?? "",
    dspOptions,
    overrideBase: boolField(row, "override_base") ?? false,
    state: decodeModderOverlayState(raw["state"])
  };
}

/** Decode the list_overlays response or the modder_overlays subject
 *  state. Returns null when the payload is not an object. */
export function decodeModderSurface(raw: unknown): ModderSurface | null {
  if (!isObject(raw)) return null;
  const overlaysRaw = raw["overlays"];
  const overlays: ModderOverlay[] = [];
  if (Array.isArray(overlaysRaw)) {
    for (const entry of overlaysRaw) {
      const decoded = decodeModderOverlay(entry);
      if (decoded !== null) overlays.push(decoded);
    }
  }
  return {
    // ModderSurfaceState serialises snake_case: "enabled" / "disabled".
    surfaceEnabled: raw["surface_state"] === "enabled",
    allowlistLoaded: raw["allowlist_status"] === "loaded",
    overlays
  };
}

/** Decode the `profile` field of a list_dac_catalogue response -
 *  the board profile a registered overlay row must declare. */
export function decodeCatalogueProfile(raw: unknown): string {
  if (!isObject(raw)) return "";
  return stringField(raw, "profile") ?? "";
}

// =============================================================
// Local structural helpers
// =============================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function boolField(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A non-empty string, or null - the framework sends JSON null for
 *  an absent optional string field. */
function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
