// Contract: a sent sitting the framework refuses as expired or invalid is
// cleared, and the one card is raised once.
//
// Field failure: a sitting that the glass still held rode the first send
// (household restore to Open, a protected verb). The framework validated
// it and refused it - step_up_expired (past its end) or step_up_invalid
// (unknown: revoked, reaped, a steward restart). Neither is
// step_up_required, so the one inline step-up path passed it straight
// through: the dead token stayed cached, no card was raised, and the
// surface painted the bare refusal ("refused: 403 Forbidden").
//
// Now, on any elevatable op, when the cached sitting rode the send and
// the refusal is step_up_expired or step_up_invalid, the sitting is
// cleared and the one card is raised once - exactly as for a household
// lock on a cached sitting. Cancel returns the original refusal with the
// sitting cleared. A fresh sitting refused again is cleared and surfaced;
// nothing loops or stacks. The household set shows the existing
// system-password ask on a cancelled card, never the raw refusal. The
// predicate that raises the card for a send with no sitting stays
// step_up_required only.
// Run:
//   node --experimental-strip-types --test tests/contracts/step-up-sitting-refused.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dispatchWithStepUp, type StepUpBridge } from "../../src/runtime/step-up-dispatch.ts";
import * as elevation from "../../src/runtime/step-up-elevation.ts";
import { HOUSEHOLD_SET_OP } from "../../src/features/household/household-protection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const householdHook = readFileSync(join(root, "features", "household", "useHouseholdProtection.ts"), "utf8");
const elevationSrc = readFileSync(join(root, "runtime", "step-up-elevation.ts"), "utf8");
const dispatchSrc = readFileSync(join(root, "runtime", "step-up-dispatch.ts"), "utf8");

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// The refusals as the WS frame carries them: code refused, the bare
// status line as the message, the subclass beside it.
const EXPIRED = { code: "refused", message: "refused: 403 Forbidden", subclass: "step_up_expired" };
const INVALID = { code: "refused", message: "refused: 403 Forbidden", subclass: "step_up_invalid" };
const STEPUP = { code: "permission_denied", message: "elevate", subclass: "step_up_required" };
const LOCKED = { code: "permission_denied", message: "403 Forbidden", subclass: "household_policy_locked" };

function bridge(
  acquireToken: string | null,
  init: string | null = null
): StepUpBridge & { acquired: number; token: string | null } {
  return {
    token: init,
    acquired: 0,
    getToken() {
      return this.token;
    },
    setToken(t: string | null) {
      this.token = t;
    },
    async acquire() {
      this.acquired += 1;
      return acquireToken;
    }
  };
}

function isSittingRefused(e: unknown): boolean {
  const f = (elevation as Record<string, unknown>)["isSittingRefused"] as ((x: unknown) => boolean) | undefined;
  assert.equal(typeof f, "function", "step-up-elevation exports isSittingRefused");
  return f!(e);
}

test("the sitting refusals are step_up_expired and step_up_invalid; the card predicate stays narrow", () => {
  assert.equal(isSittingRefused(EXPIRED), true);
  assert.equal(isSittingRefused(INVALID), true);
  assert.equal(isSittingRefused(STEPUP), false);
  assert.equal(isSittingRefused(LOCKED), false);
  assert.equal(isSittingRefused({ code: "refused", message: "refused: 403 Forbidden" }), false, "no subclass: not a sitting refusal");
  assert.equal(isSittingRefused(undefined), false);
  assert.equal(elevation.isElevationRequired(EXPIRED), false, "a send with no sitting still raises the card on step_up_required only");
  assert.equal(elevation.isElevationRequired(INVALID), false);
  assert.ok(/return error\.subclass === "step_up_required";/.test(code(elevationSrc)));
});

