// Schema-first WebSocket transport.
//
// Single connection multiplexes three frame classes against the
// framework's `evo-projection-ws` envelope shape:
//
//   - Request/Response: client posts `Request { request_id, op,
//     payload }`, server replies with `Response { response_to,
//     outcome }`.
//   - Subscribe/SubscriptionEvent: client opens
//     `Subscribe { subscription_id, op, payload }`, server emits
//     `SubscriptionAck` then a stream of `SubscriptionEvent` frames
//     until the client unsubscribes or the connection closes.
//   - Happening fan-out: server emits `Happening { seq, happening }`
//     frames independent of any subscription; subscribers that opened
//     a `subscribe_happenings` channel pick them up through that
//     channel.
//
// Authentication: presented at handshake time as the WebSocket
// sub-protocol `bearer.<token>`. The framework's ws_endpoint validates
// the bearer before accepting the upgrade.

import type { Transport } from "../sdk/transport";
import type { CallOpts, SubscribeOpts, WireOpResult } from "../sdk/types";
import { DEFAULT_OPEN_DEADLINE_MS } from "./deadline.ts";
import { dispatchWithStepUp, type StepUpBridge } from "./step-up-dispatch.ts";

// App-level operator-password bridge, installed once by StepUpHost.
// Module-global so EVERY WsTransport instance (the shared socket and
// any private bearer-scoped socket) funnels an elevation refusal
// through the SAME card and the SAME in-memory token cache - one
// canonical inline-step-up path for the whole app.
let stepUpBridge: StepUpBridge | null = null;
export function setStepUpBridge(bridge: StepUpBridge | null): void {
  stepUpBridge = bridge;
}

interface IncomingFrame {
  frame_type: "request" | "subscribe" | "unsubscribe";
  [key: string]: unknown;
}

interface OutgoingResponse {
  frame_type: "response";
  response_to: number;
  outcome:
    | { outcome: "ok"; value: unknown }
    | { outcome: "err"; code: string; message: string };
}

interface OutgoingSubscriptionAck {
  frame_type: "subscription_ack";
  subscription_id: string;
}

interface OutgoingSubscriptionEvent {
  frame_type: "subscription_event";
  subscription_id: string;
  event: unknown;
}

interface OutgoingSubscriptionEnded {
  frame_type: "subscription_ended";
  subscription_id: string;
  reason: string;
}

interface OutgoingHappening {
  frame_type: "happening";
  seq: number;
  happening: unknown;
}

type OutgoingFrame =
  | OutgoingResponse
  | OutgoingSubscriptionAck
  | OutgoingSubscriptionEvent
  | OutgoingSubscriptionEnded
  | OutgoingHappening;

/** Configuration for the WebSocket transport. */
export interface WsTransportConfig {
  url?: string;
  bearerToken?: string;
  /** Reconnect backoff schedule in milliseconds. */
  backoffMs?: readonly number[];
  /** Hard deadline for a single WS open, in milliseconds. A stuck
   *  upgrade must not sit until the browser gives up - past this the
   *  open rejects and the nascent socket is closed, so the connect
   *  layer can retry or the shell can degrade. Bounds the critical
   *  path "no matter what". Defaults to DEFAULT_OPEN_DEADLINE_MS. */
  openTimeoutMs?: number;
}

const DEFAULT_BACKOFF: readonly number[] = [500, 1000, 2000, 5000, 10_000];

/** A subscription that opted into keepalive (`keepalive_ms` in its
 *  subscribe payload) is presumed DEAD when no frame at all - neither a
 *  real event nor a keepalive beat - arrives for this multiple of its
 *  keepalive interval. Three missed beats is the dead signal; it forces
 *  a socket reconnect, which re-subscribes and lets consumers re-seed
 *  through the existing onConnectionChange("open") path. This is the
 *  only way to distinguish a silently-dead-but-open subscription (boot
 *  race, server-side reap without a socket close) from a subject that is
 *  simply quiet - a transition-only subject emits nothing for minutes by
 *  design, so silence alone is not a fault; the keepalive is. */
