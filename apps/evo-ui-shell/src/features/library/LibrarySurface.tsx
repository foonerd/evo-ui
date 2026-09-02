// LibrarySurface - music library browse view + source management.
//
// Top section: source rows with state badge + per-source actions
// (Wake / Probe / Update / Remove; Remove hidden on local-internal
// per the framework's non-removable-floor-source invariant).
//
// Bottom section: breadcrumb-driven browse of the currently
// selected source. Directory entries navigate; playlist entries
// load/append to the queue. Track-shaped results (file entries)
// render as ruled TrackTiles - toolbox: heart toggle +
// append-to-queue (queue.enqueue) + kebab (Play next / Add to
// playlist). Directory/playlist rows stay navigation rows
// (containers, not tracks) but adopt the icon-toolbox shape: two
// icon actions, no kebab (nothing left over). When the source is
// Offline, the browse returns stale:true + a stale banner is shown.

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  CalendarDays,
  ChevronRight,
  CornerDownRight,
  Disc3,
  Folder,
  FolderOpen,
  FolderTree,
  Heart,
  LayoutGrid,
  List,
  ListMusic,
  ListPlus,
  Loader2,
  Music,
  Play,
  Plus,
  RotateCw,
  Tags,
  User
} from "lucide-preact";
import { ConfirmDialog, PlaylistPickerDialog } from "../../components/dialogs";
import { TrackTile } from "../../components/TrackTile";
import { KebabMenu } from "../../components/KebabMenu";
import {
  ListTextModeControl,
  type ListTextModeOverride
} from "../../components/ListTextModeControl";
import type { TextOverflowMode } from "../../components/ScrollingText";
import { useLibrary } from "./useLibrary";
import { FacetTile } from "./FacetTile";
import { applyArtworkSize, readArtworkSize } from "./artwork-size";
import { useAudioQueue } from "../queue/useAudioQueue";
import type {
  Selection,
  EnqueueSelectionMode
} from "../queue/useAudioQueue";

/** Browse-tile queue intent; "now" maps to the plugin's atomic
 *  "replace" mode. */
type QueueMode = "now" | "next" | "append";
const toVerbMode = (m: QueueMode): EnqueueSelectionMode =>
  m === "now" ? "replace" : m;
import { useFavourites } from "../favourites/useFavourites";
import { usePlaylists } from "../playlist/usePlaylists";
import {
  formatSourceKind,
  formatSourceState,
  isRemovable,
  type BrowseLibraryResponse,
  type FacetBrowseResponse,
  type FacetKind,
  type LibraryEntry,
  type SourceRecord
} from "./library-decoders";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

type CollectionViewMode = "list" | "tile";

// Browse mode: the classic folder walk, or one of the framework's tag
// dimensions (library.browse_by_<facet>). Folder walks directories;
// the dimension modes list the distinct tag values, and selecting one
// drills to its tracks.
type BrowseMode = "folder" | FacetKind;

// Session cache of facet enumerations, keyed by `${sourceId}:${facet}`.
// Switching Artist/Album/Genre/Year tabs (or leaving and returning)
// reuses the last list instead of re-dispatching browse_by_* and
// re-running the MPD list + enrich roundtrips. Refresh forces a reload;
// a library scan should invalidate (handled by the caller).
const FACET_CACHE = new Map<string, FacetBrowseResponse>();

const BROWSE_MODES: { id: BrowseMode; icon: typeof Folder; labelKey: string }[] =
  [
    { id: "folder", icon: FolderTree, labelKey: "library.mode.folder" },
    { id: "artist", icon: User, labelKey: "library.mode.artist" },
    { id: "album", icon: Disc3, labelKey: "library.mode.album" },
    { id: "genre", icon: Tags, labelKey: "library.mode.genre" },
    { id: "year", icon: CalendarDays, labelKey: "library.mode.year" }
  ];

interface LibrarySurfaceProps {
  /** Optional: when set, the surface focuses on this source on
   *  mount. Default is local-internal. */
  defaultSourceId?: string;
  /** Fired once after a (changed) defaultSourceId has been focused, so the
   *  caller can clear its one-shot deep-link target (e.g. Sources ->
   *  "Open in Library"). */
  onDefaultSourceApplied?: () => void;
  /** Shared list-vs-tile mode, controlled centrally so the
   *  Appearance setting applies uniformly across Queue,
   *  Library, Favourites, Playlists, and Multi-room. */
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  /** Resolved boolean from Settings -> Appearance -> Classical
   *  metadata. False suppresses the strip regardless of tags. */
  showClassicalStrip: boolean;
  /** RESOLVED long-text mode for the track-shaped (file) tiles. */
  textMode: TextOverflowMode;
  /** Raw Aa override (ui.list.text_mode.browse). */
  textModeOverride: ListTextModeOverride;
  onTextModeOverrideChange: (mode: ListTextModeOverride) => void;
}

