// FavouritesSurface - operator-facing favourites list.
//
// Subscribes to audio_favourites and renders the ordered items as
// ruled TrackTiles. Per-tile toolbox: heart toggle (filled - tap
// removes the favourite), append-to-queue (queue.enqueue), and a
// kebab with Play next / Add to playlist / Move up / Move down
// (favourites.move_favourite) / Remove favourite (danger). Clear
// all stays in the header.

import { useCallback, useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronUp,
  Heart,
  LayoutGrid,
  List,
  ListPlus,
  Play,
  Plus,
  X
} from "lucide-preact";
import { useFavourites } from "./useFavourites";
import { useAudioQueue } from "../queue/useAudioQueue";
import { usePlaylists } from "../playlist/usePlaylists";
import type { FavouriteItem } from "./favourites-decoders";
import { ConfirmDialog, PlaylistPickerDialog } from "../../components/dialogs";
import { TrackTile } from "../../components/TrackTile";
import { KebabMenu } from "../../components/KebabMenu";
import {
  ListTextModeControl,
  type ListTextModeOverride
} from "../../components/ListTextModeControl";
import type { TextOverflowMode } from "../../components/ScrollingText";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

type CollectionViewMode = "list" | "tile";

interface FavouritesSurfaceProps {
  /** Shared list-vs-tile mode, controlled centrally so the
   *  Appearance setting applies uniformly across collection
   *  surfaces. */
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  /** Resolved boolean from Settings -> Appearance -> Classical
   *  metadata. False suppresses the strip regardless of tags. */
  showClassicalStrip: boolean;
  /** RESOLVED long-text mode for this surface's tiles. */
  textMode: TextOverflowMode;
  /** Raw Aa override (ui.list.text_mode.favourites). */
  textModeOverride: ListTextModeOverride;
  onTextModeOverrideChange: (mode: ListTextModeOverride) => void;
}

