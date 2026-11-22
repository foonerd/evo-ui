// Contract: the glass honours the sitting's expires_at_ms.
//
// Field failure: step_up_auth_verify answers { token, expires_at_ms }, but
// the one card kept only the token. Past expires_at_ms the token still
// counted as a live sitting: the Settings gate stayed open on it, and
// Library Remove on a protected sources group skipped the card and sent
// Remove with a dead token - the queue was released, then the handoff was
// refused. The kiosk, always on, is the primary case.
//
// Now the card keeps what verify issued - the token and its
// expires_at_ms - in one in-memory sitting store. A token at or past
// expires_at_ms is no sitting: getToken answers null (ignored on read),
// and a timer clears it and tells every subscriber, so live falls on the
// gates without a reload. A token re-set by the caller that acquired it
// keeps the expiry verify gave it. An answer with no expires_at_ms keeps
// the old rule (the wire refusal path decides). Still one card, one store.
// Run:
//   node --experimental-strip-types --test tests/contracts/step-up-sitting-expiry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as trust from "../../src/runtime/session-trust.ts";
import { dispatchWithStepUp, type StepUpBridge } from "../../src/runtime/step-up-dispatch.ts";
import { removeNeedsSitting } from "../../src/features/library/remove-household.ts";
import { decodeHouseholdSnapshot } from "../../src/features/household/household-protection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const storePath = join(root, "features", "pairing", "step-up-sitting-store.ts");
const host = read("features/pairing/StepUpHost.tsx");
const sittingHook = read("features/household/useStepUpSitting.ts");
const trustSrc = read("runtime/session-trust.ts");

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

async function storeModule(): Promise<typeof import("../../src/features/pairing/step-up-sitting-store.ts")> {
  assert.ok(existsSync(storePath), "features/pairing/step-up-sitting-store.ts exists");
  return await import("../../src/features/pairing/step-up-sitting-store.ts");
}

// A clock the test drives: now() is the wall clock, timers fire when told.
function fakeClock(start: number) {
  let id = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const clock = {
    t: start,
    now: () => clock.t,
    setTimer: (fn: () => void, ms: number): number => {
      id += 1;
      timers.set(id, { fn, at: clock.t + ms });
      return id;
    },
    clearTimer: (h: unknown): void => {
      timers.delete(h as number);
    },
    // Advance and fire every timer that is due.
    advance(to: number): void {
      clock.t = to;
      for (const [k, v] of [...timers]) {
        if (v.at <= to) {
          timers.delete(k);
          v.fn();
        }
      }
    },
    pending: (): number => timers.size
  };
  return clock;
}

const CATALOG = {
  levels: [
    { id: "open", default_groups: [] },
    { id: "low", default_groups: ["network", "file-sharing", "sources"] }
  ],
  groups: [
    { id: "network", scopes: ["network_admin"] },
    { id: "file-sharing", scopes: ["network_admin"] },
    { id: "sources", scopes: ["network_admin"] }
  ]
};
const low = decodeHouseholdSnapshot({ chosen: true, level: "low", lend: false, protected_groups: [], catalog: CATALOG });

const START = 1_800_000_000_000;
const TTL = 300_000;

// ---- the wire: verify answers the token and its expiry -------------------

test("step_up_auth_verify decodes to the token and expires_at_ms", () => {
  const decode = (trust as Record<string, unknown>)["decodeStepUpIssued"] as
    | ((raw: unknown) => { token: string; expiresAtMs: number | null } | null)
    | undefined;
  assert.equal(typeof decode, "function", "session-trust exports decodeStepUpIssued");
  assert.deepEqual(
    decode!({ step_up_auth_issued: true, token: "tok", expires_at_ms: START + TTL, principal_username: "evo" }),
    { token: "tok", expiresAtMs: START + TTL }
  );
  assert.deepEqual(decode!({ token: "tok" }), { token: "tok", expiresAtMs: null }, "no expiry on the wire: none invented");
  assert.equal(decode!({ token: "", expires_at_ms: START }), null);
  assert.equal(decode!({ expires_at_ms: START }), null);
  assert.equal(decode!(null), null);
  const verify = code(trustSrc).slice(code(trustSrc).indexOf("export async function stepUpVerify("));
  assert.ok(/const issued = decodeStepUpIssued\(r\.value\);/.test(verify) && /return \{ ok: true, value: issued \};/.test(verify), "stepUpVerify answers the token with its expiry");
});

// ---- the store: expired is no sitting -------------------------------------

test("a token at or past expires_at_ms is no sitting; before it, it is", async () => {
  const { createStepUpSittingStore, liveToken } = await storeModule();
  assert.equal(liveToken({ token: "a", expiresAtMs: START + 1 }, START), "a");
  assert.equal(liveToken({ token: "a", expiresAtMs: START }, START), null, "at expires_at_ms: gone");
  assert.equal(liveToken({ token: "a", expiresAtMs: START }, START + 1), null);
  assert.equal(liveToken({ token: "a", expiresAtMs: null }, START + 10 * TTL), "a", "no expiry known: the old rule");
  assert.equal(liveToken(null, START), null);

  const clock = fakeClock(START);
  const store = createStepUpSittingStore(clock);
  store.issue("tok", START + TTL);
  store.setToken("tok"); // the acquiring caller re-sets the same token
  clock.t = START + TTL - 1;
  assert.equal(store.getToken(), "tok", "live until expires_at_ms");
  clock.t = START + TTL;
  assert.equal(store.getToken(), null, "past it, ignored on read even before the timer runs");
});

