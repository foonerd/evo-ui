import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshFromAnomaly } from "../../src/core/anomaly-refresh.ts";

test("shouldRefreshFromAnomaly requires positive anomaly signal", () => {
  assert.equal(shouldRefreshFromAnomaly(0, "supported"), false);
  assert.equal(shouldRefreshFromAnomaly(-1, "supported"), false);
});

test("shouldRefreshFromAnomaly blocks missing-capability surfaces", () => {
  assert.equal(shouldRefreshFromAnomaly(1, "missing"), false);
});

test("shouldRefreshFromAnomaly allows supported/partial surfaces", () => {
  assert.equal(shouldRefreshFromAnomaly(1, "supported"), true);
  assert.equal(shouldRefreshFromAnomaly(2, "partial"), true);
});
