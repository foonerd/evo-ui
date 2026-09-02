// Fullscreen "zoom" of the live visualiser. Tapping the now-playing
// visualiser band opens this; it is a pure enlargement - the analyser
// filling the viewport. A kebab (top-left) opens an in-place picker to
// switch STYLE and PALETTE live; every other tap zooms back out.
//
// It renders through the app's single overlay primitive
// (AttentionOverlay: body portal, z-band, Esc + focus custody) and
// reuses the SAME frameSource ref the inline visualiser reads, so there
// is no second wire subscription and no extra device load.
//
// Style/palette changes go through the same authoritative settings path
// the studio uses (onSelectPreset / onSelectPalette -> App patchUiSettings),
// so a pick made here persists and fans out to the inline band and other
// seats - not a throwaway session change.

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { Visualizer } from "./Visualizer";
import type {
  VisualizerPreset,
  VisualizerBinCount,
  VisualizerChannelMode
} from "./Visualizer";
import type { SpectrumFrameBuffers } from "./spectrum-decoders";
import {
  VIZ_PALETTES,
  paletteSwatchCss,
  type VizPaletteId,
  type VizColorMode
} from "./viz-palettes";
import { VISUALIZER_PRESETS } from "./local-prefs";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export interface ImmersiveVisualizerProps {
  onClose: () => void;
  preset: VisualizerPreset;
  binCount: VisualizerBinCount;
  channelMode: VisualizerChannelMode;
  sensitivityDb: number;
  decay: number;
  palette: VizPaletteId;
  colorMode: VizColorMode;
  frameSource?: { readonly current: SpectrumFrameBuffers };
  onSelectPreset: (preset: VisualizerPreset) => void;
  onSelectPalette: (palette: VizPaletteId) => void;
}

// Selectable styles, family-ordered (meters, lines, atmosphere,
// spatial). "off" is a master-switch state, not a style you would pick
// while staring at the fullscreen analyser, so it is excluded here.
const STYLE_ORDER: readonly VisualizerPreset[] = VISUALIZER_PRESETS.filter(
  (p) => p !== "off"
) as VisualizerPreset[];

export function ImmersiveVisualizer({
  onClose,
  preset,
  binCount,
  channelMode,
  sensitivityDb,
  decay,
  palette,
  colorMode,
  frameSource,
  onSelectPreset,
  onSelectPalette
}: ImmersiveVisualizerProps): JSX.Element {
  useLocale(); // re-render on locale change so labels stay current

  // The core Visualizer sizes its canvas from an explicit height in px;
  // track the viewport so the analyser fills the screen and follows a
  // resize (kiosk is fixed, but a remote browser can change).
  const [vh, setVh] = useState<number>(
    typeof window === "undefined" ? 720 : window.innerHeight
  );
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);

  const livePreset: VisualizerPreset = preset === "off" ? "bars" : preset;

  const stop = (e: Event) => e.stopPropagation();

  // Tapping the analyser zooms out - but if the picker is open, the
  // first tap just closes the picker (one level of "back").
  const onStageClick = () => {
    if (menuOpen) setMenuOpen(false);
    else onClose();
  };

  return (
    <AttentionOverlay
      band="dialog"
      className="evo-immersive-viz"
      role="dialog"
      ariaLabel="Fullscreen visualiser"
      onDismiss={onClose}
    >
      <div className="evo-immersive-viz-stage" onClick={onStageClick}>
        <Visualizer
          enabled
          preset={livePreset}
          binCount={binCount}
          channelMode={channelMode}
          heightPx={vh}
          frameSource={frameSource}
          sensitivityDb={sensitivityDb}
          decay={decay}
          palette={palette}
          colorMode={colorMode}
        />
      </div>

      <button
        type="button"
        className={"evo-immersive-kebab" + (menuOpen ? " on" : "")}
        aria-label="Visualiser options"
        aria-expanded={menuOpen}
        onClick={(e) => {
          stop(e);
          setMenuOpen((v) => !v);
        }}
      >
        &#8942;
      </button>

      {menuOpen ? (
        <div
          className="evo-immersive-menu"
          role="menu"
          onClick={stop}
        >
          <div className="evo-immersive-menu-label">{t("viz.preset")}</div>
          <div className="evo-immersive-chips">
            {STYLE_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={id === preset}
                className={id === preset ? "on" : ""}
                onClick={() => onSelectPreset(id)}
              >
                {t(`viz.style.${id}` as never)}
              </button>
            ))}
          </div>

          <div className="evo-immersive-menu-label">{t("viz.palette")}</div>
          <div className="evo-immersive-swatches">
            {VIZ_PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={p === palette}
                className={p === palette ? "on" : ""}
                onClick={() => onSelectPalette(p)}
              >
                <span
                  className="evo-immersive-swatch"
                  style={{ background: paletteSwatchCss(p) }}
                  aria-hidden="true"
                />
                {t(`viz.pal.${p}` as never)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="evo-immersive-close"
        aria-label="Close fullscreen visualiser"
        onClick={(e) => {
          stop(e);
          onClose();
        }}
      >
        &times;
      </button>
    </AttentionOverlay>
  );
}
