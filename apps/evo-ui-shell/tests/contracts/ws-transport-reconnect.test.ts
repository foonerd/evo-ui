// Contract test for the WsTransport reconnect loop.
//
// Regression guard for the bug where a device reboot left the UI
// dead until a manual page reload: onClose scheduled exactly one
// reopen attempt, and because a socket that never opened never
// fires `close`, a failed attempt was never retried. The fix makes
// the reconnect reschedule itself on every failed attempt.
//
// ws-transport.ts has only `import type` dependencies, so it is
// safe to import directly into the node:test harness.

import test from "node:test";
import assert from "node:assert/strict";
import { WsTransport } from "../../src/runtime/ws-transport.ts";

// Minimal fake WebSocket. Each construction either opens or fails,
// driven by FakeWebSocket.failNext (the count of upcoming
// constructions that should fail their connection).
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static failNext = 0;

  public url: string;
  public protocols: string | string[] | undefined;
  public readyState: number = FakeWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  // No constructor parameter properties: the contract harness runs
  // under node --experimental-strip-types, which strips types but
  // does not synthesise parameter-property assignments.
  public constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
    const shouldFail = FakeWebSocket.failNext > 0;
    if (shouldFail) FakeWebSocket.failNext -= 1;
    queueMicrotask(() => {
      if (shouldFail) {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("error", { type: "error" });
      } else {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", { type: "open" });
      }
    });
  }

  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  /** Test helper: simulate the network / server dropping the socket. */
  public drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  /** Test helper: deliver a server frame to the transport. */
  public deliver(obj: unknown): void {
    this.emit("message", { data: JSON.stringify(obj) });
  }

  private emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

test("WsTransport keeps retrying the reconnect until the socket reopens", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = 0;

    // Tiny backoff so the retry loop runs in milliseconds.
    const transport = new WsTransport({
      url: "ws://test",
      backoffMs: [5, 5, 5, 5]
    });
    await transport.connect();
    assert.equal(FakeWebSocket.instances.length, 1, "one socket on connect");

    // The next two reconnect attempts fail; the third succeeds. This
    // is the reboot case: the device is down across several attempts.
    FakeWebSocket.failNext = 2;
    FakeWebSocket.instances[0].drop();

    // Wait out the backoff schedule plus the retries.
    await new Promise<void>((r) => setTimeout(r, 150));

    // The one-shot bug would leave exactly 2 sockets (initial + one
    // dead attempt). The fix retries, so more were constructed and
    // the transport ends on an OPEN socket.
    assert.ok(
      FakeWebSocket.instances.length >= 4,
      `expected reconnect retries, saw ${FakeWebSocket.instances.length} sockets`
    );
    const last =
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    assert.equal(
      last.readyState,
      FakeWebSocket.OPEN,
      "transport reconnected to an open socket"
    );

    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("keepalive watchdog: beats keep the socket, a lapse forces a reconnect", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = 0;

    const transport = new WsTransport({ url: "ws://test", backoffMs: [5, 5] });
    await transport.connect();
    const sock0 = FakeWebSocket.instances[0];

    // Subscribe with a tiny keepalive so the watchdog window is ~60ms.
    transport.subscribe("subscribe_happenings", { keepalive_ms: 20 }, {});
    await new Promise<void>((r) => setTimeout(r, 5));
    const subFrame = sock0.sent
      .map((s) => JSON.parse(s) as { frame_type: string; subscription_id?: string })
      .find((f) => f.frame_type === "subscribe");
    const subId = subFrame?.subscription_id as string;
    assert.ok(subId, "subscribe frame carried a subscription id");

    // Beats every 15ms hold the 60ms watchdog off - no reconnect.
    for (let i = 0; i < 5; i += 1) {
      sock0.deliver({
        frame_type: "subscription_event",
        subscription_id: subId,
        event: { happenings_keepalive: true, ts_ms: i }
      });
      await new Promise<void>((r) => setTimeout(r, 15));
    }
    assert.equal(
      FakeWebSocket.instances.length,
      1,
      "keepalive beats keep the same socket alive - no reconnect"
    );

    // Stop beating: the watchdog (60ms) fires, closes the socket, and the
    // reconnect loop opens a fresh one.
    await new Promise<void>((r) => setTimeout(r, 130));
    assert.ok(
      FakeWebSocket.instances.length >= 2,
      `keepalive lapse must force a reconnect, saw ${FakeWebSocket.instances.length} sockets`
    );

    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("WsTransport stops reconnecting once the caller closes it", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = 0;

    const transport = new WsTransport({
      url: "ws://test",
      backoffMs: [5, 5, 5, 5]
    });
    await transport.connect();
    await transport.close();

    // A close() drop must not trigger the reconnect loop.
    FakeWebSocket.instances[0].drop();
    const countAfterClose = FakeWebSocket.instances.length;
    await new Promise<void>((r) => setTimeout(r, 60));
    assert.equal(
      FakeWebSocket.instances.length,
      countAfterClose,
      "no reconnect attempts after an explicit close"
    );
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});
