// Contract: a dead bearer must not paint a live lie.
//
// Field failure: every paired browser on the fleet held a bearer the
// players no longer knew (pairing stores wiped; 24h token TTL). The
// framework refused those bearers at the WebSocket upgrade, the
// transport retried its construction-time token forever, the surfaces
// stayed "connected" on their last seed, and the kiosk's silent remint
// never reached the prompt socket. Only a private window (no bearer) or
// a storage wipe was live. This pins the mechanics that end that:
//
//   1. the handshake reads the CURRENT bearer on every open;
//   2. a failed reconnect attempt is observable (the stale-bearer probe
//      hangs off it);
//   3. an in-page bearer write re-handshakes a live socket at once;
//   4. the probe purges ONLY on a landed anonymous read, never on an
//      outage, and announces the purge on the one bearer bus;
//   5. the prompt seat is claimed per open socket, never anonymously.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WsTransport } from "../../src/runtime/ws-transport.ts";
import { probeStaleBearer } from "../../src/runtime/stale-bearer-probe.ts";
import { onBearerChange } from "../../src/runtime/bearer.ts";

// Minimal fake WebSocket (same shape as ws-transport-reconnect.test.ts).
// Records the subprotocols each construction presented, so the handshake
// bearer is observable per socket.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static failNext = 0;
  /** When set, every request frame is answered with this outcome. */
  static autoAnswer: ((op: string) => unknown) | null = null;

  public url: string;
  public protocols: string | string[] | undefined;
  public readyState: number = FakeWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

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
    const answer = FakeWebSocket.autoAnswer;
    if (answer === null) return;
    const frame = JSON.parse(data) as { frame_type?: string; request_id?: number; op?: string };
    if (frame.frame_type !== "request" || frame.op === undefined) return;
    const outcome = answer(frame.op);
    queueMicrotask(() =>
      this.emit("message", {
        data: JSON.stringify({
          frame_type: "response",
          response_to: frame.request_id,
          outcome
        })
      })
    );
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  public drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  private emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

