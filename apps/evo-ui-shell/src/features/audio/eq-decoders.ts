// Pure logic for the parametric-EQ surface.
//
// The EQ has three framework-side pieces:
//   - composition.select_mode { v, mode } on the audio.composition
//     shelf - selects "eq_only" (or "passthrough"). eq_only is
//     refused, with status "bad_request" + an operator-readable
//     `error`, when the negotiated format is outside the EQ DSP's
//     coverage (PCM s16le / f32le, mono / stereo).
//   - options.set_eq_engaged { v, value } - the A/B bypass within
//     eq_only mode.
//   - options.set_eq_band { v, index, freq_hz, gain_db, q } - one
//     of the 10 peaking bands.
// eq_engaged + the 10 bands persist in audio.options.settings; the
// composition mode is ephemeral (resets to passthrough on load).
//
// Named presets are a UI-owned convenience (stored in ui.settings),
// so their serialise / parse / validate logic lives here too.
//
// Kept pure and Preact-free for the contract tests.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Number of peaking bands - schema-pinned by the framework. */
export const EQ_BAND_COUNT = 10;
export const EQ_FREQ_MIN = 20;
export const EQ_FREQ_MAX = 20000;
export const EQ_GAIN_MIN = -15;
export const EQ_GAIN_MAX = 15;
export const EQ_Q_MIN = 0.1;
export const EQ_Q_MAX = 30;

/** One peaking-EQ band. */
export interface EqBand {
  /** Centre frequency in Hz (20..=20000). */
  freqHz: number;
  /** Gain in dB (-15..=+15). 0 disables the band. */
  gainDb: number;
  /** Quality factor (0.1..=30). Higher = narrower. */
  q: number;
}

function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp a band's fields into the framework domains. */
export function clampEqBand(b: EqBand): EqBand {
  return {
    freqHz: Math.round(clampNum(b.freqHz, EQ_FREQ_MIN, EQ_FREQ_MAX)),
    gainDb: clampNum(b.gainDb, EQ_GAIN_MIN, EQ_GAIN_MAX),
    q: clampNum(b.q, EQ_Q_MIN, EQ_Q_MAX)
  };
}

/** The framework default band: 1 kHz, 0 dB, Q 1.0. */
export function defaultEqBand(): EqBand {
  return { freqHz: 1000, gainDb: 0, q: 1 };
}

/** 10 flat default bands - the framework's literal default state
 *  (every band at 1 kHz / 0 dB / Q 1.0). */
export function flatEqBands(): EqBand[] {
  const out: EqBand[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) out.push(defaultEqBand());
  return out;
}

/** 10 bands spread across the spectrum at 0 dB / Q 1.0 - the UI's
 *  "reset" state. Same flat response as flatEqBands(), but the
 *  bands are pre-placed at standard frequencies so the operator
 *  starts with a usable 10-band layout rather than ten handles
 *  stacked on 1 kHz. */
export function spreadEqBands(): EqBand[] {
  const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  return freqs.map((freqHz) => ({ freqHz, gainDb: 0, q: 1 }));
}

/** Decode the `eq_bands` array from an audio.options.settings
 *  payload into exactly EQ_BAND_COUNT clamped bands. Missing or
 *  short input is padded with flat defaults; extra entries are
 *  dropped. */
export function decodeEqBands(raw: unknown): EqBand[] {
  const out: EqBand[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const entry = list[i];
    if (isObject(entry)) {
      const f = entry["freq_hz"];
      const g = entry["gain_db"];
      const q = entry["q"];
      out.push(
        clampEqBand({
          freqHz: typeof f === "number" ? f : 1000,
          gainDb: typeof g === "number" ? g : 0,
          q: typeof q === "number" ? q : 1
        })
      );
    } else {
      out.push(defaultEqBand());
    }
  }
  return out;
}

/** Encode one band to the options.set_eq_band wire payload. */
export function eqBandToPayload(
  index: number,
  band: EqBand
): Record<string, unknown> {
  const c = clampEqBand(band);
  return {
    v: 1,
    index,
    freq_hz: c.freqHz,
    gain_db: c.gainDb,
    q: c.q
  };
}

