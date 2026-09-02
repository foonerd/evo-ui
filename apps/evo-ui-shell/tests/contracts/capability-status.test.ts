import test from "node:test";
import assert from "node:assert/strict";
import { combineCapabilityStatuses } from "../../src/core/capability-status.ts";

test("combineCapabilityStatuses returns missing when all are missing", () => {
  assert.equal(combineCapabilityStatuses(["missing", "missing"]), "missing");
});

test("combineCapabilityStatuses returns supported when all are supported", () => {
  assert.equal(combineCapabilityStatuses(["supported", "supported"]), "supported");
});

test("combineCapabilityStatuses returns partial for mixed statuses", () => {
  assert.equal(combineCapabilityStatuses(["supported", "missing"]), "partial");
  assert.equal(combineCapabilityStatuses(["supported", "partial"]), "partial");
  assert.equal(combineCapabilityStatuses(["partial", "missing"]), "partial");
});

test("combineCapabilityStatuses safely defaults to missing for empty list", () => {
  assert.equal(combineCapabilityStatuses([]), "missing");
});
