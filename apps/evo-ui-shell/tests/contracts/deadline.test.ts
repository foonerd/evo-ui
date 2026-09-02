// Contract tests for critical-path deadline primitives + transport bounds.

import test from "node:test";
import assert from "node:assert/strict";
import {
  withDeadline,
  deadlineSignal,
  criticalConnectBudgetMs,
  USABLE_SHELL_BUDGET_MS,
  DEFAULT_OPEN_DEADLINE_MS,
  DEFAULT_SEED_DEADLINE_MS,
  CRITICAL_CONNECT_ATTEMPTS,
  CRITICAL_BACKOFF_MS
} from "../../src/runtime/deadline.ts";
import { WsTransport } from "../../src/runtime/ws-transport.ts";
import { pluginRequest } from "../../src/runtime/plugin-request-codec.ts";
import type { WireOpResult } from "../../src/sdk/types.ts";

test("critical connect budget is strictly inside the usable-shell ceiling", () => {
  const budget = criticalConnectBudgetMs();
  assert.ok(
    budget <= USABLE_SHELL_BUDGET_MS,
    `critical connect ${budget}ms must be ≤ ${USABLE_SHELL_BUDGET_MS}ms`
  );
  assert.equal(CRITICAL_CONNECT_ATTEMPTS, 2);
  assert.equal(DEFAULT_OPEN_DEADLINE_MS, 800);
  assert.equal(DEFAULT_SEED_DEADLINE_MS, 800);
  assert.deepEqual(CRITICAL_BACKOFF_MS, [200]);
});

test("withDeadline returns the value when it settles before the deadline", async () => {
  const r = await withDeadline(Promise.resolve(42), 1000);
  assert.deepEqual(r, { timedOut: false, value: 42 });
});

test("withDeadline reports timedOut for a promise that never settles", async () => {
  const never = new Promise<number>(() => {});
  const r = await withDeadline(never, 20);
  assert.deepEqual(r, { timedOut: true });
});

test("deadlineSignal aborts after the deadline and cancel() prevents it", async () => {
  const late = deadlineSignal(20);
  assert.equal(late.signal.aborted, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(late.signal.aborted, true);

  const cancelled = deadlineSignal(20);
  cancelled.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cancelled.signal.aborted, false);
});

class StuckWebSocket {
  static instances: StuckWebSocket[] = [];
  public url: string;
  public readyState = 0;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  public constructor(url: string) {
    this.url = url;
    StuckWebSocket.instances.push(this);
  }
  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  public send(): void {}
  public close(): void {
    this.readyState = 3;
  }
}

test("WsTransport open is bounded: a stuck upgrade rejects, never hangs", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = StuckWebSocket;
  try {
    StuckWebSocket.instances = [];
    const transport = new WsTransport({ url: "ws://test", openTimeoutMs: 40 });
    const started = Date.now();
    await assert.rejects(
      transport.connect(),
      /open exceeded 40ms deadline/
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `bounded (${elapsed}ms)`);
    assert.equal(StuckWebSocket.instances[0].readyState, 3);
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

class SilentWebSocket {
  public url: string;
  public readyState = 0;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  public constructor(url: string) {
    this.url = url;
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
    for (const cb of this.listeners["close"] ?? []) cb({ type: "close" });
  }
}

test("dispatch honours an abort signal: a stalled seed read resolves, never parks forever", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentWebSocket;
  try {
    const transport = new WsTransport({ url: "ws://test", openTimeoutMs: 1000 });
    await transport.connect();
    const d = deadlineSignal(30);
    const started = Date.now();
    const result: WireOpResult = await transport.dispatch(
      "request",
      { shelf: "audio.playback", request_type: "get_now_playing" },
      { signal: d.signal }
    );
    d.cancel();
    assert.equal(result.error?.code, "aborted");
    assert.ok(Date.now() - started < 1000);
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("dispatch refuses immediately when signal is already aborted", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentWebSocket;
  try {
    const transport = new WsTransport({ url: "ws://test", openTimeoutMs: 1000 });
    await transport.connect();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await transport.dispatch(
      "request",
      { shelf: "audio.playback", request_type: "get_now_playing" },
      { signal: ctrl.signal }
    );
    assert.equal(result.error?.code, "aborted");
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("pluginRequest forwards opts.signal to the transport dispatch", async () => {
  let seenSignal: AbortSignal | undefined;
  const spy = {
    dispatch(
      _op: string,
      _payload: Record<string, unknown>,
      opts?: { signal?: AbortSignal }
    ): Promise<WireOpResult> {
      seenSignal = opts?.signal;
      return Promise.resolve({ value: { payload_b64: btoa("{}") } });
    }
  };
  const ctrl = new AbortController();
  await pluginRequest(spy, "audio.playback", "get_now_playing", { v: 1 }, {
    signal: ctrl.signal
  });
  assert.equal(seenSignal, ctrl.signal);
});

test("onConnectionChange fires open and closed", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentWebSocket;
  try {
    const transport = new WsTransport({ url: "ws://test", openTimeoutMs: 1000 });
    const events: string[] = [];
    const off = transport.onConnectionChange((s) => events.push(s));
    await transport.connect();
    assert.deepEqual(events, ["open"]);
    // Trigger close via the fake socket.
    const sock = (transport as unknown as { socket: SilentWebSocket | null }).socket;
    assert.ok(sock !== null);
    sock.close();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(events.includes("closed"));
    off();
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});