function withFakeSocket(run: () => Promise<void>): Promise<void> {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.failNext = 0;
  FakeWebSocket.autoAnswer = null;
  return run().finally(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("Remint / evoBearer write -> next handshake uses the new token (kiosk day-up holder)", () =>
  withFakeSocket(async () => {
    let stored: string | undefined = "minted-at-boot";
    const transport = new WsTransport({
      url: "ws://test",
      bearerSource: () => stored,
      backoffMs: [5, 5, 5]
    });
    await transport.connect();
    assert.deepEqual(FakeWebSocket.instances[0].protocols, ["evo.bearer.minted-at-boot"]);

    // The kiosk remints into localStorage from outside the page; the
    // steward drops the old-token socket at expiry.
    stored = "reminted";
    FakeWebSocket.instances[0].drop();
    await sleep(40);

    const reopened = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    assert.equal(reopened.readyState, FakeWebSocket.OPEN);
    assert.deepEqual(reopened.protocols, ["evo.bearer.reminted"], "the reopen carried the new token");
    assert.equal(transport.handshakeBearer(), "reminted");
    await transport.close();
  }));

test("a purged bearer makes the next handshake anonymous - no reload", () =>
  withFakeSocket(async () => {
    let stored: string | undefined = "dead-soon";
    const transport = new WsTransport({
      url: "ws://test",
      bearerSource: () => stored,
      backoffMs: [5, 5, 5]
    });
    await transport.connect();
    stored = undefined; // purged by the stale-bearer policy
    transport.rotateBearer(); // the bearer bus re-handshakes a live socket now
    await sleep(40);
    const reopened = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    assert.equal(reopened.readyState, FakeWebSocket.OPEN);
    assert.equal(reopened.protocols, undefined, "anonymous upgrade after the purge");
    await transport.close();
  }));

test("a failed reconnect attempt is observable, and the loop keeps the live source", () =>
  withFakeSocket(async () => {
    const transport = new WsTransport({
      url: "ws://test",
      bearerSource: () => "stale",
      backoffMs: [5, 5, 5, 5]
    });
    await transport.connect();
    const failures: number[] = [];
    const off = transport.onReconnectAttemptFailed((attempt) => failures.push(attempt));
    FakeWebSocket.failNext = 2;
    FakeWebSocket.instances[0].drop();
    await sleep(120);
    assert.ok(failures.length >= 2, `expected failed attempts to be reported, saw ${failures.length}`);
    // Every attempt presented the live source's token - never nothing.
    for (const ws of FakeWebSocket.instances.slice(1)) {
      assert.deepEqual(ws.protocols, ["evo.bearer.stale"]);
    }
    off();
    await transport.close();
  }));

test("setBearerToken pins a snapshot and re-handshakes with it", () =>
  withFakeSocket(async () => {
    const transport = new WsTransport({
      url: "ws://test",
      bearerSource: () => "from-source",
      backoffMs: [5, 5]
    });
    await transport.connect();
    transport.setBearerToken("pinned");
    await sleep(30);
    const reopened = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    assert.deepEqual(reopened.protocols, ["evo.bearer.pinned"]);
    assert.equal(transport.handshakeBearer(), "pinned");
    await transport.close();
  }));

// ---- the probe: purge only on a landed anonymous read ----------------

function stubWindowStorage(initial: Record<string, string>): () => void {
  const store = new Map(Object.entries(initial));
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      }
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
  return () => {
    (globalThis as { window?: unknown }).window = saved;
  };
}

test("probe: anon connect fails -> device down, token kept, nothing announced", () =>
  withFakeSocket(async () => {
    const restore = stubWindowStorage({ evoBearer: "maybe-valid" });
    let announced = 0;
    const off = onBearerChange(() => {
      announced += 1;
    });
    try {
      FakeWebSocket.failNext = 3;
      const outcome = await probeStaleBearer({
        url: "ws://test",
        read: async () => true,
        isCancelled: () => false,
        connect: { maxAttempts: 2, backoffMs: [5] }
      });
      assert.equal(outcome, "device-down");
      assert.equal(
        (globalThis as { window: { localStorage: { getItem: (k: string) => string | null } } }).window
          .localStorage.getItem("evoBearer"),
        "maybe-valid",
        "a valid pair survives an outage"
      );
      assert.equal(announced, 0);
    } finally {
      off();
      restore();
    }
  }));

test("probe: anon read lands -> purge, announced on the bearer bus", () =>
  withFakeSocket(async () => {
    const restore = stubWindowStorage({ evoBearer: "dead" });
    let announced = 0;
    const off = onBearerChange(() => {
      announced += 1;
    });
    try {
      FakeWebSocket.autoAnswer = () => ({ outcome: "ok", value: { granted: [], ok: true } });
      const outcome = await probeStaleBearer({
        url: "ws://test",
        read: async (anon) => {
          const r = await anon.dispatch("negotiate", { capabilities: [] });
          return r.error === undefined;
        },
        isCancelled: () => false,
        connect: { maxAttempts: 2, backoffMs: [5] }
      });
      assert.equal(outcome, "purge");
      assert.equal(
        (globalThis as { window: { localStorage: { getItem: (k: string) => string | null } } }).window
          .localStorage.getItem("evoBearer"),
        null,
        "the dead bearer is gone"
      );
      assert.equal(announced, 1, "every live bearer socket hears the purge");
      // The probe socket itself presented no bearer and claimed nothing.
      const probeSocket = FakeWebSocket.instances[0];
      assert.equal(probeSocket.protocols, undefined);
      const sentOps = probeSocket.sent.map((s) => JSON.parse(s) as { op?: string; payload?: unknown });
      assert.deepEqual(sentOps.map((f) => f.op), ["negotiate"]);
      assert.deepEqual(sentOps[0].payload, { capabilities: [] });
    } finally {
      off();
      restore();
    }
  }));

test("probe: anon connected but read refused -> back out, token kept", () =>
  withFakeSocket(async () => {
    const restore = stubWindowStorage({ evoBearer: "unproven" });
    try {
      FakeWebSocket.autoAnswer = () => ({
        outcome: "err",
        code: "permission_denied",
        message: "refused"
      });
      const outcome = await probeStaleBearer({
        url: "ws://test",
        read: async (anon) => {
          const r = await anon.dispatch("negotiate", { capabilities: [] });
          return r.error === undefined;
        },
        isCancelled: () => false,
        connect: { maxAttempts: 2, backoffMs: [5] }
      });
      assert.equal(outcome, "backout");
      assert.equal(
        (globalThis as { window: { localStorage: { getItem: (k: string) => string | null } } }).window
          .localStorage.getItem("evoBearer"),
        "unproven"
      );
    } finally {
      restore();
    }
  }));

// ---- wiring: the hooks present the live bearer and honour the bus ----

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

test("no bearer socket snapshots storedBearer() at construction any more", () => {
  for (const rel of [
    "features/prompts/usePromptResponder.ts",
    "features/network/useNetworkLink.ts",
    "features/sources/useNetworkShares.ts",
    "features/sources/useSmbServer.ts",
    "features/sources/useUsbDrives.ts",
    "features/system/useSystemPower.ts"
  ]) {
    const text = src(rel);
    assert.ok(!/bearerToken:\s*storedBearer\(\)/.test(text), `${rel} must not snapshot the bearer`);
    assert.ok(/bearerSource:\s*storedBearer\b/.test(text), `${rel} must read the bearer at the handshake`);
  }
});

test("the transport reads the source at every open and reports failed reconnects", () => {
  const text = src("runtime/ws-transport.ts");
  assert.ok(/handshakeProtocols\(\s*handshakeBearer\(this\.bearerSource, this\.bearerToken\)/.test(text));
  assert.ok(/onReconnectAttemptFailed\(/.test(text));
  assert.ok(/reconnectFailureListeners/.test(text));
  assert.ok(/public rotateBearer\(\)/.test(text));
});

test("shelf subjects: reconnect runs the stale-bearer probe and paints only an open socket connected", () => {
  const text = src("runtime/use-shelf-subject.ts");
  assert.ok(/probeStaleBearer\(/.test(text), "reconnect probe");
  assert.ok(/onReconnectAttemptFailed\(/.test(text), "hangs off failed reconnect attempts");
  assert.ok(/onConnectionChange\(/.test(text), "socket open/closed drives the paint");
  assert.ok(/kind: "disconnected"/.test(text), "a closed socket is painted disconnected");
  assert.ok(/onBearerChange\(reauth\)/.test(text), "the bearer bus re-mounts the shelf");
  assert.ok(/bearerSource: bearerScoped \? readBearer : undefined/.test(text), "probe sockets stay anonymous");
});

test("prompt socket: claim per open socket, never anonymously, bus-driven reauth", () => {
  const text = src("features/prompts/usePromptResponder.ts");
  assert.ok(/if \(!shouldClaimResponder\(storedBearer\(\)\)\)/.test(text), "no bearer -> no claim, no socket");
  assert.ok(/onConnectionChange\(\(socketState\) => \{[\s\S]*?void claim\(\);/.test(text), "reopen re-claims the seat");
  assert.ok(/socketState === "open"[\s\S]*?\} else \{[\s\S]*?setStatus\("inactive"\)/.test(text), "a drop paints inactive");
  assert.ok(/onBearerChange\(reauthPromptResponder\)/.test(text), "pair / purge rebuilds the socket");
  assert.ok(/capabilities: \[\] \}/.test(text), "the probe read claims nothing");
  assert.ok(!/bearerToken: storedBearer\(\)/.test(text));
});

test("the bearer bus: store and purge announce; the shared transport stays anonymous", () => {
  const bearer = src("runtime/bearer.ts");
  assert.ok(/export function onBearerChange/.test(bearer));
  assert.ok(/removeItem\("evoBearer"\);\s*notifyBearerChange\(\);/.test(bearer), "purge announces");
  const trust = src("runtime/session-trust.ts");
  assert.ok(/setItem\("evoBearer", token\);\s*notifyBearerChange\(\);/.test(trust), "pair announces");
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource/.test(shared), "LAN-trust socket presents no bearer");
});
