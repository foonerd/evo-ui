// Contract: verbErrorMessage extraction precedence. This is the
// single shared refusal-to-prose path every shelf hook renders
// inline (plan Phase 0b) - regressions here would silently blank
// or garble every refusal message in the UI.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { verbErrorMessage } from "../../src/runtime/verb-error.ts";

const FALLBACK = "fallback prose";

test("string errors pass through verbatim", () => {
  assert.equal(verbErrorMessage("queue is empty", FALLBACK), "queue is empty");
});

test("empty string falls back", () => {
  assert.equal(verbErrorMessage("", FALLBACK), FALLBACK);
});

test("object message wins over subclass", () => {
  assert.equal(
    verbErrorMessage(
      { message: "position 9999 out of range (queue length 13)", subclass: "position_out_of_range" },
      FALLBACK
    ),
    "position 9999 out of range (queue length 13)"
  );
});

test("subclass renders when no message", () => {
  const out = verbErrorMessage({ subclass: "queue_empty" }, FALLBACK);
  assert.ok(out.includes("queue_empty"), `expected subclass in "${out}"`);
});

test("empty object falls back", () => {
  assert.equal(verbErrorMessage({}, FALLBACK), FALLBACK);
});

test("null and undefined fall back", () => {
  assert.equal(verbErrorMessage(null, FALLBACK), FALLBACK);
  assert.equal(verbErrorMessage(undefined, FALLBACK), FALLBACK);
});

test("non-string message ignored, subclass still renders", () => {
  const out = verbErrorMessage({ message: 42, subclass: "payload_version_unsupported" }, FALLBACK);
  assert.ok(out.includes("payload_version_unsupported"));
});
