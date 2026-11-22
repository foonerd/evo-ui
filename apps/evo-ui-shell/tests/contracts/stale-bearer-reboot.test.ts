// Contract: a reboot must not purge a live pairing.
//
// Field failure: a paired browser rebooted the player from the power
// cluster. While the player was down, the bearer socket's upgrade failed
// (an outage and a dead token look the same at the upgrade: close 1006).
// The stale-bearer probe then retried an ANONYMOUS socket until the
// player came back, its read landed, and the policy purged the bearer -
// a token the player still honoured. The browser fell back to "pair to
// manage" and the household raise refused as pair-first. Core bearer
// validation was innocent; the race was on the glass.
//
// Now, when the anonymous read lands, the stored bearer is re-handshaken
// once at that moment - one upgrade, no request on it. If that upgrade
// opens, the token is kept (the earlier failure was the outage). Only if
// that upgrade fails while the anonymous one succeeded is the token
// purged. The same rule governs the shelf subject's first-seed probe.
// Device down and a refused anonymous read keep the token, as before.
// Run:
//   node --experimental-strip-types --test tests/contracts/stale-bearer-reboot.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { probeStaleBearer } from "../../src/runtime/stale-bearer-probe.ts";
import * as policy from "../../src/runtime/stale-bearer-policy.ts";
import { onBearerChange } from "../../src/runtime/bearer.ts";

// A fake WebSocket that decides per upgrade whether it opens, and logs
// the order of events so "at that moment" is observable.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static log: string[] = [];
  /** true = this upgrade fails. */
  static refuse: (protocols: string[] | undefined) => boolean = () => false;

  public url: string;
  public protocols: string[] | undefined;
  public readyState: number = FakeWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  public constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = typeof protocols === "string" ? [protocols] : protocols;
    FakeWebSocket.instances.push(this);
    const kind = this.protocols === undefined ? "anon" : "bearer";
    const fail = FakeWebSocket.refuse(this.protocols);
    FakeWebSocket.log.push(`${kind}-upgrade-${fail ? "refused" : "open"}`);
    queueMicrotask(() => {
      if (fail) {
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
    const frame = JSON.parse(data) as { frame_type?: string; request_id?: number; op?: string };
    if (frame.frame_type !== "request" || frame.op === undefined) return;
    FakeWebSocket.log.push(`request-${frame.op}`);
    queueMicrotask(() =>
      this.emit("message", {
        data: JSON.stringify({
          frame_type: "response",
          response_to: frame.request_id,
          outcome: { outcome: "ok", value: { granted: [], ok: true } }
        })
      })
    );
  }

  public close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  private emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

function withFakes(initial: Record<string, string>, run: (store: Map<string, string>) => Promise<void>): Promise<void> {
  const savedWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  const savedWin = (globalThis as { window?: unknown }).window;
  const store = new Map(Object.entries(initial));
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
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
  FakeWebSocket.instances = [];
  FakeWebSocket.log = [];
  FakeWebSocket.refuse = () => false;
  return run(store).finally(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = savedWs;
    (globalThis as { window?: unknown }).window = savedWin;
  });
}

const negotiateRead = async (anon: { dispatch: (op: string, p: Record<string, unknown>) => Promise<{ error?: unknown }> }): Promise<boolean> => {
  const r = await anon.dispatch("negotiate", { capabilities: [] });
  return r.error === undefined;
};

// ---- the two field cases ---------------------------------------------------

test("a bearer that failed during the outage and upgrades once the player is back is kept", () =>
  withFakes({ evoBearer: "live" }, async (store) => {
    let announced = 0;
    const off = onBearerChange(() => {
      announced += 1;
    });
    try {
      // The player is still booting: the anonymous upgrade fails twice,
      // then the player answers. The bearer was never refused by it.
      let anonDown = 2;
      FakeWebSocket.refuse = (p) => (p === undefined ? anonDown-- > 0 : false);
      const outcome = await probeStaleBearer({
        url: "ws://test",
        read: negotiateRead,
        isCancelled: () => false,
        connect: { maxAttempts: 5, backoffMs: [1] }
      });
      assert.notEqual(outcome, "purge", "a live pairing is not purged");
      assert.equal(outcome, "bearer-live");
      assert.equal(store.get("evoBearer"), "live", "the stored bearer is kept");
      assert.equal(announced, 0, "nothing announced on the bearer bus");
      const bearerSockets = FakeWebSocket.instances.filter((s) => s.protocols !== undefined);
      assert.equal(bearerSockets.length, 1, "the stored bearer is re-handshaken once");
      assert.deepEqual(bearerSockets[0].protocols, ["evo.bearer.live"], "with the token stored at that moment");
      assert.equal(bearerSockets[0].sent.length, 0, "an upgrade only - no request rides it");
      assert.equal(bearerSockets[0].readyState, FakeWebSocket.CLOSED, "and it is closed");
      assert.deepEqual(
        FakeWebSocket.log,
        ["anon-upgrade-refused", "anon-upgrade-refused", "anon-upgrade-open", "request-negotiate", "bearer-upgrade-open"],
        "the re-handshake runs when the anonymous read has landed"
      );
    } finally {
      off();
    }
  }));

test("a bearer the player refuses while the anonymous read lands is still purged", () =>
  withFakes({ evoBearer: "dead" }, async (store) => {
    let announced = 0;
    const off = onBearerChange(() => {
      announced += 1;
    });
    try {
      FakeWebSocket.refuse = (p) => p !== undefined && p.includes("evo.bearer.dead");
      const outcome = await probeStaleBearer({
        url: "ws://test",
        read: negotiateRead,
        isCancelled: () => false,
        connect: { maxAttempts: 2, backoffMs: [1] }
      });
      assert.equal(outcome, "purge");
      assert.equal(store.get("evoBearer"), undefined, "the dead bearer is gone");
      assert.equal(announced, 1, "every live bearer socket hears the purge");
      assert.deepEqual(
        FakeWebSocket.log,
        ["anon-upgrade-open", "request-negotiate", "bearer-upgrade-refused"],
        "purged only after the re-handshake was refused while the anonymous one opened"
      );
    } finally {
      off();
    }
  }));

test("device down and a refused anonymous read still keep the token and never re-handshake", () =>
  withFakes({ evoBearer: "maybe" }, async (store) => {
    FakeWebSocket.refuse = () => true;
    const down = await probeStaleBearer({
      url: "ws://test",
      read: negotiateRead,
      isCancelled: () => false,
      connect: { maxAttempts: 2, backoffMs: [1] }
    });
    assert.equal(down, "device-down");
    assert.equal(store.get("evoBearer"), "maybe");
    FakeWebSocket.refuse = () => false;
    FakeWebSocket.instances = [];
    const backout = await probeStaleBearer({
      url: "ws://test",
      read: async () => false,
      isCancelled: () => false,
      connect: { maxAttempts: 2, backoffMs: [1] }
    });
    assert.equal(backout, "backout");
    assert.equal(store.get("evoBearer"), "maybe");
    assert.equal(FakeWebSocket.instances.filter((s) => s.protocols !== undefined).length, 0, "no re-handshake without a landed read");
  }));

// ---- the decision, pure ------------------------------------------------------

test("after a landed anonymous read: the bearer re-handshake decides keep or purge", () => {
  const f = (policy as Record<string, unknown>)["resolveBearerRecheck"] as ((landed: boolean) => string) | undefined;
  assert.equal(typeof f, "function", "stale-bearer-policy exports resolveBearerRecheck");
  assert.equal(f!(true), "keep-bearer-live");
  assert.equal(f!(false), "purge");
  // The tables it follows are unchanged: never purge without a landed read.
  assert.equal(policy.resolveProbeRead({ probing: true, readLanded: true }), "purge");
  assert.equal(policy.resolveProbeRead({ probing: true, readLanded: false }), "backout");
  assert.equal(policy.resolveProbeRead({ probing: false, readLanded: true }), "none");
});

// ---- the callers ---------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  assert.ok(a >= 0, "missing " + from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, "missing " + to);
  return s.slice(a, b);
}

