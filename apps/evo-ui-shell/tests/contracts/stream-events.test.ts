import test from "node:test";
import assert from "node:assert/strict";
import { isKnownStreamEvent } from "../../src/core/stream-events.ts";

test("isKnownStreamEvent accepts known stream events", () => {
  assert.equal(isKnownStreamEvent({ event: "playback.state" }), true);
  assert.equal(isKnownStreamEvent({ event: "sync.lagged" }), true);
  assert.equal(isKnownStreamEvent({ event: "error" }), true);
});

test("isKnownStreamEvent rejects unknown/empty frames", () => {
  assert.equal(isKnownStreamEvent({ event: "unknown.event" }), false);
  assert.equal(isKnownStreamEvent({ event: "" }), false);
  assert.equal(isKnownStreamEvent(null), false);
});
