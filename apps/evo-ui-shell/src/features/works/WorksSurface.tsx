// WorksSurface - operator-facing browse-by-Work shelf.
//
// Shape 2 from the QPLF-1 mockup round: a two-column surface
// where the left pane lists Works (composer / title / number of
// recordings) and the right pane lists the selected work's
// Recordings in original_date order (conductor / year / ensemble
// / label / album_uri navigation).
//
// Two empty-state distinctions:
//   - "no classical content" - the operator's library simply does
//     not have composer-tagged tracks. The shelf is informational.
//   - "MP3-on-MPD-0.x limitation" (framework spec finding #1):
//     composer tags are present but no Work tags are visible. The
//     shelf renders an explanatory hint so the operator does not
//     mistake the empty list for a framework defect.
//
// Per framework spec finding #2: recording display names use
// (conductor, year, label) via formatRecordingTitle - never the
// album_uri basename. The "Open in Library" affordance still
// navigates to album_uri (the filesystem parent of contributing
// tracks).

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Library, FolderOpen, ListMusic } from "lucide-preact";
import type { UseWorksState } from "./useWorks";
import { useAudioQueue } from "../queue/useAudioQueue";
import { t, tn } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  formatRecordingTitle,
  looksLikeMpdMp3Limitation,
  pickYear,
  type Recording,
  type WorkSummary
} from "./works-decoders.ts";

interface WorksSurfaceProps {
  /** Single mount of useWorks owned by App.tsx; the same state powers
   *  both the sidebar Auto-resolution and this surface so there is
   *  exactly one WS subscription, not one per surface visit. */
  worksState: UseWorksState;
  /** Optional: deep-link to a specific work_id on mount. */
  initialWorkId?: string;
  /** Navigate the operator into Library at this filesystem path.
   *  When undefined the "Open in Library" affordance is hidden. */
  onOpenAlbumUri?: (uri: string) => void;
}

