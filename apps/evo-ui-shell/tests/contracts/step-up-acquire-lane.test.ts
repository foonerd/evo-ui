// Contract: one step-up card, no orphaned first waiter.
// Run: node --experimental-strip-types --test tests/contracts/step-up-acquire-lane.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStepUpAcquireLane } from "../../src/features/pairing/step-up-acquire-lane.ts";

test("the first acquire opens the card", () => {
  const lane = createStepUpAcquireLane();
  assert.equal(lane.open, false);
  assert.equal(
    lane.enqueue(() => undefined),
    true,
    "first waiter opens the card"
  );
  assert.equal(lane.open, true);
});

test("a second acquire joins the same card and does not replace the first waiter", async () => {
  const lane = createStepUpAcquireLane();
  const first = Promise.withResolvers<string | null>();
  const second = Promise.withResolvers<string | null>();
  assert.equal(lane.enqueue(first.resolve), true);
  assert.equal(
    lane.enqueue(second.resolve),
    false,
    "second waiter must not open a second card"
  );
  lane.settle("t1");
  assert.equal(await first.promise, "t1", "first waiter is not orphaned");
  assert.equal(await second.promise, "t1", "second waiter shares the sitting");
  assert.equal(lane.open, false);
});

test("cancel settles every waiter as null", async () => {
  const lane = createStepUpAcquireLane();
  const first = Promise.withResolvers<string | null>();
  const second = Promise.withResolvers<string | null>();
  lane.enqueue(first.resolve);
  lane.enqueue(second.resolve);
  lane.settle(null);
  assert.equal(await first.promise, null);
  assert.equal(await second.promise, null);
});

test("a later acquire after settle opens a fresh card", () => {
  const lane = createStepUpAcquireLane();
  lane.enqueue(() => undefined);
  lane.settle("t1");
  assert.equal(lane.enqueue(() => undefined), true);
  assert.equal(lane.open, true);
});
