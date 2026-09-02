// Reproduce + regression for the canonical inline-step-up path.
// Run: node --experimental-strip-types --test tests/contracts/step-up-dispatch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchWithStepUp,
  type StepUpBridge
} from "../../src/runtime/step-up-dispatch.ts";
import { isElevationRequired } from "../../src/runtime/step-up-elevation.ts";

const PERM = { code: "permission_denied", message: "requires network_admin" };

// A framework NATIVE op that genuinely consumes a step_up_token in
// its payload (e.g. pair_revoke / set_kiosk_password). The card path
// is valid ONLY for these. Plugin shelf verbs ride the flat "request"
// op, whose authority is fixed by the bearer - see the request tests.
const NATIVE_OP = "pair_revoke";

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

// --- predicate -----------------------------------------------------
test("isElevationRequired: permission_denied (the framework's actual code)", () => {
  assert.equal(isElevationRequired(PERM), true);
});
test("isElevationRequired: step_up_required subclass", () => {
  assert.equal(
    isElevationRequired({ code: "x", message: "", subclass: "step_up_required" }),
    true
  );
});
test("isElevationRequired: ordinary error is not elevation", () => {
  assert.equal(isElevationRequired({ code: "invalid_payload", message: "" }), false);
  assert.equal(isElevationRequired(undefined), false);
});

// --- CORE FIX: the plugin `request` op never raises the card -------
// The framework's shelf-verb gate authorises from the bearer's
// flattened capabilities only; it never reads a
// step_up_token from the request body, and nothing mutates the
// connection's step-up scopes after admission. So a shelf-verb refusal
// cannot be cured by the operator password - raising the card was a
// dead-end loop. The refusal must pass straight through so the surface
// can prompt to pair instead.
test("request op: permission_denied passes through, NO card (the fix)", async () => {
  const b = bridge("tok-should-not-be-used");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: PERM };
  };
  const r = await dispatchWithStepUp(send, "request", { shelf: "networking.link" }, undefined, b);
  assert.deepEqual(r, { error: PERM });
  assert.equal(calls, 1); // one send, no retry
  assert.equal(b.acquired, 0); // card never raised
});

test("request op: step_up_required subclass also passes through, NO card", async () => {
  const b = bridge("tok");
  const send = async () => ({
    error: { code: "permission_denied", message: "", subclass: "step_up_required" }
  });
  const r = await dispatchWithStepUp(send, "request", {}, undefined, b);
  assert.equal((r.error as { subclass?: string }).subclass, "step_up_required");
  assert.equal(b.acquired, 0);
});

// --- reproduce: bare dispatch dead-ends (no bridge) ---------------
test("no bridge: permission_denied passes straight through", async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: PERM };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, null);
  assert.deepEqual(r, { error: PERM });
  assert.equal(calls, 1);
});

// --- native op: card raised, token attached, retry succeeds -------
test("native op: permission_denied -> acquire token -> retry -> success", async () => {
  const b = bridge("tok-1");
  let seenToken: unknown = "unset";
  const send = async (_op: string, payload: Record<string, unknown>) => {
    if (!("step_up_token" in payload)) return { error: PERM };
    seenToken = payload.step_up_token;
    return { value: { ok: true } };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, { paired_device_id: "x" }, undefined, b);
  assert.deepEqual(r, { value: { ok: true } });
  assert.equal(seenToken, "tok-1");
  assert.equal(b.acquired, 1);
  assert.equal(b.token, "tok-1"); // cached for the sitting
});

// --- native op: cached token reused without re-prompting ----------
test("native op: cached token satisfies retry without raising the card", async () => {
  const b = bridge(null, "cached");
  const send = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: PERM };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 0); // no card
});

// --- native op: stale cached token -> prompt once, then succeed ---
test("native op: stale cached token is cleared and a fresh prompt is raised", async () => {
  const b = bridge("fresh", "stale");
  const send = async (_op: string, payload: Record<string, unknown>) => {
    if (payload.step_up_token === "fresh") return { value: { ok: 1 } };
    return { error: PERM }; // no token OR stale token both refuse
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 1);
  assert.equal(b.token, "fresh");
});

// --- native op: cancel returns the ORIGINAL refusal, no fabrication
test("native op: operator cancels -> original permission_denied is returned", async () => {
  const b = bridge(null);
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: PERM };
  };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { error: PERM });
  assert.equal(b.acquired, 1);
  assert.equal(calls, 1); // no retry attempted after cancel
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

// --- no recursion while the card is up (the verify op dispatches
//     through this same path) ---------------------------------------
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
      // Simulate step_up_auth_verify dispatching through the SAME path
      // while the card is up. It must pass straight through, not recurse.
      nested = await dispatchWithStepUp(
        async () => ({ error: PERM }),
        "step_up_auth_verify",
        {},
        undefined,
        this
      );
      return "tok";
    }
  };
  const send = async (_op: string, payload: Record<string, unknown>) =>
    "step_up_token" in payload ? { value: { ok: 1 } } : { error: PERM };
  const r = await dispatchWithStepUp(send, NATIVE_OP, {}, undefined, b);
  assert.deepEqual(r, { value: { ok: 1 } });
  assert.equal(b.acquired, 1); // exactly one card, no recursion
  assert.deepEqual(nested, { error: PERM }); // nested passed through
});

type WireOpResultLike = { value?: unknown; error?: unknown };

// --- native op: already-tokened payload never loops ----------------
test("native op: payload already carrying a token is not retried (no loop)", async () => {
  const b = bridge("tok");
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { error: PERM };
  };
  const r = await dispatchWithStepUp(
    send,
    NATIVE_OP,
    { step_up_token: "existing" },
    undefined,
    b
  );
  assert.deepEqual(r, { error: PERM });
  assert.equal(calls, 1);
  assert.equal(b.acquired, 0);
});