/** Encode one band to the bare wire shape used inside a preset's
 *  `bands` array (no index / version envelope). */
export function eqBandToWire(
  band: EqBand
): { freq_hz: number; gain_db: number; q: number } {
  const c = clampEqBand(band);
  return { freq_hz: c.freqHz, gain_db: c.gainDb, q: c.q };
}

/** Outcome of a composition.select_mode dispatch. */
export type SelectModeOutcome =
  | { ok: true; activeMode: string }
  | { ok: false; reason: string };

/** Decode the composition.select_mode response value. The plugin
 *  returns an OK frame whose `status` carries the verdict, so a
 *  refusal is `{ status: "bad_request", error }`, not a wire
 *  error. */
export function decodeSelectModeOutcome(raw: unknown): SelectModeOutcome {
  if (!isObject(raw)) {
    return { ok: false, reason: "The device returned an unreadable response." };
  }
  if (raw["status"] === "ok") {
    const m = raw["active_mode"];
    return { ok: true, activeMode: typeof m === "string" ? m : "" };
  }
  const err = raw["error"];
  return {
    ok: false,
    reason:
      typeof err === "string" && err.length > 0
        ? err
        : "The device refused the EQ mode."
  };
}

/** Summed peaking-EQ magnitude response in dB at one frequency.
 *  A Gaussian-in-log-frequency approximation per band - good
 *  enough to draw the curve; the framework runs the real RBJ
 *  biquads. Matches the approved mockup's curve. */
export function eqResponseDb(bands: ReadonlyArray<EqBand>, freqHz: number): number {
  let sum = 0;
  for (const b of bands) {
    const d = Math.log(freqHz / b.freqHz);
    const sigma = 0.62 / b.q;
    sum += b.gainDb * Math.exp(-0.5 * (d / sigma) * (d / sigma));
  }
  return sum;
}

// ---- presets (UI-owned, stored in ui.settings) -----------------

/** A named EQ preset - a snapshot of the 10 bands. */
export interface EqPreset {
  name: string;
  bands: EqBand[];
}

/** Schema marker for the exported preset-library file. */
export const EQ_PRESET_FILE_SCHEMA = "evo-eq-presets";

/** Serialise the preset library to the export-file shape. */
export function serialiseEqPresetLibrary(presets: ReadonlyArray<EqPreset>): string {
  return JSON.stringify(
    {
      schema: EQ_PRESET_FILE_SCHEMA,
      version: 1,
      presets: presets.map((p) => ({
        name: p.name,
        bands: p.bands.map((b) => clampEqBand(b))
      }))
    },
    null,
    2
  );
}

/** Decode the options.list_eq_presets response into the preset
 *  library. Tolerates the { presets: [...] } envelope and a bare
 *  array; skips entries that are not usable presets. */
export function decodeEqPresetList(raw: unknown): EqPreset[] {
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isObject(raw) && Array.isArray(raw["presets"])) {
    list = raw["presets"];
  } else {
    return [];
  }
  const out: EqPreset[] = [];
  for (const entry of list as unknown[]) {
    const p = decodeEqPreset(entry);
    if (p !== null) out.push(p);
  }
  return out;
}

/** Validate + decode one preset object. Returns null when the
 *  object is not a usable preset (no name, or no bands). */
export function decodeEqPreset(raw: unknown): EqPreset | null {
  if (!isObject(raw)) return null;
  const name = raw["name"];
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (!Array.isArray(raw["bands"])) return null;
  return { name: name.trim(), bands: decodeEqBands(raw["bands"]) };
}

/** Parse an imported preset-library file. Returns the preset list
 *  on success, or null when the file is not a recognised EQ
 *  preset export. Tolerates a bare array of presets too. */
export function parseEqPresetLibrary(text: string): EqPreset[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  let list: unknown;
  if (Array.isArray(doc)) {
    list = doc;
  } else if (isObject(doc) && doc["schema"] === EQ_PRESET_FILE_SCHEMA) {
    list = doc["presets"];
  } else {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const out: EqPreset[] = [];
  for (const entry of list as unknown[]) {
    const p = decodeEqPreset(entry);
    if (p !== null) out.push(p);
  }
  return out;
}
