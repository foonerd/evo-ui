// StreamFormatReadout - the live "what is reaching the DAC" readout
// in the DAC stage. Driven by the playback warden's stream_format
// subject (consumed via useHardwareAudio). The format is null until
// the first stream_format happening is observed this session -
// nothing has played yet, or playback started before this session
// connected and has not crossed a track boundary since.

import { t } from "../../runtime/i18n";
import {
  formatAudioFormat,
  audioFormatsEqual,
  type StreamFormat
} from "./stream-format-decoders";

interface StreamFormatReadoutProps {
  /** Latest stream format, or null until one is observed. */
  format: StreamFormat | null;
}

export function StreamFormatReadout({ format }: StreamFormatReadoutProps) {
  // Two empty-states map to the same operator-facing message:
  // - format === null: decoder rejected a malformed envelope.
  // - format.effective === null: valid envelope but no route-change
  //   publish yet (the seeded-on-announce state; happens between
  //   plugin load and first playback route resolution).
  if (format === null || format.effective === null) {
    return (
      <p className="audio-stage-note">
        The live playback format appears here once a track starts or
        changes.
      </p>
    );
  }
  const { effective, source } = format;
  // Show the source line only when the framework's conversion
  // (resampling / DoP wrapping) actually changed the format. A null
  // source means the decoder format was not separately knowable -
  // treat it as equal to effective and show only the one line.
  const showSource =
    source !== null && !audioFormatsEqual(source, effective);
  return (
    <div className="audio-streamfmt">
      <div className="audio-streamfmt-row">
        <span className="audio-streamfmt-label">Reaching the DAC</span>
        <span className="audio-streamfmt-value">
          {formatAudioFormat(effective)}
        </span>
      </div>
      {showSource ? (
        <div className="audio-streamfmt-row">
          <span className="audio-streamfmt-label">{t("audioopt.sourceFile")}</span>
          <span className="audio-streamfmt-value audio-streamfmt-source">
            {formatAudioFormat(source)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