for (const [name, refusal, op, payload] of [
  ["household restore (expired)", EXPIRED, HOUSEHOLD_SET_OP, { lend: false, level: "open" }],
  ["household restore (invalid)", INVALID, HOUSEHOLD_SET_OP, { lend: false, level: "open" }],
  ["a protected verb (expired)", EXPIRED, "request", { shelf: "audio.library", request_type: "library.remove_source" }],
  ["a protected verb (invalid)", INVALID, "request", { shelf: "network.shares", request_type: "network.share.add" }]
] as const) {
  test(`${name}: the dead sitting is cleared and the one card raised once; the fresh sitting applies`, async () => {
    const b = bridge("fresh", "dead");
    const seen: Array<string | undefined> = [];
    const send = async (_op: string, p: Record<string, unknown>) => {
      seen.push(p["step_up_token"] as string | undefined);
      return p["step_up_token"] === "fresh" ? { value: { ok: 1 } } : { error: refusal };
    };
    const r = await dispatchWithStepUp(send, op, { ...payload }, undefined, b);
    assert.deepEqual(r, { value: { ok: 1 } }, "the change applied - no bare 403");
    assert.deepEqual(seen, ["dead", "fresh"], "one send with the dead sitting, one with the fresh one");
    assert.equal(b.acquired, 1, "exactly one card");
    assert.equal(b.token, "fresh", "the fresh sitting is cached");
  });
}

test("cancel: the original refusal, the dead sitting cleared, no retry", async () => {
  const b = bridge(null, "dead");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: EXPIRED };
  };
  const r = await dispatchWithStepUp(send, HOUSEHOLD_SET_OP, { lend: false }, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_expired");
  assert.equal(b.acquired, 1, "the card was raised once");
  assert.equal(b.token, null, "the dead sitting does not stay cached");
  assert.equal(calls, 1);
});

test("a fresh sitting refused again is cleared and surfaced; no second card, no loop", async () => {
  const b = bridge("fresh", "dead");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: INVALID };
  };
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_invalid");
  assert.equal(b.acquired, 1);
  assert.equal(calls, 2, "dead sitting, then fresh sitting, then stop");
  assert.equal(b.token, null);
});

test("a cached retry refused as expired is cleared and the card raised once", async () => {
  // No sitting on the first send; another dispatch cached one meanwhile;
  // the retry with it is refused as expired - it is cleared, not kept.
  const b = bridge("fresh", null);
  const seen: Array<string | undefined> = [];
  const send = async (_op: string, p: Record<string, unknown>) => {
    const tok = p["step_up_token"] as string | undefined;
    seen.push(tok);
    if (tok === undefined) {
      b.token = "other";
      return { error: STEPUP };
    }
    return tok === "fresh" ? { value: { ok: 1 } } : { error: EXPIRED };
  };
  const r = await dispatchWithStepUp(send, "pair_revoke", {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.deepEqual(seen, [undefined, "other", "fresh"]);
  assert.equal(b.acquired, 1);
  assert.equal(b.token, "fresh");
});

test("a card already up: the refusal is surfaced, the dead sitting still cleared, nothing stacked", async () => {
  let release: (token: string | null) => void = () => undefined;
  const first = bridge(null, null);
  first.acquire = () =>
    new Promise<string | null>((resolve) => {
      first.acquired += 1;
      release = resolve;
    });
  const pending = dispatchWithStepUp(
    async (_op, p) => ("step_up_token" in p ? { value: { ok: 1 } } : { error: STEPUP }),
    "pair_revoke",
    {},
    undefined,
    first
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(first.acquired, 1);
  const second = bridge("never", "dead");
  const r = await dispatchWithStepUp(async () => ({ error: EXPIRED }), "request", {}, undefined, second);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_expired");
  assert.equal(second.acquired, 0, "no second card while the first is up");
  assert.equal(second.token, null, "the dead sitting is still cleared");
  release("t1");
  assert.deepEqual(await pending, { value: { ok: 1 } });
});

test("a token the caller put on the payload is not ours: no clear, no card", async () => {
  const b = bridge("never", "cached");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: EXPIRED };
  };
  const r = await dispatchWithStepUp(send, HOUSEHOLD_SET_OP, { step_up_token: "theirs" }, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_expired");
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
  assert.equal(b.token, "cached");
});

test("the household set shows the system-password ask on a cancelled card, never the raw refusal", () => {
  const h = code(householdHook);
  assert.ok(/import \{ isElevationRequired, isSittingRefused \} from "\.\.\/\.\.\/runtime\/step-up-elevation\.ts";/.test(householdHook));
  assert.ok(
    /if \(isElevationRequired\(r\.error\) \|\| isSittingRefused\(r\.error\)\) \{\s*const message = t\("household\.stepUpNeeded"\);/.test(h),
    "a sitting refusal is the same honest ask as step_up_required"
  );
  assert.ok(/import \{ isElevationRequired, isSittingRefused \} from "\.\/step-up-elevation\.ts";/.test(dispatchSrc), "the one inline path reads the one predicate");
});
