// Contract tests for the roster_snap dispatch-result classifier.
//
// Covers the audit finding that roster_snap errors and decode failures
// were silent (returned null), leaving the operator with no actionable
// feedback. The classifier now distinguishes dispatch-level errors,
// decode-level failures, and successful snaps.

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRosterSnapResult,
  humaniseSnapError
} from "../../src/features/multiroom/decoders.ts";

// Synthetic snap shape used as the decoder return type; the
// classifier is parametric so we don't depend on the real RosterSnap.
interface FakeSnap {
  id: string;
}

const okDecoder = (v: unknown): FakeSnap | null => {
  if (typeof v === "object" && v !== null && "id" in v) {
    const id = (v as Record<string, unknown>)["id"];
    return typeof id === "string" ? { id } : null;
  }
  return null;
};
const alwaysFailDecoder = (_v: unknown): FakeSnap | null => null;

test("classifyRosterSnapResult parses a happy-path snap", () => {
  const r = classifyRosterSnapResult(
    { value: { id: "snap-001" } },
    okDecoder
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.snap.id, "snap-001");
});

test("classifyRosterSnapResult surfaces dispatch-level error as message", () => {
  const r = classifyRosterSnapResult(
    { error: { message: "step-up token required" } },
    okDecoder
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.message, "step-up token required");
});

test("classifyRosterSnapResult surfaces structured error subclass when message absent", () => {
  const r = classifyRosterSnapResult(
    { error: { subclass: "CarrierNotInScope" } },
    okDecoder
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /CarrierNotInScope/);
});

test("classifyRosterSnapResult surfaces plain-string errors directly", () => {
  const r = classifyRosterSnapResult(
    { error: "Connection lost" },
    okDecoder
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.message, "Connection lost");
});

test("classifyRosterSnapResult surfaces decode failures distinctly", () => {
  // No `error` field but the decoder returned null - audit-flagged
  // class. The operator should see "unparsable" rather than nothing.
  const r = classifyRosterSnapResult(
    { value: { garbage: "shape" } },
    alwaysFailDecoder
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /unparsable/);
});

test("classifyRosterSnapResult: empty result envelope still surfaces decode failure", () => {
  const r = classifyRosterSnapResult({}, alwaysFailDecoder);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /unparsable/);
});

test("classifyRosterSnapResult: error takes precedence over decode", () => {
  // If both error and value are present, error wins. The framework
  // never sends both; this guards us against future shape drift.
  const r = classifyRosterSnapResult(
    { error: { message: "timeout" }, value: { id: "x" } },
    okDecoder
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.message, "timeout");
});

test("humaniseSnapError handles non-empty strings as pass-through", () => {
  assert.equal(humaniseSnapError("framework refused"), "framework refused");
});

test("humaniseSnapError falls back to generic when envelope opaque", () => {
  assert.match(humaniseSnapError(undefined), /unknown reason/);
  assert.match(humaniseSnapError(null), /unknown reason/);
  assert.match(humaniseSnapError(42), /unknown reason/);
  assert.match(humaniseSnapError([]), /unknown reason/);
});

test("humaniseSnapError ignores empty-string message field", () => {
  // Defensive: an empty message must not produce an empty banner.
  const r = humaniseSnapError({ message: "" });
  assert.match(r, /unknown reason/);
});

test("humaniseSnapError prefers message over subclass when both present", () => {
  const r = humaniseSnapError({ message: "explicit text", subclass: "Foo" });
  assert.equal(r, "explicit text");
});
