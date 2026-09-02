// QueueSurface - the operator-facing playback queue view.
//
// Consumes useAudioQueue (which subscribes to the audio_queue
// subject and exposes the audio.queue.* verbs as callbacks).
// Renders either as a list (default) or as a tile grid, gated on
// the shared CollectionViewMode the App stores in localStorage.
//
// Header actions: Clear queue / Save queue as playlist / Load
// playlist / Append playlist / Skip to next available.
// Per-tile toolbox (RULED list-element standard): a LIVE play slot
// ("Play from here" via queue.play_from_position - the plugin
// validates the position before dispatch, so refusals leave
// playback untouched), add-to-playlist, and a kebab carrying move
// up / move down / favourite toggle / remove (danger). Title tap
// plays the row through the same verb.
// Drag-and-drop stays rejected on the
// audio-queue surface - single-step explicit moves are easier to
// undo than a drag that drops in the wrong place.

import { useCallback, useMemo, useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronUp,
  Heart,
  LayoutGrid,
  List,
  ListPlus,
  Loader2,
  Play,
  RotateCw,
  X
} from "lucide-preact";
import { useAudioQueue } from "./useAudioQueue";
import { useFavourites } from "../favourites/useFavourites";
import { usePlaylists } from "../playlist/usePlaylists";
import { codecFromUri } from "./audio-queue-decoders";
import type { QueueItem } from "./audio-queue-decoders";
import { TrackTile } from "../../components/TrackTile";
import { KebabMenu } from "../../components/KebabMenu";
import {
  ListTextModeControl,
  type ListTextModeOverride
} from "../../components/ListTextModeControl";
import type { TextOverflowMode } from "../../components/ScrollingText";
import type { DomainIconResolver } from "../../core/domain-icons";
import {
  ConfirmDialog,
  PlaylistPickerDialog,
  PromptDialog
} from "../../components/dialogs";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  collectionChromeMode,
  readCollectionLoadFlag
} from "../../runtime/collection-load-chrome";

/** Dialog discriminator for the QueueSurface. null = no dialog open. */
type QueueDialog =
  | null
  | { kind: "clear" }
  | { kind: "save-as" }
  | { kind: "load" }
  | { kind: "append" }
  | { kind: "add-to-playlist"; item: QueueItem };

type CollectionViewMode = "list" | "tile";

interface QueueSurfaceProps {
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  /** Theme-resolved icon resolver - the placeholder for items
   *  without per-item artwork comes from the active theme's
   *  domain_icons contribution for `audio.queue`. */
  resolveDomainIcon: DomainIconResolver;
  /** Resolved boolean from Settings -> Appearance -> Classical
   *  metadata. False suppresses the strip regardless of tags. */
  showClassicalStrip: boolean;
  /** RESOLVED long-text mode for this surface's tiles (the Aa
   *  override already resolved against the device Long text
   *  setting by App). */
  textMode: TextOverflowMode;
  /** Raw Aa override (ui.list.text_mode.queue; "system" = follow
   *  the device setting, never stored). */
  textModeOverride: ListTextModeOverride;
  onTextModeOverrideChange: (mode: ListTextModeOverride) => void;
}

