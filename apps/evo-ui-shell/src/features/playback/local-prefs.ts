// Per-browser playback/visualizer preferences - THE single source for
// the localStorage keys, value spaces, and tolerant readers. The App
// owns writing (its Settings controls); the designer's Show mode
// reads through the SAME resolution so the preview obeys the same
// preferences as the glass in this browser (WYSIWYG parity - the
// hardcoded preview values were called out in review).
//
// These are deliberately per-browser (panel kiosk and laptop each
// keep their own), like the visualiser toggle always was. If they
// ever centralise into ui settings, this module is the one seam.

import { normalizeVolumeStep } from "../../core/playback-volume";
import {
  isVizColorMode,
  isVizPalette,
  type VizColorMode,
  type VizPaletteId,
} from "./viz-palettes";

export const PLAYBACK_VOLUME_STEP_STORAGE_KEY =
  "evo-ui-shell.playback.volumeStep";
export const VISUALIZER_PRESET_STORAGE_KEY = "evo-ui-shell.visualizer.preset";
export const VISUALIZER_BIN_COUNT_STORAGE_KEY =
  "evo-ui-shell.visualizer.binCount";
export const VISUALIZER_CHANNEL_MODE_STORAGE_KEY =
  "evo-ui-shell.visualizer.channelMode";
export const VISUALIZER_SENSITIVITY_DB_STORAGE_KEY =
  "evo-ui-shell.visualizer.sensitivityDb";
export const VISUALIZER_PALETTE_STORAGE_KEY =
  "evo-ui-shell.visualizer.palette";
export const VISUALIZER_COLOR_MODE_STORAGE_KEY =
  "evo-ui-shell.visualizer.colorMode";
export const CLASSICAL_METADATA_MODE_STORAGE_KEY =
  "evo-ui-shell.classical.metadataMode";

// Presets: classic meters, organic lines, atmospheric FX, spatial
// layouts, plus an explicit off state. All paint the same 1:1 wire
// bins — style only changes canvas treatment.
export const VISUALIZER_PRESETS = [
  "bars",
  "led",
  "spectrum",
  "glow",
  "mirror",
  "wave",
  "ribbon",
  "echo",
  "trail",
  "fluid",
  "aurora",
  "prism",
  "pulse",
  "dots",
  "radial",
  "waterfall",
  "off",
] as const;
export type VisualizerPresetId = (typeof VISUALIZER_PRESETS)[number];
export function isVisualizerPreset(value: string): value is VisualizerPresetId {
  return (VISUALIZER_PRESETS as readonly string[]).includes(value);
}

// `bin_count` and `channel_mode` are operator-configurable. The
// renderer downsamples the canonical 256-stereo wire shape to the
// operator's displayed shape.
export const VISUALIZER_BIN_COUNTS = [32, 64, 128, 256] as const;
export type VisualizerBinCountId = (typeof VISUALIZER_BIN_COUNTS)[number];
export function isVisualizerBinCount(value: unknown): value is VisualizerBinCountId {
  return (
    typeof value === "number" &&
    (VISUALIZER_BIN_COUNTS as readonly number[]).includes(value)
  );
}

export const VISUALIZER_CHANNEL_MODES = ["mono", "stereo"] as const;
export type VisualizerChannelModeId = (typeof VISUALIZER_CHANNEL_MODES)[number];
export function isVisualizerChannelMode(value: string): value is VisualizerChannelModeId {
  return value === "mono" || value === "stereo";
}

// Analyser frequency-scale dimension. Carries the operator's choice on the
// wire (ui.visualizer.frequency_scale); the framework producer owns the
// banking math. Default "log" - matches the
// framework parse boundary and the music-analyser convention. The renderer
// must NOT remap bins for scale: the wire carries payload-truth bin edges
// drawn 1:1.
export const VISUALIZER_FREQUENCY_SCALES = ["log", "mel", "linear"] as const;
export type VisualizerFrequencyScaleId = (typeof VISUALIZER_FREQUENCY_SCALES)[number];
export function isVisualizerFrequencyScale(value: string): value is VisualizerFrequencyScaleId {
  return value === "log" || value === "mel" || value === "linear";
}

