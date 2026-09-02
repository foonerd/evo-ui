// useWorks - read-then-subscribe hook for the Works shelf.
//
// Multiplexes onto the page-lifetime FrameworkTransport when under
// PlayerShellProviders. Owns the subscription only — never closes
// the shared socket. Designer mounts without a provider keep a
// private socket (close on unmount).

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import {
  connectWithRetry,
  MAX_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { attachSharedHappenings } from "../../runtime/shared-framework-attach";
import { frameworkUrl } from "../../runtime/use-shelf-subject";
import {
  decodeGetWorkRecordings,
  decodeLibraryCounters,
  decodeListWorks,
  decodeWorksRefusal,
  type GetWorkRecordingsResponse,
  type LibraryCounters,
  type ListWorksResponse,
  type WorkSummary
} from "./works-decoders.ts";

const LIBRARY_SHELF = "audio.library";
const PAYLOAD_VERSION = 1;

export type WorksConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface WorksConnectionState {
  kind: WorksConnectionKind;
  reason?: string;
  attempt?: number;
}

export type WorksVerbResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export interface UseWorksState {
  connection: WorksConnectionState;
  /** Live works list. null while the seed read is in flight. */
  works: WorkSummary[] | null;
  /** Live library counters projected from the audio_library subject.
   *  null until the framework has emitted at least one payload that
   *  carried the counters. */
  counters: LibraryCounters | null;
  refreshWorks: () => Promise<WorksVerbResult<ListWorksResponse>>;
  getWorkRecordings: (
    workId: string
  ) => Promise<WorksVerbResult<GetWorkRecordingsResponse>>;
}

function errorMessage(error: unknown): string {
  const refusal = decodeWorksRefusal({ error });
  if (refusal !== null) return refusal.message;
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const message = rec["message"];
    if (typeof message === "string" && message.length > 0) return message;
    const subclass = rec["subclass"];
    if (typeof subclass === "string" && subclass.length > 0) {
      return `Framework refused: ${subclass}`;
    }
  }
  return "The works system refused the command.";
}

/** Pick the audio_library_state payload out of a raw happening
 *  frame. The framework declares audio_library_state as the canonical
 *  subject carrying the classical counter projection. */
function pickAudioLibraryStatePayload(raw: unknown): unknown | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const frame = (typeof obj["happening"] === "object" && obj["happening"] !== null
    ? (obj["happening"] as Record<string, unknown>)
    : obj);
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_library_state") return null;
  return frame["new_state"];
}

function worksConnectError(detail: string): string {
  return (
    "The works service did not respond after " +
    `${MAX_CONNECT_ATTEMPTS} connection attempts. It may be ` +
    `restarting. Last error: ${detail}`
  );
}

export function useWorks(enabled: boolean = true): UseWorksState {
  const sharedTransport = tryUseFrameworkTransport();
  const [connection, setConnection] = useState<WorksConnectionState>({
    kind: "connecting"
  });
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [counters, setCounters] = useState<LibraryCounters | null>(null);
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (!enabled) {
      setConnection({ kind: "disconnected", reason: "connects once the player is ready" });
      return;
    }
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: "WebSocket unavailable" });
      return;
    }

    const ownsTransport = sharedTransport === null;
    const transport =
      sharedTransport ?? new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    let cancelled = false;

    const handleHappening = (raw: unknown): void => {
      if (cancelled) return;
      const payload = pickAudioLibraryStatePayload(raw);
      if (payload === null) return;
      const decodedCounters = decodeLibraryCounters(payload);
      if (decodedCounters !== null) setCounters(decodedCounters);
      void (async (): Promise<void> => {
        const reread = await pluginRequest(
          transport,
          LIBRARY_SHELF,
          "library.list_works",
          { v: PAYLOAD_VERSION }
        );
        if (!cancelled && reread.error === undefined) {
          const decoded = decodeListWorks(reread.value);
          if (decoded !== null) setWorks(decoded.works);
        }
      })();
    };

    const seedWorks = async (): Promise<void> => {
      const initialWorks = await pluginRequest(
        transport,
        LIBRARY_SHELF,
        "library.list_works",
        { v: PAYLOAD_VERSION }
      );
      if (cancelled || initialWorks.error !== undefined) return;
      const decoded = decodeListWorks(initialWorks.value);
      if (decoded !== null) setWorks(decoded.works);
    };

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
        onError: (_n, detail) => {
          if (!cancelled) {
            setConnection({ kind: "error", reason: worksConnectError(detail) });
          }
        },
        isCancelled: () => cancelled,
        afterOpen: seedWorks,
        onHappening: handleHappening
      });
      return () => {
        cancelled = true;
        attach.stop();
        transportRef.current = null;
      };
    }

    setConnection({ kind: "connecting" });
    const subAbort = new AbortController();
    let offHappening: (() => void) | undefined;
    void (async (): Promise<void> => {
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
        await seedWorks();
        if (cancelled) return;
        offHappening = transport.onHappening((f) => handleHappening(f.happening));
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
        setConnection({ kind: "error", reason: worksConnectError(detail) });
      }
    })();

    return () => {
      cancelled = true;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
      void transport.close();
      transportRef.current = null;
    };
  }, [enabled, sharedTransport]);

  const dispatch = useCallback(
    async <T,>(
      requestType: string,
      envelope: Record<string, unknown>,
      decoder?: (raw: unknown) => T | null
    ): Promise<WorksVerbResult<T | void>> => {
      const transport = transportRef.current;
      if (transport === null) {
        return {
          ok: false,
          message: "Not connected to the works system."
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
            message: `Works system returned an unrecognised ${requestType} response.`
          };
        }
        return { ok: true, value: decoded };
      }
      return { ok: true, value: undefined };
    },
    []
  );

  const refreshWorks = useCallback(
    () => dispatch("library.list_works", {}, decodeListWorks),
    [dispatch]
  ) as () => Promise<WorksVerbResult<ListWorksResponse>>;

  const getWorkRecordings = useCallback(
    (workId: string) =>
      dispatch(
        "library.get_work_recordings",
        { work_id: workId },
        decodeGetWorkRecordings
      ),
    [dispatch]
  ) as (
    workId: string
  ) => Promise<WorksVerbResult<GetWorkRecordingsResponse>>;

  return {
    connection,
    works,
    counters,
    refreshWorks,
    getWorkRecordings
  };
}
