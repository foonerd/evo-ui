// Contract for the shared Pair / StepUp / household classifier.
// Run: node --experimental-strip-types --test tests/contracts/authz-classify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuthz,
  isPairRequired,
  isHouseholdLocked
} from "../../src/runtime/authz-classify.ts";

test("step_up_required is elevate, never pair", () => {
  const e = { code: "permission_denied", subclass: "step_up_required" };
  assert.equal(classifyAuthz(e), "elevate");
  assert.equal(isPairRequired(e), false);
  assert.equal(isHouseholdLocked(e), false);
});

test("verb_capability_scope_not_granted is pass — LAN-trust dispatches it", () => {
  // A LAN-trust caller is admitted for these verbs. A scope miss is not a
  // pairing signal; the surface must dispatch, not open Pair.
  const e = {
    code: "permission_denied",
    subclass: "verb_capability_scope_not_granted"
  };
  assert.equal(classifyAuthz(e), "pass");
  assert.equal(isPairRequired(e), false);
  assert.equal(isHouseholdLocked(e), false);
});

test("household_policy_locked is pass, and flagged as the household lock", () => {
  const e = { code: "permission_denied", subclass: "household_policy_locked" };
  assert.equal(classifyAuthz(e), "pass");
  assert.equal(isPairRequired(e), false);
  assert.equal(isHouseholdLocked(e), true);
});

test("the pair ceremony subclasses are pair", () => {
  for (const subclass of ["pair_expired", "pair_unknown", "pair_wrong_code"]) {
    const e = { code: "permission_denied", subclass };
    assert.equal(classifyAuthz(e), "pair", subclass);
    assert.equal(isPairRequired(e), true, subclass);
    assert.equal(isHouseholdLocked(e), false, subclass);
  }
});

test("bare permission_denied is pass — not a ceremony", () => {
  const e = { code: "permission_denied", message: "requires network_admin" };
  assert.equal(classifyAuthz(e), "pass");
  assert.equal(isPairRequired(e), false);
  assert.equal(isHouseholdLocked(e), false);
});

test("responder / lock-shaped refusals are pass", () => {
  assert.equal(
    classifyAuthz({
      code: "permission_denied",
      subclass: "responder_already_assigned"
    }),
    "pass"
  );
  assert.equal(
    classifyAuthz({
      code: "permission_denied",
      subclass: "user_interaction_responder_not_granted"
    }),
    "pass"
  );
  assert.equal(
    classifyAuthz({
      code: "permission_denied",
      subclass: "responder_slot_unclaimed"
    }),
    "pass"
  );
});

test("ordinary faults are pass", () => {
  assert.equal(
    classifyAuthz({ code: "invalid_payload", subclass: "bad_host" }),
    "pass"
  );
  assert.equal(classifyAuthz(undefined), "pass");
  assert.equal(isHouseholdLocked(undefined), false);
});

test("message text never classifies — no regex", () => {
  assert.equal(
    classifyAuthz({
      code: "internal",
      message: "permission denied scope network_admin pair household locked"
    }),
    "pass"
  );
});
