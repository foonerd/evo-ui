// Visualizer STUDIO - the dedicated tuning surface (agreed studio
// direction): the operator dials preset / bins / channel mode /
// sensitivity against SYNTHETIC spectrum frames, deterministic and
// always moving, instead of whatever happens to be playing. Pattern
// choices exercise different behaviours: sweep (frequency travel),
// pulse (beat energy + onsets), noise (dense motion), silence.
//
// The dials edit the DEVICE settings (ui.visualizer.*) through the
// settings PATCH - and the live settings stream fans the change out
// to every running session within ~500 ms, so the studio tunes the
// real glass while previewing on synthetic frames. Revision
// conflicts refetch and retry once; failures surface visibly.

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { GatewayClient, UiSettingsRevisionConflictError } from "../core/gateway-client";
import { usePresentation } from "../runtime/presentation-context";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { Visualizer } from "../features/playback/Visualizer";
import {
  emptySpectrumBuffers,
  type SpectrumFrameBuffers,
} from "../features/playback/spectrum-decoders";
import {
  startSyntheticSpectrum,
  SYNTHETIC_PATTERNS,
  type SyntheticPattern,
} from "../features/playback/synthetic-spectrum";
import {
  isVisualizerBinCount,
  isVisualizerChannelMode,
  isVisualizerFrequencyScale,
  isVisualizerPreset,
  clampSensitivityDb,
  clampDecay,
  VISUALIZER_DECAY_DEFAULT,
  VISUALIZER_BIN_COUNTS,
  VISUALIZER_FREQUENCY_SCALES,
  VISUALIZER_PRESETS,
  type VisualizerBinCountId,
  type VisualizerChannelModeId,
  type VisualizerFrequencyScaleId,
  type VisualizerPresetId,
} from "../features/playback/local-prefs";
import {
  isVizColorMode,
  isVizPalette,
  paletteSwatchCss,
  VIZ_COLOR_MODES,
  VIZ_PALETTES,
  type VizColorMode,
  type VizPaletteId,
} from "../features/playback/viz-palettes";
import { Lbl, Seg, Stepper } from "./builder-controls";

interface VizSettings {
  // `enabled` is the SYSTEM master switch (ui.visualizer.enabled). Off =
  // visualiser off on every screen regardless of the style. This is the
  // one control the operator asked to keep, and it maps to the device's
  // spectrum demand (framework parity).
  enabled: boolean;
  // `preset` is the rendering STYLE, remembered across off/on. "off" is
  // also a config value that disables.
  preset: VisualizerPresetId;
  binCount: VisualizerBinCountId;
  channelMode: VisualizerChannelModeId;
  // Analyser frequency scale (log/mel/linear). Producer-owned math; the UI
  // only carries the choice to the device demand.
  frequencyScale: VisualizerFrequencyScaleId;
  sensitivityDb: number;
  decay: number;
  palette: VizPaletteId;
  colorMode: VizColorMode;
}

const DEFAULTS: VizSettings = {
  // Master defaults OFF (opt-in) - matches the runtime demand default; the
  // toggle writes it on first use. frequencyScale defaults "log" - the
  // music-analyser convention and the framework parse default.
  enabled: false, preset: "bars", binCount: 256, channelMode: "mono",
  frequencyScale: "log", sensitivityDb: 0, decay: VISUALIZER_DECAY_DEFAULT,
  palette: "theme", colorMode: "gradient",
};

