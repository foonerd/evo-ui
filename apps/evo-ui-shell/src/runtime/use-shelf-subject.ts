// useShelfSubject - THE read-then-subscribe factory (plan law L4).
//
// Anonymous shelves multiplex onto the page-lifetime FrameworkTransport
// (subscriptions only — never close that socket on unmount).
//
// Bearer-scoped shelves (e.g. network shares) keep a private WsTransport:
// presenting a bearer on the shared socket would replace LAN-trust
// grants for every consumer, including playback.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { MutableRef } from "preact/hooks";
import { WsTransport } from "./ws-transport";
import { pluginRequest } from "./plugin-request-codec";
import { connectWithRetry, MAX_CONNECT_ATTEMPTS } from "./connect-retry";
import { verbErrorMessage } from "./verb-error";
import { useSecondaryLive } from "./secondary-live";
import { tryUseFrameworkTransport } from "./framework-transport";
import { attachSharedHappenings } from "./shared-framework-attach";
import { DENY_SPECTRUM_PAYLOAD } from "./happenings-filter";

const PAYLOAD_VERSION = 1;

export type SubjectConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface SubjectConnectionState {
  kind: SubjectConnectionKind;
  reason?: string;
  attempt?: number;
}

export type SubjectVerbResult<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      /** Structured refusal subclass when the framework sent one
       *  (step_up_required, pair_expired, ...). Lets dispatch sites
       *  branch on the refusal without string-matching prose. */
      subclass?: string;
    };

export interface ShelfSubjectMessages {
  /** WebSocket API missing in this environment. */
  wsUnavailable: () => string;
  /** A verb was dispatched before/after the transport lived. */
  notConnected: () => string;
  /** Connect retries exhausted. */
  noResponse: (attempts: number, detail: string) => string;
  /** Fallback when a refusal carries no message/subclass. */
  refused: () => string;
}

export interface ShelfSubjectConfig<S> {
  shelf: string;
  /** Optional bearer for a PRIVATE transport. NOTE: presenting a
   *  bearer REPLACES the anonymous LAN-trust grants with the token's
   *  own scope set - a narrow token can do LESS than no token. Only
   *  pass one when the surface needs a scope anonymity lacks. Never
   *  applied to the shared FrameworkTransport. */
  bearerToken?: string;
  /** The shelf's read verb (e.g. queue.get_queue). Subject
   *  subscribes never snapshot - the read is NOT optional. */
  readRequestType: string;
  /** Decode the read verb's response envelope. null = unrecognised
   *  (state stays null; surfaces render their honest not-yet
   *  state). */
  decodeRead: (raw: unknown) => S | null;
  /** Decode one happening frame. null = not this subject's frame
   *  (the happenings stream is shared - decoders must reject
   *  frames that are not theirs). */
  decodeHappening: (raw: unknown) => S | null;
  messages: ShelfSubjectMessages;
}

export interface ShelfSubject<S> {
  connection: SubjectConnectionState;
  state: S | null;
  /** For verbs whose response carries a fresh snapshot. */
  setState: (next: S | null) => void;
  /** Escape hatch for shelf-specific request shapes. */
  transportRef: MutableRef<WsTransport | null>;
  /** Dispatch a mutating verb; success carries no payload. */
  dispatchVoid: (
    requestType: string,
    envelope: Record<string, unknown>
  ) => Promise<SubjectVerbResult>;
  /** Dispatch a verb and decode its response envelope. */
  request: <T>(
    requestType: string,
    envelope: Record<string, unknown>,
    decode: (raw: unknown) => T | null,
    unrecognised: () => string
  ) => Promise<SubjectVerbResult<T>>;
  /** Rebuild the PRIVATE bearer socket with the freshly stored bearer
   *  (e.g. after inline pairing) IN PLACE, without a page reload. The
   *  read + subscription re-establish on the new socket, so the operator
   *  stays on the surface they paired from. No-op for shelves riding the
   *  shared anonymous transport (nothing to reauth). */
  reauth: () => void;
}

/** Structured subclass off a verb refusal, when present. */
function errorSubclass(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const sub = (error as Record<string, unknown>)["subclass"];
    if (typeof sub === "string" && sub.length > 0) return sub;
  }
  return undefined;
}

export function frameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