// Classify a browse failure so the notice can say "took too long"
// (DLNA ContentDirectory / SOAP timeouts are common on Jellyfin/Plex-
// class servers) rather than a flat "couldn't load". Matches the
// framework's Transient/deadline vocabulary case-insensitively.
function isTimeoutMessage(message: string): boolean {
  return /timeout|timed out|deadline|took too long|transient/i.test(message);
}

export function LibrarySurface({
  defaultSourceId,
  onDefaultSourceApplied,
  viewMode,
  onViewModeChange,
  showClassicalStrip,
  textMode,
  textModeOverride,
  onTextModeOverrideChange
}: LibrarySurfaceProps) {
  useLocale();
  const library = useLibrary();
  const audioQueue = useAudioQueue();
  const fav = useFavourites();
  const playlists = usePlaylists();
  const [addToPlaylistTarget, setAddToPlaylistTarget] =
    useState<LibraryEntry | null>(null);
  // Derive a fast lookup of which URIs are already favourited
  // from the live audio_favourites subject. Avoids one
  // is_favourite call per row.
  const favouriteUris = useMemo(() => {
    const set = new Set<string>();
    fav.state?.items.forEach((item) => set.add(item.uri));
    return set;
  }, [fav.state]);
  // Browse-tile enrichment (real title + artist + lazy cover art).
  // Default ON: the resolver is concurrency-safe (8-parallel gate) and
  // TrackTile lazy-loads, so only visible tiles fetch and same-album
  // tiles share one mpd-album URL - the original reason for gating it
  // off (fetch storm) no longer applies. Set localStorage
  // evo.ui.browseArtwork = "off" to fall back to filename-only tiles.
  const browseArtworkOn = useMemo(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("evo.ui.browseArtwork") !== "off";
    } catch {
      return true;
    }
  }, []);
  const [selectedSource, setSelectedSource] = useState<string>(
    defaultSourceId ?? "local-internal"
  );
  // Deep-link: when the caller sets a new defaultSourceId (e.g. Sources ->
  // "Open in Library" for a just-mounted NAS), focus it, then signal the
  // caller to clear its one-shot target so it does not stick.
  useEffect(() => {
    if (defaultSourceId) {
      setSelectedSource(defaultSourceId);
      onDefaultSourceApplied?.();
    }
    // defaultSourceId is the trigger; setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSourceId]);
  const [browseState, setBrowseState] = useState<BrowseLibraryResponse | null>(
    null
  );
  // A failed browse (media-server offline, or a SOAP ContentDirectory
  // timeout) must read as an honest error, NOT a perpetual "Loading" -
  // browseState stays null on failure, so without this the folder view
  // spins forever. `timeout` picks the "took too long" copy over the
  // generic failure copy.
  const [browseError, setBrowseError] = useState<
    { message: string; timeout: boolean } | null
  >(null);
  // DLNA navigation trail. A DLNA path is a single opaque ContentDirectory
  // object id per level, NOT a "/"-joined filesystem path, so crumbs can't
  // be derived by splitting the path (that shows the raw id and never
  // accumulates). Instead we push {name, objectId} as the operator drills
  // in, so the breadcrumb reads "Music / Family Music" and each crumb can
  // navigate back up. Reset when the source changes.
  const [dlnaTrail, setDlnaTrail] = useState<{ name: string; path: string }[]>(
    []
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>("");
  // Browse-by-dimension state. browseMode selects folder vs a tag
  // facet; facetState holds the facet value list; drill/drillTracks
  // hold the selected value and its resolved tracks (interim: via
  // search_library until the framework browse_by_* verbs accept a facet
  // selector and return the matching tracks directly).
  const [browseMode, setBrowseMode] = useState<BrowseMode>("folder");
  const [facetState, setFacetState] = useState<FacetBrowseResponse | null>(null);
  const [drill, setDrill] = useState<{ facet: FacetKind; value: string } | null>(
    null
  );
  const [drillTracks, setDrillTracks] = useState<LibraryEntry[] | null>(null);

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

  // Browse the selected source whenever it changes (or on mount).
  // Source change clears the path back to root for a clean entry
  // point - operators expect the source picker to reset the cursor.
  const browse = library.browse;
  const browseSource = useCallback(
    async (sourceId: string, path: string): Promise<void> => {
      const r = await browse(sourceId, path);
      if (r.ok) {
        setBrowseState(r.value);
        setBrowseError(null);
        setFeedback("");
      } else {
        setBrowseState(null);
        setBrowseError({ message: r.message, timeout: isTimeoutMessage(r.message) });
        setFeedback(r.message);
      }
    },
    [browse]
  );

  const loadMoreBrowse = useCallback(async (): Promise<void> => {
    if (browseState === null || browseState.nextPage === null) return;
    const r = await browse(
      selectedSource,
      browseState.path,
      browseState.nextPage
    );
    if (r.ok) {
      setBrowseState({
        ...r.value,
        entries: [...browseState.entries, ...r.value.entries]
      });
      setFeedback("");
    } else {
      setFeedback(r.message);
    }
  }, [browse, browseState, selectedSource]);

  const loadFacet = useCallback(
    async (
      facet: FacetKind,
      sourceId: string,
      force = false
    ): Promise<void> => {
      setDrill(null);
      setDrillTracks(null);
      const key = `${sourceId}:${facet}`;
      if (!force) {
        const cached = FACET_CACHE.get(key);
        if (cached !== undefined) {
          setFacetState(cached);
          setFeedback("");
          return;
        }
      }
      setFacetState(null);
      const r = await library.browseByDimension(facet, sourceId);
      if (r.ok) {
        FACET_CACHE.set(key, r.value);
        setFacetState(r.value);
        setFeedback("");
      } else {
        setFacetState(null);
        setFeedback(r.message);
      }
    },
    // library.browseByDimension is a stable useCallback; depending on
    // the whole `library` object (new each render) would loop the
    // effect below and thrash the list.
    [library.browseByDimension]
  );

  // Fetch on mode / source change. Folder mode walks the root; a
  // dimension mode loads its facet value list. Source change resets
  // both to a clean entry point.
  useEffect(() => {
    if (browseMode === "folder") {
      setFacetState(null);
      setDrill(null);
      setDrillTracks(null);
      void browseSource(selectedSource, "");
    } else {
      void loadFacet(browseMode, selectedSource);
    }
  }, [browseMode, selectedSource, browseSource, loadFacet]);

  // Drill a facet value to its tracks via the exact tag-scoped
  // browse_by_<facet> selector (BRW-1).
  const openDrill = useCallback(
    (facet: FacetKind, value: string) => {
      setDrill({ facet, value });
      setDrillTracks(null);
      void (async () => {
        const r = await library.drillDimension(facet, selectedSource, value);
        if (r.ok) {
          setDrillTracks(r.value);
          setFeedback("");
        } else {
          setDrillTracks([]);
          setFeedback(r.message);
        }
      })();
    },
    [library.drillDimension, selectedSource]
  );

  const clearDrill = useCallback(() => {
    setDrill(null);
    setDrillTracks(null);
  }, []);

  const sources = library.sources;
  const selected = useMemo(
    () => sources?.find((s) => s.id === selectedSource) ?? null,
    [sources, selectedSource]
  );

  // DLNA sources are ContentDirectory browse-only — tag facets
  // have no MPD substrate. Force folder mode when the operator
  // selects a network_dlna source.
  const isDlnaSource = selected?.kind === "network_dlna";

  useEffect(() => {
    if (isDlnaSource && browseMode !== "folder") {
      setBrowseMode("folder");
    }
  }, [isDlnaSource, browseMode]);

  // Derived: breadcrumb segments from the current browse path.
  // The framework's browse uses "/"-joined paths; root is the
  // empty string. Each crumb is a clickable navigation back up
  // the tree.
  const crumbs = useMemo(() => {
    const path = browseState?.path ?? "";
    if (path === "") return [];
    return path.split("/").reduce<{ name: string; path: string }[]>(
      (acc, segment) => {
        const prev = acc[acc.length - 1]?.path ?? "";
        const combined = prev === "" ? segment : `${prev}/${segment}`;
        acc.push({ name: segment, path: combined });
        return acc;
      },
      []
    );
  }, [browseState?.path]);

  // A new source starts at root with an empty trail.
  useEffect(() => {
    setDlnaTrail([]);
  }, [selectedSource]);

  const onNavigateEntry = useCallback(
    (entry: LibraryEntry) => {
      if (entry.kind === "directory") {
        if (isDlnaSource) {
          setDlnaTrail((prev) => [
            ...prev,
            { name: entry.name, path: entry.uri }
          ]);
        }
        void browseSource(selectedSource, entry.uri);
      }
    },
    [browseSource, selectedSource, isDlnaSource]
  );

  // Crumbs shown in the breadcrumb: for DLNA the name trail; for local /
  // NAS the "/"-split path. Navigating a DLNA crumb truncates the trail
  // to that level (step back up); the root crumb clears it.
  const displayCrumbs = isDlnaSource ? dlnaTrail : crumbs;
  const onCrumbNavigate = useCallback(
    (idx: number, path: string) => {
      if (isDlnaSource) {
        setDlnaTrail((prev) => prev.slice(0, idx + 1));
      }
      void browseSource(selectedSource, path);
    },
    [isDlnaSource, browseSource, selectedSource]
  );

  const onPlaylistEntry = useCallback(
    (entry: LibraryEntry, replace: boolean) => {
      if (entry.kind !== "playlist") return;
      void runAction(
        replace ? t("queue.loadAction") : t("queue.appendAction"),
        () =>
          replace
            ? audioQueue.loadPlaylist(entry.name)
            : audioQueue.appendPlaylist(entry.name)
      );
    },
    [audioQueue, runAction]
  );

  const onEnqueueFile = useCallback(
    (entry: LibraryEntry, top: boolean) => {
      if (entry.kind !== "file") return;
      const currentPosition = audioQueue.queue?.currentPosition ?? null;
      const position =
        top && currentPosition !== null ? currentPosition + 1 : undefined;
      void runAction(
        top ? t("collection.playNext") : t("collection.addToQueue"),
        () => audioQueue.enqueue([entry.uri], position)
      );
    },
    [audioQueue, runAction]
  );


  // ---- Unified queue / playlist actions (criteria-based) --------
  // One action set over any selection. The plugin's multi-dimensional
  // verbs (queue.enqueue_selection / playlist.save_selection) resolve
  // the criteria to tracks server-side (MPD findadd/searchadd) and
  // apply the mode in one roundtrip - no URI list crosses the wire, so
  // it scales to any library size. Zero-match returns an explicit empty
  // and leaves the queue untouched.
  const facetSelection = useCallback(
    (facet: FacetKind, value: string, artist?: string | null): Selection => {
      const sel: Selection = { dimension: facet, value };
      if (
        facet === "album" &&
        artist !== undefined &&
        artist !== null &&
        artist.length > 0
      ) {
        sel.parent = { tag: "albumartist", value: artist };
      }
      return sel;
    },
    []
  );

  const onFacetQueue = useCallback(
    (
      facet: FacetKind,
      value: string,
      mode: QueueMode,
      artist?: string | null
    ) => {
      void runAction(value, () =>
        audioQueue.enqueueSelection(
          facetSelection(facet, value, artist),
          toVerbMode(mode)
        )
      );
    },
    [audioQueue, runAction, facetSelection]
  );

  const onFacetSave = useCallback(
    (facet: FacetKind, value: string, artist?: string | null) => {
      void runAction(t("library.saveAsPlaylistName", { name: value }), () =>
        playlists.saveSelection(
          value,
          facetSelection(facet, value, artist),
          "create"
        )
      );
    },
    [playlists, runAction, facetSelection]
  );

  const onDirectoryQueue = useCallback(
    (entry: LibraryEntry, mode: QueueMode) => {
      if (entry.kind !== "directory") return;
      void runAction(entry.name, () =>
        audioQueue.enqueueSelection(
          { dimension: "folder", value: entry.uri },
          toVerbMode(mode)
        )
      );
    },
    [audioQueue, runAction]
  );

  // Folder-level queue actions for a DLNA MediaServer container. A
  // network container has no MPD folder substrate, so it can't use the
  // `folder` Criteria path above; it resolves server-side page by page
  // via enqueueContainer. entry.uri is the container's stable dlna: id.
  const onDlnaContainerQueue = useCallback(
    (entry: LibraryEntry, mode: QueueMode) => {
      if (entry.kind !== "directory") return;
      void runAction(entry.name, () =>
        audioQueue.enqueueContainer(selectedSource, entry.uri, toVerbMode(mode))
      );
    },
    [audioQueue, runAction, selectedSource]
  );

  // Save a DLNA container as a stored playlist of stable dlna: ids
  // (paged server-side). Named from the container's display name.
  const onDlnaContainerSave = useCallback(
    (entry: LibraryEntry) => {
      if (entry.kind !== "directory") return;
      void runAction(
        t("library.saveAsPlaylistName", { name: entry.name }),
        () =>
          playlists.saveSelectionContainer(
            entry.name,
            selectedSource,
            entry.uri,
            "create"
          )
      );
    },
    [playlists, runAction, selectedSource]
  );

  // Save a folder as a stored playlist. The plugin resolves the
  // folder dimension to the directory path and MPD's playlistadd
  // expands it recursively - no URI list on the wire. The playlist
  // is named from the folder's DISPLAY name (entry.name), never its
  // URI: the framework's validate_playlist_name refuses the "/" that
  // every folder URI carries.
  const onDirectorySave = useCallback(
    (entry: LibraryEntry) => {
      if (entry.kind !== "directory") return;
      void runAction(
        t("library.saveAsPlaylistName", { name: entry.name }),
        () =>
          playlists.saveSelection(
            entry.name,
            { dimension: "folder", value: entry.uri },
            "create"
          )
      );
    },
    [playlists, runAction]
  );

  const onToggleFavourite = useCallback(
    (entry: LibraryEntry) => {
      const isFav = favouriteUris.has(entry.uri);
      void runAction(
        isFav
          ? t("collection.removeFromFavourites")
          : t("collection.addToFavourites"),
        () =>
          isFav
            ? fav.removeFavourite(entry.uri)
            : fav.addFavourite(entry.uri)
      );
    },
    [fav, favouriteUris, runAction]
  );

  const onWakeSource = useCallback(
    (source: SourceRecord) => {
      void runAction(t("library.wakeAction", { name: source.displayName }), async () => {
        const r = await library.wakeSource(source.id);
        if (r.ok) return { ok: true };
        return { ok: false, message: r.message };
      });
    },
    [library, runAction]
  );

  const onProbeSource = useCallback(
    (source: SourceRecord) => {
      void runAction(t("library.probeAction", { name: source.displayName }), async () => {
        const r = await library.probeSource(source.id);
        if (r.ok) return { ok: true };
        return { ok: false, message: r.message };
      });
    },
    [library, runAction]
  );

  const onUpdateSource = useCallback(
    (source: SourceRecord) => {
      void runAction(t("library.rescanAction", { name: source.displayName }), async () => {
        const r = await library.updateSource(source.id);
        if (r.ok) return { ok: true };
        return { ok: false, message: r.message };
      });
    },
    [library, runAction]
  );

  const [removeTarget, setRemoveTarget] = useState<SourceRecord | null>(null);
  const onRemoveSource = useCallback(
    (source: SourceRecord) => {
      setRemoveTarget(source);
    },
    []
  );

  const onRefresh = useCallback(() => {
    if (browseMode === "folder") {
      void browseSource(selectedSource, browseState?.path ?? "");
    } else if (drill !== null) {
      openDrill(drill.facet, drill.value);
    } else {
      FACET_CACHE.delete(`${selectedSource}:${browseMode}`);
      void loadFacet(browseMode, selectedSource, true);
    }
  }, [
    browseMode,
    browseSource,
    selectedSource,
    browseState?.path,
    drill,
    openDrill,
    loadFacet
  ]);

  // The library browse is a file-tree walker: directories and the
  // tracks inside them. Stored playlists surface here only because
  // MPD lists them at the music root, but they are dead ends in the
  // browse (no drill path) AND they have dedicated, drillable homes -
  // the Favourites and Playlists surfaces. So drop playlist-kind
  // entries. Also hide any "__"-prefixed name: that is the framework's
  // internal-store convention (e.g. the __favourites__ playlist that
  // backs the heart feature) and must never be a user-facing tile.
  const visibleEntries = useMemo(
    () =>
      (browseState?.entries ?? []).filter(
        (entry) => entry.kind !== "playlist" && !entry.name.startsWith("__")
      ),
    [browseState?.entries]
  );

  // Track-shaped tile - shared by the folder file rows and the
  // dimension-drill track results so both look and behave identically
  // (artwork, favourite toggle, enqueue, kebab).
  const renderFileTile = (entry: LibraryEntry) => {
    const isFav = favouriteUris.has(entry.uri);
    return (
      <TrackTile
        key={`file:${entry.uri}`}
        shape={viewMode === "tile" ? "card" : "row"}
        title={browseArtworkOn ? entry.title ?? entry.name : entry.name}
        artist={browseArtworkOn ? entry.artist : null}
        album={browseArtworkOn ? entry.album : null}
        artworkUrl={browseArtworkOn ? entry.artworkUrl : null}
        placeholderIcon={<Music size={16} />}
        classical={showClassicalStrip ? entry.classical : null}
        textMode={textMode}
        actions={
          <>
            <button
              type="button"
              className={
                isFav ? "track-tile-fav track-tile-action-on" : "track-tile-fav"
              }
              onClick={() => onToggleFavourite(entry)}
              disabled={busy}
              aria-pressed={isFav}
              aria-label={
                isFav
                  ? t("collection.removeFromFavourites")
                  : t("collection.addToFavourites")
              }
              title={
                isFav
                  ? t("collection.removeFromFavourites")
                  : t("collection.addToFavourites")
              }
            >
              <Heart size={14} fill={isFav ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => onEnqueueFile(entry, false)}
              disabled={busy}
              aria-label={t("collection.addToQueue")}
              title={t("library.fileAddTitle")}
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
                  onSelect: () => onEnqueueFile(entry, true)
                },
                {
                  id: "add-to-playlist",
                  icon: <ListPlus size={14} />,
                  label: t("collection.addToPlaylist"),
                  onSelect: () => setAddToPlaylistTarget(entry)
                }
              ]}
            />
          </>
        }
      />
    );
  };

  // ----- render ----------------------------------------------------

  return (
    <div className="library-surface">
      <div className="library-surface-head">
        <div>
          <h2 className="library-surface-title">{t("library.title")}</h2>
          <p className="library-surface-meta">
            {library.connection.kind === "reconnecting"
              ? t("library.reconnecting")
              : sources === null
                ? library.connection.kind === "error"
                  ? t("library.unreachable", {
                      reason:
                        library.connection.reason ?? t("collection.noDetail")
                    })
                  : t("library.loadingSources")
                : sources.length === 0
                  ? t("library.noAdmitted")
                  : t(
                      sources.length === 1
                        ? "library.sourceCount.one"
                        : "library.sourceCount.many",
                      { n: sources.length }
                    )}
          </p>
        </div>
        <div className="library-head-actions">
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
            className="library-refresh"
            onClick={onRefresh}
            aria-label={t("library.refreshAria")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={16} className="library-spin" />
            ) : (
              <RotateCw size={16} />
            )}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className="library-feedback" role="status">
          {feedback}
        </div>
      ) : null}

      <section className="library-sources">
        {sources === null ? null : sources.length === 0 ? (
          <div className="library-empty">{t("library.noneAdmittedYet")}</div>
        ) : (
          sources.map((source) => (
            <div
              key={source.id}
              className={
                source.id === selectedSource
                  ? "library-source-row library-source-selected"
                  : "library-source-row"
              }
            >
              <button
                type="button"
                className="library-source-info"
                onClick={() => setSelectedSource(source.id)}
              >
                <div className="library-source-name">
                  <span>{source.displayName}</span>
                  <span
                    className={
                      "library-state-badge library-state-" + source.state
                    }
                  >
                    {formatSourceState(source.state)}
                  </span>
                </div>
                <div className="library-source-meta">
                  <span className="library-kind-chip">
                    {formatSourceKind(source.kind)}
                  </span>
                  {/* A media server (DLNA) has no filesystem mount and no
                      scanned track count - showing "0 of 0 tracks" or a
                      mount path is meaningless. Local/NAS sources keep both. */}
                  {source.kind !== "network_dlna" ? (
                    <>
                      <span className="library-meta-sep">-</span>
                      <span>{source.mountPath}</span>
                      <span className="library-meta-sep">-</span>
                      {(() => {
                        // While a scan is in flight for this source, show
                        // the live "Indexing N of M" from the scan-progress
                        // subject; the count settles on its own (sources
                        // republish) when the scan completes - no reload.
                        const sp = library.scanProgress[source.id];
                        if (sp !== undefined && sp.phase === "scanning") {
                          return (
                            <span className="library-scanning">
                              {sp.estimatedTotal !== null
                                ? t("library.indexingOf", {
                                    scanned: sp.scannedTracks.toLocaleString(),
                                    total: sp.estimatedTotal.toLocaleString()
                                  })
                                : t("library.indexing", {
                                    scanned: sp.scannedTracks.toLocaleString()
                                  })}
                            </span>
                          );
                        }
                        return (
                          <span>
                            {t("library.tracksOfTotal", {
                              available:
                                source.trackCountAvailable.toLocaleString(),
                              total: source.trackCount.toLocaleString()
                            })}
                          </span>
                        );
                      })()}
                    </>
                  ) : null}
                </div>
              </button>
              <div className="library-source-actions">
                {/* Wake and Rescan are local-library recovery/scan actions.
                    A DLNA MediaServer indexes itself and is browsed live over
                    ContentDirectory - there is nothing to wake or scan, and
                    "rescan" routes through MPD and errors. Offer neither for
                    network_dlna; Probe (re-check reachability) + Remove stay. */}
                {source.state === "offline" && source.kind !== "network_dlna" ? (
                  <button
                    type="button"
                    className="library-action-primary"
                    onClick={() => onWakeSource(source)}
                    disabled={busy}
                  >
                    {t("library.wake")}
                  </button>
                ) : null}
                {source.kind !== "network_dlna" ? (
                  <button
                    type="button"
                    onClick={() => onUpdateSource(source)}
                    disabled={busy || source.state === "offline"}
                    title={
                      source.state === "offline"
                        ? t("library.updateRefusedOffline")
                        : t("library.rescanTitle")
                    }
                  >
                    {t("library.rescan")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onProbeSource(source)}
                  disabled={busy}
                >
                  {t("library.probe")}
                </button>
                {isRemovable(source.kind) ? (
                  <button
                    type="button"
                    className="library-action-danger"
                    onClick={() => onRemoveSource(source)}
                    disabled={busy}
                  >
                    {t("library.remove")}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      <div className="library-browse">
        <div
          className="library-browse-modes"
          role="group"
          aria-label={t("library.browseBy")}
        >
          {(isDlnaSource
            ? BROWSE_MODES.filter((m) => m.id === "folder")
            : BROWSE_MODES
          ).map((m) => {
            const Icon = m.icon;
            const active = browseMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className={
                  active
                    ? "library-mode-btn library-mode-active"
                    : "library-mode-btn"
                }
                onClick={() => setBrowseMode(m.id)}
                aria-pressed={active}
                title={t(m.labelKey as never)}
              >
                <Icon size={14} />
                <span>{t(m.labelKey as never)}</span>
              </button>
            );
          })}
        </div>

        <div className="library-breadcrumb">
          <span className="library-breadcrumb-label">{t("library.browsing")}</span>
          <button
            type="button"
            className="library-crumb"
            onClick={() => {
              if (browseMode === "folder") {
                if (isDlnaSource) setDlnaTrail([]);
                void browseSource(selectedSource, "");
              } else clearDrill();
            }}
            disabled={busy}
          >
            {selected?.displayName ?? selectedSource}
          </button>
          {browseMode === "folder"
            ? displayCrumbs.map((c, idx) => (
                <span key={`${c.path}-${idx}`} className="library-crumb-wrap">
                  <ChevronRight size={12} className="library-crumb-sep" />
                  {idx === displayCrumbs.length - 1 ? (
                    <span className="library-crumb-current">{c.name}</span>
                  ) : (
                    <button
                      type="button"
                      className="library-crumb"
                      onClick={() => onCrumbNavigate(idx, c.path)}
                      disabled={busy}
                    >
                      {c.name}
                    </button>
                  )}
                </span>
              ))
            : (
              <span className="library-crumb-wrap">
                <ChevronRight size={12} className="library-crumb-sep" />
                {drill === null ? (
                  <span className="library-crumb-current">
                    {t(`library.mode.${browseMode}` as never)}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="library-crumb"
                      onClick={clearDrill}
                      disabled={busy}
                    >
                      {t(`library.mode.${browseMode}` as never)}
                    </button>
                    <ChevronRight size={12} className="library-crumb-sep" />
                    <span className="library-crumb-current">{drill.value}</span>
                  </>
                )}
              </span>
            )}
        </div>

        {isDlnaSource ? (
          <p className="library-source-note">{t("library.mediaServerNote")}</p>
        ) : null}

        {browseMode !== "folder" ? (
          drill !== null ? (
            drillTracks === null ? (
              <div className="library-empty">{t("collection.loading")}</div>
            ) : drillTracks.length === 0 ? (
              <div className="library-empty">{t("library.drillEmpty")}</div>
            ) : (
              <>
                <div className="library-drill-actions">
                  <button
                    type="button"
                    className="library-drill-action"
                    disabled={busy}
                    onClick={() =>
                      onFacetQueue(drill.facet, drill.value, "now")
                    }
                  >
                    <Play size={14} /> {t("collection.playNow")}
                  </button>
                  <button
                    type="button"
                    className="library-drill-action"
                    disabled={busy}
                    onClick={() =>
                      onFacetQueue(drill.facet, drill.value, "append")
                    }
                  >
                    <ListPlus size={14} /> {t("collection.addToQueue")}
                  </button>
                  <button
                    type="button"
                    className="library-drill-action"
                    disabled={busy}
                    onClick={() => onFacetSave(drill.facet, drill.value)}
                  >
                    <ListMusic size={14} /> {t("collection.saveAsPlaylist")}
                  </button>
                </div>
                <div
                  className={
                    viewMode === "tile"
                      ? "library-entries library-entries-tile"
                      : "library-entries"
                  }
                >
                  {drillTracks.map((entry) => renderFileTile(entry))}
                </div>
              </>
            )
          ) : facetState === null ? (
            <div className="library-empty">{t("collection.loading")}</div>
          ) : facetState.entries.length === 0 ? (
            <div className="library-empty">{t("library.emptyDir")}</div>
          ) : (
            <div
              className={
                viewMode === "tile"
                  ? "library-entries library-entries-tile"
                  : "library-entries"
              }
            >
              {facetState.entries.map((entry) => (
                <FacetTile
                  key={`${browseMode}:${entry.value}`}
                  facet={browseMode as FacetKind}
                  entry={entry}
                  viewMode={viewMode}
                  busy={busy}
                  onOpen={() => openDrill(browseMode as FacetKind, entry.value)}
                  onQueue={(mode) =>
                    onFacetQueue(
                      browseMode as FacetKind,
                      entry.value,
                      mode,
                      entry.artist
                    )
                  }
                  onSave={() =>
                    onFacetSave(
                      browseMode as FacetKind,
                      entry.value,
                      entry.artist
                    )
                  }
                />
              ))}
            </div>
          )
        ) : browseState?.stale === true ? (
          <div className="library-stale-banner">
            <strong>{t("library.staleTitle")}</strong> {t("library.staleBody")}
          </div>
        ) : null}

        {browseMode === "folder" ? (
          browseError !== null ? (
          <div className="library-empty library-notice-error">
            {browseError.timeout
              ? t("library.browseTimeout")
              : t("library.browseFailed")}
          </div>
        ) : browseState === null ? (
          <div className="library-empty">{t("collection.loading")}</div>
        ) : visibleEntries.length === 0 ? (
          <div className="library-empty">
            {selected?.state === "probing"
              ? t("library.probing")
              : selected?.state === "offline"
              ? t("library.sourceOffline")
              : t("library.emptyDir")}
          </div>
        ) : (
          <div
            className={
              viewMode === "tile"
                ? "library-entries library-entries-tile"
                : "library-entries"
            }
          >
            {visibleEntries.map((entry) => {
              // Track-shaped results render THE tile; directories
              // and playlists stay navigation rows (containers) and
              // only adopt the icon-toolbox shape.
              if (entry.kind === "file") {
                return renderFileTile(entry);
              }
              if (entry.kind === "directory") {
                // Cover-forward folder tile: the folder's own art via
                // the mpd-directory cover_url, folder glyph as fallback.
                // DLNA containers are browse-only (no MPD folder
                // queue substrate) — open-only actions.
                return (
                  <TrackTile
                    key={`dir:${entry.uri}`}
                    shape={viewMode === "tile" ? "card" : "row"}
                    title={entry.name}
                    artworkUrl={
                      entry.coverUrl !== null
                        ? applyArtworkSize(entry.coverUrl, readArtworkSize())
                        : null
                    }
                    placeholderIcon={<FolderOpen size={16} />}
                    textMode={textMode}
                    onPrimaryAction={() => onNavigateEntry(entry)}
                    primaryActionLabel={t("library.dirOpen", { name: entry.name })}
                    primaryActionTitle={t("library.dirOpen", { name: entry.name })}
                    actions={
                      isDlnaSource ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onDlnaContainerQueue(entry, "now")}
                          disabled={busy}
                          aria-label={t("collection.playNow")}
                          title={t("collection.playNow")}
                        >
                          <Play size={14} />
                        </button>
                        <KebabMenu
                          disabled={busy}
                          items={[
                            {
                              id: "play-next",
                              icon: <CornerDownRight size={14} />,
                              label: t("collection.playNext"),
                              onSelect: () => onDlnaContainerQueue(entry, "next")
                            },
                            {
                              id: "add-queue",
                              icon: <ListPlus size={14} />,
                              label: t("collection.addToQueue"),
                              onSelect: () => onDlnaContainerQueue(entry, "append")
                            },
                            {
                              id: "save-playlist",
                              icon: <ListMusic size={14} />,
                              label: t("collection.saveAsPlaylist"),
                              onSelect: () => onDlnaContainerSave(entry)
                            }
                          ]}
                        />
                      </>
                      ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onDirectoryQueue(entry, "now")}
                          disabled={busy}
                          aria-label={t("collection.playNow")}
                          title={t("collection.playNow")}
                        >
                          <Play size={14} />
                        </button>
                        <KebabMenu
                          disabled={busy}
                          items={[
                            {
                              id: "play-next",
                              icon: <CornerDownRight size={14} />,
                              label: t("collection.playNext"),
                              onSelect: () => onDirectoryQueue(entry, "next")
                            },
                            {
                              id: "add-queue",
                              icon: <ListPlus size={14} />,
                              label: t("collection.addToQueue"),
                              onSelect: () => onDirectoryQueue(entry, "append")
                            },
                            {
                              id: "save-playlist",
                              icon: <ListMusic size={14} />,
                              label: t("collection.saveAsPlaylist"),
                              onSelect: () => onDirectorySave(entry)
                            }
                          ]}
                        />
                      </>
                      )
                    }
                  />
                );
              }
              // Playlist (normally filtered from visibleEntries).
              return (
                <div
                  key={`${entry.kind}:${entry.uri}`}
                  className={
                    (viewMode === "tile"
                      ? "library-entry library-entry-tile"
                      : "library-entry") +
                    " library-entry-" +
                    entry.kind
                  }
                >
                  <button
                    type="button"
                    className="library-entry-name"
                    onClick={() => onNavigateEntry(entry)}
                    disabled
                  >
                    <ListMusic size={16} />
                    <span>{entry.name}</span>
                  </button>
                  <div className="library-entry-actions">
                    <button
                      type="button"
                      onClick={() => onPlaylistEntry(entry, true)}
                      disabled={busy}
                      aria-label={t("collection.loadToQueue")}
                      title={t("library.plLoadTitle")}
                    >
                      <Play size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPlaylistEntry(entry, false)}
                      disabled={busy}
                      aria-label={t("collection.appendToQueue")}
                      title={t("library.plAppendTitle")}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          )
        ) : null}
        {browseMode === "folder" &&
        browseState !== null &&
        browseState.nextPage !== null ? (
          <div className="library-load-more">
            <button
              type="button"
              onClick={() => void loadMoreBrowse()}
              disabled={busy}
            >
              {t("library.loadMore")}
            </button>
          </div>
        ) : null}
      </div>

      {addToPlaylistTarget !== null ? (
        <PlaylistPickerDialog
          title={t("collection.addToPlaylist")}
          hint={t("collection.appendHint", { name: addToPlaylistTarget.name })}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("dialog.add")}
          onCancel={() => setAddToPlaylistTarget(null)}
          onConfirm={(name) => {
            const target = addToPlaylistTarget;
            setAddToPlaylistTarget(null);
            void runAction(
              t("library.addToNamed", { item: target.name, playlist: name }),
              async () => {
              const r = await playlists.addToPlaylist(name, [target.uri]);
              if (r.ok) return { ok: true };
              return { ok: false, message: r.message };
            });
          }}
        />
      ) : null}

      {removeTarget !== null ? (
        <ConfirmDialog
          title={t("library.removeSourceTitle")}
          message={t("library.removeSourceMessage", {
            name: removeTarget.displayName
          })}
          confirmLabel={t("library.remove")}
          destructive
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => {
            const target = removeTarget;
            setRemoveTarget(null);
            void runAction(
              t("library.removeAction", { name: target.displayName }),
              async () => {
              const r = await library.removeSource(target.id);
              if (r.ok) return { ok: true };
              return { ok: false, message: r.message };
            });
          }}
        />
      ) : null}
    </div>
  );
}