export function FavouritesSurface({
  viewMode,
  onViewModeChange,
  showClassicalStrip,
  textMode,
  textModeOverride,
  onTextModeOverrideChange
}: FavouritesSurfaceProps) {
  useLocale();
  const fav = useFavourites();
  const audioQueue = useAudioQueue();
  const playlists = usePlaylists();
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>("");
  const [addToPlaylistTarget, setAddToPlaylistTarget] =
    useState<FavouriteItem | null>(null);

  const runAction = useCallback(
    async (
      label: string,
      operation: () => Promise<{ ok: boolean; message?: string }>
    ): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFeedback(t("collection.feedback.working", { label }));
      try {
        const result = await operation();
        if (result.ok) {
          setFeedback("");
        } else {
          setFeedback(
            result.message ?? t("collection.feedback.incomplete", { label })
          );
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setFeedback(t("collection.feedback.failed", { label, detail }));
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const onPlayNext = useCallback(
    (item: FavouriteItem) => {
      const currentPosition = audioQueue.queue?.currentPosition ?? null;
      const position =
        currentPosition !== null ? currentPosition + 1 : undefined;
      void runAction(t("collection.playNext"), () =>
        audioQueue.enqueue([item.uri], position)
      );
    },
    [audioQueue, runAction]
  );

  const onAddToQueue = useCallback(
    (item: FavouriteItem) => {
      void runAction(t("collection.addToQueue"), () =>
        audioQueue.enqueue([item.uri])
      );
    },
    [audioQueue, runAction]
  );

  const onMoveUp = useCallback(
    (item: FavouriteItem) => {
      if (item.position === 0) return;
      void runAction(t("collection.moveUp"), () =>
        fav.moveFavourite(item.uri, item.position - 1)
      );
    },
    [fav, runAction]
  );

  const onMoveDown = useCallback(
    (item: FavouriteItem, total: number) => {
      if (item.position >= total - 1) return;
      void runAction(t("collection.moveDown"), () =>
        fav.moveFavourite(item.uri, item.position + 1)
      );
    },
    [fav, runAction]
  );

  const onRemove = useCallback(
    (item: FavouriteItem) => {
      void runAction(t("stage.favRemove"), () => fav.removeFavourite(item.uri));
    },
    [fav, runAction]
  );

  const [confirmClear, setConfirmClear] = useState(false);
  const onClearAll = useCallback(() => {
    setConfirmClear(true);
  }, []);

  // ----- render --------------------------------------------------

  const state = fav.state;
  const items = state?.items ?? [];
  const count = state?.count ?? 0;

  return (
    <div className="favourites-surface">
      <div className="favourites-surface-head">
        <div>
          <h2 className="favourites-surface-title">
            <Heart size={18} className="favourites-heart-icon" />
            {t("nav.favourites")}
          </h2>
          <p className="favourites-surface-meta">
            {state === null
              ? fav.connection.kind === "error"
                ? t("fav.unreachable", {
                    reason: fav.connection.reason ?? t("collection.noDetail")
                  })
                : t("collection.loading")
              : count === 0
                ? t("fav.emptyTitle")
                : t(
                    count === 1
                      ? "collection.itemCount.one"
                      : "collection.itemCount.many",
                    { n: count }
                  )}
          </p>
        </div>
        <div className="favourites-head-actions">
          <ListTextModeControl
            value={textModeOverride}
            onChange={onTextModeOverrideChange}
          />
          <div
            className="collection-view-toggle"
            role="group"
            aria-label={t("collection.viewMode")}
          >
            <button
              type="button"
              className={
                viewMode === "list"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("list")}
              aria-pressed={viewMode === "list"}
              aria-label={t("collection.listView")}
              title={t("collection.listView")}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              className={
                viewMode === "tile"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("tile")}
              aria-pressed={viewMode === "tile"}
              aria-label={t("collection.tileView")}
              title={t("collection.tileView")}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <button
            type="button"
            className="favourites-clear-button"
            onClick={onClearAll}
            disabled={busy || count === 0}
          >
            {t("fav.clearAll")}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className="favourites-feedback" role="status">
          {feedback}
          <button
            type="button"
            className="favourites-feedback-dismiss"
            aria-label={t("collection.dismiss")}
            onClick={() => setFeedback("")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {state === null || count === 0 ? (
        <div className="favourites-empty">
          <Heart size={32} className="favourites-empty-icon" />
          <h3>{t("fav.emptyTitle")}</h3>
          <p>{t("fav.emptyBody")}</p>
        </div>
      ) : (
        <div
          className={
            viewMode === "tile" ? "collection-tile-grid" : "track-tile-list"
          }
        >
          {items.map((item) => {
            const toolbox = (
              <>
                <button
                  type="button"
                  className="track-tile-fav track-tile-action-on"
                  onClick={() => onRemove(item)}
                  disabled={busy}
                  aria-pressed
                  aria-label={t("collection.removeFromFavourites")}
                  title={t("collection.removeFromFavourites")}
                >
                  <Heart size={14} fill="currentColor" />
                </button>
                <button
                  type="button"
                  onClick={() => onAddToQueue(item)}
                  disabled={busy || item.available === false}
                  aria-label={t("collection.addToQueue")}
                  title={t("collection.appendToQueue")}
                >
                  <Plus size={14} />
                </button>
                <KebabMenu
                  disabled={busy}
                  items={[
                    {
                      id: "play-next",
                      icon: <Play size={14} />,
                      label: t("collection.playNext"),
                      disabled: item.available === false,
                      onSelect: () => onPlayNext(item)
                    },
                    {
                      id: "add-to-playlist",
                      icon: <ListPlus size={14} />,
                      label: t("collection.addToPlaylist"),
                      disabled: item.available === false,
                      onSelect: () => setAddToPlaylistTarget(item)
                    },
                    {
                      id: "move-up",
                      icon: <ChevronUp size={14} />,
                      label: t("collection.moveUp"),
                      disabled: item.position === 0,
                      onSelect: () => onMoveUp(item)
                    },
                    {
                      id: "move-down",
                      icon: <ChevronDown size={14} />,
                      label: t("collection.moveDown"),
                      disabled: item.position >= count - 1,
                      onSelect: () => onMoveDown(item, count)
                    },
                    {
                      id: "remove",
                      icon: <X size={14} />,
                      label: t("stage.favRemove"),
                      danger: true,
                      onSelect: () => onRemove(item)
                    }
                  ]}
                />
              </>
            );
            return (
              <TrackTile
                key={item.uri}
                shape={viewMode === "tile" ? "card" : "row"}
                title={item.title ?? item.uri}
                artist={item.artist}
                album={item.album}
                artworkUrl={item.artworkUrl}
                placeholderIcon={<Heart size={16} />}
                classical={showClassicalStrip ? item.classical : null}
                durationMs={item.durationMs}
                unavailable={item.available === false}
                textMode={textMode}
                leading={
                  viewMode === "tile" ? undefined : (
                    <span className="track-tile-pos">
                      <span className="track-tile-pos-label">
                        {item.position + 1}
                      </span>
                    </span>
                  )
                }
                badges={
                  item.available === false ? (
                    <span className="track-tile-badge track-tile-badge-danger">
                      {t("queue.unavailBadge")}
                    </span>
                  ) : undefined
                }
                actions={toolbox}
              />
            );
          })}
        </div>
      )}

      {addToPlaylistTarget !== null ? (
        <PlaylistPickerDialog
          title={t("collection.addToPlaylist")}
          hint={t("collection.appendHint", {
            name: addToPlaylistTarget.title ?? addToPlaylistTarget.uri
          })}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("dialog.add")}
          onCancel={() => setAddToPlaylistTarget(null)}
          onConfirm={(name) => {
            const target = addToPlaylistTarget;
            setAddToPlaylistTarget(null);
            void runAction(t("collection.addToPlaylist"), async () => {
              const r = await playlists.addToPlaylist(name, [target.uri]);
              if (r.ok) return { ok: true };
              return { ok: false, message: r.message };
            });
          }}
        />
      ) : null}

      {confirmClear ? (
        <ConfirmDialog
          title={t("fav.clearAllTitle")}
          message={t("fav.clearAllMessage")}
          confirmLabel={t("fav.clearAll")}
          destructive
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void runAction(t("fav.clearAction"), () => fav.clearFavourites());
          }}
        />
      ) : null}
    </div>
  );
}
