// Contract: the recovery open deadline is separate from the critical one.
//
// Named defect: after a device reboot the shell looped forever cycling
// "Playback service unavailable / WebSocket open exceeded 800ms deadline"
// and "Connecting to playback". Root cause: this box's real WS handshake
// is ~1.7-3s, but every reconnect attempt raced the 800ms critical open
// deadline and died, and playback re-entered the critical schedule on a
// timer - an infinite loop only a hard refresh cleared.
//
// The fix keeps the critical first-paint budget tight (two 800ms attempts,
// degrade inside USABLE_SHELL_BUDGET_MS) but gives the RECOVERY path (the
// transport's own reconnect after a drop, and playback's post-degrade
// loop) a separate, real-handshake-sized open deadline. These fixtures
// pin that split with SCALED deadlines so the suite runs in milliseconds.
//
// ws-transport.ts / playback-session.ts have only `import type` deps, so
// they import directly into the node:test harness.

import test from "node:test";
import assert from "node:assert/strict";
import { WsTransport } from "../../src/runtime/ws-transport.ts";
import { startPlaybackSession } from "../../src/features/playback/playback-session.ts";
import {
  DEFAULT_OPEN_DEADLINE_MS,
  RECOVERY_OPEN_DEADLINE_MS
} from "../../src/runtime/deadline.ts";

// Fake WebSocket whose upgrade takes `openDelayMs`. If the transport's
// open deadline fires first it close()s the nascent socket, so the late
// open is suppressed - exactly the real deadline race. Model a dead host
// with an open delay longer than any test window.
class DelayedWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: DelayedWebSocket[] = [];
  static openDelayMs = 0;

  public url: string;
  public protocols: string | string[] | undefined;
  public readyState: number = DelayedWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  private openTimer: ReturnType<typeof setTimeout>;

  public constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    DelayedWebSocket.instances.push(this);
    this.openTimer = setTimeout(() => {
      if (this.readyState === DelayedWebSocket.CLOSED) return;
      this.readyState = DelayedWebSocket.OPEN;
      this.emit("open", { type: "open" });
    }, DelayedWebSocket.openDelayMs);
  }

  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(_code?: number, _reason?: string): void {
    clearTimeout(this.openTimer);
    this.readyState = DelayedWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  /** Simulate the server/network dropping a live socket. */
  public drop(): void {
    clearTimeout(this.openTimer);
    this.readyState = DelayedWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  private emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

function withFakeWs<T>(fn: () => Promise<T>): Promise<T> {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = DelayedWebSocket;
  DelayedWebSocket.instances = [];
  DelayedWebSocket.openDelayMs = 0;
  return fn().finally(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

test("recovery deadline is a distinct, larger budget than the critical one", () => {
  assert.ok(
    RECOVERY_OPEN_DEADLINE_MS > DEFAULT_OPEN_DEADLINE_MS,
    "recovery open budget must exceed the critical first-paint budget"
  );
  // Floor above the measured ~3s handshake, still bounded (not minutes).
  assert.ok(RECOVERY_OPEN_DEADLINE_MS > 3000);
  assert.ok(RECOVERY_OPEN_DEADLINE_MS <= 60_000);
});

test("critical open misses a slow handshake; connectRecovery completes it", async () => {
  await withFakeWs(async () => {
    DelayedWebSocket.openDelayMs = 60; // handshake longer than critical
    const transport = new WsTransport({
      url: "ws://test-recover",
      openTimeoutMs: 20, // critical: too tight for a 60ms handshake
      recoveryOpenTimeoutMs: 300 // recovery: room for the real handshake
    });
    // Critical connect races the 20ms deadline and loses.
    await assert.rejects(transport.connect(), /open exceeded 20ms/);
    assert.equal(transport.isOpen(), false);
    // Recovery connect uses the 300ms budget - the same handshake fits.
    await transport.connectRecovery();
    assert.equal(transport.isOpen(), true);
    await transport.close();
  });
});

test("transport auto-reconnect after a drop uses the recovery deadline, not 800", async () => {
  await withFakeWs(async () => {
    DelayedWebSocket.openDelayMs = 0; // first open is instant
    const transport = new WsTransport({
      url: "ws://test-drop",
      openTimeoutMs: 20,
      recoveryOpenTimeoutMs: 300,
      backoffMs: [5, 5, 5, 5]
    });
    await transport.connect();
    assert.equal(transport.isOpen(), true);

    // The handshake is now slow (60ms). With the critical 20ms budget the
    // reconnect would never complete and loop forever; the recovery 300ms
    // budget lets it back in.
    DelayedWebSocket.openDelayMs = 60;
    DelayedWebSocket.instances[0].drop();
    await sleep(400);

    const last =
      DelayedWebSocket.instances[DelayedWebSocket.instances.length - 1];
    assert.equal(
      last.readyState,
      DelayedWebSocket.OPEN,
      "scheduleReconnect reconnected on the recovery deadline"
    );
    await transport.close();
  });
});

test("dead host: playback degrades ONCE inside the critical budget, no churn", async () => {
  await withFakeWs(async () => {
    DelayedWebSocket.openDelayMs = 100_000; // never opens = dead host
    const transport = new WsTransport({
      url: "ws://test-dead",
      openTimeoutMs: 20,
      recoveryOpenTimeoutMs: 100
    });
    const kinds: string[] = [];
    let cancelled = false;
    const started = Date.now();
    const session = startPlaybackSession(transport, {
      onConnection: (s) => kinds.push(s.kind),
      onNowPlaying: () => undefined,
      onStreamFormat: () => undefined,
      isCancelled: () => cancelled
    });
    await sleep(400);
    // Degraded well inside the usable-shell budget (two 20ms + 200 backoff).
    assert.ok(kinds.includes("error"), `expected degrade, got ${kinds.join(",")}`);
    assert.ok(Date.now() - started < 2000, "degrade must land inside 2s");
    // The loop bug flip-flopped connecting<->error forever. Recovery holds
    // the degrade popup steady: exactly one error, never connected.
    assert.equal(
      kinds.filter((k) => k === "error").length,
      1,
      `error must be raised once, got ${kinds.join(",")}`
    );
    assert.ok(!kinds.includes("connected"));
    cancelled = true;
    session.stop();
    await transport.close();
  });
});

test("slow handshake (1.7-3s scaled): critical misses, playback recovers to connected", async () => {
  await withFakeWs(async () => {
    DelayedWebSocket.openDelayMs = 60; // real handshake, longer than critical
    const transport = new WsTransport({
      url: "ws://test-slow",
      openTimeoutMs: 20,
      recoveryOpenTimeoutMs: 300
    });
    const kinds: string[] = [];
    let cancelled = false;
    const session = startPlaybackSession(transport, {
      onConnection: (s) => kinds.push(s.kind),
      onNowPlaying: () => undefined,
      onStreamFormat: () => undefined,
      isCancelled: () => cancelled
    });
    // Critical (~240ms) misses -> degrade; recovery waits one backoff step
    // (500ms) then connects on the 300ms open budget.
    await sleep(1000);
    assert.ok(kinds.includes("error"), `expected degrade first, got ${kinds.join(",")}`);
    assert.ok(kinds.includes("connected"), `expected recovery, got ${kinds.join(",")}`);
    assert.ok(
      kinds.indexOf("error") < kinds.lastIndexOf("connected"),
      "degrade precedes recovery"
    );
    cancelled = true;
    session.stop();
    await transport.close();
  });
});
