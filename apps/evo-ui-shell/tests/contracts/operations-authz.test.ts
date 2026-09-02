import test from "node:test";
import assert from "node:assert/strict";
import {
  canRunPrivilegedOperation,
  needsStepUpReauth
} from "../../src/core/operations-authz.ts";

test("canRunPrivilegedOperation requires non-missing capability and active step-up", () => {
  assert.equal(canRunPrivilegedOperation("supported", true), true);
  assert.equal(canRunPrivilegedOperation("partial", true), true);
  assert.equal(canRunPrivilegedOperation("missing", true), false);
  assert.equal(canRunPrivilegedOperation("supported", false), false);
});

test("needsStepUpReauth detects privileged-session failures", () => {
  assert.equal(needsStepUpReauth(null), false);
  assert.equal(needsStepUpReauth("step_up_required: Privileged step-up session required"), true);
  assert.equal(needsStepUpReauth("permission denied for scope.system.admin"), true);
  assert.equal(needsStepUpReauth("network timeout"), false);
});