export function DesignerVisualizerStudio(): JSX.Element {
  useLocale();
  const { viewportOverride } = usePresentation();
  const clientRef = useRef<GatewayClient | null>(null);
  if (clientRef.current === null) clientRef.current = new GatewayClient();
  const client = clientRef.current;

  const [viz, setViz] = useState<VizSettings>(DEFAULTS);
  const [pattern, setPattern] = useState<SyntheticPattern>("sweep");
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef<number | undefined>(undefined);

  // Seed from the DEVICE settings - the studio edits the real thing.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const payload = await client.getUiSettings();
        if (!alive) return;
        revRef.current = payload.revision;
        const s = payload.settings;
        const seededScale: VisualizerFrequencyScaleId =
          typeof s["ui.visualizer.frequency_scale"] === "string" && isVisualizerFrequencyScale(s["ui.visualizer.frequency_scale"] as string)
            ? (s["ui.visualizer.frequency_scale"] as VisualizerFrequencyScaleId) : DEFAULTS.frequencyScale;
        const seededBins: VisualizerBinCountId =
          isVisualizerBinCount(s["ui.visualizer.bin_count"])
            ? (s["ui.visualizer.bin_count"] as VisualizerBinCountId) : DEFAULTS.binCount;
        setViz({
          enabled: typeof s["ui.visualizer.enabled"] === "boolean"
            ? (s["ui.visualizer.enabled"] as boolean) : DEFAULTS.enabled,
          preset: typeof s["ui.visualizer.preset"] === "string" && isVisualizerPreset(s["ui.visualizer.preset"] as string)
            ? (s["ui.visualizer.preset"] as VisualizerPresetId) : DEFAULTS.preset,
          binCount: seededBins,
          channelMode: typeof s["ui.visualizer.channel_mode"] === "string" && isVisualizerChannelMode(s["ui.visualizer.channel_mode"] as string)
            ? (s["ui.visualizer.channel_mode"] as VisualizerChannelModeId) : DEFAULTS.channelMode,
          frequencyScale: seededScale,
          sensitivityDb: typeof s["ui.visualizer.sensitivity_db"] === "number"
            ? clampSensitivityDb(s["ui.visualizer.sensitivity_db"] as number) : DEFAULTS.sensitivityDb,
          decay: typeof s["ui.visualizer.decay"] === "number"
            ? clampDecay(s["ui.visualizer.decay"] as number) : DEFAULTS.decay,
          palette: isVizPalette(s["ui.visualizer.palette"])
            ? (s["ui.visualizer.palette"] as VizPaletteId) : DEFAULTS.palette,
          colorMode: isVizColorMode(s["ui.visualizer.color_mode"])
            ? (s["ui.visualizer.color_mode"] as VizColorMode) : DEFAULTS.colorMode,
        });
      } catch {
        if (alive) setError(t("viz.loadFailed"));
      }
    })();
    return () => { alive = false; };
  }, [client]);

  // The synthetic frame source - one stable buffer, driven at 30 fps.
  const frameRef = useRef<SpectrumFrameBuffers>(emptySpectrumBuffers());
  const patternRef = useRef(pattern);
  patternRef.current = pattern;
  useEffect(() => startSyntheticSpectrum(frameRef.current, () => patternRef.current), []);

  const patch = (changes: Record<string, unknown>, next: Partial<VizSettings>) => {
    setViz((v) => ({ ...v, ...next }));
    setError(null);
    void (async () => {
      try {
        const payload = await client.patchUiSettings(changes, revRef.current);
        revRef.current = payload.revision;
      } catch (e) {
        if (e instanceof UiSettingsRevisionConflictError) {
          try {
            const latest = await client.getUiSettings();
            const retry = await client.patchUiSettings(changes, latest.revision);
            revRef.current = retry.revision;
            return;
          } catch { /* fall through to the visible error */ }
        }
        setError(t("viz.saveFailed"));
      }
    })();
  };

  const w = viewportOverride?.widthPx ?? 1280;
  const h = viewportOverride?.heightPx ?? 720;
  const vizHeight = Math.max(96, Math.round(h * 0.42));

  return (
    <section className="designer-canvas" aria-label="Visualizer studio">
      <header className="designer-canvas-head">
        <span className="designer-canvas-label">{t("viz.title")}</span>
        {error !== null ? <span class="stb-refusal">{error}</span> : null}
      </header>

      <div className="viz-studio">
        <div className="viz-studio-controls">
          <Lbl text={t("viz.system")} help={t("viz.systemHelp")} />
          <Seg options={["on", "off"] as const} value={viz.enabled ? "on" : "off"}
            label={(v) => t(`viz.sys.${v}` as never)}
            onChange={(v) => patch({ "ui.visualizer.enabled": v === "on" }, { enabled: v === "on" })} />
          <Lbl text={t("viz.preset")} help={t("viz.presetHelp")} />
          <Seg options={VISUALIZER_PRESETS} value={viz.preset}
            label={(v) => t(`viz.style.${v}` as never)}
            onChange={(preset) => patch({ "ui.visualizer.preset": preset }, { preset })} />
          <Lbl text={t("viz.bins")} help={t("viz.binsHelp")} />
          <Seg options={VISUALIZER_BIN_COUNTS} value={viz.binCount}
            onChange={(binCount) => patch({ "ui.visualizer.bin_count": binCount }, { binCount })} />
          <Lbl text={t("viz.channels")} />
          <Seg options={["mono", "stereo"] as const} value={viz.channelMode}
            label={(v) => t(`viz.channel.${v}` as never)}
            onChange={(channelMode) => patch({ "ui.visualizer.channel_mode": channelMode }, { channelMode })} />
          <Lbl text={t("viz.frequencyScale")} help={t("viz.frequencyScaleHelp")} />
          <Seg options={VISUALIZER_FREQUENCY_SCALES} value={viz.frequencyScale}
            label={(v) => t(`viz.freqScale.${v}` as never)}
            onChange={(frequencyScale) =>
              patch({ "ui.visualizer.frequency_scale": frequencyScale }, { frequencyScale })} />
          <Lbl text={t("viz.palette")} help={t("viz.paletteHelp")} />
          <div class="stb-seg viz-palette-seg" role="radiogroup" aria-label={t("viz.palette")}>
            {VIZ_PALETTES.map((pal) => (
              <button key={pal} type="button"
                class={viz.palette === pal ? "on" : ""}
                role="radio"
                aria-checked={viz.palette === pal}
                onClick={() => patch({ "ui.visualizer.palette": pal }, { palette: pal })}>
                <span
                  class="viz-palette-swatch"
                  style={{ background: paletteSwatchCss(pal) }}
                  aria-hidden="true"
                />
                {t(`viz.pal.${pal}` as never)}
              </button>
            ))}
          </div>
          <Lbl text={t("viz.colorMode")} help={t("viz.colorModeHelp")} />
          <Seg options={VIZ_COLOR_MODES} value={viz.colorMode}
            label={(v) => t(`viz.cm.${v}` as never)}
            onChange={(colorMode) =>
              patch({ "ui.visualizer.color_mode": colorMode }, { colorMode })} />
          <Lbl text={t("viz.sensitivity")} help={t("viz.sensitivityHelp")} />
          <Stepper value={viz.sensitivityDb} min={-20} max={20} step={1}
            fmt={(v) => `${v > 0 ? "+" : ""}${v} dB`}
            onChange={(sensitivityDb) =>
              patch({ "ui.visualizer.sensitivity_db": sensitivityDb }, { sensitivityDb })} />
          <Lbl text={t("viz.decay")} help={t("viz.decayHelp")} />
          <Stepper value={viz.decay} min={1} max={10} step={1}
            fmt={(v) => (v <= 3 ? `${v} · lazy` : v >= 8 ? `${v} · aggressive` : `${v}`)}
            onChange={(decay) =>
              patch({ "ui.visualizer.decay": decay }, { decay })} />
          <Lbl text={t("viz.pattern")} help={t("viz.patternHelp")} />
          <Seg options={SYNTHETIC_PATTERNS} value={pattern}
            label={(v) => t(`viz.pat.${v}` as never)}
            onChange={setPattern} />
          <p class="stb-help">{t("viz.liveNote")}</p>
        </div>

        <div className="viz-studio-stage">
          <div className="designer-device viz-studio-device">
            <div className="designer-device-bezel">
              <div className="designer-build-panel viz-studio-panel"
                style={{ height: `${Math.min(h, vizHeight + 48)}px` }}>
                <Visualizer
                  enabled={viz.enabled}
                  preset={viz.preset}
                  binCount={viz.binCount}
                  channelMode={viz.channelMode}
                  heightPx={vizHeight}
                  frameSource={frameRef}
                  sensitivityDb={viz.sensitivityDb}
                  decay={viz.decay}
                  palette={viz.palette}
                  colorMode={viz.colorMode}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
