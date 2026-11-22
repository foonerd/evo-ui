// OutputControlRow - one listed output with its five controls: Enable,
// Disable, Play, Pause, and its own volume. Every control names this
// row's hw:N,M id and no other. The row paints only what the plugin has
// answered for this output; before any answer it says so. A refusal is
// shown on this row and nowhere else. This is not the output picker and
// the slider is not the global volume.

import { Pause, Play, Power, PowerOff } from "lucide-preact";
import type { AlsaOutput } from "./audio-options-decoders";
import type { OutputState } from "./output-verbs";
import { t } from "../../runtime/i18n";

interface OutputControlRowProps {
  output: AlsaOutput;
  /** This output's last answered state, or null before any answer. */
  state: OutputState | null;
  /** This output's last refusal, or null. */
  error: string | null;
  busy: boolean;
  onEnable: (outputId: string) => void;
  onDisable: (outputId: string) => void;
  onPlay: (outputId: string) => void;
  onPause: (outputId: string) => void;
  onVolume: (outputId: string, volume: number) => void;
}

export function OutputControlRow(props: OutputControlRowProps) {
  const { output, state, busy } = props;
  const sliderId = `audio-output-volume-${output.alsaId.replace(/[^a-z0-9]/gi, "-")}`;
  const status =
    state === null
      ? t("audioopt.outputUnknown")
      : [
          state.enabled ? t("audioopt.outputEnabled") : t("audioopt.outputDisabled"),
          state.playing ? t("audioopt.outputPlaying") : t("audioopt.outputIdle"),
          state.volume !== null ? `${state.volume}%` : null
        ]
          .filter((s): s is string => s !== null)
          .join(" - ");
  return (
    <li className="audio-output-row">
      <div className="audio-output-row-head">
        <span className="audio-output-row-label">{output.label}</span>
        <span className="audio-output-row-id">{output.alsaId}</span>
        <span className="audio-output-row-status">{status}</span>
      </div>
      <div className="audio-output-row-controls">
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={busy}
          onClick={() => props.onEnable(output.alsaId)}
          title={t("audioopt.outputEnable")}
        >
          <Power size={14} /> {t("audioopt.outputEnable")}
        </button>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={busy}
          onClick={() => props.onDisable(output.alsaId)}
          title={t("audioopt.outputDisable")}
        >
          <PowerOff size={14} /> {t("audioopt.outputDisable")}
        </button>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={busy}
          onClick={() => props.onPlay(output.alsaId)}
          title={t("audioopt.outputPlay")}
        >
          <Play size={14} /> {t("audioopt.outputPlay")}
        </button>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={busy}
          onClick={() => props.onPause(output.alsaId)}
          title={t("audioopt.outputPause")}
        >
          <Pause size={14} /> {t("audioopt.outputPause")}
        </button>
        <label className="audio-output-row-volume" htmlFor={sliderId}>
          <span>{t("audioopt.outputVolume")}</span>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={state?.volume ?? 0}
            disabled={busy}
            onChange={(ev) =>
              props.onVolume(output.alsaId, Number((ev.currentTarget as HTMLInputElement).value))
            }
          />
          <span className="audio-output-row-volume-value">
            {state?.volume !== null && state?.volume !== undefined ? `${state.volume}` : "--"}
          </span>
        </label>
      </div>
      {props.error !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{props.error}</span>
        </div>
      ) : null}
    </li>
  );
}
