// Contract for the canonical inline-step-up path, NARROW predicate.
// Run: node --experimental-strip-types --test tests/contracts/step-up-dispatch.test.ts
//
// The card is raised ONLY for subclass "step_up_required", and NEVER for
// the pairing / responder-lifecycle ops (they either reject a step_up_token
// field or refuse for a reason the password cannot cure). A bare
// permission_denied (wrong password, rate-limit, schema-gate miss, release
// on a LAN-trust socket) passes straight through - stacking the card on
// those is the Pair + step-up loop this file guards against.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchWithStepUp,
  type StepUpBridge
} from "../../src/runtime/step-up-dispatch.ts";
import { isElevationRequired } from "../../src/runtime/step-up-elevation.ts";
import { createStepUpAcquireLane } from "../../src/features/pairing/step-up-acquire-lane.ts";

// Bare permission_denied: NOT step-up-curable (the loop cause).
const PERM = { code: "permission_denied", message: "requires network_admin" };
// The ONLY refusal that raises the card.
const STEPUP = {
  code: "permission_denied",
  message: "elevate",
  subclass: "step_up_required"
};

// A framework NATIVE op that genuinely consumes a step_up_token (e.g.
// pair_revoke / set_kiosk_password) and is NOT on the non-elevatable
// skip list. The card path is valid ONLY for these, and ONLY on a
// step_up_required refusal.
const NATIVE_OP = "pair_revoke";

type WireOpResultLike = { value?: unknown; error?: unknown };

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

// --- predicate: narrow ---------------------------------------------
test("isElevationRequired: bare permission_denied is NOT elevation", () => {
  assert.equal(isElevationRequired(PERM), false);
});
test("isElevationRequired: step_up_required subclass IS elevation", () => {
  assert.equal(isElevationRequired(STEPUP), true);
});
test("isElevationRequired: ordinary error / undefined are not elevation", () => {
  assert.equal(isElevationRequired({ code: "invalid_payload", message: "" }), false);
  assert.equal(isElevationRequired(undefined), false);
});

// --- the plugin `request` op elevates --------------------------------
// The token rides the request payload; the steward validates it for that
// dispatch. This fixture FAILS if `request` is put back on the skip list
// (it would then pass the refusal straight through, acquiring nothing).
test("request op: step_up_required raises the card, retry with token admits", async () => {
  const b = bridge("tok-req");
  let seenToken: unknown = "unset";
  const send = async (_op: string, payload: Record<string, unknown>) => {
    if (!("step_up_token" in payload)) return { error: STEPUP };
    seenToken = payload.step_up_token;
    return { value: { ok: true } };
  };
  const r = await dispatchWithStepUp(
    send,
    "request",
    { shelf: "networking.link" },
    undefined,
    b
  );
  assert.deepEqual(r, { value: { ok: true } });
  assert.equal(seenToken, "tok-req");
  assert.equal(b.acquired, 1);
});

// --- request op: operator cancels -> ORIGINAL refusal, no fabrication
test("request op: operator cancels -> original step_up_required returned", async () => {
  const b = bridge(null);
  const send = async () => ({ error: STEPUP });
  const r = await dispatchWithStepUp(send, "request", { shelf: "networking.link" }, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(b.acquired, 1);
});

// --- CORE FIX: pairing + responder ops never raise the card --------
// These are the ops that stacked the step-up card on top of Pair and on
// PromptSurface's always-mounted cleanup, looping every surface.
test("pair_authenticate: step_up_required passes through, NO card (Pair submit)", async () => {
  const b = bridge("tok");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: STEPUP };
  };
  const r = await dispatchWithStepUp(send, "pair_authenticate", { password: "x" }, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});
test("release_user_interaction_responder: permission_denied passes through, NO card", async () => {
  const b = bridge("tok");
  const send = async () => ({ error: PERM }); // LAN-trust release refusal
  const r = await dispatchWithStepUp(
    send,
    "release_user_interaction_responder",
    {},
    undefined,
    b
  );
  assert.deepEqual(r, { error: PERM });
  assert.equal(b.acquired, 0);
});
test("negotiate: step_up_required passes through, NO card", async () => {
  const b = bridge("tok");
  const send = async () => ({ error: STEPUP });
  const r = await dispatchWithStepUp(send, "negotiate", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(b.acquired, 0);
});

// --- native op: bare permission_denied does NOT raise the card -----
test("native op: bare permission_denied (wrong password / rate-limit) passes through, NO card", async () => {
  const b = bridge("tok");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: PERM };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { error: PERM });
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});