export function QueueSurface({
  viewMode,
  onViewModeChange,
  resolveDomainIcon,
  showClassicalStrip,
  textMode,
  textModeOverride,
  onTextModeOverrideChange
}: QueueSurfaceProps) {
  useLocale();
  const QueueIcon = resolveDomainIcon("audio.queue");
  const {
    connection,
    queue,
    removeItem,
    moveItem,
    clearQueue,
    loadPlaylist,
    appendPlaylist,
    saveAsPlaylist,
    skipToNextAvailable,
    playFromPosition,
    refresh
  } = useAudioQueue();
  // Truthful load status, STATE-DRIVEN (no clock). queue === null means
  // the seed has not resolved yet (loading), NOT "empty" - the
  // framework's empty envelope decodes to a non-null queue with
  // items=[]. Flag off => mode "hidden" => legacy behaviour untouched.
  // The queue has no probing signal, so it stays inline; the prominent
  // panel is reserved for a genuinely enumerating source.
  const queueHasSnapshot = queue !== null;
  const queueErrored = connection.kind === "error";
  const collectionFlag = useMemo(() => readCollectionLoadFlag(), []);
  const loadMode = collectionChromeMode({
    flag: collectionFlag,
    loading: !queueHasSnapshot && !queueErrored,
    hasSnapshot: queueHasSnapshot,
    errored: queueErrored,
    probing: false
  });
  const fav = useFavourites();
  // Playlist index for the in-app PlaylistPickerDialog used by
  // Load / Append. The subject is read-then-subscribed inside the
  // hook so it always has a current snapshot to render.
  const playlists = usePlaylists();
  const [dialog, setDialog] = useState<QueueDialog>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  // Membership set for the heart-toggle icon. Cheaper than calling
  // is_favourite per row - the audio_favourites subject already
  // pushes the full set on every change.
  const favouriteUris = useMemo(() => {
    const set = new Set<string>();
    fav.state?.items.forEach((item) => set.add(item.uri));
    return set;
  }, [fav.state]);
  const [feedback, setFeedback] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

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

  const onPlayItem = useCallback(
    (position: number) => {
      // queue.play_from_position addresses the row DIRECTLY (zero
      // based). Refusals (position_out_of_range / queue_empty)
      // surface inline via the shared feedback line and leave
      // playback untouched - the plugin validates before dispatch.
      void runAction(t("stage.play"), () => playFromPosition(position));
    },
    [runAction, playFromPosition]
  );

  const onRemoveItem = useCallback(
    (id: number) => {
      void runAction(t("queue.remove"), () => removeItem(id));
    },
    [runAction, removeItem]
  );

  // Kebab move up / move down: one explicit single-step
  // move_queue_item (songid stays stable across moves).
  const onMoveStep = useCallback(
    (item: QueueItem, delta: -1 | 1, total: number) => {
      const toPosition = item.position + delta;
      if (toPosition < 0 || toPosition >= total) return;
      void runAction(
        t(delta === -1 ? "collection.moveUp" : "collection.moveDown"),
        () => moveItem(item.id, toPosition)
      );
    },
    [runAction, moveItem]
  );

  const onToggleFavourite = useCallback(
    (item: QueueItem) => {
      const isFav = favouriteUris.has(item.uri);
      void runAction(
        isFav
          ? t("collection.removeFromFavourites")
          : t("collection.addToFavourites"),
        () =>
          isFav ? fav.removeFavourite(item.uri) : fav.addFavourite(item.uri)
      );
    },
    [fav, favouriteUris, runAction]
  );

  const onClearQueue = useCallback(() => {
    setDialog({ kind: "clear" });
  }, []);

  const onSaveAsPlaylist = useCallback(() => {
    setDialog({ kind: "save-as" });
  }, []);

  const onLoadPlaylist = useCallback(() => {
    setDialog({ kind: "load" });
  }, []);

  const onAppendPlaylist = useCallback(() => {
    setDialog({ kind: "append" });
  }, []);

  const onSkipToNextAvailable = useCallback(() => {
    const from = (queue?.currentPosition ?? -1) + 1;
    void runAction(t("queue.skipNext"), async () => {
      const r = await skipToNextAvailable(from);
      if (!r.ok) return { ok: false, message: r.message };
      if (r.outcome.kind === "stopped") {
        return {
          ok: false,
          message:
            r.outcome.reason !== undefined
              ? t("queue.skipStopped.reason", { reason: r.outcome.reason })
              : t("queue.skipStopped.noneAhead")
        };
      }
      return { ok: true };
    });
  }, [queue?.currentPosition, runAction, skipToNextAvailable]);

  const onRefresh = useCallback(() => {
    void runAction(t("queue.refresh"), refresh);
  }, [runAction, refresh]);

  // ----- render ------------------------------------------------------

  const items = queue?.items ?? [];
  const currentPosition = queue?.currentPosition ?? null;
  const totalLength = queue?.length ?? 0;
  const renderedCount = items.length;
  const showTruncationFooter =
    queue?.truncated === true && renderedCount < totalLength;

  // THE toolbox (ruled): [play from here] [add to playlist]
  // [kebab: move up / move down / favourite / remove (danger)].
  // Identical in row and card shape.
  const tileToolbox = (item: QueueItem) => {
    const isFav = favouriteUris.has(item.uri);
    return (
      <>
        <button
          type="button"
          onClick={() => onPlayItem(item.position)}
          disabled={busy || item.available === false}
          aria-label={t("list.playFromHere")}
          title={t("list.playFromHere")}
        >
          <Play size={14} />
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: "add-to-playlist", item })}
          disabled={busy || item.available === false}
          aria-label={t("collection.addToPlaylist")}
          title={t("collection.addToPlaylistEllipsis")}
        >
          <ListPlus size={14} />
        </button>
        <KebabMenu
          disabled={busy}
          items={[
            {
              id: "move-up",
              icon: <ChevronUp size={14} />,
              label: t("collection.moveUp"),
              disabled: item.position === 0,
              onSelect: () => onMoveStep(item, -1, totalLength)
            },
            {
              id: "move-down",
              icon: <ChevronDown size={14} />,
              label: t("collection.moveDown"),
              disabled: item.position >= totalLength - 1,
              onSelect: () => onMoveStep(item, 1, totalLength)
            },
            {
              id: "favourite",
              icon: (
                <Heart size={14} className={isFav ? "kebab-fav-on" : undefined} fill={isFav ? "currentColor" : "none"} />
              ),
              label: isFav
                ? t("collection.removeFromFavourites")
                : t("collection.addToFavourites"),
              onSelect: () => onToggleFavourite(item)
            },
            {
              id: "remove",
              icon: <X size={14} />,
              label: t("queue.removeTitle"),
              danger: true,
              onSelect: () => onRemoveItem(item.id)
            }
          ]}
        />
      </>
    );
  };

  return (
    <div className="queue-surface">
      <div className="queue-surface-head">
        <div>
          <h2 className="queue-surface-title">{t("nav.library")}</h2>
          <p className="queue-surface-meta">
            {totalLength === 0
              ? t("queue.empty")
              : t(
                  totalLength === 1
                    ? "collection.itemCount.one"
                    : "collection.itemCount.many",
                  { n: totalLength }
                )}
            {currentPosition !== null
              ? ` - ${t("queue.playingPosition", { n: currentPosition + 1 })}`
              : ""}
            {connection.kind !== "connected" ? (
              <span className="queue-conn-tag">
                {" - "}
                {loadMode !== "hidden"
                  ? queueHasSnapshot
                    ? t("collection.updating")
                    : t("collection.loadingQueue")
                  : connection.kind === "error"
                    ? connection.reason ?? t("collection.unavailable")
                    : connection.kind}
                {connection.attempt !== undefined && loadMode === "hidden"
                  ? ` ${t("queue.connAttempt", { n: connection.attempt })}`
                  : ""}
              </span>
            ) : null}
          </p>
        </div>
        <div className="queue-surface-head-actions">
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
            className="queue-refresh-button"
            onClick={onRefresh}
            aria-label={t("queue.refreshAria")}
            title={t("queue.refresh")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={16} className="queue-spin" />
            ) : (
              <RotateCw size={16} />
            )}
          </button>
        </div>
      </div>

      <div className="queue-header-actions">
        <button
          type="button"
          className="queue-action-button queue-action-danger"
          onClick={onClearQueue}
          disabled={busy || totalLength === 0}
        >
          {t("queue.clear")}
        </button>
        <button
          type="button"
          className="queue-action-button"
          onClick={onSaveAsPlaylist}
          disabled={busy || totalLength === 0}
        >
          {t("queue.saveAs")}
        </button>
        <button
          type="button"
          className="queue-action-button"
          onClick={onLoadPlaylist}
          disabled={busy}
        >
          {t("queue.load")}
        </button>
        <button
          type="button"
          className="queue-action-button"
          onClick={onAppendPlaylist}
          disabled={busy}
        >
          {t("queue.append")}
        </button>
        <div className="queue-header-spacer" />
        <button
          type="button"
          className="queue-action-button queue-action-primary"
          onClick={onSkipToNextAvailable}
          disabled={busy || totalLength === 0}
        >
          {t("queue.skipNext")}
        </button>
      </div>

      {feedback ? (
        <div className="queue-feedback" role="status">
          {feedback}
          <button
            type="button"
            className="queue-feedback-dismiss"
            aria-label={t("collection.dismiss")}
            onClick={() => setFeedback("")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {queue === null && loadMode !== "hidden" ? (
        <div className="queue-empty-state">
          <p>{t("collection.loadingQueue")}</p>
        </div>
      ) : totalLength === 0 ? (
        <div className="queue-empty-state">
          <h3>{t("queue.emptyTitle")}</h3>
          <p>{t("queue.emptyBody")}</p>
        </div>
      ) : viewMode === "tile" ? (
        <div className="collection-tile-grid">
          {items.map((item) => {
            const codec = codecFromUri(item.uri);
            const isCurrent = item.position === currentPosition;
            const tertiaryExtra = [
              codec,
              item.available === false ? t("collection.unavailable") : null
            ]
              .filter((v) => v !== null)
              .join(" - ");
            return (
              <TrackTile
                key={item.id}
                shape="card"
                title={item.title ?? item.uri}
                artist={item.artist}
                album={item.album}
                artworkUrl={item.artworkUrl}
                placeholderIcon={<QueueIcon />}
                classical={showClassicalStrip ? item.classical : null}
                durationMs={item.durationMs}
                tertiary={tertiaryExtra === "" ? null : tertiaryExtra}
                current={isCurrent}
                textMode={textMode}
                onPrimaryAction={() => onPlayItem(item.position)}
                primaryActionDisabled={busy || item.available === false}
                primaryActionLabel={t("queue.playAria", {
                  title: item.title ?? item.uri
                })}
                actions={tileToolbox(item)}
              />
            );
          })}
        </div>
      ) : (
        <div className="track-tile-list">
          {items.map((item) => {
            const codec = codecFromUri(item.uri);
            const isCurrent = item.position === currentPosition;
            return (
              <TrackTile
                key={item.id}
                shape="row"
                title={item.title ?? item.uri}
                artist={item.artist}
                album={item.album}
                artworkUrl={item.artworkUrl}
                placeholderIcon={<QueueIcon />}
                classical={showClassicalStrip ? item.classical : null}
                durationMs={item.durationMs}
                current={isCurrent}
                unavailable={item.available === false}
                textMode={textMode}
                leading={
                  <span className="track-tile-pos">
                    <span className="track-tile-pos-label">
                      {item.position + 1}
                    </span>
                    {isCurrent ? (
                      <span className="track-tile-pos-marker">
                        {t("queue.playingMarker")}
                      </span>
                    ) : null}
                  </span>
                }
                badges={
                  <>
                    {codec !== null ? (
                      <span className="track-tile-badge">{codec}</span>
                    ) : null}
                    {item.available === false ? (
                      <span className="track-tile-badge track-tile-badge-danger">
                        {t("queue.unavailBadge")}
                      </span>
                    ) : null}
                  </>
                }
                onPrimaryAction={() => onPlayItem(item.position)}
                primaryActionDisabled={busy || item.available === false}
                primaryActionTitle={
                  item.available === false
                    ? t("queue.sourceUnavailable")
                    : t("queue.playThisItem")
                }
                actions={tileToolbox(item)}
              />
            );
          })}
        </div>
      )}

      {showTruncationFooter ? (
        <div className="queue-truncation-footer">
          {t("queue.truncationFooter", {
            rendered: renderedCount,
            total: totalLength
          })}
        </div>
      ) : null}

      {dialog?.kind === "clear" ? (
        <ConfirmDialog
          title={t("queue.clear")}
          message={t("queue.clearMessage")}
          confirmLabel={t("queue.clear")}
          destructive
          onCancel={closeDialog}
          onConfirm={() => {
            closeDialog();
            void runAction(t("queue.clear"), clearQueue);
          }}
        />
      ) : null}

      {dialog?.kind === "save-as" ? (
        <PromptDialog
          title={t("queue.saveAsTitle")}
          label={t("playlist.nameLabel")}
          placeholder={t("queue.saveAsPlaceholder")}
          hint={t("queue.saveAsHint")}
          confirmLabel={t("dialog.save")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            closeDialog();
            void runAction(t("queue.saveAsAction"), () => saveAsPlaylist(name));
          }}
        />
      ) : null}

      {dialog?.kind === "load" ? (
        <PlaylistPickerDialog
          title={t("queue.loadTitle")}
          hint={t("queue.loadHint")}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("collection.loadToQueue")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            closeDialog();
            void runAction(t("queue.loadAction"), () => loadPlaylist(name));
          }}
        />
      ) : null}

      {dialog?.kind === "append" ? (
        <PlaylistPickerDialog
          title={t("queue.appendTitle")}
          hint={t("queue.appendHint")}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("queue.appendConfirm")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            closeDialog();
            void runAction(t("queue.appendAction"), () => appendPlaylist(name));
          }}
        />
      ) : null}

      {dialog?.kind === "add-to-playlist" ? (
        <PlaylistPickerDialog
          title={t("collection.addToPlaylist")}
          hint={t("collection.appendHint", {
            name: dialog.item.title ?? dialog.item.uri
          })}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("dialog.add")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            const targetUri = dialog.item.uri;
            closeDialog();
            void runAction(t("collection.addToPlaylist"), async () => {
              const r = await playlists.addToPlaylist(name, [targetUri]);
              if (r.ok) return { ok: true };
              return { ok: false, message: r.message };
            });
          }}
        />
      ) : null}

    </div>
  );
}