// Wire enum max for visualiser bins. Not an honesty clamp — the device
// analyser (FFT_WINDOW=16384 + anti-clone) accepts every documented count
// under every frequency scale.
export const VISUALIZER_MAX_BINS = 256;

// Sensitivity knob bounds (in dB). +/-20 dB span covers the
// practical range: -20 dB pulls hot content down by 4x amplitude,
// +20 dB lifts quiet content up by 10x amplitude. Default 0 dB.
export const VISUALIZER_SENSITIVITY_DB_DEFAULT = 0;
export const VISUALIZER_SENSITIVITY_DB_MIN = -20;
export const VISUALIZER_SENSITIVITY_DB_MAX = 20;
export function clampSensitivityDb(v: number): number {
  if (!Number.isFinite(v)) return VISUALIZER_SENSITIVITY_DB_DEFAULT;
  if (v < VISUALIZER_SENSITIVITY_DB_MIN) return VISUALIZER_SENSITIVITY_DB_MIN;
  if (v > VISUALIZER_SENSITIVITY_DB_MAX) return VISUALIZER_SENSITIVITY_DB_MAX;
  return Math.round(v);
}

// Decay = how fast a bar falls back (gravity). 1 = lazy (slow, floaty
// settle), 10 = aggressive (snappy, percussive). 5 is the baseline.
export const VISUALIZER_DECAY_STORAGE_KEY =
  "evo-ui-shell.visualizer.decay";
export const VISUALIZER_DECAY_DEFAULT = 5;
export const VISUALIZER_DECAY_MIN = 1;
export const VISUALIZER_DECAY_MAX = 10;
export function clampDecay(v: number): number {
  if (!Number.isFinite(v)) return VISUALIZER_DECAY_DEFAULT;
  if (v < VISUALIZER_DECAY_MIN) return VISUALIZER_DECAY_MIN;
  if (v > VISUALIZER_DECAY_MAX) return VISUALIZER_DECAY_MAX;
  return Math.round(v);
}

/* ---------------- tolerant readers (App defaults) ---------------- */

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface VisualizerPrefs {
  // System master switch. The device (ui.visualizer.enabled) is the
  // truth; this per-browser read only backs the designer's Show preview
  // and defaults on.
  readonly enabled: boolean;
  // `preset` is the rendering style; "off" also disables.
  readonly preset: VisualizerPresetId;
  readonly binCount: VisualizerBinCountId;
  readonly channelMode: VisualizerChannelModeId;
  readonly sensitivityDb: number;
  readonly decay: number;
  readonly palette: VizPaletteId;
  readonly colorMode: VizColorMode;
}

/** The same resolution the App performs at boot. */
export function readVisualizerPrefs(): VisualizerPrefs {
  const preset = readRaw(VISUALIZER_PRESET_STORAGE_KEY);
  const bins = Number(readRaw(VISUALIZER_BIN_COUNT_STORAGE_KEY));
  const chan = readRaw(VISUALIZER_CHANNEL_MODE_STORAGE_KEY);
  const sens = Number(readRaw(VISUALIZER_SENSITIVITY_DB_STORAGE_KEY));
  const dec = Number(readRaw(VISUALIZER_DECAY_STORAGE_KEY));
  const pal = readRaw(VISUALIZER_PALETTE_STORAGE_KEY);
  const cmode = readRaw(VISUALIZER_COLOR_MODE_STORAGE_KEY);
  return {
    enabled: true,
    preset: preset !== null && isVisualizerPreset(preset) ? preset : "bars",
    binCount: isVisualizerBinCount(bins) ? bins : 256,
    channelMode: chan !== null && isVisualizerChannelMode(chan) ? chan : "mono",
    sensitivityDb: clampSensitivityDb(sens),
    decay: clampDecay(dec),
    palette: isVizPalette(pal) ? pal : "theme",
    colorMode: isVizColorMode(cmode) ? cmode : "gradient",
  };
}

export function readVolumeStep(): number {
  return normalizeVolumeStep(Number(readRaw(PLAYBACK_VOLUME_STEP_STORAGE_KEY)));
}

/** Mirrors App: strip shows unless the stored mode is "off". */
export function readShowClassicalStrip(): boolean {
  return readRaw(CLASSICAL_METADATA_MODE_STORAGE_KEY) !== "off";
}
