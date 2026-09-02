// useLibrary - read-then-subscribe hook for the audio.library
// shelf. Manages the sources subject and exposes the eight
// library.* verbs as typed callbacks. Browse / search return
// their decoded responses to the caller rather than persisting
// in hook state, because navigation is path-driven and the
// surface owns the breadcrumb cursor.
//
// The audio_library_sources subject pushes on every source list
// change; the surface re-renders source rows from that single
// state. audio_library_scan_progress emits during scans for the
// inline progress bar (state is held by the hook and exposed as
// a map source_id -> { percent, indexed, total }).

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { reconnectDelayMs } from "../../runtime/connect-retry";
import { t } from "../../runtime/i18n";
import {
  decodeBrowseLibrary,
  decodeDrillTracks,
  decodeFacetBrowse,
  decodeListSources,
  decodeListSourcesHappening,
  decodeScanProgressHappening,
  type ScanProgressEntry,
  decodeProbeSource,
  decodeSearchResults,
  decodeUpdateSource,
  type BrowseLibraryResponse,
  type FacetBrowseResponse,
  type FacetKind,
  type LibraryEntry,
  type ListSourcesResponse,
  type ProbeSourceResponse,
  type SourceRecord,
  type UpdateSourceResponse
} from "./library-decoders";

const LIBRARY_SHELF = "audio.library";
const PAYLOAD_VERSION = 1;

export type LibraryConnectionKind =
  | "connecting"
  // Transient, self-healing: the socket dropped (or the first open
  // has not landed yet) and the transport is retrying with unbounded
  // backoff. NON-terminal — the surface shows a quiet "reconnecting"
  // hint, never a dead-end error that needs a page reload.
  | "reconnecting"
  | "connected"
  | "disconnected"
  | "error";

export interface LibraryConnectionState {
  kind: LibraryConnectionKind;
  reason?: string;
  attempt?: number;
}

export type LibraryVerbResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export interface LibraryState {
  connection: LibraryConnectionState;
  /** Latest decoded list of sources, null until the seed read
   *  resolves. */
  sources: SourceRecord[] | null;
  /** Live scan progress keyed by source id, fed by the
   *  audio_library_scan_progress subject. A source with a
   *  phase="scanning" entry is indexing right now; the entry clears
   *  on the terminal/idle envelope. The settled count arrives on the
   *  sibling audio_library_sources republish - no reload. */
  scanProgress: Record<string, ScanProgressEntry>;
  listSources: () => Promise<LibraryVerbResult<ListSourcesResponse>>;
  browse: (
    sourceId: string,
    path: string,
    page?: number
  ) => Promise<LibraryVerbResult<BrowseLibraryResponse>>;
  browseByDimension: (
    facet: FacetKind,
    sourceId: string,
    page?: number
  ) => Promise<LibraryVerbResult<FacetBrowseResponse>>;
  /** Drill a facet value to its tracks (BRW-1). Exact tag-scoped, via
   *  the browse_by_<facet> select selector. */
  drillDimension: (
    facet: FacetKind,
    sourceId: string,
    value: string,
    parent?: { tag: string; value: string }
  ) => Promise<LibraryVerbResult<LibraryEntry[]>>;
  probeSource: (
    sourceId: string
  ) => Promise<LibraryVerbResult<ProbeSourceResponse>>;
  wakeSource: (sourceId: string) => Promise<LibraryVerbResult>;
  updateSource: (
    sourceId: string,
    forceRescan?: boolean
  ) => Promise<LibraryVerbResult<UpdateSourceResponse>>;
  removeSource: (sourceId: string) => Promise<LibraryVerbResult>;
  addSource: (
    payload: Record<string, unknown>
  ) => Promise<LibraryVerbResult<{ sourceId: string }>>;
  searchLibrary: (
    query: string,
    options?: {
      sourceIds?: string[];
      includeOffline?: boolean;
      maxResults?: number;
    }
  ) => Promise<LibraryVerbResult<LibraryEntry[]>>;
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
  return t("library.refusedCommand");
}