const KEEPALIVE_WATCHDOG_FACTOR = 3;

type PendingResolver = (value: WireOpResult) => void;

interface ActiveSubscription {
  id: string;
  /** Op name (e.g. "subscribe_happenings") used both for the
   *  initial subscribe frame and for any reconnect re-subscribe. */
  op: string;
  /** Payload from the caller's subscribe() invocation, used
   *  verbatim on initial subscribe AND on reconnect re-subscribe.
   *  Previously the reconnect path threw the payload away and
   *  re-sent `{}` - which silently lost any happenings filter
   *  (e.g. `subject_types_deny`) the original subscriber set,
   *  re-flooding the consumer with high-frequency events it had
   *  asked to be excluded from. */
  payload: Record<string, unknown>;
  /** Keepalive cadence the subscribe payload requested, in ms, when
   *  the caller opted in. Drives the liveness watchdog. undefined =
   *  no keepalive requested (no watchdog). */
  keepaliveMs?: number;
  push: (event: unknown) => void;
  close: (reason: string) => void;
}

/** True when a subscription_event carries a framework keepalive beat
 *  (`happenings_keepalive` / `subject_keepalive`) rather than a real
 *  subject event. These prove liveness only and are never delivered to
 *  the consumer. */
function isKeepaliveEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  return e["happenings_keepalive"] === true || e["subject_keepalive"] === true;
}

/**
 * WebSocket transport multiplexing one connection across every wire
 * op + happenings fan-out for the lifetime of the page.
 */
export class WsTransport implements Transport {
  private readonly url: string;
  private bearerToken: string | undefined;
  private readonly backoffMs: readonly number[];
  private readonly openTimeoutMs: number;

  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingResolver>();
  private subscriptions = new Map<string, ActiveSubscription>();
  private happeningListeners = new Set<(event: OutgoingHappening) => void>();
  private connectionListeners = new Set<
    (state: "open" | "closed") => void
  >();
  private connectPromise: Promise<WebSocket> | null = null;
  private backoffIndex = 0;
  private closing = false;
  /** Per-subscription keepalive watchdog timers, keyed by subscription
   *  id. Present only for subscriptions that opted into keepalive. */
  private subWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  /** Bound pagehide handler kept as a field so it can be removed
   *  on `close()`. The browser fires `pagehide` reliably when a
   *  tab closes / navigates away (it is the canonical replacement
   *  for `beforeunload` on modern desktop + mobile browsers). We
   *  use it to send an explicit WS close so the runtime's proxy
   *  forwards the close upstream and the framework drops the
   *  subscription - otherwise the upstream session leaks for the
   *  life of the framework process and accumulates one extra
   *  high-frequency happening consumer per opened-and-closed tab. */
  private readonly pageHideHandler: () => void;

  public constructor(cfg: WsTransportConfig = {}) {
    this.url = cfg.url ?? defaultWsUrl();
    this.bearerToken = cfg.bearerToken;
    this.backoffMs = cfg.backoffMs ?? DEFAULT_BACKOFF;
    this.openTimeoutMs = cfg.openTimeoutMs ?? DEFAULT_OPEN_DEADLINE_MS;
    // Send a clean WS close on tab unload. Using socket.close()
    // (rather than transport.close()) keeps the work synchronous
    // enough to flight before the page is gone - the browser
    // is allowed to drop async work during pagehide, but a
    // single WebSocket close frame queues into the socket's
    // send buffer immediately. The transport's own teardown on
    // React unmount remains the canonical path.
    this.pageHideHandler = (): void => {
      if (this.socket !== null && this.socket.readyState <= WebSocket.OPEN) {
        try {
          this.socket.close(1000, "page-unload");
        } catch {
          // Browser is mid-unload; ignore.
        }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.pageHideHandler);
    }
  }

