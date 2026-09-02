import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_STALE_AFTER_MS,
  shouldMarkSnapshotStale
} from "../../src/core/freshness-policy.ts";

test("shouldMarkSnapshotStale returns false at threshold boundary", () => {
  assert.equal(shouldMarkSnapshotStale(SNAPSHOT_STALE_AFTER_MS), false);
});

test("shouldMarkSnapshotStale returns true above threshold", () => {
  assert.equal(shouldMarkSnapshotStale(SNAPSHOT_STALE_AFTER_MS + 1), true);
});
