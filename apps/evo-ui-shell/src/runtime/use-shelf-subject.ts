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
import { clearBearer, onBearerChange } from "./bearer";
import { resolveConnectFailure, resolveProbeRead } from "./stale-bearer-policy";
import { probeStaleBearer } from "./stale-bearer-probe";
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
   *  applied to the shared FrameworkTransport. A fixed snapshot; prefer
   *  `bearerSource`. */
  bearerToken?: string;
  /** Live bearer source, read at every handshake of the private socket
   *  (first open and every reconnect) and when deciding whether this
   *  mount owns a private socket at all. A pair, a purge, or a kiosk
   *  remint written after mount is what the next upgrade carries. */
  bearerSource?: () => string | undefined;
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
  // Set true when a bearer socket was refused and we are re-probing
  // anonymously to decide whether the TOKEN is dead (device reset /
  // revoked / expired -> anon read lands) or the DEVICE is down (anon
  // connect also fails). While true the effect opens an anonymous
  // private socket regardless of the stored bearer. A deliberate
  // reauth() (inline re-pair) clears it so the new bearer is retried.
  const forceAnonRef = useRef(false);
  // Bumped by reauth() to force the effect to tear the socket down and
  // reopen it with the current bearer.
  const [reauthNonce, setReauthNonce] = useState(0);
  const reauth = useCallback(() => {
    forceAnonRef.current = false;
    setReauthNonce((n) => n + 1);
  }, []);

  // The one bearer bus: a pair stores a token, the stale-bearer policy
  // purges one (from this mount or any other bearer socket on the page).
  // Either way this mount re-handshakes with the CURRENT bearer at once -
  // a private socket after a pair, the shared LAN-trust socket after a
  // purge - so no second reload is ever needed to get clean.
  useEffect(() => onBearerChange(reauth), [reauth]);

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

    // While re-probing (forceAnonRef) we deliberately open anonymously
    // even though a bearer is stored, so the anon read can prove the
    // token dead vs the device down.
    const probing = forceAnonRef.current;
    // The bearer as of THIS mount: the live source when the caller gave
    // one, else the snapshot. Decides whether this mount owns a private
    // bearer socket; the socket itself re-reads the source at every
    // handshake, so a token written later is what the next upgrade
    // carries (never a construction snapshot).
    const readBearer = (): string | undefined =>
      cfg.bearerSource !== undefined ? cfg.bearerSource() : bearerRef.current;
    const storedBearerTok = readBearer();
    const hadStoredBearer =
      typeof storedBearerTok === "string" && storedBearerTok.length > 0;
    const bearer = probing ? undefined : storedBearerTok;
    const bearerScoped = typeof bearer === "string" && bearer.length > 0;
    // Shared when available and anonymous; otherwise a private socket
    // (bearer shelves, or designer mounts without PlayerShellProviders).
    // Force a PRIVATE anonymous socket while probing so the probe's
    // read + failure land in seed() below (one place to decide).
    const ownsTransport = bearerScoped || probing || sharedTransport === null;
    const transport = ownsTransport
      ? new WsTransport({
          url: frameworkUrl(),
          // A probing / designer socket is anonymous by construction and
          // stays so; a bearer socket reads the live bearer per handshake.
          bearerSource: bearerScoped ? readBearer : undefined
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
    let offConn: (() => void) | undefined;
    let offReconnectFailed: (() => void) | undefined;

    const seedRead = async (): Promise<boolean> => {
      const initial = await pluginRequest(
        transport,
        cfg.shelf,
        cfg.readRequestType,
        { v: PAYLOAD_VERSION }
      );
      if (cancelled) return false;
      if (initial.error === undefined) {
        const seeded = cfg.decodeRead(initial.value);
        if (seeded !== null) setState(seeded);
        return true;
      }
      return false;
    };

    // Reconnect on a bearer socket: the transport keeps retrying with
    // the live bearer, but a dead token and a dead device look the same
    // at the upgrade (close 1006). Run the SAME stale-bearer policy the
    // first seed runs - one anonymous probe per drop episode: a landed
    // read purges the token (the bearer bus then re-mounts this shelf on
    // the LAN-trust socket, live); a failed anonymous connect keeps the
    // token and the honest disconnected paint (outage, never a purge);
    // a refused read backs out and stops probing until the socket opens.
    let probeInFlight = false;
    let backedOut = false;
    const probeOnReconnectFailure = async (): Promise<void> => {
      if (!bearerScoped || probeInFlight || backedOut || cancelled) return;
      probeInFlight = true;
      try {
        const outcome = await probeStaleBearer({
          url: frameworkUrl(),
          read: async (anon) => {
            const r = await pluginRequest(anon, cfg.shelf, cfg.readRequestType, {
              v: PAYLOAD_VERSION
            });
            return r.error === undefined;
          },
          isCancelled: () => cancelled
        });
        if (cancelled) return;
        if (outcome === "backout") {
          backedOut = true;
          setConnection({
            kind: "error",
            reason: cfg.messages.noResponse(MAX_CONNECT_ATTEMPTS, "read refused")
          });
        }
        // "purge": clearBearer() announced it; the bus reauth re-mounts
        // this shelf anonymously. "device-down": token kept, the
        // disconnected paint below already says so; the transport keeps
        // retrying and the next failed attempt probes again.
      } finally {
        probeInFlight = false;
      }
    };

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

        const readLanded = await seedRead();
        if (cancelled) return;
        const probeRead = resolveProbeRead({
          probing,
          readLanded
        });
        if (probeRead === "purge") {
          // The anonymous read landed where the bearer socket was
          // refused: the stored token is dead (device reset / revoked /
          // expired), not the device. Purge it - the surface drops to
          // its unpaired "pair to manage" state with this live read-only
          // content, no incognito / site-data clearing. clearBearer()
          // announces the purge on the bearer bus, which re-mounts this
          // shelf on the shared LAN-trust socket; the anonymous probe
          // socket keeps serving until that re-mount lands.
          clearBearer();
          bearerRef.current = undefined;
          forceAnonRef.current = false;
        } else if (probeRead === "backout") {
          // Anon socket connected but the read was refused even
          // anonymously -> this shelf's read needs a capability the LAN
          // principal lacks, so we CANNOT prove the bearer is the
          // culprit. Back out (keep the token) and surface an honest
          // error; a retry re-tries the bearer.
          forceAnonRef.current = false;
          setConnection({
            kind: "error",
            reason: cfg.messages.noResponse(MAX_CONNECT_ATTEMPTS, "read refused")
          });
          return;
        }

        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          const decoded = cfg.decodeHappening(raw);
          if (decoded !== null) setState(decoded);
        };
        offHappening = transport.onHappening((f) =>
          handleHappening(f.happening)
        );
        // `connected` is only ever painted for an OPEN socket. A drop
        // paints the honest disconnected state while the transport
        // retries; a reopen re-seeds the read (a happening missed during
        // the gap is state, not a delta) and paints connected again.
        offConn = transport.onConnectionChange((socketState) => {
          if (cancelled) return;
          if (socketState === "open") {
            backedOut = false;
            setConnection({ kind: "connected" });
            void seedRead();
          } else {
            // Honest while the transport retries: not connected, no
            // attempt count (the reconnect loop has no ceiling).
            setConnection({
              kind: "disconnected",
              reason: cfg.messages.notConnected()
            });
          }
        });
        offReconnectFailed = transport.onReconnectAttemptFailed(() => {
          void probeOnReconnectFailure();
        });
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
        if (resolveConnectFailure({ hadStoredBearer, probing }) === "probe") {
          // The bearer socket's upgrade was refused (framework 401
          // "token verify failed") OR the device is unreachable - the
          // browser collapses both to WS close 1006, so we cannot tell
          // yet. Re-probe anonymously: an anon read that lands proves
          // the token dead; an anon connect that also fails proves the
          // device down (handled on the probe re-run's surface-error).
          forceAnonRef.current = true;
          setReauthNonce((n) => n + 1);
          return;
        }
        // No bearer to blame, or the anonymous probe's connect also
        // failed (device genuinely unreachable): honest transport error.
        forceAnonRef.current = false;
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
      if (offConn !== undefined) offConn();
      if (offReconnectFailed !== undefined) offReconnectFailed();
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
