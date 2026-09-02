// PivotQueueReveal - the compass "down" reveal. Small-screen decision:
// the current queue only, with three minimal per-track actions, and a
// Queue | Playlists | Favourites switch where Playlists and Favourites
// replace the queue by loading to it (load-to-queue semantics;
// favourites is the reserved __favourites__ stored playlist).
//
//   Queue       - the live play queue. Tap a track -> Play now /
//                 Add to list / Favourite.
//   Playlists   - stored playlists. Tap one -> load it as the queue
//                 (replaces) and return to the Queue view.
//   Favourites  - favourite tracks. Tap one -> load favourites as the
//                 queue and return to Queue; or Add to list / Remove.
//
// No move/remove/play-next here - those are browser-surface scope.

import { useCallback, useMemo, useState } from "preact/hooks";
import { Heart, ListPlus, Music, Play, Trash2, X } from "lucide-preact";
import { useAudioQueue } from "./useAudioQueue";
import type { QueueItem } from "./audio-queue-decoders";
import { useFavourites } from "../favourites/useFavourites";
import type { FavouriteItem } from "../favourites/favourites-decoders";
import { usePlaylists } from "../playlist/usePlaylists";
import { RESERVED_FAVOURITES_PLAYLIST } from "../playlist/playlist-decoders";
import { PlaylistPickerDialog } from "../../components/dialogs";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

type QueueMode = "queue" | "playlists" | "favourites";

type VerbResult = { ok: true } | { ok: false; message: string };

interface SelectedRow {
  uri: string;
  title: string;
  /** Queue position when the row came from the queue; null otherwise. */
  position: number | null;
  source: "queue" | "favourites";
}

