// Contract: session-trust wire shapes (pairing + step-up screens).
// The pair_begin fixture is a VERBATIM live capture (rig probe
// 2026-07-19). Locked invariants:
//   - pair_begin's response NEVER carries the code - it renders on
//     the player's own screen only. A future response that grows a
//     `code` field is a security regression, not a feature.
//   - Ops ride the standard frame envelope; a raw ClientRequest is
//     refused with frame_parse (transport-level - covered here by
//     the decoder contract, live-covered by the probes).

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodePairBegan,
  decodePairedSession,
  makeNonce,
  retryAfterMinutes
} from "../../src/runtime/session-trust.ts";
import { bearerExpiresAtMs } from "../../src/runtime/bearer.ts";

// Verbatim live capture: probe against the bench rig, 2026-07-19.
const LIVE_PAIR_BEGAN = {
  expires_at_ms: 1784473135191,
  pair_began: true,
  pair_id: "kkywHYm7qJNgiFqz"
};

test("pair_begin: live shape decodes; the code is absent by contract", () => {
  const v = decodePairBegan(LIVE_PAIR_BEGAN);
  assert.notEqual(v, null);
  assert.equal(v?.pairId, "kkywHYm7qJNgiFqz");
  assert.equal(v?.expiresAtMs, 1784473135191);
  // The security invariant, asserted on the fixture itself.
  assert.equal("code" in LIVE_PAIR_BEGAN, false);
});

test("pair_begin: junk shapes are rejected, not guessed at", () => {
  assert.equal(decodePairBegan(null), null);
  assert.equal(decodePairBegan([]), null);
  assert.equal(decodePairBegan({ pair_id: 7, expires_at_ms: "soon" }), null);
  assert.equal(decodePairBegan({ pair_began: true }), null);
});

test("pair_complete: token required, expiry tolerated absent", () => {
  const withExpiry = decodePairedSession({
    pair_completed: true,
    token: "eyJpZCI6IkIteHcza3JE",
    expires_at_ms: 1784555237926,
    paired_device_id: "P6gUaqBj-ccJX4M3TzNHPw"
  });
  assert.equal(withExpiry?.token, "eyJpZCI6IkIteHcza3JE");
  assert.equal(withExpiry?.expiresAtMs, 1784555237926);

  const bare = decodePairedSession({ token: "t" });
  assert.equal(bare?.token, "t");
  assert.equal(bare?.expiresAtMs, null);

  assert.equal(decodePairedSession({ pair_completed: true }), null);
  assert.equal(decodePairedSession({ token: "" }), null);
});

test("nonce: 16 bytes, base64url unpadded, fresh per call", () => {
  const a = makeNonce();
  const b = makeNonce();
  // 16 bytes -> 22 base64 chars unpadded.
  assert.equal(a.length, 22);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(a.includes("="), false);
  assert.notEqual(a, b);
});

test("rate-limit retry-after: framework message form parses to minutes", () => {
  // Verbatim message form from the framework walk log 2026-07-19.
  assert.equal(
    retryAfterMinutes("step_up_auth_verify: too many failed attempts; retry after 899560ms"),
    15
  );
  assert.equal(retryAfterMinutes("retry after 1ms"), 1);
  assert.equal(retryAfterMinutes("too many attempts"), null);
  assert.equal(retryAfterMinutes(""), null);
});

test("bearer expiry: decoded for display, junk tolerated", () => {
  const payload = { id: "x", capabilities: [], expires_at_ms: 1784555237926 };
  const token = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(bearerExpiresAtMs(token), 1784555237926);
  assert.equal(bearerExpiresAtMs(undefined), null);
  assert.equal(bearerExpiresAtMs("not-a-token"), null);
});
