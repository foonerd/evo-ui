import test from "node:test";
import assert from "node:assert/strict";
import { formatRequestDetail, formatRequestId } from "../../src/core/request-id.ts";

test("formatRequestId normalizes nullish values to n/a", () => {
  assert.equal(formatRequestId(undefined), "n/a");
  assert.equal(formatRequestId(null), "n/a");
});

test("formatRequestId preserves scalar values as strings", () => {
  assert.equal(formatRequestId("abc-123"), "abc-123");
  assert.equal(formatRequestId(42), "42");
});

test("formatRequestDetail composes prefix with request id token", () => {
  assert.equal(formatRequestDetail("Queue add requested", "req-1"), "Queue add requested (request req-1)");
});
