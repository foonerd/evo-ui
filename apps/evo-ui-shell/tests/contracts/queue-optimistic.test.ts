import test from "node:test";
import assert from "node:assert/strict";
import { moveCurrentItemNext, removeCurrentItem } from "../../src/core/queue-optimistic.ts";
import type { QueueSnapshotPayload } from "../../src/core/types.ts";

function snapshot(
  current_index: number | null,
  titles: string[]
): QueueSnapshotPayload {
  return {
    current_index,
    items: titles.map((title) => ({ title }))
  };
}

test("removeCurrentItem removes selected item and keeps valid index", () => {
  const input = snapshot(1, ["A", "B", "C"]);
  const result = removeCurrentItem(input);

  assert.deepEqual(result.items.map((item) => item.title), ["A", "C"]);
  assert.equal(result.current_index, 1);
});

test("removeCurrentItem nulls current index when queue becomes empty", () => {
  const input = snapshot(0, ["Only"]);
  const result = removeCurrentItem(input);

  assert.equal(result.items.length, 0);
  assert.equal(result.current_index, null);
});

test("moveCurrentItemNext swaps current with next and advances current index", () => {
  const input = snapshot(0, ["A", "B", "C"]);
  const result = moveCurrentItemNext(input);

  assert.deepEqual(result.items.map((item) => item.title), ["B", "A", "C"]);
  assert.equal(result.current_index, 1);
});

test("moveCurrentItemNext keeps order stable when already at tail", () => {
  const input = snapshot(2, ["A", "B", "C"]);
  const result = moveCurrentItemNext(input);

  assert.deepEqual(result.items.map((item) => item.title), ["A", "B", "C"]);
  assert.equal(result.current_index, 2);
});
