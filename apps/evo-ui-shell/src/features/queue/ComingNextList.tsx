// ComingNextList - compact "what plays next" rail panel for the
// home page right rail. Replaces the full QueueSurface mount that
// used to live there. Shows the next 5 queued items after the
// currently playing position, each with a thumbnail + two-line text
// + a single Play-now action.
//
// Play-now uses queue.play_from_position - the row is addressed
// directly by its zero-based queue position; the plugin validates
// the position before dispatch so refusals leave playback alone.

import { useCallback, useMemo, useState } from "preact/hooks";
import { ChevronRight, Play } from "lucide-preact";
import { useAudioQueue } from "./useAudioQueue";
import type { QueueItem } from "./audio-queue-decoders";
import { TrackTile } from "../../components/TrackTile";
import type { DomainIconResolver } from "../../core/domain-icons";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

interface ComingNextListProps {
  resolveDomainIcon: DomainIconResolver;
  /** Click handler for the "View full queue" affordance below the
   *  list. Navigates the operator to the Queue surface. */
  onOpenFullQueue: () => void;
  /** How many upcoming items to show. Default 5 per the home-rail
   *  brief. Cap at 10 to keep the rail from growing unbounded if a
   *  future caller asks for more. */
  visibleCount?: number;
}

const DEFAULT_VISIBLE = 5;
const MAX_VISIBLE = 10;

export function ComingNextList({
  resolveDomainIcon,
  onOpenFullQueue,
  visibleCount
}: ComingNextListProps) {
  useLocale();
  const limit = Math.min(
    Math.max(1, visibleCount ?? DEFAULT_VISIBLE),
    MAX_VISIBLE
  );
  const audioQueue = useAudioQueue();
  const QueueIcon = resolveDomainIcon("audio.queue");

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const queue = audioQueue.queue;
  const allItems = queue?.items ?? [];
  const currentPosition = queue?.currentPosition ?? null;
  const totalLength = queue?.length ?? allItems.length;

  // Slice the next N items strictly AFTER currentPosition. When no
  // track is playing (currentPosition === null) we show the head of
  // the queue, which is what the operator expects "Coming Next" to
  // mean when transport is stopped.
  const upcoming: QueueItem[] = useMemo(() => {
    if (allItems.length === 0) return [];
    const startIndex =
      currentPosition === null
        ? 0
        : allItems.findIndex((it) => it.position === currentPosition) + 1;
    if (startIndex < 0) return allItems.slice(0, limit);
    return allItems.slice(startIndex, startIndex + limit);
  }, [allItems, currentPosition, limit]);

  const remainingAfter = Math.max(
    0,
    totalLength -
      ((currentPosition !== null ? currentPosition + 1 : 0) + upcoming.length)
  );

  const onPlayItem = useCallback(
    async (item: QueueItem): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFeedback("");
      try {
        const r = await audioQueue.playFromPosition(item.position);
        if (!r.ok) {
          setFeedback(r.message);
          return;
        }
      } finally {
        setBusy(false);
      }
    },
    [audioQueue, busy]
  );

  // ---- render -----------------------------------------------------

  return (
    <section
      className="card right-rail-coming-next"
      aria-label={t("queue.comingNextAria")}
    >
      <div className="right-rail-head">
        <p className="nav-group-title">{t("queue.comingNext")}</p>
        <button
          type="button"
          className="right-rail-coming-next-open"
          onClick={onOpenFullQueue}
          title={t("queue.openFullTitle")}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {queue === null ? (
        <p className="right-rail-coming-next-empty">{t("queue.loadingQueue")}</p>
      ) : upcoming.length === 0 ? (
        <p className="right-rail-coming-next-empty">
          {totalLength === 0 ? t("queue.emptyAddHint") : t("queue.endOfQueue")}
        </p>
      ) : (
        <ol className="right-rail-coming-next-list">
          {upcoming.map((item) => {
            const title = item.title ?? item.uri;
            const unavailable = item.available === false;
            return (
              <li key={item.id}>
                <TrackTile
                  shape="row"
                  dense
                  title={title}
                  artist={item.artist}
                  album={item.album}
                  artworkUrl={item.artworkUrl}
                  placeholderIcon={<QueueIcon size={18} />}
                  unavailable={unavailable}
                  actions={
                    <button
                      type="button"
                      className="coming-next-play"
                      onClick={() => void onPlayItem(item)}
                      disabled={busy || unavailable}
                      aria-label={
                        unavailable
                          ? t("queue.unavailableAria", { title })
                          : t("queue.playNowAria", { title })
                      }
                      title={
                        unavailable
                          ? t("queue.unavailableTitle")
                          : t("queue.playNow")
                      }
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                  }
                />
              </li>
            );
          })}
        </ol>
      )}

      {feedback ? (
        <p className="right-rail-coming-next-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      <button
        type="button"
        className="right-rail-coming-next-footer"
        onClick={onOpenFullQueue}
      >
        <span>{t("queue.viewFull")}</span>
        <span className="right-rail-coming-next-footer-meta tabular">
          {totalLength === 0
            ? "0"
            : remainingAfter > 0
              ? t("queue.totalMore", {
                  total: totalLength,
                  more: remainingAfter
                })
              : t("queue.total", { total: totalLength })}
        </span>
      </button>
    </section>
  );
}
