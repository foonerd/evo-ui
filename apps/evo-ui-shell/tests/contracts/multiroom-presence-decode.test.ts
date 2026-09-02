// Contract tests for the multi-room peer-presence decoders.
//
// Covers the three Option fields the framework attaches to each
// list_discovered_peers entry: presence_state,
// last_transition_at_ms, network. decoders.ts is a pure,
// dependency-free module so it imports cleanly here.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePresenceState,
  decodePeerPresence
} from "../../src/features/multiroom/decoders.ts";

test("decodePresenceState accepts the five substrate states verbatim", () => {
  for (const s of ["live", "quiet", "stalled", "absent", "discarded"]) {
    assert.equal(decodePresenceState(s), s);
  }
});

test("decodePresenceState rejects unknown / empty / non-string as null", () => {
  assert.equal(decodePresenceState("online"), null);
  assert.equal(decodePresenceState("Live"), null); // snake_case, case-sensitive
  assert.equal(decodePresenceState(""), null);
  assert.equal(decodePresenceState(null), null);
  assert.equal(decodePresenceState(undefined), null);
  assert.equal(decodePresenceState(7), null);
});

test("decodePeerPresence decodes all three populated fields", () => {
  assert.deepEqual(
    decodePeerPresence({
      presence_state: "live",
      last_transition_at_ms: 1779491446000,
      network: "enp0s3"
    }),
    {
      presenceState: "live",
      lastTransitionAtMs: 1779491446000,
      network: "enp0s3"
    }
  );
});

test("decodePeerPresence tolerates absent / null Option fields", () => {
  const allNull = {
    presenceState: null,
    lastTransitionAtMs: null,
    network: null
  };
  assert.deepEqual(decodePeerPresence({}), allNull);
  assert.deepEqual(
    decodePeerPresence({
      presence_state: null,
      last_transition_at_ms: null,
      network: null
    }),
    allNull
  );
  // The not-yet-classified path: legacy 10-field entry, no presence.
  assert.deepEqual(
    decodePeerPresence({ device_id: "abc", display_name: "x" }),
    allNull
  );
});

test("decodePeerPresence returns all-null for a non-object entry", () => {
  const allNull = {
    presenceState: null,
    lastTransitionAtMs: null,
    network: null
  };
  assert.deepEqual(decodePeerPresence(null), allNull);
  assert.deepEqual(decodePeerPresence("garbage"), allNull);
  assert.deepEqual(decodePeerPresence(42), allNull);
});

test("decodePeerPresence rejects a non-finite last_transition_at_ms", () => {
  const p = decodePeerPresence({
    presence_state: "stalled",
    last_transition_at_ms: Number.POSITIVE_INFINITY,
    network: "eno1"
  });
  assert.equal(p.lastTransitionAtMs, null);
  assert.equal(p.presenceState, "stalled");
  assert.equal(p.network, "eno1");
});
