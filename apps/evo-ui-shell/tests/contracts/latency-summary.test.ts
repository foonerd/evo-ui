import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLatencyMs } from "../../src/core/latency-summary.ts";

test("summarizeLatencyMs returns zero summary for empty input", () => {
  assert.deepEqual(summarizeLatencyMs([]), {
    count: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0
  });
});

test("summarizeLatencyMs ignores invalid samples and computes percentiles", () => {
  const summary = summarizeLatencyMs([10, 20, Number.NaN, -5, 30, 40, 100]);
  assert.equal(summary.count, 5);
  assert.equal(summary.p50, 30);
  assert.equal(summary.p95, 100);
  assert.equal(summary.p99, 100);
  assert.equal(summary.max, 100);
});
