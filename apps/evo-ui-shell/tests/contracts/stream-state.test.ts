import test from "node:test";
import assert from "node:assert/strict";
import { buildStreamNextState, INITIAL_STREAM_STATE } from "../../src/core/stream-state.ts";

test("buildStreamNextState increments counters and tracks last event", () => {
  const next = buildStreamNextState(INITIAL_STREAM_STATE, {
    event: "playback.state",
    seq: 10
  });

  assert.equal(next.eventsSeen, 1);
  assert.equal(next.lastSeq, 10);
  assert.equal(next.seqGapCount, 0);
  assert.equal(next.seqRegressionCount, 0);
  assert.equal(next.eventCounts["playback.state"], 1);
});

test("buildStreamNextState counts sequence gaps", () => {
  const first = buildStreamNextState(INITIAL_STREAM_STATE, {
    event: "queue.changed",
    seq: 4
  });
  const next = buildStreamNextState(first, {
    event: "queue.changed",
    seq: 8
  });

  assert.equal(next.seqGapCount, 1);
  assert.equal(next.seqRegressionCount, 0);
  assert.equal(next.lastSeq, 8);
});

test("buildStreamNextState counts sequence regressions", () => {
  const first = buildStreamNextState(INITIAL_STREAM_STATE, {
    event: "browse.changed",
    seq: 7
  });
  const next = buildStreamNextState(first, {
    event: "browse.changed",
    seq: 7
  });

  assert.equal(next.seqGapCount, 0);
  assert.equal(next.seqRegressionCount, 1);
});

test("buildStreamNextState preserves last seq when incoming frame has no seq", () => {
  const first = buildStreamNextState(INITIAL_STREAM_STATE, {
    event: "network.changed",
    seq: 2
  });
  const next = buildStreamNextState(first, {
    event: "system.notice"
  });

  assert.equal(next.lastSeq, 2);
  assert.equal(next.eventCounts["system.notice"], 1);
});