  public setBearerToken(token: string | undefined): void {
    this.bearerToken = token;
    // Force reconnect so the new token takes effect at the next
    // handshake. In-flight pending requests reject on close.
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "bearer-rotated");
    }
  }

  /** Subscribe to the framework's happenings fan-out. */
  public onHappening(
    handler: (event: { seq: number; happening: unknown }) => void,
  ): () => void {
    const adapter = (frame: OutgoingHappening): void =>
      handler({ seq: frame.seq, happening: frame.happening });
    this.happeningListeners.add(adapter);
    return (): void => {
      this.happeningListeners.delete(adapter);
    };
  }

  /** Socket open/closed transitions (not React connection policy). */
  public onConnectionChange(
    handler: (state: "open" | "closed") => void,
  ): () => void {
    this.connectionListeners.add(handler);
    return (): void => {
      this.connectionListeners.delete(handler);
    };
  }

  private emitConnection(state: "open" | "closed"): void {
    for (const handler of this.connectionListeners) {
      handler(state);
    }
  }

  /** True when a live OPEN socket is already held (no new upgrade). */
  public isOpen(): boolean {
    return (
      this.socket !== null && this.socket.readyState === WebSocket.OPEN
    );
  }

  /**
   * Eagerly establish the WebSocket connection. Returns once the
   * socket has opened. Useful when the page wants to fail fast on
   * connectivity issues at boot.
   */
  public async connect(): Promise<void> {
    if (this.closing) {
      throw new Error("WebSocket transport is closed");
    }
    await this.ensureSocket();
  }

  public async close(): Promise<void> {
    this.closing = true;
    this.clearAllSubWatchdogs();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pageHideHandler);
    }
    if (this.socket !== null) {
      this.socket.close(1000, "client-closed");
      this.socket = null;
    }
    for (const sub of this.subscriptions.values()) {
      sub.close("client-closed");
    }
    this.subscriptions.clear();
    for (const resolve of this.pending.values()) {
      resolve({
        error: { code: "connection_closed", message: "transport closed" },
      });
    }
    this.pending.clear();
  }

  // Public dispatch funnels through the canonical inline-step-up path:
  // a scope/step-up refusal raises the app's operator-password card and
  // retries with the token, transparently to every caller. When no
  // bridge is installed (designer / tests) it is a straight pass-through
  // to sendFrame.
  public async dispatch(
    op: string,
    payload: Record<string, unknown>,
    opts?: CallOpts,
  ): Promise<WireOpResult> {
    return dispatchWithStepUp(
      (o, p, pt) => this.sendFrame(o, p, pt as CallOpts | undefined),
      op,
      payload,
      opts,
      stepUpBridge,
    );
  }

  private async sendFrame(
    op: string,
    payload: Record<string, unknown>,
    opts?: CallOpts,
  ): Promise<WireOpResult> {
    const ws = await this.ensureSocket();
    const requestId = this.nextRequestId++;
    // The framework's IncomingFrame is `deny_unknown_fields`: a
    // request frame may carry ONLY request_id / op / payload. A
    // step-up token cannot ride the frame - the server rejects the
    // whole frame with a `frame_parse` error keyed to response_to 0,
    // which matches no pending request, so the caller would hang
    // forever. opts.stepUpToken is therefore not applied here;
    // step-up-gated ops carry the token inside their op payload, or
    // use the HTTP transport's X-Step-Up-Token header.
    const frame: IncomingFrame = {
      frame_type: "request",
      request_id: requestId,
      op,
      payload,
    };
    const sig = opts?.signal;
    if (sig?.aborted) {
      return { error: { code: "aborted", message: "dispatch aborted" } };
    }
    return await new Promise<WireOpResult>((resolve) => {
      this.pending.set(requestId, resolve);
      ws.send(JSON.stringify(frame));
      if (sig !== undefined) {
        sig.addEventListener("abort", () => {
          if (this.pending.delete(requestId)) {
            resolve({
              error: { code: "aborted", message: "dispatch aborted" },
            });
          }
        });
      }
    });
  }

  public subscribe(
    op: string,
    payload: Record<string, unknown>,
    opts?: SubscribeOpts,
  ): AsyncIterable<unknown> {
    const subscriptionId = `${op}-${this.nextRequestId++}`;
    const transport = this;
    const queue: unknown[] = [];
    let waiters: Array<(v: IteratorResult<unknown>) => void> = [];
    let endedReason: string | null = null;

    const push = (event: unknown): void => {
      const w = waiters.shift();
      if (w !== undefined) {
        w({ value: event, done: false });
      } else {
        queue.push(event);
      }
    };

    const close = (reason: string): void => {
      endedReason = reason;
      const w = waiters;
      waiters = [];
      for (const r of w) {
        r({ value: undefined, done: true });
      }
    };

    const keepaliveMs =
      typeof payload["keepalive_ms"] === "number"
        ? (payload["keepalive_ms"] as number)
        : undefined;
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      op,
      payload,
      keepaliveMs,
      push,
      close,
    });

    void (async (): Promise<void> => {
      const ws = await this.ensureSocket();
      const frame: IncomingFrame = {
        frame_type: "subscribe",
        subscription_id: subscriptionId,
        op,
        payload,
      };
      if (opts?.since !== undefined) {
        (frame.payload as Record<string, unknown>).since = opts.since;
      }
      // A step-up token cannot ride the frame - see dispatch(); the
      // framework's deny_unknown_fields rejects any extra field.
      ws.send(JSON.stringify(frame));
      // Arm the liveness watchdog once the subscribe is on the wire.
      this.armSubWatchdog(subscriptionId);
    })();

    if (opts?.signal !== undefined) {
      opts.signal.addEventListener("abort", () => {
        transport.unsubscribe(subscriptionId);
      });
    }

    return {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            const queued = queue.shift();
            if (queued !== undefined) {
              return { value: queued, done: false };
            }
            if (endedReason !== null) {
              return { value: undefined, done: true };
            }
            return await new Promise<IteratorResult<unknown>>((resolve) => {
              waiters.push(resolve);
            });
          },
          async return(): Promise<IteratorResult<unknown>> {
            transport.unsubscribe(subscriptionId);
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  /** (Re)arm the keepalive watchdog for a subscription that opted in.
   *  Called on subscribe, on reconnect re-subscribe, and reset on every
   *  frame the subscription receives (real event or keepalive beat). */
  private armSubWatchdog(subscriptionId: string): void {
    const existing = this.subWatchdogs.get(subscriptionId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.subWatchdogs.delete(subscriptionId);
    }
    const sub = this.subscriptions.get(subscriptionId);
    if (this.closing || sub === undefined || sub.keepaliveMs === undefined) {
      return;
    }
    const timer = setTimeout(
      () => this.onSubKeepaliveLapse(subscriptionId),
      sub.keepaliveMs * KEEPALIVE_WATCHDOG_FACTOR,
    );
    this.subWatchdogs.set(subscriptionId, timer);
  }

  /** A keepalive-opted subscription went silent past the watchdog: the
   *  socket is open but this subscription is not delivering. Force a
   *  reconnect so scheduleReconnect re-subscribes and consumers re-seed
   *  on the onConnectionChange("open") that follows - the one canonical
   *  recovery path, now triggered by keepalive-lapse as well as by a
   *  socket close. */
  private onSubKeepaliveLapse(subscriptionId: string): void {
    this.subWatchdogs.delete(subscriptionId);
    if (this.closing || !this.subscriptions.has(subscriptionId)) {
      return;
    }
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "keepalive-lapse");
    }
  }

  private clearAllSubWatchdogs(): void {
    for (const timer of this.subWatchdogs.values()) {
      clearTimeout(timer);
    }
    this.subWatchdogs.clear();
  }

  private unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub === undefined) {
      return;
    }
    const watchdog = this.subWatchdogs.get(subscriptionId);
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
      this.subWatchdogs.delete(subscriptionId);
    }
    sub.close("unsubscribed");
    this.subscriptions.delete(subscriptionId);
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      const frame: IncomingFrame = {
        frame_type: "unsubscribe",
        subscription_id: subscriptionId,
      };
      this.socket.send(JSON.stringify(frame));
    }
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    if (this.connectPromise !== null) {
      return await this.connectPromise;
    }
    this.connectPromise = this.openSocket();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async openSocket(): Promise<WebSocket> {
    // Canonical bearer subprotocol is `evo.bearer.<token>` (the
    // framework's extract path matches exactly this prefix; the
    // token itself is base64url unpadded, so the whole value is a
    // legal RFC 7230 token and the server echoes it in the 101).
    const protocols =
      this.bearerToken !== undefined
        ? [`evo.bearer.${this.bearerToken}`]
        : undefined;
    const ws = new WebSocket(this.url, protocols);
    return await new Promise<WebSocket>((resolve, reject) => {
      // Hard open deadline. A stuck upgrade (proxy accepted the TCP
      // connection but never completes the 101, or the framework is
      // wedged) would otherwise hang here until the browser's own
      // multi-minute timeout. Past openTimeoutMs we abandon this
      // socket and reject so connect-retry can try again or the
      // shell can degrade - the critical path stays bounded.
      let settled = false;
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close(1000, "open-deadline");
        } catch {
          // ignore - socket may already be tearing down
        }
        reject(
          new Error(`WebSocket open exceeded ${this.openTimeoutMs}ms deadline`)
        );
      }, this.openTimeoutMs);
      ws.addEventListener("open", () => {
        if (settled) {
          // Opened after we already gave up; close the late socket.
          try {
            ws.close(1000, "open-deadline-late");
          } catch {
            // ignore
          }
          return;
        }
        settled = true;
        clearTimeout(deadline);
        this.socket = ws;
        this.backoffIndex = 0;
        ws.addEventListener("message", (ev) => this.onMessage(ev));
        ws.addEventListener("close", (ev) => this.onClose(ev));
        this.emitConnection("open");
        resolve(ws);
      });
      ws.addEventListener("error", (ev) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(new Error(`WebSocket failed to open: ${(ev as Event).type}`));
      });
    });
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== "string") {
      return;
    }
    let frame: OutgoingFrame;
    try {
      frame = JSON.parse(ev.data) as OutgoingFrame;
    } catch {
      return;
    }
    switch (frame.frame_type) {
      case "response": {
        const resolve = this.pending.get(frame.response_to);
        if (resolve === undefined) {
          return;
        }
        this.pending.delete(frame.response_to);
        if (frame.outcome.outcome === "ok") {
          // The framework returns application errors as `outcome: "ok"`
          // with `value.error = {class, details: {subclass}, message}`.
          // The outer envelope flags only transport-level success;
          // the inner value carries the operation's actual outcome.
          // Detect the error variant and route it through the same
          // failure path as transport-level errors.
          const inValueErr = readFrameworkErrorEnvelope(frame.outcome.value);
          if (inValueErr !== null) {
            resolve({ error: inValueErr });
          } else {
            resolve({ value: frame.outcome.value });
          }
        } else {
          // Forward the framework's structured-error fields. `subclass`
          // is optional but operator-friendly copy depends on it
          // (MULTIROOM-FLOWS.md §13 catalogue keys off subclass).
          const errOut: { code: string; message: string; subclass?: string } = {
            code: frame.outcome.code,
            message: frame.outcome.message,
          };
          const sub = (frame.outcome as { subclass?: unknown }).subclass;
          if (typeof sub === "string" && sub.length > 0) {
            errOut.subclass = sub;
          }
          resolve({ error: errOut });
        }
        return;
      }
      case "subscription_ack":
        return;
      case "subscription_event": {
        // Any frame for a subscription - real event OR keepalive beat -
        // proves the subscription is alive; reset its watchdog. Keepalive
        // beats carry no subject state and are never delivered onward.
        this.armSubWatchdog(frame.subscription_id);
        if (isKeepaliveEvent(frame.event)) {
          return;
        }
        const sub = this.subscriptions.get(frame.subscription_id);
        sub?.push(frame.event);
        return;
      }
      case "subscription_ended": {
        const sub = this.subscriptions.get(frame.subscription_id);
        if (sub !== undefined) {
          sub.close(frame.reason);
          this.subscriptions.delete(frame.subscription_id);
        }
        return;
      }
      case "happening": {
        for (const handler of this.happeningListeners) {
          handler(frame);
        }
        return;
      }
    }
  }

  private onClose(_ev: CloseEvent): void {
    this.socket = null;
    // The socket is gone; every subscription's watchdog is moot until the
    // reconnect re-subscribes and re-arms them. Clear to avoid a stale
    // timer firing a second close during the reconnect window.
    this.clearAllSubWatchdogs();
    this.emitConnection("closed");
    // Fail every request outstanding at close time now - a dead
    // socket can never answer them, and leaving them pending would
    // hang their callers until (or past) the reconnect.
    for (const [requestId, resolve] of this.pending.entries()) {
      resolve({
        error: { code: "connection_closed", message: "connection closed" },
      });
      this.pending.delete(requestId);
    }
    if (this.closing) {
      return;
    }
    this.scheduleReconnect();
  }

  /**
   * Reconnect with backoff, rescheduling on every failed attempt
   * until the socket reopens.
   *
   * A device reboot drops the socket for ~a minute - far longer than
   * any single backoff delay. A one-shot reopen fires while the
   * device is still down and fails; because a socket that never
   * opened never emits `close`, onClose would not run again and the
   * transport would stay dead until a full page reload. Rescheduling
   * on failure keeps trying, so the transport reconnects on its own
   * once the device is back.
   */
  private scheduleReconnect(): void {
    if (this.closing) {
      return;
    }
    const delay =
      this.backoffMs[Math.min(this.backoffIndex, this.backoffMs.length - 1)];
    this.backoffIndex += 1;
    setTimeout(() => {
      // A concurrent ensureSocket() may have already reconnected;
      // skip this tick if a socket exists.
      if (this.closing || this.socket !== null) {
        return;
      }
      void this.openSocket()
        .then((ws) => {
          // Re-establish active subscriptions on the new socket
          // using each subscription's recorded op + payload, so
          // any happenings filter (subject_types_deny, etc.) the
          // original subscriber set survives a transport reconnect.
          for (const sub of this.subscriptions.values()) {
            const frame: IncomingFrame = {
              frame_type: "subscribe",
              subscription_id: sub.id,
              op: sub.op,
              payload: sub.payload,
            };
            ws.send(JSON.stringify(frame));
            // Re-arm the liveness watchdog on the fresh subscription.
            this.armSubWatchdog(sub.id);
          }
        })
        .catch(() => {
          // The device is still unreachable - keep retrying.
          this.scheduleReconnect();
        });
    }, delay);
  }
}

