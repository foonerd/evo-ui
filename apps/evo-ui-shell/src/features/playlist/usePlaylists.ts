// usePlaylists - read-then-subscribe for audio.playlist's index +
// typed callbacks for every verb. The detail (playlist contents)
// is fetched on demand via getPlaylist and not held in hook
// state - the surface owns the selected-playlist cursor.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import {
  connectWithRetry,
  MAX_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry";
import { t } from "../../runtime/i18n";
import type { Selection } from "../queue/useAudioQueue";
import {
  decodePlaylistContents,
  decodePlaylistIndex,
  decodePlaylistIndexHappening,
  filterFavouritesOut,
  type PlaylistContents,
  type PlaylistIndex
} from "./playlist-decoders";

const PLAYLIST_SHELF = "audio.playlist";
const PAYLOAD_VERSION = 1;

export type PlaylistsConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface PlaylistsConnectionState {
  kind: PlaylistsConnectionKind;
  reason?: string;
  attempt?: number;
}

export type PlaylistVerbResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export interface UsePlaylistsState {
  connection: PlaylistsConnectionState;
  /** Latest decoded index with the favourites pseudo-playlist
   *  filtered out (so the UI never tries to manage it from here). */
  index: PlaylistIndex | null;
  listPlaylists: () => Promise<PlaylistVerbResult<PlaylistIndex>>;
  getPlaylist: (
    name: string
  ) => Promise<PlaylistVerbResult<PlaylistContents>>;
  createPlaylist: (name: string) => Promise<PlaylistVerbResult>;
  deletePlaylist: (name: string) => Promise<PlaylistVerbResult>;
  renamePlaylist: (
    fromName: string,
    toName: string
  ) => Promise<PlaylistVerbResult>;
  addToPlaylist: (
    playlistName: string,
    uris: string[]
  ) => Promise<PlaylistVerbResult>;
  /** Save a browse selection to a stored playlist server-side (the
   *  plugin resolves the criteria to tracks). No URI list on the wire. */
  saveSelection: (
    playlistName: string,
    selection: Selection,
    mode: "create" | "append"
  ) => Promise<PlaylistVerbResult>;
  /** Save a network container (DLNA folder) as a stored playlist of
   *  stable dlna: identities; paged like the queue's enqueueContainer. */
  saveSelectionContainer: (
    playlistName: string,
    sourceId: string,
    uri: string,
    mode: "create" | "append"
  ) => Promise<PlaylistVerbResult>;
  removeFromPlaylist: (
    playlistName: string,
    position: number
  ) => Promise<PlaylistVerbResult>;
  moveInPlaylist: (
    playlistName: string,
    fromPosition: number,
    toPosition: number
  ) => Promise<PlaylistVerbResult>;
}

function frameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const message = rec["message"];
    if (typeof message === "string" && message.length > 0) return message;
    const subclass = rec["subclass"];
    if (typeof subclass === "string" && subclass.length > 0) {
      return t("collection.frameworkRefused", { subclass });
    }
  }
  return t("playlist.refusedCommand");
}

