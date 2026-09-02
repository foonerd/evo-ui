// Lyrics renderer, shared by the combined Track Info surface, the
// standalone lyrics widget, and the stage. LRCLIB is single-source, so
// this renders the plain text plus a mode-aware attribution (name + QR).
// Honest states: loading vs no-lyrics are distinct. When only synced
// (LRC) lyrics exist, timestamps are stripped to plain text rather than
// falsely reporting "no lyrics".

import { t } from "../../runtime/i18n";
import { AttributionLine } from "./AttributionLine";
import type { TrackDetail } from "./track-detail-decoders";

/** Strip LRC timestamp tags ([mm:ss.xx]) so synced-only lyrics render as
 *  readable plain text. */
export function lrcToPlain(lrc: string): string {
  return lrc
    .replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function LyricsBlock({
  detail,
  loading
}: {
  detail: TrackDetail | null;
  loading?: boolean;
}) {
  if (detail === null) {
    return (
      <p className="contextual-empty">
        {loading === true ? t("contextual.loading") : t("contextual.noLyrics")}
      </p>
    );
  }
  const l = detail.lyrics;
  const text =
    l.plain !== null && l.plain.length > 0
      ? l.plain
      : l.synced !== null && l.synced.length > 0
        ? lrcToPlain(l.synced)
        : null;
  if (l.status !== "ok" || text === null || text.length === 0) {
    return <p className="contextual-empty">{t("contextual.noLyrics")}</p>;
  }
  return (
    <div className="contextual-pane">
      <pre className="contextual-lyrics">{text}</pre>
      <AttributionLine
        attribution={
          l.sourceUrl !== null
            ? { sourceName: "LRCLIB", sourceUrl: l.sourceUrl, license: "" }
            : null
        }
      />
    </div>
  );
}