export function WorksSurface({
  worksState,
  initialWorkId,
  onOpenAlbumUri
}: WorksSurfaceProps) {
  useLocale();
  const ws = worksState;
  const audioQueue = useAudioQueue();
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(
    initialWorkId ?? null
  );
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [recordingsBusy, setRecordingsBusy] = useState(false);
  const [recordingsError, setRecordingsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  // Auto-select the first work when nothing is selected and the list
  // is non-empty. Keeps the right pane productive on first render.
  useEffect(() => {
    if (selectedWorkId !== null) return;
    if (ws.works === null || ws.works.length === 0) return;
    setSelectedWorkId(ws.works[0].workId);
  }, [ws.works, selectedWorkId]);

  // Fetch recordings whenever the selected work changes.
  useEffect(() => {
    if (selectedWorkId === null) {
      setRecordings(null);
      setRecordingsError(null);
      return;
    }
    let cancelled = false;
    setRecordingsBusy(true);
    setRecordingsError(null);
    void (async (): Promise<void> => {
      const result = await ws.getWorkRecordings(selectedWorkId);
      if (cancelled) return;
      setRecordingsBusy(false);
      if (result.ok) {
        setRecordings(result.value.recordings);
      } else {
        setRecordings(null);
        setRecordingsError(result.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkId, ws.getWorkRecordings]);

  const runAction = useCallback(
    async (
      label: string,
      op: () => Promise<{ ok: boolean; message?: string }>
    ): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFeedback(t("collection.feedback.working", { label }));
      try {
        const r = await op();
        setFeedback(
          r.ok
            ? ""
            : (r.message ?? t("collection.feedback.incomplete", { label }))
        );
      } catch (err) {
        setFeedback(
          t("collection.feedback.failed", {
            label,
            detail: err instanceof Error ? err.message : String(err)
          })
        );
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const onPlayRecording = useCallback(
    (rec: Recording) => {
      if (rec.albumUri === null) return;
      void runAction(t("works.actionPlayRecording"), () =>
        audioQueue.enqueue([rec.albumUri ?? ""], 0)
      );
    },
    [audioQueue, runAction]
  );

  const onAddRecordingToQueue = useCallback(
    (rec: Recording) => {
      if (rec.albumUri === null) return;
      void runAction(t("collection.addToQueue"), () =>
        audioQueue.enqueue([rec.albumUri ?? ""])
      );
    },
    [audioQueue, runAction]
  );

  const onOpenAlbum = useCallback(
    (rec: Recording) => {
      if (rec.albumUri === null || onOpenAlbumUri === undefined) return;
      onOpenAlbumUri(rec.albumUri);
    },
    [onOpenAlbumUri]
  );

  // -- render --------------------------------------------------------

  const works = ws.works;
  const counters = ws.counters;
  const selectedWork = useMemo<WorkSummary | null>(() => {
    if (selectedWorkId === null || works === null) return null;
    return works.find((w) => w.workId === selectedWorkId) ?? null;
  }, [works, selectedWorkId]);

  const isLimitationCase =
    counters !== null && looksLikeMpdMp3Limitation(counters);

  return (
    <div className="works-surface">
      <div className="works-surface-head">
        <div>
          <h2 className="works-surface-title">
            <Library size={18} className="works-surface-icon" />
            {t("works.title")}
          </h2>
          <p className="works-surface-meta">
            {works === null
              ? ws.connection.kind === "error"
                ? t("works.unreachable", {
                    reason: ws.connection.reason ?? t("collection.noDetail")
                  })
                : t("collection.loadingWorks")
              : works.length === 0
                ? t("works.metaEmpty")
                : tn("works.count", works.length) +
                  (counters !== null
                    ? t("works.countMultiSuffix", {
                        n: counters.worksWithMultipleRecordings
                      })
                    : "")}
          </p>
        </div>
      </div>

      {feedback ? (
        <div className="works-feedback" role="status">
          {feedback}
        </div>
      ) : null}

      {works !== null && works.length === 0 ? (
        <div className="works-empty">
          <Library size={32} className="works-empty-icon" />
          {isLimitationCase ? (
            <>
              <h3>{t("works.flacTitle")}</h3>
              <p>
                {t("works.flacBody1", {
                  n: counters?.totalTracksWithComposer ?? 0
                })}
              </p>
              <p>{t("works.flacBody2")}</p>
            </>
          ) : (
            <>
              <h3>{t("works.emptyTitle")}</h3>
              <p>{t("works.emptyBody")}</p>
            </>
          )}
        </div>
      ) : (
        <div className="works-grid">
          <aside className="works-list">
            {works === null
              ? null
              : works.map((w) => (
                  <button
                    key={w.workId}
                    type="button"
                    className={
                      w.workId === selectedWorkId
                        ? "works-list-row works-list-row-active"
                        : "works-list-row"
                    }
                    onClick={() => setSelectedWorkId(w.workId)}
                  >
                    <span className="works-list-composer">{w.composer}</span>
                    <span className="works-list-title">{w.work}</span>
                    <span className="works-list-count">
                      {tn("works.recordingCount", w.recordingCount)}
                    </span>
                  </button>
                ))}
          </aside>

          <section className="works-detail">
            {selectedWork === null ? (
              <p className="works-detail-empty">{t("works.selectPrompt")}</p>
            ) : (
              <>
                <div className="works-detail-head">
                  <h3 className="works-detail-title">{selectedWork.work}</h3>
                  <p className="works-detail-composer">
                    {selectedWork.composer}
                  </p>
                </div>

                {recordingsError !== null ? (
                  <p className="works-detail-error">{recordingsError}</p>
                ) : recordingsBusy ? (
                  <p className="works-detail-empty">
                    {t("works.loadingRecordings")}
                  </p>
                ) : recordings === null || recordings.length === 0 ? (
                  <p className="works-detail-empty">{t("works.noRecordings")}</p>
                ) : (
                  <ol className="works-recording-list">
                    {recordings.map((r) => (
                      <li key={r.recordingId} className="works-recording">
                        <div className="works-recording-name">
                          {formatRecordingTitle(r)}
                        </div>
                        <div className="works-recording-meta">
                          {r.ensemble !== null ? (
                            <span>{r.ensemble}</span>
                          ) : null}
                          {r.ensemble !== null && r.label !== null ? (
                            <span className="works-recording-sep">-</span>
                          ) : null}
                          {pickYear(r.recordingDate) !== null &&
                          pickYear(r.recordingDate) !==
                            pickYear(r.originalDate) ? (
                            <>
                              <span className="works-recording-sep">-</span>
                              <span>
                                {t("works.recordedYear", {
                                  year: pickYear(r.recordingDate) ?? ""
                                })}
                              </span>
                            </>
                          ) : null}
                          <span className="works-recording-sep">-</span>
                          <span className="tabular">
                            {tn("works.trackCount", r.trackCount)}
                          </span>
                        </div>
                        <div className="works-recording-actions">
                          <button
                            type="button"
                            onClick={() => onPlayRecording(r)}
                            disabled={busy || r.albumUri === null}
                          >
                            <ListMusic size={14} />
                            <span>{t("works.play")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onAddRecordingToQueue(r)}
                            disabled={busy || r.albumUri === null}
                          >
                            {t("collection.addToQueue")}
                          </button>
                          {onOpenAlbumUri !== undefined && r.albumUri !== null ? (
                            <button
                              type="button"
                              onClick={() => onOpenAlbum(r)}
                              disabled={busy}
                              title={t("works.openInLibraryTitle")}
                            >
                              <FolderOpen size={14} />
                              <span>{t("works.openInLibrary")}</span>
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