export function useShelfSubject<S>(config: ShelfSubjectConfig<S>): ShelfSubject<S> {
  const secondaryLive = useSecondaryLive();
  const sharedTransport = tryUseFrameworkTransport();
  const [connection, setConnection] = useState<SubjectConnectionState>({
    kind: "connecting"
  });
  const [state, setState] = useState<S | null>(null);
  const transportRef = useRef<WsTransport | null>(null);
  // The config is captured once - hooks are called with literal
  // configs; swapping shelves mid-flight is not a supported shape.
  const configRef = useRef(config);
  // The bearer CAN change in place (inline pairing stores a new token).
  // Keep a live ref to the latest bearer so reauth() rebuilds the socket
  // with it - without re-capturing shelf/decoders mid-flight.
  const bearerRef = useRef(config.bearerToken);
  bearerRef.current = config.bearerToken;
  // Bumped by reauth() to force the effect to tear the socket down and
  // reopen it with the current bearer.
  const [reauthNonce, setReauthNonce] = useState(0);
  const reauth = useCallback(() => setReauthNonce((n) => n + 1), []);

  useEffect(() => {
    const cfg = configRef.current;
    if (!secondaryLive) {
      setConnection({
        kind: "disconnected",
        reason: "connects once the player is live"
      });
      return;
    }
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: cfg.messages.wsUnavailable() });
      return;
    }

    const bearer = bearerRef.current;
    const bearerScoped = typeof bearer === "string" && bearer.length > 0;
    // Shared when available and anonymous; otherwise a private socket
    // (bearer shelves, or designer mounts without PlayerShellProviders).
    const ownsTransport = bearerScoped || sharedTransport === null;
    const transport = ownsTransport
      ? new WsTransport({
          url: frameworkUrl(),
          bearerToken: bearer
        })
      : sharedTransport;
    transportRef.current = transport;

    if (!ownsTransport) {
      let cancelled = false;
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
        onError: (attempts, detail) => {
          if (cancelled) return;
          setConnection({
            kind: "error",
            reason: cfg.messages.noResponse(attempts, detail)
          });
        },
        isCancelled: () => cancelled,
        afterOpen: async () => {
          if (cancelled) return;
          const initial = await pluginRequest(
            transport,
            cfg.shelf,
            cfg.readRequestType,
            { v: PAYLOAD_VERSION }
          );
          if (cancelled || initial.error !== undefined) return;
          const seeded = cfg.decodeRead(initial.value);
          if (seeded !== null) setState(seeded);
        },
        onHappening: (raw) => {
          if (cancelled) return;
          const decoded = cfg.decodeHappening(raw);
          if (decoded !== null) setState(decoded);
        }
      });
      return () => {
        cancelled = true;
        attach.stop();
        transportRef.current = null;
      };
    }

    // Private bearer socket — close on unmount (must not touch shared).
    let cancelled = false;
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
          cfg.shelf,
          cfg.readRequestType,
          { v: PAYLOAD_VERSION }
        );
        if (!cancelled && initial.error === undefined) {
          const seeded = cfg.decodeRead(initial.value);
          if (seeded !== null) setState(seeded);
        }
        if (cancelled) return;

        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          const decoded = cfg.decodeHappening(raw);
          if (decoded !== null) setState(decoded);
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
            // Subscription ended; reconnect re-establishes.
          }
        })();
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({
          kind: "error",
          reason: cfg.messages.noResponse(MAX_CONNECT_ATTEMPTS, detail)
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
  }, [secondaryLive, sharedTransport, reauthNonce]);

  const dispatchVoid = useCallback(
    async (
      requestType: string,
      envelope: Record<string, unknown>
    ): Promise<SubjectVerbResult> => {
      const cfg = configRef.current;
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: cfg.messages.notConnected() };
      }
      const result = await pluginRequest(transport, cfg.shelf, requestType, {
        v: PAYLOAD_VERSION,
        ...envelope
      });
      if (result.error !== undefined) {
        return {
          ok: false,
          message: verbErrorMessage(result.error, cfg.messages.refused()),
          subclass: errorSubclass(result.error)
        };
      }
      return { ok: true, value: undefined };
    },
    []
  );

  const request = useCallback(
    async <T>(
      requestType: string,
      envelope: Record<string, unknown>,
      decode: (raw: unknown) => T | null,
      unrecognised: () => string
    ): Promise<SubjectVerbResult<T>> => {
      const cfg = configRef.current;
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: cfg.messages.notConnected() };
      }
      const result = await pluginRequest(transport, cfg.shelf, requestType, {
        v: PAYLOAD_VERSION,
        ...envelope
      });
      if (result.error !== undefined) {
        return {
          ok: false,
          message: verbErrorMessage(result.error, cfg.messages.refused()),
          subclass: errorSubclass(result.error)
        };
      }
      const decoded = decode(result.value);
      if (decoded === null) {
        return { ok: false, message: unrecognised() };
      }
      return { ok: true, value: decoded };
    },
    []
  );

  return { connection, state, setState, transportRef, dispatchVoid, request, reauth };
}
