// PlaylistsSurface - drill-down playlist management.
//
// LANDING (default): no left column. A responsive card grid of
// playlists - cover placeholder, name, track count, inline actions
// (Load to queue / Append to queue / more-menu with Rename +
// Delete). Clicking the card drills into the detail view; the
// inline actions never drill (stopPropagation).
//
// DETAIL: back button + playlist name + track count, a management
// bar (Load to queue / Append to queue / Add current queue /
// Rename) and a full-width track list of ruled tiles. Per-tile
// toolbox: LIVE play slot ("Play from here" - loads this playlist
// as the queue via queue.load_playlist_to_queue, then starts the
// tapped row via queue.play_from_position; both are real verbs and
// the composite is exactly what the label promises),
// append-this-track-to-queue (queue.enqueue), and a kebab with
// Move up / Move down (playlist.move_in_playlist) + Remove
// (playlist.remove_from_playlist, danger).
//
// Deliberately NOT wired live: a card "Play now" that promises
// playback (queue.load_playlist_to_queue alone loads the queue;
// whether playback starts is the framework's call, so the card
// button keeps its honest "Load to queue" label).

import { useCallback, useEffect, useState } from "preact/hooks";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  LayoutGrid,
  List,
  ListMusic,
  Loader2,
  MoreVertical,
  Music,
  Play,
  Plus,
  X
} from "lucide-preact";
import { usePlaylists } from "./usePlaylists";
import { useAudioQueue } from "../queue/useAudioQueue";
import {
  formatRelativeMs,
  type PlaylistContents,
  type PlaylistIndexEntry,
  type PlaylistItem
} from "./playlist-decoders";
import { ConfirmDialog, PromptDialog } from "../../components/dialogs";
import { TrackTile } from "../../components/TrackTile";
import { KebabMenu } from "../../components/KebabMenu";
import {
  ListTextModeControl,
  type ListTextModeOverride
} from "../../components/ListTextModeControl";
import type { TextOverflowMode } from "../../components/ScrollingText";
import { t, tn } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

type PlaylistDialog =
  | null
  | { kind: "create" }
  | { kind: "rename"; current: string }
  | { kind: "delete"; target: string };

type CollectionViewMode = "list" | "tile";

interface PlaylistsSurfaceProps {
  /** Shared list-vs-tile mode, controlled centrally so the device
   *  setting applies uniformly across collection surfaces. On the
   *  landing grid "tile" is the responsive auto-fill card grid and
   *  "list" collapses it to a single full-width column; the detail
   *  track list is independent of the mode. */
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  /** Resolved boolean from the device settings. False suppresses
   *  the classical strip regardless of tags. */
  showClassicalStrip: boolean;
  /** RESOLVED long-text mode for the detail track tiles. */
  textMode: TextOverflowMode;
  /** Raw Aa override (ui.list.text_mode.playlists). */
  textModeOverride: ListTextModeOverride;
  onTextModeOverrideChange: (mode: ListTextModeOverride) => void;
}

/** Deterministic cover placeholder for playlists (the index carries
 *  no artwork). Hash the name so the gradient is stable across
 *  re-sorts and sessions. */
function coverGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const hue2 = (hue + 42) % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 30%), hsl(${hue2} 60% 52%))`;
}

// Render a track-count badge honouring the framework's wire-shape
// truth contract (audio.playlist.v1 / PLUGIN_CONTRACT.md §15).
// null means "MPD truth not yet known" - show neutrally, never as
// "0 tracks" (forbidden by the catalogue acceptance row). Real 0
// remains "0 tracks".
function formatTrackCount(count: number | null): string {
  if (count === null) return t("playlist.tracksPending");
  return tn("dialog.trackCount", count);
}

export function PlaylistsSurface({
  viewMode,
  onViewModeChange,
  showClassicalStrip,
  textMode,
  textModeOverride,
  onTextModeOverrideChange
}: PlaylistsSurfaceProps) {
  useLocale();
  const playlists = usePlaylists();
  const audioQueue = useAudioQueue();
  // null = landing grid; non-null = drilled into that playlist.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [contents, setContents] = useState<PlaylistContents | null>(null);
  const [contentsLoading, setContentsLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PlaylistDialog>(null);

  const runAction = useCallback(
    async (
      label: string,
      operation: () => Promise<{ ok: boolean; message?: string }>
    ): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setFeedback(t("collection.feedback.working", { label }));
      try {
        const result = await operation();
        if (result.ok) {
          setFeedback("");
          return true;
        }
        setFeedback(
          result.message ?? t("collection.feedback.incomplete", { label })
        );
        return false;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setFeedback(t("collection.feedback.failed", { label, detail }));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  // Fetch the drilled playlist's contents whenever the selection
  // changes, and re-fetch when a mutating verb succeeds (index push
  // doesn't carry contents - we have to re-read).
  const getPlaylist = playlists.getPlaylist;
  const fetchContents = useCallback(
    async (name: string): Promise<void> => {
      setContentsLoading(true);
      try {
        const r = await getPlaylist(name);
        if (r.ok) {
          setContents(r.value);
        } else {
          setContents(null);
          setFeedback(r.message);
        }
      } finally {
        setContentsLoading(false);
      }
    },
    [getPlaylist]
  );

  useEffect(() => {
    if (selectedName === null) {
      setContents(null);
      return;
    }
    void fetchContents(selectedName);
  }, [selectedName, fetchContents]);

  const indexEntries = playlists.index?.playlists ?? [];

  const closeDialog = useCallback(() => setDialog(null), []);

  const onCreatePlaylist = useCallback(() => {
    setDialog({ kind: "create" });
  }, []);

  const onRenamePlaylist = useCallback((name: string) => {
    setMenuFor(null);
    setDialog({ kind: "rename", current: name });
  }, []);

  const onDeletePlaylist = useCallback((name: string) => {
    setMenuFor(null);
    setDialog({ kind: "delete", target: name });
  }, []);

  const onLoadToQueue = useCallback(
    (name: string) => {
      void runAction(t("collection.loadToQueue"), () =>
        audioQueue.loadPlaylist(name)
      );
    },
    [audioQueue, runAction]
  );

  const onAppendToQueue = useCallback(
    (name: string) => {
      void runAction(t("collection.appendToQueue"), () =>
        audioQueue.appendPlaylist(name)
      );
    },
    [audioQueue, runAction]
  );

  // Per-track "Play from here": replace the queue with THIS
  // playlist, then start playback at the tapped row. Two real
  // verbs in sequence; if the load succeeds but the position play
  // is refused, the refusal message surfaces inline and the loaded
  // queue stays (visible state matches what actually happened).
  const onPlayTrackHere = useCallback(
    (item: PlaylistItem) => {
      if (selectedName === null) return;
      const name = selectedName;
      void runAction(t("list.playFromHere"), async () => {
        const loaded = await audioQueue.loadPlaylist(name);
        if (!loaded.ok) return loaded;
        return audioQueue.playFromPosition(item.position);
      });
    },
    [selectedName, audioQueue, runAction]
  );

  // Per-track append to queue - real verb: queue.enqueue([uri])
  // (useAudioQueue.enqueue), so the toolbox "+" slot is honest.
  const onEnqueueTrack = useCallback(
    (item: PlaylistItem) => {
      void runAction(t("collection.addToQueue"), () =>
        audioQueue.enqueue([item.uri])
      );
    },
    [audioQueue, runAction]
  );

  // Add the CURRENT queue's tracks to the drilled playlist via
  // playlist.add_to_playlist. Client-side URIs are only honest when
  // the queue envelope was not truncated - the affordance disables
  // itself on truncation rather than silently dropping tracks.
  const queueItems = audioQueue.queue?.items ?? [];
  const queueTruncated = audioQueue.queue?.truncated === true;
  const onAddCurrentQueue = useCallback(() => {
    if (selectedName === null) return;
    const name = selectedName;
    const uris = (audioQueue.queue?.items ?? []).map((i) => i.uri);
    if (uris.length === 0) return;
    void runAction(t("playlist.addCurrentQueue"), async () => {
      const r = await playlists.addToPlaylist(name, uris);
      if (r.ok) await fetchContents(name);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    });
  }, [selectedName, audioQueue.queue, playlists, runAction, fetchContents]);

  const onMoveUp = useCallback(
    (item: PlaylistItem) => {
      if (selectedName === null || item.position === 0) return;
      const name = selectedName;
      void runAction(t("collection.moveUp"), async () => {
        const r = await playlists.moveInPlaylist(
          name,
          item.position,
          item.position - 1
        );
        if (r.ok) await fetchContents(name);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      });
    },
    [selectedName, playlists, runAction, fetchContents]
  );

  const onMoveDown = useCallback(
    (item: PlaylistItem, total: number) => {
      if (selectedName === null || item.position >= total - 1) return;
      const name = selectedName;
      void runAction(t("collection.moveDown"), async () => {
        const r = await playlists.moveInPlaylist(
          name,
          item.position,
          item.position + 1
        );
        if (r.ok) await fetchContents(name);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      });
    },
    [selectedName, playlists, runAction, fetchContents]
  );

  const onRemoveItem = useCallback(
    (item: PlaylistItem) => {
      if (selectedName === null) return;
      const name = selectedName;
      void runAction(t("playlist.removeFromPlaylist"), async () => {
        const r = await playlists.removeFromPlaylist(name, item.position);
        if (r.ok) await fetchContents(name);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      });
    },
    [selectedName, playlists, runAction, fetchContents]
  );

  // ----- shared chrome -------------------------------------------

  const feedbackBanner = feedback ? (
    <div className="playlists-feedback" role="status">
      {feedback}
      <button
        type="button"
        className="playlists-feedback-dismiss"
        aria-label={t("collection.dismiss")}
        onClick={() => setFeedback("")}
      >
        <X size={14} />
      </button>
    </div>
  ) : null;

  const dialogs = (
    <>
      {dialog?.kind === "create" ? (
        <PromptDialog
          title={t("playlist.new")}
          label={t("playlist.nameLabel")}
          placeholder={t("playlist.namePlaceholder")}
          confirmLabel={t("playlist.create")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            closeDialog();
            void runAction(t("playlist.createAction"), async () => {
              const r = await playlists.createPlaylist(name);
              if (!r.ok) return { ok: false, message: r.message };
              setSelectedName(name);
              return { ok: true };
            });
          }}
        />
      ) : null}

      {dialog?.kind === "rename" ? (
        <PromptDialog
          title={t("playlist.renameTitle")}
          label={t("playlist.renameLabel", { name: dialog.current })}
          initialValue={dialog.current}
          confirmLabel={t("playlist.rename")}
          onCancel={closeDialog}
          onConfirm={(name) => {
            closeDialog();
            if (name === dialog.current) return;
            const previous = dialog.current;
            void runAction(t("playlist.renameTitle"), async () => {
              const r = await playlists.renamePlaylist(previous, name);
              if (!r.ok) return { ok: false, message: r.message };
              // Follow the rename if we are drilled into it.
              setSelectedName((cur) => (cur === previous ? name : cur));
              return { ok: true };
            });
          }}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={t("playlist.deleteTitle")}
          message={t("playlist.deleteMessage", { name: dialog.target })}
          confirmLabel={t("playlist.delete")}
          destructive
          onCancel={closeDialog}
          onConfirm={() => {
            const target = dialog.target;
            closeDialog();
            void runAction(t("playlist.deleteTitle"), async () => {
              const r = await playlists.deletePlaylist(target);
              if (!r.ok) return { ok: false, message: r.message };
              // Deleting the drilled playlist returns to the landing.
              setSelectedName((cur) => (cur === target ? null : cur));
              return { ok: true };
            });
          }}
        />
      ) : null}
    </>
  );

  // ----- detail view ---------------------------------------------

  if (selectedName !== null) {
    const entry =
      indexEntries.find((e) => e.name === selectedName) ?? null;
    const items = contents?.items ?? [];
    const trackCount = entry?.itemCount ?? contents?.itemCount ?? null;

    return (
      <div className="playlists-surface">
        <div className="playlists-detail-topbar">
          <button
            type="button"
            className="playlists-back"
            onClick={() => setSelectedName(null)}
            aria-label={t("app.back")}
          >
            <ChevronLeft size={14} />
            <span>{t("nav.playlists")}</span>
          </button>
          <div className="playlists-detail-headline">
            <h2 className="playlists-surface-title">{selectedName}</h2>
            <p className="playlists-surface-meta">
              {formatTrackCount(trackCount)}
              {entry !== null && entry.modifiedAtMs !== null
                ? ` - ${t("playlist.lastModified", {
                    when: formatRelativeMs(entry.modifiedAtMs)
                  })}`
                : ""}
            </p>
          </div>
          <ListTextModeControl
            value={textModeOverride}
            onChange={onTextModeOverrideChange}
          />
        </div>

        {feedbackBanner}

        <div className="playlists-manage-bar">
          <button
            type="button"
            onClick={() => onLoadToQueue(selectedName)}
            disabled={busy || (contents !== null && contents.itemCount === 0)}
          >
            {t("collection.loadToQueue")}
          </button>
          <button
            type="button"
            onClick={() => onAppendToQueue(selectedName)}
            disabled={busy || (contents !== null && contents.itemCount === 0)}
          >
            {t("collection.appendToQueue")}
          </button>
          <button
            type="button"
            onClick={onAddCurrentQueue}
            disabled={busy || queueItems.length === 0 || queueTruncated}
            title={
              queueTruncated
                ? t("playlist.addCurrentQueueTruncated")
                : t("playlist.addCurrentQueueHint")
            }
          >
            {t("playlist.addCurrentQueue")}
          </button>
          <button
            type="button"
            onClick={() => onRenamePlaylist(selectedName)}
            disabled={busy}
          >
            {t("playlist.rename")}
          </button>
        </div>

        {contentsLoading ? (
          <div className="playlists-empty">
            <Loader2 size={14} className="playlists-spin" />
            {t("collection.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="playlists-empty">
            {t("playlist.emptyTitle")}
            <br />
            {t("playlist.emptyBody")}
          </div>
        ) : (
          <div
            className={
              viewMode === "tile" ? "playlists-track-tiles" : "track-tile-list"
            }
          >
            {items.map((item) => (
              <TrackTile
                key={`${item.uri}#${item.position}`}
                shape={viewMode === "tile" ? "card" : "row"}
                title={item.title ?? item.uri}
                artist={item.artist}
                album={item.album}
                artworkUrl={item.artworkUrl}
                placeholderIcon={<Music size={16} />}
                classical={showClassicalStrip ? item.classical : null}
                durationMs={item.durationMs}
                unavailable={item.available === false}
                textMode={textMode}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => onPlayTrackHere(item)}
                      disabled={busy || item.available === false}
                      aria-label={t("list.playFromHere")}
                      title={t("list.playFromHere")}
                    >
                      <Play size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEnqueueTrack(item)}
                      disabled={busy || item.available === false}
                      aria-label={t("collection.addToQueue")}
                      title={t("collection.addToQueue")}
                    >
                      <Plus size={14} />
                    </button>
                    <KebabMenu
                      disabled={busy}
                      items={[
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
                          disabled: item.position >= items.length - 1,
                          onSelect: () => onMoveDown(item, items.length)
                        },
                        {
                          id: "remove",
                          icon: <X size={14} />,
                          label: t("playlist.removeFromPlaylist"),
                          danger: true,
                          onSelect: () => onRemoveItem(item)
                        }
                      ]}
                    />
                  </>
                }
              />
            ))}
          </div>
        )}

        {dialogs}
      </div>
    );
  }

  // ----- landing view --------------------------------------------

  return (
    <div className="playlists-surface">
      <div className="playlists-surface-head">
        <div>
          <h2 className="playlists-surface-title">{t("nav.playlists")}</h2>
          <p className="playlists-surface-meta">
            {playlists.index === null
              ? playlists.connection.kind === "error"
                ? t("playlist.unreachable", {
                    reason:
                      playlists.connection.reason ?? t("collection.noDetail")
                  })
                : t("collection.loading")
              : tn("playlist.count", indexEntries.length)}
          </p>
        </div>
        <div className="playlists-head-actions">
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
            className="playlists-new-button"
            onClick={onCreatePlaylist}
            disabled={busy}
          >
            <Plus size={14} />
            {t("playlist.new")}
          </button>
        </div>
      </div>

      {feedbackBanner}

      {playlists.index === null ? (
        <div className="playlists-empty">
          {playlists.connection.kind === "error"
            ? t("collection.unavailable")
            : t("collection.loading")}
        </div>
      ) : indexEntries.length === 0 ? (
        <div className="playlists-empty">{t("playlist.noneYet")}</div>
      ) : (
        <div
          className={
            viewMode === "list"
              ? "playlists-card-grid playlists-card-grid-list"
              : "playlists-card-grid"
          }
        >
          {indexEntries.map((entry: PlaylistIndexEntry) => (
            <div
              key={entry.name}
              className="playlist-card"
              role="button"
              tabIndex={0}
              aria-label={entry.name}
              onClick={() => setSelectedName(entry.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedName(entry.name);
                }
              }}
            >
              <span
                className="playlist-card-cover"
                style={{ background: coverGradient(entry.name) }}
                aria-hidden="true"
              >
                <ListMusic size={18} />
              </span>
              <span className="playlist-card-meta">
                <span className="playlist-card-name">{entry.name}</span>
                <span className="playlist-card-count">
                  {formatTrackCount(entry.itemCount)}
                </span>
              </span>
              <span className="playlist-card-actions">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLoadToQueue(entry.name);
                  }}
                  disabled={busy || entry.itemCount === 0}
                  aria-label={t("collection.loadToQueue")}
                  title={t("collection.loadToQueue")}
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAppendToQueue(entry.name);
                  }}
                  disabled={busy || entry.itemCount === 0}
                  aria-label={t("collection.appendToQueue")}
                  title={t("collection.appendToQueue")}
                >
                  <Plus size={14} />
                </button>
                <span className="playlist-card-more">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuFor((cur) =>
                        cur === entry.name ? null : entry.name
                      );
                    }}
                    aria-label={t("playlist.moreActions")}
                    title={t("playlist.moreActions")}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === entry.name}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuFor === entry.name ? (
                    <>
                      <div
                        className="playlist-card-menu-backdrop"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor(null);
                        }}
                      />
                      <div className="playlist-card-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRenamePlaylist(entry.name);
                          }}
                          disabled={busy}
                        >
                          {t("playlist.rename")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="playlists-action-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeletePlaylist(entry.name);
                          }}
                          disabled={busy}
                        >
                          {t("playlist.delete")}
                        </button>
                      </div>
                    </>
                  ) : null}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {dialogs}
    </div>
  );
}