test("the shelf subject's first-seed probe re-handshakes the stored bearer before it purges", () => {
  const c = code(src("runtime/use-shelf-subject.ts"));
  const purge = between(c, 'if (probeRead === "purge") {', '} else if (probeRead === "backout") {');
  assert.ok(
    /const recheck = resolveBearerRecheck\(\s*await bearerUpgradeLands\(frameworkUrl\(\), readBearer\(\)\)\s*\);\s*if \(cancelled\) return;\s*if \(recheck === "keep-bearer-live"\) \{\s*forceAnonRef\.current = false;\s*setReauthNonce\(\(n\) => n \+ 1\);\s*return;\s*\}\s*clearBearer\(\);/.test(purge),
    "a bearer that upgrades now is kept and the shelf re-mounts on it; only a refused one is purged"
  );
  assert.equal((c.match(/clearBearer\(\)/g) ?? []).length, 1, "one purge site in the subject");
});

test("the other callers: one helper decides; no second send of the same ask", () => {
  const probe = code(src("runtime/stale-bearer-probe.ts"));
  assert.ok(/export async function bearerUpgradeLands\(/.test(probe));
  assert.ok(/new WsTransport\(\{ url, bearerToken: token \}\)/.test(probe), "the re-handshake presents the token it was given");
  assert.equal((probe.match(/clearBearer\(\)/g) ?? []).length, 1, "one purge site in the probe");
  const link = code(src("features/network/useNetworkLink.ts"));
  assert.ok(/if \(outcome !== "purge"\) \{\s*return \{/.test(link), "a kept bearer returns the honest error; the write is not re-sent");
  const prompt = code(src("features/prompts/usePromptResponder.ts"));
  assert.ok(/if \(cancelled \|\| outcome === "purge"\) return;/.test(prompt), "a kept bearer keeps the first-open loop retrying");
});
