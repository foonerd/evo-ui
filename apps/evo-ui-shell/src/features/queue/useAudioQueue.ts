// useAudioQueue - read-then-subscribe for audio.queue / audio_queue.
//
// Multiplexes onto the page-lifetime FrameworkTransport. Owns the
// subscription only — never closes the shared socket on unmount.
// Gated by SecondaryLive until playback is connected.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { useSecondaryLive } from "../../runtime/secondary-live";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { attachSharedHappenings } from "../../runtime/shared-framework-attach";
import { frameworkUrl } from "../../runtime/use-shelf-subject";
import { connectWithRetry, MAX_CONNECT_ATTEMPTS } from "../../runtime/connect-retry";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { t } from "../../runtime/i18n";
import {
  decodeQueueState,
  decodeQueueStateHappening,
  decodeSkipOutcome,
  type QueueState,
  type SkipOutcome
} from "./audio-queue-decoders";

const QUEUE_SHELF = "audio.queue";
const PAYLOAD_VERSION = 1;

export type QueueConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface QueueConnectionState {
  kind: QueueConnectionKind;
  reason?: string;
  attempt?: number;
}

export type QueueVerbResult =
  | { ok: true }
  | { ok: false; message: string };

/** Server-side selection criteria for the multi-dimensional verbs -
 *  the same shape the browse drill carries. The plugin resolves it to
 *  tracks (MPD findadd/searchadd); no URI list crosses the wire. */
export interface Selection {
  dimension: "artist" | "album" | "genre" | "year" | "folder" | "playlist";
  value: string;
  parent?: { tag: string; value: string };
}
export type EnqueueSelectionMode = "replace" | "next" | "append";

export type QueueSkipResult =
  | { ok: true; outcome: SkipOutcome }
  | { ok: false; message: string };

/** Public surface of the hook. */
export interface AudioQueueState {
  connection: QueueConnectionState;
  /** Decoded latest queue envelope, null until the seed read
   *  resolves. The framework's `read_mirror` returns the empty
   *  envelope before the first publish, which decodes to a
   *  non-null QueueState with items=[] - so a null `queue` here
   *  means the read itself failed, not "queue is empty". */
  queue: QueueState | null;
  enqueue: (uris: string[], position?: number) => Promise<QueueVerbResult>;
  /** Replace-and-play: clear the queue, load these URIs, and play
   *  from the top. Composed from clear_queue + enqueue +
   *  play_from_position (the framework has no atomic replace verb
   *  yet); each step aborts on the first failure. */
  playNow: (uris: string[]) => Promise<QueueVerbResult>;
  /** Multi-dimensional, server-side enqueue: the plugin resolves the
   *  selection to tracks and applies the mode in one MPD roundtrip
   *  (replace = atomic clear+add+play). Scale-safe - no URI list on
   *  the wire. */
  enqueueSelection: (
    selection: Selection,
    mode: EnqueueSelectionMode
  ) => Promise<QueueVerbResult>;
  /** Paged Container-shape enqueue for network sources (DLNA):
   *  resolves an opaque container id to tracks page by page. */
  enqueueContainer: (
    sourceId: string,
    uri: string,
    mode: EnqueueSelectionMode
  ) => Promise<QueueVerbResult>;
  removeItem: (id: number) => Promise<QueueVerbResult>;
  moveItem: (id: number, toPosition: number) => Promise<QueueVerbResult>;
  clearQueue: () => Promise<QueueVerbResult>;
  loadPlaylist: (playlistName: string) => Promise<QueueVerbResult>;
  appendPlaylist: (playlistName: string) => Promise<QueueVerbResult>;
  saveAsPlaylist: (playlistName: string) => Promise<QueueVerbResult>;
  skipToNextAvailable: (fromPosition: number) => Promise<QueueSkipResult>;
  /** Play the entry at a zero-based queue position directly
   *  (queue.play_from_position). The plugin validates the position
   *  against the live queue length BEFORE dispatching, so refusals
   *  (position_out_of_range, queue_empty) leave playback untouched. */
  playFromPosition: (position: number) => Promise<QueueVerbResult>;
  /** Defensive resync. Re-reads queue.get_queue and applies the
   *  result. Used by the surface's reload button + any surface
   *  observing an invariant violation. */
  refresh: () => Promise<QueueVerbResult>;
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
  return t("queue.refusedCommand");
}