// --- reproduce: bare dispatch dead-ends (no bridge) ---------------
test("no bridge: step_up_required passes straight through", async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: STEPUP };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, null);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(calls, 1);
});

// --- native op: card raised, token attached, retry succeeds -------
test("native op: step_up_required -> acquire token -> retry -> success", async () => {
  const b = bridge("tok-1");
  let seenToken: unknown = "unset";
  const send = async (_op: string, payload: Record<string, unknown>) => {
    if (!("step_up_token" in payload)) return { error: STEPUP };
    seenToken = payload.step_up_token;
    return { value: { ok: true } };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, { paired_device_id: "x" }, undefined, b);
  assert.deepEqual(r, { value: { ok: true } });
  assert.equal(seenToken, "tok-1");
  assert.equal(b.acquired, 1);
  assert.equal(b.token, "tok-1");
});

// --- native op: cached token reused without re-prompting ----------
const LOCKED = {
  code: "permission_denied",
  message: "403 Forbidden",
  subclass: "household_policy_locked"
};

test("cached token rides the first send so a household lock admits without elevate", async () => {
  const b = bridge(null, "sit");
  let calls = 0;
  const send = async (_op: string, payload: Record<string, unknown>) => {
    calls += 1;
    return "step_up_token" in payload
      ? { value: { ok: 1 } }
      : { error: LOCKED };
  };
  const r = await dispatchWithStepUp(send, "request", { shelf: "x" }, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});

test("household-locked on a cached token raises acquire once", async () => {
  // The cached sitting rode the first send and the gate still refused:
  // it is spent. Clear it, raise the ONE card once, retry with the fresh
  // sitting - never a dead end with no card and no sitting.
  const b = bridge("fresh", "stale");
  const seen: Array<string | undefined> = [];
  const send = async (_op: string, payload: Record<string, unknown>) => {
    seen.push(payload["step_up_token"] as string | undefined);
    return payload["step_up_token"] === "fresh"
      ? { value: { ok: 1 } }
      : { error: LOCKED };
  };
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.deepEqual(seen, ["stale", "fresh"], "one send with the dead sitting, one with the fresh one");
  assert.equal(b.acquired, 1, "exactly one card");
  assert.equal(b.token, "fresh", "the fresh sitting is cached for the next send");
});

test("household-locked on a cached token: cancel returns the lock", async () => {
  const b = bridge(null, "stale");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: LOCKED };
  };
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "household_policy_locked");
  assert.equal(b.acquired, 1, "the card was raised once");
  assert.equal(b.token, null, "the dead sitting stays cleared on cancel");
  assert.equal(calls, 1, "no retry without a sitting");
});

test("a second household lock after the fresh sitting leaves token null", async () => {
  // The card was offered; the gate refused the fresh sitting too. A
  // sitting the household gate would not spend is not a live override:
  // it is cleared so no gate opens on it, the lock is surfaced, and
  // nothing loops or stacks.
  const b = bridge("fresh", "stale");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: LOCKED };
  };
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "household_policy_locked");
  assert.equal(b.acquired, 1, "acquire once, never again in the same dispatch");
  assert.equal(calls, 2, "dead sitting, then fresh sitting, then stop");
  assert.equal(b.token, null, "the refused fresh sitting is cleared - the gate cannot open on it");
});

test("a fresh sitting the gate admits stays cached", async () => {
  const b = bridge("fresh", "stale");
  const send = async (_op: string, payload: Record<string, unknown>) =>
    payload["step_up_token"] === "fresh" ? { value: { ok: 1 } } : { error: LOCKED };
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.token, "fresh");
});

test("acquiring still admits only one card: a lock while a card is up is surfaced, not stacked", async () => {
  // A dispatch whose card is up holds the guard; a second dispatch that
  // hits the household lock with a cached sitting meanwhile surfaces the
  // lock and raises nothing.
  let release: (token: string | null) => void = () => undefined;
  const first = bridge(null, null);
  first.acquire = () =>
    new Promise<string | null>((resolve) => {
      first.acquired += 1;
      release = resolve;
    });
  const stepUpThenOk = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: STEPUP };
  const pending = dispatchWithStepUp(stepUpThenOk, NATIVE_OP, {}, undefined, first);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(first.acquired, 1, "the first card is up");

  const second = bridge("never", "stale");
  const lockSend = async () => ({ error: LOCKED });
  const r = await dispatchWithStepUp(lockSend, "request", {}, undefined, second);
  assert.equal((r.error as { subclass?: string }).subclass, "household_policy_locked");
  assert.equal(second.acquired, 0, "no second card while the first is up");
  assert.equal(second.token, null, "the dead sitting is still cleared");

  release("t1");
  const done = await pending;
  assert.deepEqual(done, { value: { ok: 1 } });
});

