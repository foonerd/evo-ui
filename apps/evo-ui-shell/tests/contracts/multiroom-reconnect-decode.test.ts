// Contract tests for the reconnect_peer outcome decoder.
//
// Covers the audit finding that the previous implementation inferred
// reconnect success from `winning_carrier !== null` only, which would
// misclassify a malformed envelope as "exhausted". The decoder now
// returns `ok: false` for unparsable shapes so the operator banner
// distinguishes "framework said no carrier won" from "framework's
// response was unparsable".

import test from "node:test";
import assert from "node:assert/strict";
import { decodeReconnectOutcome } from "../../src/features/multiroom/decoders.ts";

test("decodeReconnectOutcome happy path with explicit reconnected: true", () => {
  const r = decodeReconnectOutcome({
    reconnect_outcome: {
      reconnected: true,
      winning_carrier: "wifi",
      elapsed_ms: 1234
    }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.reconnected, true);
  assert.equal(r.outcome.winningCarrier, "wifi");
  assert.equal(r.outcome.elapsedMs, 1234);
});

test("decodeReconnectOutcome infers success from winning_carrier when explicit flag absent", () => {
  const r = decodeReconnectOutcome({
    reconnect_outcome: {
      winning_carrier: "ethernet",
      elapsed_ms: 80
    }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.reconnected, true);
  assert.equal(r.outcome.winningCarrier, "ethernet");
  assert.equal(r.outcome.elapsedMs, 80);
});

test("decodeReconnectOutcome treats null winning_carrier without explicit flag as exhaustion", () => {
  const r = decodeReconnectOutcome({
    reconnect_outcome: {
      winning_carrier: null,
      elapsed_ms: 30000
    }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.reconnected, false);
  assert.equal(r.outcome.winningCarrier, null);
  assert.equal(r.outcome.elapsedMs, 30000);
});

test("decodeReconnectOutcome trusts explicit reconnected: false even when carrier present", () => {
  // Defensive: if the framework ever returns a carrier name alongside
  // an explicit false (e.g. attempted carrier but ultimately failed),
  // we must trust the boolean, not the heuristic.
  const r = decodeReconnectOutcome({
    reconnect_outcome: {
      reconnected: false,
      winning_carrier: "wifi",
      elapsed_ms: 30000
    }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.reconnected, false);
});

test("decodeReconnectOutcome handles missing elapsed_ms by defaulting to zero", () => {
  const r = decodeReconnectOutcome({
    reconnect_outcome: { winning_carrier: "wifi" }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.elapsedMs, 0);
});

test("decodeReconnectOutcome returns ok: false for non-object envelope", () => {
  const shapes: ReadonlyArray<unknown> = [undefined, null, "string", 42, [], true];
  for (const s of shapes) {
    const r = decodeReconnectOutcome(s);
    assert.equal(r.ok, false, `expected ok: false for ${JSON.stringify(s)}`);
    if (r.ok) return;
    assert.match(r.message, /not a structured object/);
  }
});

test("decodeReconnectOutcome returns ok: false when reconnect_outcome envelope missing", () => {
  const r = decodeReconnectOutcome({ some_other_field: "value" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /missing the reconnect_outcome envelope/);
});

test("decodeReconnectOutcome returns ok: false when reconnect_outcome is not an object", () => {
  const r = decodeReconnectOutcome({ reconnect_outcome: "wifi" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /missing the reconnect_outcome envelope/);
});

test("decodeReconnectOutcome tolerates extra fields without crashing", () => {
  // Forward-compat: framework may add new fields. Decoder ignores them
  // rather than refusing on unknown keys.
  const r = decodeReconnectOutcome({
    reconnect_outcome: {
      reconnected: true,
      winning_carrier: "wifi",
      elapsed_ms: 100,
      future_field_we_dont_know_about: { nested: 1 }
    },
    top_level_future_field: 42
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.reconnected, true);
});

test("decodeReconnectOutcome rejects non-finite elapsed_ms by defaulting to zero", () => {
  // Number(undefined) returns NaN; the decoder should not propagate
  // NaN into the result envelope.
  const r = decodeReconnectOutcome({
    reconnect_outcome: { winning_carrier: "wifi", elapsed_ms: NaN }
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.outcome.elapsedMs, 0);
});
