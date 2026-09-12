// Contract: a lent-box widen / Stop lending refusal (step_up_required) reaches
// the operator-password card - the subclass survives the wire decode no matter
// which envelope the framework used, and dispatchWithStepUp then raises the
// card and retries with the token.
//
// The bug this guards: the household direct op (household_protection_set)
// flattens the discriminator onto `error.subclass`, but the WS decode read
// only `error.details.subclass`. The subclass was dropped, isElevationRequired
// went false, the card never opened, and the glass painted a bare 403. The
// framework's own reader (evo household_policy_gate_e2e `subclass_of`) accepts
// the subclass at /error/details/subclass, /error/subclass and bare /subclass;
// the UI decode now mirrors that.
import test from "node:test";
import assert from "node:assert/strict";
import { liftErrorSubclass } from "../../src/runtime/wire-error.ts";
import { readFrameworkErrorEnvelope } from "../../src/runtime/ws-transport.ts";
import { dispatchWithStepUp } from "../../src/runtime/step-up-dispatch.ts";
import { isElevationRequired } from "../../src/runtime/step-up-elevation.ts";
import { HOUSEHOLD_SET_OP } from "../../src/features/household/household-protection.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---- the shared reader lifts subclass from every framework location ----

test("liftErrorSubclass: canonical details.subclass", () => {
  assert.equal(
    liftErrorSubclass({ class: "permission_denied", details: { subclass: "step_up_required" } }),
    "step_up_required"
  );
});

test("liftErrorSubclass: flattened error.subclass (the direct-op shape)", () => {
  assert.equal(
    liftErrorSubclass({ class: "permission_denied", subclass: "step_up_required" }),
    "step_up_required"
  );
});

test("liftErrorSubclass: prefers details, tolerates missing / wrong-type", () => {
  assert.equal(
    liftErrorSubclass({ details: { subclass: "household_policy_locked" }, subclass: "ignored" }),
    "household_policy_locked"
  );
  assert.equal(liftErrorSubclass({ class: "permission_denied" }), undefined);
  assert.equal(liftErrorSubclass({ subclass: 7 as unknown as string }), undefined);
  assert.equal(liftErrorSubclass(undefined), undefined);
});

// ---- the WS value.error envelope surfaces the subclass on BOTH shapes ----

const MSG = "This player is locked; a system password is required.";

test("readFrameworkErrorEnvelope lifts subclass from details.subclass", () => {
  const decoded = readFrameworkErrorEnvelope({
    error: { class: "permission_denied", message: MSG, details: { subclass: "step_up_required" } }
  });
  assert.notEqual(decoded, null);
  assert.equal(decoded!.subclass, "step_up_required");
  assert.equal(isElevationRequired(decoded!), true);
});

test("readFrameworkErrorEnvelope lifts a FLATTENED error.subclass (regression)", () => {
  // This is the exact shape household_protection_set returned; the old
  // details-only read dropped it and the card never opened.
  const decoded = readFrameworkErrorEnvelope({
    error: { class: "permission_denied", message: MSG, subclass: "step_up_required" }
  });
  assert.notEqual(decoded, null);
  assert.equal(decoded!.subclass, "step_up_required");
  assert.equal(isElevationRequired(decoded!), true);
});

test("readFrameworkErrorEnvelope: a real domain field named error is not an error", () => {
  // No message => not a framework error envelope (guards a domain payload
  // that happens to carry an `error` key).
  assert.equal(readFrameworkErrorEnvelope({ error: { some: "data" } }), null);
  assert.equal(readFrameworkErrorEnvelope({ value: 1 }), null);
});

// ---- decode -> elevation: lent unlock w/o a token raises the card, retry applies ----

const SNAPSHOT = { household_protection: true, chosen: true, level: "open", lend: false };

function stepUpSend(decodedErr: { code: string; message: string; subclass?: string }) {
  const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
  const send = async (op: string, payload: Record<string, unknown>) => {
    calls.push({ op, payload });
    if ("step_up_token" in payload) return { value: SNAPSHOT };
    return { error: decodedErr };
  };
  return { send, calls };
}

test("lent unlock without a token -> step_up_required -> card -> retry with token -> apply", async () => {
  // The error is what the transport now decodes from the real (flattened)
  // envelope; feeding it proves the end-to-end elevation.
  const decoded = readFrameworkErrorEnvelope({
    error: { class: "permission_denied", message: MSG, subclass: "step_up_required" }
  })!;
  const { send, calls } = stepUpSend(decoded);
  let acquired = 0;
  const bridge = {
    getToken: () => null,
    setToken: () => {},
    acquire: async () => {
      acquired += 1;
      return "verified-token";
    }
  };
  // unlock = lend:false, no level (omit-level; Framework restores prior_level)
  const r = await dispatchWithStepUp(send, HOUSEHOLD_SET_OP, { lend: false }, undefined, bridge);
  assert.equal(acquired, 1, "the password card must be raised exactly once");
  assert.equal(calls.length, 2, "one refused call, then one retry");
  assert.equal(calls[1].payload.step_up_token, "verified-token", "retry carries the token");
  assert.deepEqual((r as { value?: unknown }).value, SNAPSHOT, "the retry applied");
  assert.equal((r as { error?: unknown }).error, undefined, "no 403 surfaced");
});

test("operator cancels the card -> original step_up_required refusal, no apply", async () => {
  const decoded = readFrameworkErrorEnvelope({
    error: { class: "permission_denied", message: MSG, subclass: "step_up_required" }
  })!;
  const { send, calls } = stepUpSend(decoded);
  const bridge = {
    getToken: () => null,
    setToken: () => {},
    acquire: async () => null // operator dismissed the card
  };
  const r = await dispatchWithStepUp(send, HOUSEHOLD_SET_OP, { lend: false }, undefined, bridge);
  assert.equal(calls.length, 1, "no retry when the card is cancelled");
  const err = (r as { error?: { subclass?: string } }).error;
  assert.notEqual(err, undefined, "the original refusal is surfaced");
  assert.equal(err!.subclass, "step_up_required");
  // The hook keys off isElevationRequired here to show the system-password ask
  // (household.stepUpNeeded) and leaves lend unchanged - never a bare 403.
  assert.equal(isElevationRequired(err!), true);
});

test("household set rides the stored-bearer socket when a sitting can exist", () => {
  const hook = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "features",
      "household",
      "useHouseholdProtection.ts"
    ),
    "utf8"
  );
  assert.ok(
    /householdWriteSocket/.test(hook),
    "set must pick the socket that matches StepUpHost's caller"
  );
  assert.ok(
    /new WsTransport/.test(hook) && /bearerToken: bearer/.test(hook),
    "a stored kiosk/pair bearer must be presented on the write, not the anonymous page socket"
  );
  assert.ok(
    /HOUSEHOLD_GET_OP/.test(hook) && /shared/.test(hook),
    "get stays on the shared LAN-trust socket"
  );
});