test("NON_ELEVATABLE_OPS unchanged: the seven ops never carry a sitting and never raise the card", async () => {
  for (const op of [
    "pair_begin",
    "pair_authenticate",
    "pair_complete",
    "step_up_auth_verify",
    "negotiate",
    "release_user_interaction_responder",
    "list_user_interactions"
  ]) {
    const b = bridge("never", "cached");
    const seen: Array<string | undefined> = [];
    const send = async (_op: string, payload: Record<string, unknown>) => {
      seen.push(payload["step_up_token"] as string | undefined);
      return { error: LOCKED };
    };
    const r = await dispatchWithStepUp(send, op, {}, undefined, b);
    assert.deepEqual(seen, [undefined], `${op}: no sitting on the send`);
    assert.equal(b.acquired, 0, `${op}: no card`);
    assert.equal(b.token, "cached", `${op}: the sitting is untouched`);
    assert.equal((r.error as { subclass?: string }).subclass, "household_policy_locked");
  }
});

test("native op: cached token satisfies retry without raising the card", async () => {
  const b = bridge(null, "cached");
  const send = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: STEPUP };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 0);
});

// --- native op: stale cached token -> prompt once, then succeed ---
test("native op: stale cached token is cleared and a fresh prompt is raised", async () => {
  const b = bridge("fresh", "stale");
  const send = async (_op: string, payload: Record<string, unknown>) => {
    if (payload.step_up_token === "fresh") return { value: { ok: 1 } };
    return { error: STEPUP };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 1);
  assert.equal(b.token, "fresh");
});

// --- native op: cancel returns the ORIGINAL refusal, no fabrication
test("native op: operator cancels -> original step_up_required is returned", async () => {
  const b = bridge(null);
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: STEPUP };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(b.acquired, 1);
  assert.equal(calls, 1);
});

// --- success path is untouched (no card, one send) ----------------
test("ok response: no elevation, no card, single send", async () => {
  const b = bridge("tok");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { value: { ok: true } };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: true } });
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});

// --- no recursion while the card is up: the verify op dispatches
//     through this same path and is on the skip list ---------------
test("re-entrant dispatch during acquire does not raise a second card", async () => {
  let nested: WireOpResultLike | null = null;
  const b: StepUpBridge & { acquired: number; token: string | null } = {
    token: null,
    acquired: 0,
    getToken() {
      return this.token;
    },
    setToken(t: string | null) {
      this.token = t;
    },
    async acquire() {
      this.acquired += 1;
      // step_up_auth_verify dispatches through the SAME path while the
      // card is up. It is on the skip list, so it passes straight through.
      nested = await dispatchWithStepUp(
        async () => ({ error: STEPUP }),
        "step_up_auth_verify",
        {},
        undefined,
        this
      );
      return "tok";
    }
  };
  const send = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: STEPUP };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 1);
  assert.equal((nested as WireOpResultLike | null)?.error !== undefined, true);
});

// --- native op: already-tokened payload never loops ----------------
test("native op: payload already carrying a token is not retried (no loop)", async () => {
  const b = bridge("tok");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: STEPUP };
  };
  const r = await dispatchWithStepUp(
    send,
    NATIVE_OP,
    { step_up_token: "existing" },
    undefined,
    b
  );
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});

test("a second acquire on the same lane settles the first waiter", async () => {
  // Household override and a dispatch can both call acquire. Replacing
  // pending used to orphan the first promise. One lane, one card.
  const lane = createStepUpAcquireLane();
  const b = bridge(null, null);
  b.acquire = () =>
    new Promise<string | null>((resolve) => {
      b.acquired += 1;
      lane.enqueue(resolve);
    });
  const stepUpThenOk = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: STEPUP };
  const pending = dispatchWithStepUp(stepUpThenOk, NATIVE_OP, {}, undefined, b);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(b.acquired, 1, "the first card is up");
  const override = b.acquire("household_override");
  assert.equal(b.acquired, 2, "the override joins; it does not open a second card");
  lane.settle("t1");
  const done = await pending;
  assert.deepEqual(done, { value: { ok: 1 } });
  assert.equal(await override, "t1", "first waiter was not orphaned");
});
