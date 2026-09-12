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

test("stale token on a household lock is cleared and does not raise the card", async () => {
  const b = bridge(null, "stale");
  const send = async () => ({ error: LOCKED });
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "household_policy_locked");
  assert.equal(b.token, null);
  assert.equal(b.acquired, 0);
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