export function useAudioQueue(): AudioQueueState {
  const secondaryLive = useSecondaryLive();
  const sharedTransport = tryUseFrameworkTransport();
  const [connection, setConnection] = useState<QueueConnectionState>({
    kind: "connecting"
  });
  const [queue, setQueue] = useState<QueueState | null>(null);
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (!secondaryLive) {
      setConnection({
        kind: "disconnected",
        reason: "connects once the player is live"
      });
      return;
    }
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: t("collection.wsUnavailable") });
      return;
    }

    const ownsTransport = sharedTransport === null;
    const transport =
      sharedTransport ?? new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    let cancelled = false;

    if (!ownsTransport) {
      const attach = attachSharedHappenings(transport, {
        onConnecting: (attempt) => {
          if (cancelled) return;
          setConnection(
            attempt === undefined
              ? { kind: "connecting" }
              : { kind: "connecting", attempt }
          );
        },
        onConnected: () => {
          if (!cancelled) setConnection({ kind: "connected" });
        },
        onError: (n, detail) => {
          if (cancelled) return;
          setConnection({
            kind: "error",
            reason: t("queue.noResponse", { n, detail })
          });
        },
        isCancelled: () => cancelled,
        afterOpen: async () => {
          if (cancelled) return;
          const initial = await pluginRequest(
            transport,
            QUEUE_SHELF,
            "queue.get_queue",
            { v: PAYLOAD_VERSION }
          );
          if (cancelled || initial.error !== undefined) return;
          const seeded = decodeQueueState(initial.value);
          if (seeded !== null) setQueue(seeded);
        },
        onHappening: (raw) => {
          if (cancelled) return;
          const decoded = decodeQueueStateHappening(raw);
          if (decoded !== null) setQueue(decoded);
        }
      });

      return () => {
        cancelled = true;
        attach.stop();
        transportRef.current = null;
      };
    }

    // Designer / no provider: private socket, close on unmount.
    setConnection({ kind: "connecting" });
    const subAbort = new AbortController();
    let offHappening: (() => void) | undefined;
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
          QUEUE_SHELF,
          "queue.get_queue",
          { v: PAYLOAD_VERSION }
        );
        if (!cancelled && initial.error === undefined) {
          const seeded = decodeQueueState(initial.value);
          if (seeded !== null) setQueue(seeded);
        }
        if (cancelled) return;
        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          const decoded = decodeQueueStateHappening(raw);
          if (decoded !== null) setQueue(decoded);
        };
        offHappening = transport.onHappening((f) =>
          handleHappening(f.happening)
        );
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
            // ended
          }
        })();
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({
          kind: "error",
          reason: t("queue.noResponse", { n: MAX_CONNECT_ATTEMPTS, detail })
        });
      }
    };
    void seed();
    return () => {
      cancelled = true;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
      void transport.close();
      transportRef.current = null;
    };
  }, [secondaryLive, sharedTransport]);

  const dispatch = useCallback(
    async (
      requestType: string,
      envelope: Record<string, unknown>
    ): Promise<QueueVerbResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return {
          ok: false,
          message: t("queue.notConnected")
        };
      }
      const result = await pluginRequest(
        transport,
        QUEUE_SHELF,
        requestType,
        { v: PAYLOAD_VERSION, ...envelope }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      return { ok: true };
    },
    []
  );

  const enqueue = useCallback(
    (uris: string[], position?: number) => {
      const payload: Record<string, unknown> = { uris };
      if (typeof position === "number") payload["position"] = position;
      return dispatch("queue.enqueue", payload);
    },
    [dispatch]
  );

  const enqueueSelection = useCallback(
    (selection: Selection, mode: EnqueueSelectionMode) =>
      dispatch("queue.enqueue_selection", { selection, mode }),
    [dispatch]
  );

  // Container-shape enqueue for network sources (DLNA MediaServer):
  // the device resolves an opaque container id to tracks a page at a
  // time (default 50, hard cap 100) and NEVER in one unbounded shot, so
  // the UI must drive the pages. The first page carries the requested
  // mode; every later page appends, so a `replace`/`next` folder keeps
  // its order (page 0 replaces or inserts-after-current, the rest queue
  // in sequence behind it). Stops when the response's `next_page` is
  // null. `uri` is the container's stable id (dlna:<sid>/<oid>).
  const enqueueContainer = useCallback(
    async (
      sourceId: string,
      uri: string,
      mode: EnqueueSelectionMode
    ): Promise<QueueVerbResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("queue.notConnected") };
      }
      const selection = { kind: "container", uri };
      let page = 0;
      // Bound the loop defensively; 100/page hard cap means even a huge
      // server folder resolves in well under this many iterations.
      for (let guard = 0; guard < 500; guard++) {
        const result = await pluginRequest(transport, QUEUE_SHELF, "queue.enqueue_selection", {
          v: PAYLOAD_VERSION,
          source_id: sourceId,
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
          return { ok: true };
        }
      }
      return { ok: true };
    },
    []
  );

  const removeItem = useCallback(
    (id: number) => dispatch("queue.remove_queue_item", { id }),
    [dispatch]
  );

  const moveItem = useCallback(
    (id: number, toPosition: number) =>
      dispatch("queue.move_queue_item", { id, to_position: toPosition }),
    [dispatch]
  );

  const clearQueue = useCallback(
    () => dispatch("queue.clear_queue", {}),
    [dispatch]
  );

  const loadPlaylist = useCallback(
    (playlistName: string) =>
      dispatch("queue.load_playlist_to_queue", { playlist_name: playlistName }),
    [dispatch]
  );

  const appendPlaylist = useCallback(
    (playlistName: string) =>
      dispatch("queue.append_playlist_to_queue", {
        playlist_name: playlistName
      }),
    [dispatch]
  );

  const saveAsPlaylist = useCallback(
    (playlistName: string) =>
      dispatch("queue.save_queue_as_playlist", { playlist_name: playlistName }),
    [dispatch]
  );

  const playFromPosition = useCallback(
    (position: number) => dispatch("queue.play_from_position", { position }),
    [dispatch]
  );

  const playNow = useCallback(
    async (uris: string[]): Promise<QueueVerbResult> => {
      if (uris.length === 0) {
        return { ok: false, message: t("queue.selectionEmpty") };
      }
      const cleared = await dispatch("queue.clear_queue", {});
      if (!cleared.ok) return cleared;
      const added = await dispatch("queue.enqueue", { uris });
      if (!added.ok) return added;
      return dispatch("queue.play_from_position", { position: 0 });
    },
    [dispatch]
  );

  const skipToNextAvailable = useCallback(
    async (fromPosition: number): Promise<QueueSkipResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("queue.notConnected") };
      }
      const result = await pluginRequest(
        transport,
        QUEUE_SHELF,
        "queue.skip_to_next_available",
        { v: PAYLOAD_VERSION, from_position: fromPosition }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const outcome = decodeSkipOutcome(result.value);
      if (outcome === null) {
        return {
          ok: false,
          message: t("queue.unrecognisedSkip")
        };
      }
      return { ok: true, outcome };
    },
    []
  );

  const refresh = useCallback(async (): Promise<QueueVerbResult> => {
    const transport = transportRef.current;
    if (transport === null) {
      return { ok: false, message: t("queue.notConnected") };
    }
    const result = await pluginRequest(
      transport,
      QUEUE_SHELF,
      "queue.get_queue",
      { v: PAYLOAD_VERSION }
    );
    if (result.error !== undefined) {
      return { ok: false, message: errorMessage(result.error) };
    }
    const fresh = decodeQueueState(result.value);
    if (fresh !== null) setQueue(fresh);
    return { ok: true };
  }, []);

  return {
    connection,
    queue,
    enqueue,
    removeItem,
    moveItem,
    clearQueue,
    loadPlaylist,
    appendPlaylist,
    saveAsPlaylist,
    skipToNextAvailable,
    playFromPosition,
    playNow,
    enqueueSelection,
    enqueueContainer,
    refresh
  };
}
