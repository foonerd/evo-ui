// Named regression: hard-refresh critical path bounded by construction.
//
// Framework: get_now_playing / get_stream_format seed transition-only
// subjects. Shell: critical connect ≤ USABLE_SHELL_BUDGET_MS; seeds
// deadline-bounded; session teardown is explicit.

import test from "node:test";
import assert from "node:assert/strict";
import {
  connectWithRetry,
  CRITICAL_BACKOFF_MS,
  CRITICAL_CONNECT_ATTEMPTS
} from "../../src/runtime/connect-retry.ts";
import {
  USABLE_SHELL_BUDGET_MS,
  criticalConnectBudgetMs,
  deadlineSignal
} from "../../src/runtime/deadline.ts";
import { WsTransport } from "../../src/runtime/ws-transport.ts";
import { startPlaybackSession } from "../../src/features/playback/playback-session.ts";
import { encodePluginRequest } from "../../src/runtime/plugin-request-codec.ts";

class StuckWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  public readyState = StuckWebSocket.CONNECTING;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  public constructor(_url: string) {}
  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  public send(): void {}
  public close(): void {
    this.readyState = StuckWebSocket.CLOSED;
  }
}

test("criticalConnectBudgetMs ≤ usable-shell budget", () => {
  assert.ok(criticalConnectBudgetMs() <= USABLE_SHELL_BUDGET_MS);
});

test("critical connectWithRetry fails fast on stuck upgrade", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = StuckWebSocket;
  try {
    const transport = new WsTransport({
      url: "ws://test-critical",
      openTimeoutMs: 40
    });
    const started = Date.now();
    await assert.rejects(
      connectWithRetry(transport, () => undefined, () => false, {
        maxAttempts: CRITICAL_CONNECT_ATTEMPTS,
        backoffMs: [20]
      }),
      /open exceeded/
    );
    assert.ok(Date.now() - started < 500);
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

class ScriptedWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  public readyState = ScriptedWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  public constructor(_url: string) {
    queueMicrotask(() => {
      this.readyState = ScriptedWebSocket.OPEN;
      for (const cb of this.listeners["open"] ?? []) cb({ type: "open" });
    });
  }
  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  public send(data: string): void {
    this.sent.push(data);
    let frame: { frame_type?: string; request_id?: number; op?: string };
    try {
      frame = JSON.parse(data) as typeof frame;
    } catch {
      return;
    }
    if (frame.frame_type === "request" && typeof frame.request_id === "number") {
      // Minimal ok envelope with empty plugin payload_b64 for decode.
      const inner = btoa(JSON.stringify({ v: 1, transport_state: "stopped" }));
      const response = JSON.stringify({
        frame_type: "response",
        response_to: frame.request_id,
        outcome: {
          outcome: "ok",
          value: { payload_b64: inner }
        }
      });
      queueMicrotask(() => {
        for (const cb of this.listeners["message"] ?? []) {
          cb({ data: response });
        }
      });
    }
  }
  public close(): void {
    this.readyState = ScriptedWebSocket.CLOSED;
    for (const cb of this.listeners["close"] ?? []) cb({ type: "close" });
  }
}

test("startPlaybackSession reaches connected and can be stopped cleanly", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = ScriptedWebSocket;
  try {
    const transport = new WsTransport({
      url: "ws://test-session",
      openTimeoutMs: 500
    });
    const connections: string[] = [];
    let cancelled = false;
    const session = startPlaybackSession(transport, {
      onConnection: (s) => connections.push(s.kind),
      onNowPlaying: () => undefined,
      onStreamFormat: () => undefined,
      isCancelled: () => cancelled
    });
    // Allow connect + subscribe + seeds to settle.
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(
      connections.includes("connected"),
      `expected connected, got ${connections.join(",")}`
    );
    // Healthy boot must not advertise error/disconnected (no popup).
    assert.ok(!connections.includes("error"));
    assert.ok(!connections.includes("disconnected"));
    cancelled = true;
    session.stop();
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("already-open socket seeds without waiting for a second open event", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = ScriptedWebSocket;
  try {
    const transport = new WsTransport({
      url: "ws://test-already-open",
      openTimeoutMs: 500
    });
    await transport.connect();
    assert.equal(transport.isOpen(), true);
    let seeded = false;
    let cancelled = false;
    const session = startPlaybackSession(transport, {
      onConnection: () => undefined,
      onNowPlaying: () => {
        seeded = true;
      },
      onStreamFormat: () => undefined,
      isCancelled: () => cancelled
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(seeded, true, "get_now_playing must run on already-open socket");
    cancelled = true;
    session.stop();
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("seed-style deadline aborts a parked dispatch", async () => {
  class SilentWebSocket {
    public readyState = 0;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {};
    public constructor(_url: string) {
      queueMicrotask(() => {
        this.readyState = 1;
        for (const cb of this.listeners["open"] ?? []) cb({ type: "open" });
      });
    }
    public addEventListener(type: string, cb: (ev: unknown) => void): void {
      (this.listeners[type] ??= []).push(cb);
    }
    public send(): void {}
    public close(): void {
      this.readyState = 3;
    }
  }
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentWebSocket;
  try {
    const transport = new WsTransport({ url: "ws://test-seed", openTimeoutMs: 200 });
    await transport.connect();
    const d = deadlineSignal(30);
    const result = await transport.dispatch(
      "request",
      encodePluginRequest("audio.playback", "get_now_playing", { v: 1 }) as unknown as Record<string, unknown>,
      { signal: d.signal }
    );
    d.cancel();
    assert.equal(result.error?.code, "aborted");
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("CRITICAL backoff constants match deadline module (no drift)", () => {
  assert.equal(CRITICAL_CONNECT_ATTEMPTS, 2);
  assert.deepEqual(CRITICAL_BACKOFF_MS, [200]);
});