export function PivotQueueReveal() {
  useLocale();
  const audioQueue = useAudioQueue();
  const favourites = useFavourites();
  const playlists = usePlaylists();

  const [mode, setMode] = useState<QueueMode>("queue");
  const [sheet, setSheet] = useState<SelectedRow | null>(null);
  const [addToListUri, setAddToListUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const queue = audioQueue.queue;
  const queueItems: QueueItem[] = queue?.items ?? [];
  const currentPosition = queue?.currentPosition ?? null;
  const totalLength = queue?.length ?? queueItems.length;
  const truncated = queue?.truncated ?? false;

  const favouriteItems: FavouriteItem[] = favourites.state?.items ?? [];
  const favouriteUris = useMemo(() => {
    const set = new Set<string>();
    favouriteItems.forEach((f) => set.add(f.uri));
    return set;
  }, [favouriteItems]);

  const playlistEntries = playlists.index?.playlists ?? [];

  const run = useCallback(
    async (
      verb: () => Promise<VerbResult>,
      onOk?: () => void
    ): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFeedback("");
      try {
        const r = await verb();
        if (!r.ok) {
          setFeedback(r.message);
          return;
        }
        setSheet(null);
        onOk?.();
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  // Play a queue row now: queue.play_from_position addresses the
  // row directly by its zero-based position. Refusals leave
  // playback untouched (validated before dispatch).
  const playQueueRow = useCallback(
    (item: QueueItem) =>
      run(() => audioQueue.playFromPosition(item.position)),
    [audioQueue, run]
  );

  // Load a stored playlist (or the favourites playlist) as the queue.
  // This is the "replacement" - MPD load semantics (the verb that
  // discards the current queue and refills it from the named playlist).
  const loadAsQueue = useCallback(
    (name: string, label: string) =>
      run(
        () => audioQueue.loadPlaylist(name),
        () => {
          setMode("queue");
          setFeedback(t("queue.loadedIntoQueue", { name: label }));
        }
      ),
    [audioQueue, run]
  );

  const toggleFavourite = useCallback(
    (uri: string) =>
      run(() =>
        favouriteUris.has(uri)
          ? favourites.removeFavourite(uri).then((r) =>
              r.ok ? { ok: true } : { ok: false, message: r.message }
            )
          : favourites.addFavourite(uri).then((r) =>
              r.ok ? { ok: true } : { ok: false, message: r.message }
            )
      ),
    [favourites, favouriteUris, run]
  );

  const segment = (id: QueueMode, label: string) => (
    <button
      type="button"
      className={
        mode === id
          ? "pivot-queue-seg pivot-queue-seg-active"
          : "pivot-queue-seg"
      }
      aria-pressed={mode === id}
      onClick={() => {
        setSheet(null);
        setMode(id);
      }}
    >
      {label}
    </button>
  );

  const renderRow = (
    key: string,
    title: string,
    secondary: string | null,
    opts: {
      current?: boolean;
      unavailable?: boolean;
      onClick: () => void;
      ariaLabel: string;
    }
  ) => (
    <li
      key={key}
      className={[
        "pivot-queue-row",
        opts.current ? "pivot-queue-row-current" : "",
        opts.unavailable ? "pivot-queue-row-unavailable" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="pivot-queue-row-main"
        onClick={opts.onClick}
        aria-label={opts.ariaLabel}
      >
        <span className="pivot-queue-thumb" aria-hidden>
          {opts.current ? (
            <Play size={16} fill="currentColor" />
          ) : (
            <Music size={16} />
          )}
        </span>
        <span className="pivot-queue-body">
          <span className="pivot-queue-title" title={title}>
            {title}
          </span>
          <span className="pivot-queue-secondary" title={secondary ?? ""}>
            {secondary ?? " "}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="pivot-queue">
      <div
        className="pivot-queue-segs"
        role="tablist"
        aria-label={t("queue.sourceTablist")}
      >
        {segment("queue", t("nav.library"))}
        {segment("playlists", t("nav.playlists"))}
        {segment("favourites", t("nav.favourites"))}
      </div>

      {mode === "queue" ? (
        queue === null ? (
          <p className="pivot-queue-empty">{t("queue.loadingQueue")}</p>
        ) : queueItems.length === 0 ? (
          <p className="pivot-queue-empty">{t("queue.emptyLoadHint")}</p>
        ) : (
          <ol className="pivot-queue-list">
            {queueItems.map((item) =>
              renderRow(
                String(item.id),
                item.title ?? item.uri,
                item.album ?? item.artist ?? null,
                {
                  current: item.position === currentPosition,
                  unavailable: item.available === false,
                  ariaLabel: t("queue.actionsFor", {
                    title: item.title ?? item.uri
                  }),
                  onClick: () =>
                    setSheet({
                      uri: item.uri,
                      title: item.title ?? item.uri,
                      position: item.position,
                      source: "queue"
                    })
                }
              )
            )}
          </ol>
        )
      ) : null}

      {mode === "playlists" ? (
        playlistEntries.length === 0 ? (
          <p className="pivot-queue-empty">{t("playlist.noneSaved")}</p>
        ) : (
          <ol className="pivot-queue-list">
            {playlistEntries.map((p) =>
              renderRow(
                p.name,
                p.name,
                p.itemCount !== null
                  ? t("dialog.trackCount.many", { n: p.itemCount })
                  : null,
                {
                  ariaLabel: t("queue.loadAria", { name: p.name }),
                  onClick: () => void loadAsQueue(p.name, p.name)
                }
              )
            )}
          </ol>
        )
      ) : null}

      {mode === "favourites" ? (
        favouriteItems.length === 0 ? (
          <p className="pivot-queue-empty">{t("fav.noneYet")}</p>
        ) : (
          <ol className="pivot-queue-list">
            {favouriteItems.map((f) =>
              renderRow(
                f.uri,
                f.title ?? f.uri,
                f.album ?? f.artist ?? null,
                {
                  unavailable: f.available === false,
                  ariaLabel: t("queue.actionsFor", {
                    title: f.title ?? f.uri
                  }),
                  onClick: () =>
                    setSheet({
                      uri: f.uri,
                      title: f.title ?? f.uri,
                      position: null,
                      source: "favourites"
                    })
                }
              )
            )}
          </ol>
        )
      ) : null}

      <p className="pivot-queue-foot tabular">
        {mode === "queue"
          ? totalLength === 0
            ? t("dialog.trackCount.many", { n: 0 })
            : t(
                totalLength === 1
                  ? "dialog.trackCount.one"
                  : "dialog.trackCount.many",
                { n: totalLength }
              ) +
              (truncated
                ? ` - ${t("queue.showingFirst", { n: queueItems.length })}`
                : "")
          : mode === "playlists"
            ? t(
                playlistEntries.length === 1
                  ? "playlist.count.one"
                  : "playlist.count.many",
                { n: playlistEntries.length }
              )
            : t(
                favouriteItems.length === 1
                  ? "fav.count.one"
                  : "fav.count.many",
                { n: favouriteItems.length }
              )}
      </p>

      {feedback ? (
        <p className="pivot-queue-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      {sheet !== null ? (
        <div
          className="pivot-queue-sheet-root"
          role="dialog"
          aria-modal="true"
          aria-label={t("queue.trackActions")}
          onClick={() => setSheet(null)}
        >
          <div className="pivot-queue-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pivot-queue-sheet-head">
              <span className="pivot-queue-sheet-title" title={sheet.title}>
                {sheet.title}
              </span>
              <button
                type="button"
                className="pivot-queue-sheet-close"
                onClick={() => setSheet(null)}
                aria-label={t("dialog.close")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="pivot-queue-sheet-actions">
              {sheet.source === "queue" ? (
                <button
                  type="button"
                  className="pivot-queue-action"
                  disabled={busy || sheet.position === null}
                  onClick={() => {
                    const item = queueItems.find((q) => q.uri === sheet.uri);
                    if (item !== undefined) void playQueueRow(item);
                  }}
                >
                  <Play size={16} fill="currentColor" />
                  <span>{t("queue.playNow")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="pivot-queue-action"
                  disabled={busy}
                  onClick={() =>
                    void loadAsQueue(
                      RESERVED_FAVOURITES_PLAYLIST,
                      t("queue.favouritesLabel")
                    )
                  }
                >
                  <Play size={16} fill="currentColor" />
                  <span>{t("queue.playFavourites")}</span>
                </button>
              )}

              <button
                type="button"
                className="pivot-queue-action"
                disabled={busy}
                onClick={() => {
                  setAddToListUri(sheet.uri);
                  setSheet(null);
                }}
              >
                <ListPlus size={16} />
                <span>{t("queue.addToList")}</span>
              </button>

              <button
                type="button"
                className="pivot-queue-action"
                disabled={busy}
                onClick={() => void toggleFavourite(sheet.uri)}
              >
                {favouriteUris.has(sheet.uri) ? (
                  <>
                    <Trash2 size={16} />
                    <span>{t("collection.removeFromFavourites")}</span>
                  </>
                ) : (
                  <>
                    <Heart size={16} />
                    <span>{t("collection.addToFavourites")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addToListUri !== null ? (
        <PlaylistPickerDialog
          title={t("collection.addToPlaylist")}
          hint={t("queue.selectedTrackAppendHint")}
          playlists={playlistEntries}
          confirmLabel={t("dialog.add")}
          onCancel={() => setAddToListUri(null)}
          onConfirm={(name) => {
            const uri = addToListUri;
            setAddToListUri(null);
            void run(async () => {
              const r = await playlists.addToPlaylist(name, [uri]);
              return r.ok ? { ok: true } : { ok: false, message: r.message };
            });
          }}
        />
      ) : null}
    </div>
  );
}