export function usePlaylists(): UsePlaylistsState {
  const [connection, setConnection] = useState<PlaylistsConnectionState>({
    kind: "connecting"
  });
  const [index, setIndex] = useState<PlaylistIndex | null>(null);
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: t("collection.wsUnavailable") });
      return;
    }
    let cancelled = false;
    const transport = new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    setConnection({ kind: "connecting" });

    const seed = async (): Promise<void> => {
      try {
        await connectWithRetry(
          transport,
          (attempt) => {
            if (!cancelled) setConnection({ kind: "connecting", attempt });
          },
          () => cancelled
        );
        if (cancelled) return;
        setConnection({ kind: "connected" });

        const initial = await pluginRequest(
          transport,
          PLAYLIST_SHELF,
          "playlist.list_playlists",
          { v: PAYLOAD_VERSION }
        );
        if (!cancelled && initial.error === undefined) {
          const decoded = decodePlaylistIndex(initial.value);
          if (decoded !== null) setIndex(filterFavouritesOut(decoded));
        }
        if (cancelled) return;

        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          const decoded = decodePlaylistIndexHappening(raw);
          if (decoded !== null) setIndex(filterFavouritesOut(decoded));
        };
        const subAbort = new AbortController();
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: subAbort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              handleHappening(event);
            }
          } catch {
            // Subscription ended; reconnect re-establishes.
          }
        })();
        transport.onHappening((f) => handleHappening(f.happening));
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({
          kind: "error",
          reason:
            t("playlist.noResponse", { n: MAX_CONNECT_ATTEMPTS, detail })
        });
      }
    };
    void seed();

    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
    };
  }, []);

  const dispatchVoid = useCallback(
    async (
      requestType: string,
      envelope: Record<string, unknown>
    ): Promise<PlaylistVerbResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("playlist.notConnected") };
      }
      const result = await pluginRequest(
        transport,
        PLAYLIST_SHELF,
        requestType,
        { v: PAYLOAD_VERSION, ...envelope }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      return { ok: true, value: undefined };
    },
    []
  );

  const listPlaylists = useCallback(async (): Promise<
    PlaylistVerbResult<PlaylistIndex>
  > => {
    const transport = transportRef.current;
    if (transport === null) {
      return { ok: false, message: t("playlist.notConnected") };
    }
    const result = await pluginRequest(
      transport,
      PLAYLIST_SHELF,
      "playlist.list_playlists",
      { v: PAYLOAD_VERSION }
    );
    if (result.error !== undefined) {
      return { ok: false, message: errorMessage(result.error) };
    }
    const decoded = decodePlaylistIndex(result.value);
    if (decoded === null) {
      return {
        ok: false,
        message: t("playlist.unrecognisedList")
      };
    }
    const filtered = filterFavouritesOut(decoded);
    setIndex(filtered);
    return { ok: true, value: filtered };
  }, []);

  const getPlaylist = useCallback(
    async (name: string): Promise<PlaylistVerbResult<PlaylistContents>> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("playlist.notConnected") };
      }
      const result = await pluginRequest(
        transport,
        PLAYLIST_SHELF,
        "playlist.get_playlist",
        { v: PAYLOAD_VERSION, name }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const decoded = decodePlaylistContents(result.value);
      if (decoded === null) {
        return {
          ok: false,
          message: t("playlist.unrecognisedGet")
        };
      }
      return { ok: true, value: decoded };
    },
    []
  );

  const createPlaylist = useCallback(
    (name: string) => dispatchVoid("playlist.create_playlist", { name }),
    [dispatchVoid]
  );
  const deletePlaylist = useCallback(
    (name: string) => dispatchVoid("playlist.delete_playlist", { name }),
    [dispatchVoid]
  );
  const renamePlaylist = useCallback(
    (fromName: string, toName: string) =>
      dispatchVoid("playlist.rename_playlist", {
        from_name: fromName,
        to_name: toName
      }),
    [dispatchVoid]
  );
  const addToPlaylist = useCallback(
    (playlistName: string, uris: string[]) =>
      dispatchVoid("playlist.add_to_playlist", {
        playlist_name: playlistName,
        uris
      }),
    [dispatchVoid]
  );
  const saveSelection = useCallback(
    (
      playlistName: string,
      selection: Selection,
      mode: "create" | "append"
    ) =>
      dispatchVoid("playlist.save_selection", {
        playlist_name: playlistName,
        selection,
        mode
      }),
    [dispatchVoid]
  );
  // Save a network container (DLNA MediaServer folder) as a stored
  // playlist, storing the stable dlna: identities. Mirrors the queue's
  // enqueueContainer: the device resolves the container page by page
  // (never unbounded), so the UI drives next_page; the first page carries
  // the mode (create), the rest append into the same playlist.
  const saveSelectionContainer = useCallback(
    async (
      playlistName: string,
      sourceId: string,
      uri: string,
      mode: "create" | "append"
    ): Promise<PlaylistVerbResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("playlist.notConnected") };
      }
      const selection = { kind: "container", uri };
      let page = 0;
      for (let guard = 0; guard < 500; guard++) {
        const result = await pluginRequest(transport, PLAYLIST_SHELF, "playlist.save_selection", {
          v: PAYLOAD_VERSION,
          source_id: sourceId,
          playlist_name: playlistName,
          selection,
          mode: page === 0 ? mode : "append",
          page
        });
        if (result.error !== undefined) {
          return { ok: false, message: errorMessage(result.error) };
        }
        const val = (result.value ?? {}) as Record<string, unknown>;
        const next = val["next_page"];
        if (typeof next === "number") {
          page = next;
        } else {
          return { ok: true, value: undefined };
        }
      }
      return { ok: true, value: undefined };
    },
    []
  );
  const removeFromPlaylist = useCallback(
    (playlistName: string, position: number) =>
      dispatchVoid("playlist.remove_from_playlist", {
        playlist_name: playlistName,
        position
      }),
    [dispatchVoid]
  );
  const moveInPlaylist = useCallback(
    (playlistName: string, fromPosition: number, toPosition: number) =>
      dispatchVoid("playlist.move_in_playlist", {
        playlist_name: playlistName,
        from_position: fromPosition,
        to_position: toPosition
      }),
    [dispatchVoid]
  );

  return {
    connection,
    index,
    listPlaylists,
    getPlaylist,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addToPlaylist,
    saveSelection,
    saveSelectionContainer,
    removeFromPlaylist,
    moveInPlaylist
  };
}