test("the expiry timer clears the sitting and tells every subscriber; a late subscriber sees none", async () => {
  const { createStepUpSittingStore } = await storeModule();
  const clock = fakeClock(START);
  const store = createStepUpSittingStore(clock);
  const seen: (string | null)[] = [];
  const off = store.subscribe((tok) => seen.push(tok));
  store.issue("tok", START + TTL);
  store.setToken("tok");
  assert.equal(clock.pending(), 1, "one timer for the sitting");
  clock.advance(START + TTL);
  assert.deepEqual(seen, [null, "tok", null], "live, then cleared at expiry");
  const late: (string | null)[] = [];
  store.subscribe((tok) => late.push(tok));
  assert.deepEqual(late, [null]);
  store.setToken("tok");
  assert.equal(store.getToken(), null, "a dead token re-set is still dead - never revived with no end");
  off();
  store.setToken(null);
  assert.equal(clock.pending(), 0, "no timer without a sitting");
  store.issue("b", START + 2 * TTL);
  store.setToken("b");
  store.dispose();
  assert.equal(clock.pending(), 0, "dispose stops the timer");
  assert.equal(store.getToken(), "b", "dispose does not end a live sitting");
});

// ---- the row: an expired token cannot let Remove skip the card ------------

test("an expired sitting raises the card before Remove and never rides the send", async () => {
  const { createStepUpSittingStore } = await storeModule();
  const clock = fakeClock(START);
  const store = createStepUpSittingStore(clock);
  store.issue("old", START + TTL);
  store.setToken("old");

  // Still live: no card; the token rides the first send.
  clock.t = START + TTL - 1;
  assert.equal(removeNeedsSitting(low, store.getToken() !== null), false);

  // Past expires_at_ms: the sources group is protected and there is no sitting.
  clock.t = START + TTL + 60_000;
  assert.equal(removeNeedsSitting(low, store.getToken() !== null), true, "the card is raised before Remove");

  let acquired = 0;
  const bridge: StepUpBridge = {
    getToken: store.getToken,
    setToken: store.setToken,
    subscribe: store.subscribe,
    acquire: async () => {
      acquired += 1;
      return null;
    }
  };
  const sent: Record<string, unknown>[] = [];
  await dispatchWithStepUp(
    async (_op, payload) => {
      sent.push(payload);
      return { value: { ok: true } };
    },
    "request",
    { shelf: "audio.library", request_type: "library.remove_source" },
    undefined,
    bridge
  );
  assert.equal(sent.length, 1);
  assert.ok(!("step_up_token" in sent[0]), "a dead token never rides a send");
  assert.equal(acquired, 0);
});

// ---- the glass: one card, one store, live honours expiry ------------------

test("the one card keeps verify's expiry in the one store; live honours it", () => {
  const h = code(host);
  assert.ok(/import \{ createStepUpSittingStore \} from "\.\/step-up-sitting-store";/.test(host));
  assert.ok(/const sittingRef = useRef\(createStepUpSittingStore\(\)\);/.test(h));
  assert.ok(!/tokenRef|listenersRef/.test(h), "no second token cache beside the store");
  assert.ok(/getToken: sitting\.getToken,/.test(h) && /setToken: sitting\.setToken,/.test(h) && /subscribe: sitting\.subscribe/.test(h), "the bridge is the store");
  assert.ok(/sittingRef\.current\.issue\(verify\.value\.token, verify\.value\.expiresAtMs\);/.test(h), "the card records the expiry verify answered");
  assert.ok(/laneRef\.current\.settle\(verify\.value\.token\);/.test(h));
  assert.ok(/sitting\.dispose\(\);/.test(h), "the timer stops on unmount");
  assert.equal((h.match(/setStepUpBridge\(/g) ?? []).length, 2, "one bridge installed, cleared on unmount");

  const s = code(sittingHook);
  assert.ok(/const bridgeLive = getStepUpBridge\(\)\?\.getToken\(\) != null;/.test(s), "live is read through the store's expiry");
  assert.ok(/return \{ live: live && bridgeLive, request \};/.test(s));
  assert.ok(/if \(bridge\.getToken\(\) !== null\) return true;/.test(s), "request raises the card when the cached token is gone");
});

test("source carries no row id and is ASCII", () => {
  for (const s of [host, sittingHook, trustSrc]) assert.ok(!/\b[A-Z][0-9]\b/.test(code(s)), "no row id in source");
  if (existsSync(storePath)) {
    const s = readFileSync(storePath, "utf8");
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(s), "store is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in the store");
  }
});
