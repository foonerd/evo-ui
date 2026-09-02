// Contract tests for the move-self UI state transition.
//
// Covers the audit finding that MultiroomSurface.tsx's onMoveToGroup
// (move-this-device path) handled `moved` and `failed` but silently
// dropped `successor_required`. The pure transition function maps
// each branch to the next UI state so the SuccessorPicker can be
// rendered inline when the framework refuses to auto-elect.

import test from "node:test";
import assert from "node:assert/strict";
import {
  moveSelfTransition,
  type MoveMemberResultShape
} from "../../src/features/multiroom/decoders.ts";

test("moveSelfTransition: moved -> completed", () => {
  const result: MoveMemberResultShape = { kind: "moved" };
  const t = moveSelfTransition(result, "group-2", "Bedroom");
  assert.equal(t.kind, "completed");
});

test("moveSelfTransition: failed -> showError carries message", () => {
  const result: MoveMemberResultShape = {
    kind: "failed",
    message: "Step-up required"
  };
  const t = moveSelfTransition(result, "group-2", "Bedroom");
  assert.equal(t.kind, "showError");
  if (t.kind !== "showError") return;
  assert.equal(t.message, "Step-up required");
});

test("moveSelfTransition: successor_required -> carries destination context forward", () => {
  const result: MoveMemberResultShape = {
    kind: "successor_required",
    departingDeviceId: "dev-local",
    eligibleDeviceIds: ["dev-a", "dev-b"]
  };
  const t = moveSelfTransition(result, "group-2", "Bedroom");
  assert.equal(t.kind, "successorRequired");
  if (t.kind !== "successorRequired") return;
  assert.equal(t.departingDeviceId, "dev-local");
  assert.deepEqual(t.eligibleDeviceIds, ["dev-a", "dev-b"]);
  assert.equal(t.toGroupId, "group-2");
  assert.equal(t.toGroupName, "Bedroom");
});

test("moveSelfTransition: successor_required preserves empty eligibility list", () => {
  // Framework signals the operator should cancel + dissolve when no
  // eligible successor exists. UI doesn't filter; surfaces the empty
  // list and lets SuccessorPicker render its "no eligible members"
  // message.
  const result: MoveMemberResultShape = {
    kind: "successor_required",
    departingDeviceId: "dev-local",
    eligibleDeviceIds: []
  };
  const t = moveSelfTransition(result, "group-2", "Bedroom");
  assert.equal(t.kind, "successorRequired");
  if (t.kind !== "successorRequired") return;
  assert.deepEqual(t.eligibleDeviceIds, []);
});

test("moveSelfTransition: failed surfaces empty-string message verbatim", () => {
  // The hook should never emit an empty message, but if it does we
  // pass it through. The UI then renders an empty hint line.
  const result: MoveMemberResultShape = { kind: "failed", message: "" };
  const t = moveSelfTransition(result, "group-2", "Bedroom");
  assert.equal(t.kind, "showError");
  if (t.kind !== "showError") return;
  assert.equal(t.message, "");
});

test("moveSelfTransition: toGroupId/toGroupName are preserved exactly", () => {
  // Defensive: the destination context is captured into UI state
  // and re-used on the second dispatch. Any mutation here would
  // route the move to the wrong group.
  const t = moveSelfTransition(
    {
      kind: "successor_required",
      departingDeviceId: "x",
      eligibleDeviceIds: ["a"]
    },
    "g-with-special-chars-_:.123",
    "Display Name (with spaces)"
  );
  assert.equal(t.kind, "successorRequired");
  if (t.kind !== "successorRequired") return;
  assert.equal(t.toGroupId, "g-with-special-chars-_:.123");
  assert.equal(t.toGroupName, "Display Name (with spaces)");
});
