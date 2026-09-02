import test from "node:test";
import assert from "node:assert/strict";
import { formatInFlightSummary } from "../../src/core/in-flight-summary.ts";

test("formatInFlightSummary returns idle for zero and negative counts", () => {
  assert.equal(formatInFlightSummary(0), "idle");
  assert.equal(formatInFlightSummary(-2), "idle");
});

test("formatInFlightSummary returns count text for positive counts", () => {
  assert.equal(formatInFlightSummary(1), "1 in-flight");
  assert.equal(formatInFlightSummary(3), "3 in-flight");
});