export function useLibrary(): LibraryState {
  const [connection, setConnection] = useState<LibraryConnectionState>({
    kind: "connecting"
  });
  const [sources, setSources] = useState<SourceRecord[] | null>(null);
  const [scanProgress, setScanProgress] = useState<
    Record<string, ScanProgressEntry>
  >({});
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    // WebSocket genuinely absent (ancient/embedded WebView) is the
    // only unrecoverable state — everything else self-heals, so this
    // is the ONE place that sets a terminal "error".
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: t("collection.wsUnavailable") });
      return;
    }
    let cancelled = false;
    // `seeded` gates the two post-connect behaviours: once we have
    // completed the first seed read + subscribe, every later socket
    // reopen must REFETCH (the view could be stale after an outage),
    // and every drop shows the quiet reconnecting hint rather than
    // the first-load "connecting" copy.
    let seeded = false;
    const transport = new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    setConnection({ kind: "connecting" });

    const refetchSources = async (): Promise<void> => {
      const res = await pluginRequest(
        transport,
        LIBRARY_SHELF,
        "library.list_sources",
        { v: PAYLOAD_VERSION }
      );
      if (!cancelled && res.error === undefined) {
        const decoded = decodeListSources(res.value);
        if (decoded !== null) setSources(decoded.sources);
      }
    };

    // Reflect the transport's live socket transitions. After the
    // first successful open the transport self-reconnects with
    // unbounded backoff and re-subscribes on its own (see
    // WsTransport.scheduleReconnect); we only surface that state and
    // refresh the seed read on each reopen so a routine framework
    // bounce clears itself with no page reload and no operator action.
    const offConn = transport.onConnectionChange((socketState) => {
      if (cancelled) return;
      if (socketState === "open") {
        setConnection({ kind: "connected" });
        if (seeded) void refetchSources();
      } else if (seeded) {
        // Mid-session drop: non-terminal, self-healing.
        setConnection({ kind: "reconnecting" });
      }
    });

    const seed = async (): Promise<void> => {
      // Unbounded initial connect. The transport's own reconnect only
      // arms AFTER a socket has opened once (it rides the socket's
      // `close` event), so the very first open must retry here or a
      // boot-time / deploy-window outage would strand the page on a
      // dead "error". Exponential backoff, NO attempt ceiling, always
      // the non-terminal "reconnecting" surface between tries.
      let attempt = 0;
      for (;;) {
        if (cancelled) return;
        attempt += 1;
        try {
          await transport.connect();
          break;
        } catch {
          if (cancelled) return;
          setConnection({ kind: "reconnecting", attempt });
          await new Promise<void>((resolve) =>
            setTimeout(resolve, reconnectDelayMs(attempt))
          );
        }
      }
      if (cancelled) return;
      // onConnectionChange("open") already flipped us to connected.
      await refetchSources();
      if (cancelled) return;
      seeded = true;

      const handleHappening = (raw: unknown): void => {
        if (cancelled) return;
        const decoded = decodeListSourcesHappening(raw);
        if (decoded !== null) {
          setSources(decoded.sources);
          return;
        }
        // Live scan progress. The subject carries the FULL current scan
        // set each time (it is state, not a delta), so we rebuild the
        // map from the frame - the idle/terminal envelope (scans:[])
        // yields {} and clears the indexing indicator.
        const scans = decodeScanProgressHappening(raw);
        if (scans !== null) {
          const next: Record<string, ScanProgressEntry> = {};
          for (const s of scans) next[s.sourceId] = s;
          setScanProgress(next);
        }
      };
      // One subscription for the page lifetime; the transport
      // re-subscribes it by id across its own reconnects, so this
      // loop ends only on unmount — never re-opened per reconnect
      // (no unbounded subscription accumulation).
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
          // Subscription ended on unmount/close.
        }
      })();
      transport.onHappening((f) => handleHappening(f.happening));
    };
    void seed();

    return () => {
      cancelled = true;
      offConn();
      void transport.close();
      transportRef.current = null;
    };
  }, []);

  const dispatch = useCallback(
    async <T,>(
      requestType: string,
      envelope: Record<string, unknown>,
      decoder?: (raw: unknown) => T | null
    ): Promise<LibraryVerbResult<T | void>> => {
      const transport = transportRef.current;
      if (transport === null) {
        return {
          ok: false,
          message: t("library.notConnected")
        };
      }
      const result = await pluginRequest(
        transport,
        LIBRARY_SHELF,
        requestType,
        { v: PAYLOAD_VERSION, ...envelope }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      if (decoder !== undefined) {
        const decoded = decoder(result.value);
        if (decoded === null) {
          return {
            ok: false,
            message: t("library.unrecognised", { request: requestType })
          };
        }
        return { ok: true, value: decoded };
      }
      return { ok: true, value: undefined };
    },
    []
  );

  const listSources = useCallback(
    () => dispatch("library.list_sources", {}, decodeListSources),
    [dispatch]
  ) as () => Promise<LibraryVerbResult<ListSourcesResponse>>;

  const browse = useCallback(
    (sourceId: string, path: string, page?: number) => {
      const payload: Record<string, unknown> = {
        source_id: sourceId,
        path
      };
      if (page !== undefined) payload["page"] = page;
      return dispatch(
        "library.browse_library",
        payload,
        decodeBrowseLibrary
      );
    },
    [dispatch]
  ) as (
    sourceId: string,
    path: string,
    page?: number
  ) => Promise<LibraryVerbResult<BrowseLibraryResponse>>;

  const browseByDimension = useCallback(
    (facet: FacetKind, sourceId: string, page?: number) => {
      const payload: Record<string, unknown> = { source_id: sourceId };
      if (page !== undefined) payload["page"] = page;
      return dispatch(
        `library.browse_by_${facet}`,
        payload,
        (raw) => decodeFacetBrowse(raw, facet)
      );
    },
    [dispatch]
  ) as (
    facet: FacetKind,
    sourceId: string,
    page?: number
  ) => Promise<LibraryVerbResult<FacetBrowseResponse>>;

  const drillDimension = useCallback(
    (
      facet: FacetKind,
      sourceId: string,
      value: string,
      parent?: { tag: string; value: string }
    ) => {
      const select: Record<string, unknown> = { value };
      if (parent !== undefined) select["parent"] = parent;
      return dispatch(
        `library.browse_by_${facet}`,
        { source_id: sourceId, select },
        decodeDrillTracks
      );
    },
    [dispatch]
  ) as (
    facet: FacetKind,
    sourceId: string,
    value: string,
    parent?: { tag: string; value: string }
  ) => Promise<LibraryVerbResult<LibraryEntry[]>>;

  const probeSource = useCallback(
    (sourceId: string) =>
      dispatch(
        "library.probe_source",
        { source_id: sourceId },
        decodeProbeSource
      ),
    [dispatch]
  ) as (
    sourceId: string
  ) => Promise<LibraryVerbResult<ProbeSourceResponse>>;

  const wakeSource = useCallback(
    (sourceId: string) =>
      dispatch("library.wake_source", { source_id: sourceId }),
    [dispatch]
  ) as (sourceId: string) => Promise<LibraryVerbResult>;

  const updateSource = useCallback(
    (sourceId: string, forceRescan?: boolean) => {
      const payload: Record<string, unknown> = { source_id: sourceId };
      if (forceRescan === true) payload["force_rescan"] = true;
      return dispatch("library.update_source", payload, decodeUpdateSource);
    },
    [dispatch]
  ) as (
    sourceId: string,
    forceRescan?: boolean
  ) => Promise<LibraryVerbResult<UpdateSourceResponse>>;

  const removeSource = useCallback(
    (sourceId: string) =>
      dispatch("library.remove_source", { source_id: sourceId }),
    [dispatch]
  ) as (sourceId: string) => Promise<LibraryVerbResult>;

  const addSource = useCallback(
    async (
      payload: Record<string, unknown>
    ): Promise<LibraryVerbResult<{ sourceId: string }>> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("library.notConnected") };
      }
      const result = await pluginRequest(
        transport,
        LIBRARY_SHELF,
        "library.add_source",
        { v: PAYLOAD_VERSION, ...payload }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const value = result.value;
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as Record<string, unknown>)["source_id"] === "string"
      ) {
        return {
          ok: true,
          value: {
            sourceId: (value as Record<string, unknown>)["source_id"] as string
          }
        };
      }
      return {
        ok: false,
        message: t("library.unrecognised", { request: "add_source" })
      };
    },
    []
  );

  const searchLibrary = useCallback(
    (
      query: string,
      options?: {
        sourceIds?: string[];
        includeOffline?: boolean;
        maxResults?: number;
      }
    ) => {
      const payload: Record<string, unknown> = {
        query,
        include_offline: options?.includeOffline ?? false,
        max_results: options?.maxResults ?? 100
      };
      if (options?.sourceIds !== undefined) {
        payload["source_ids"] = options.sourceIds;
      }
      return dispatch("library.search_library", payload, decodeSearchResults);
    },
    [dispatch]
  ) as (
    query: string,
    options?: {
      sourceIds?: string[];
      includeOffline?: boolean;
      maxResults?: number;
    }
  ) => Promise<LibraryVerbResult<LibraryEntry[]>>;

  return {
    connection,
    sources,
    scanProgress,
    listSources,
    browse,
    browseByDimension,
    drillDimension,
    probeSource,
    wakeSource,
    updateSource,
    removeSource,
    addSource,
    searchLibrary
  };
}
