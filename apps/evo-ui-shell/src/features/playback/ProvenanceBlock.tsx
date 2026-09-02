// Provenance chips (MusicBrainz recording type, first-release year,
// identity confidence). Shared by the combined Track Info surface and the
// standalone provenance widget. Renders nothing when there is no
// provenance - callers that want an empty line check hasProvenance first.

import { t } from "../../runtime/i18n";
import type { MessageKey } from "../../locales/en";
import type {
  RecordingType,
  TrackReconciliation
} from "./track-detail-decoders";

const RECORDING_TYPE_KEY: Record<RecordingType, MessageKey> = {
  Studio: "trackinfo.type.studio",
  Live: "trackinfo.type.live",
  Compilation: "trackinfo.type.compilation",
  Soundtrack: "trackinfo.type.soundtrack",
  Other: "trackinfo.type.other"
};

export function hasProvenance(rec: TrackReconciliation | null): boolean {
  return (
    rec !== null &&
    (rec.recordingType !== null ||
      rec.firstReleaseYear !== null ||
      rec.confidencePercent !== null)
  );
}

export function ProvenanceBlock({
  reconciliation
}: {
  reconciliation: TrackReconciliation | null;
}) {
  const rec = reconciliation;
  if (!hasProvenance(rec) || rec === null) return null;
  return (
    <div className="trackinfo-provenance">
      {rec.recordingType !== null ? (
        <span className="trackinfo-chip">
          {t(RECORDING_TYPE_KEY[rec.recordingType])}
        </span>
      ) : null}
      {rec.firstReleaseYear !== null ? (
        <span className="trackinfo-chip">{rec.firstReleaseYear}</span>
      ) : null}
      {rec.confidencePercent !== null ? (
        <span className="trackinfo-meta">
          {t("trackinfo.confidence", { n: rec.confidencePercent })}
        </span>
      ) : null}
    </div>
  );
}
