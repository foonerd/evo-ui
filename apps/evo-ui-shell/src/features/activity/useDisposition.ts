// useDisposition - subscribes to the audio_playback_disposition
// subject and exposes a refresh callback. The recovery actions
// (wake/rescan source, etc.) dispatch via the library hook the
// surface threads through.
//
// Unlike most subjects, disposition does not have a dedicated read
// verb today - the state comes either from the initial subject
// state push or from the operator scrolling the ring buffer. We
// subscribe via subscribe_subject (per-subject channel) so we get
// the subject's current state on first dispatch, not just deltas.

import { useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import {
  connectWithRetry,
  MAX_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import {
  decodeDispositionState,
  decodeDispositionStateHappening,
  type DispositionState
} from "./disposition-decoders";

const DISPOSITION_CANONICAL_ID = "evo.audio.playback:disposition";

export type DispositionConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface DispositionConnectionState {
  kind: DispositionConnectionKind;
  reason?: string;
  attempt?: number;
}

export interface UseDispositionState {
  connection: DispositionConnectionState;
  /** Latest decoded ring-buffer state. null until the subject
   *  pushes its first state (which the framework does on
   *  subscribe_subject ack, so this populates very soon after
   *  mount when the ring has any entries). */
  state: DispositionState | null;
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

export function useDisposition(): UseDispositionState {
  const [connection, setConnection] = useState<DispositionConnectionState>({
    kind: "connecting"
  });
  const [state, setState] = useState<DispositionState | null>(null);
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: "WebSocket unavailable" });
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

        // subscribe_subject pushes the initial state on ack, then
        // streams subsequent state changes. Per-subject channel
        // means no spectrum-filter dimension needed - this stream
        // only carries the audio_playback_disposition subject.
        const subAbort = new AbortController();
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_subject",
            { canonical_id: DISPOSITION_CANONICAL_ID },
            { signal: subAbort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              // subscribe_subject emits { canonical_id,
              // subject_type, state, modified_at_ms } envelopes;
              // the state field carries the same payload the
              // happening's new_state would carry.
              if (
                typeof event === "object" &&
                event !== null &&
                "state" in event
              ) {
                const decoded = decodeDispositionState(
                  (event as Record<string, unknown>)["state"]
                );
                if (decoded !== null) setState(decoded);
              } else {
                // Fall through the subject_state_changed shape.
                const decoded = decodeDispositionStateHappening(event);
                if (decoded !== null) setState(decoded);
              }
            }
          } catch {
            // Subscription ended; reconnect re-establishes.
          }
        })();

        // Also listen via the general happenings subscription so a
        // disposition update through the bus surfaces immediately
        // even if the per-subject channel is rate-limited.
        const generalAbort = new AbortController();
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: generalAbort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              const decoded = decodeDispositionStateHappening(event);
              if (decoded !== null) setState(decoded);
            }
          } catch {
            // Subscription ended; reconnect re-establishes.
          }
        })();
        transport.onHappening((f) => {
          if (cancelled) return;
          const decoded = decodeDispositionStateHappening(f.happening);
          if (decoded !== null) setState(decoded);
        });
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({
          kind: "error",
          reason:
            "The disposition feed did not respond after " +
            `${MAX_CONNECT_ATTEMPTS} connection attempts. It may be ` +
            `restarting. Last error: ${detail}`
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

  return { connection, state };
}