/** Detect the framework's "application error inside a success
 *  envelope" shape. The framework returns `ClientResponse::Error`
 *  variants serialised as `{ error: { class, details: { subclass },
 *  message } }` under `outcome: "ok"`. The outer envelope just says
 *  "transport delivered a response"; the inner value carries the
 *  actual operation outcome. Returns the unified error shape when
 *  detected, otherwise null. */
function readFrameworkErrorEnvelope(
  value: unknown,
): { code: string; message: string; subclass?: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const err = raw["error"];
  if (typeof err !== "object" || err === null || Array.isArray(err)) {
    return null;
  }
  const errObj = err as Record<string, unknown>;
  // Only treat it as a framework error when the object actually has
  // a message + class shape, to avoid grabbing a real domain field
  // that happens to be called `error`.
  if (typeof errObj["message"] !== "string") {
    return null;
  }
  const code =
    typeof errObj["class"] === "string" ? (errObj["class"] as string) : "error";
  const out: { code: string; message: string; subclass?: string } = {
    code,
    message: errObj["message"] as string,
  };
  const details = errObj["details"];
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    const sub = (details as Record<string, unknown>)["subclass"];
    if (typeof sub === "string" && sub.length > 0) {
      out.subclass = sub;
    }
  }
  return out;
}

function defaultWsUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/api/v1/ws`;
}
