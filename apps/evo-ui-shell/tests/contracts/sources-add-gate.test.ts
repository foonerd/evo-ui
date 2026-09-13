// Contract: a valid form starts, including user+password when this session
// cannot paint the prompt. The password card appears on the responder
// (the player). Guest add proceeds. The responder lock is a notice, not a
// submit gate — not Pair, not the retired network_admin pre-flight.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  addNeedsResponder,
  canStartShareAdd,
  showCredentialResponderNotice
} from "../../src/features/sources/share-add-gate.ts";

test("addNeedsResponder: only the credentialed kind needs the prompt", () => {
  assert.equal(addNeedsResponder("user_password"), true);
  assert.equal(addNeedsResponder("guest"), false);
});

test("user+password Add with NO responder still starts (prompt on the player)", () => {
  assert.equal(
    canStartShareAdd({ valid: true, credKind: "user_password", responderGranted: false }),
    true
  );
});

test("user+password Add WITH responder starts (prompt paints on this session)", () => {
  assert.equal(
    canStartShareAdd({ valid: true, credKind: "user_password", responderGranted: true }),
    true
  );
});

test("guest Add proceeds with or without a responder", () => {
  assert.equal(
    canStartShareAdd({ valid: true, credKind: "guest", responderGranted: false }),
    true
  );
  assert.equal(
    canStartShareAdd({ valid: true, credKind: "guest", responderGranted: true }),
    true
  );
});

test("an invalid form never starts, credentialed or guest", () => {
  assert.equal(
    canStartShareAdd({ valid: false, credKind: "guest", responderGranted: true }),
    false
  );
  assert.equal(
    canStartShareAdd({ valid: false, credKind: "user_password", responderGranted: true }),
    false
  );
});

test("the honest notice shows only for a credentialed add with no responder", () => {
  assert.equal(
    showCredentialResponderNotice({ credKind: "user_password", responderGranted: false }),
    true
  );
  assert.equal(
    showCredentialResponderNotice({ credKind: "user_password", responderGranted: true }),
    false
  );
  assert.equal(
    showCredentialResponderNotice({ credKind: "guest", responderGranted: false }),
    false
  );
});

// ---- the surface wires the gate (no network_admin pre-flight, no Pair) ----

const src = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "features",
    "sources",
    "SourcesSurface.tsx"
  ),
  "utf8"
);

test("SourcesSurface starts add through canStartShareAdd, not a Pair pre-flight", () => {
  assert.ok(/useResponderGranted\(\)/.test(src), "must read the responder grant for the notice");
  assert.ok(/canStartShareAdd\(/.test(src), "the submit must go through the start gate");
  assert.ok(
    !/hasNetworkAdmin\s*\(|bearerCapabilities\s*\(/.test(src),
    "must not re-add a client-side network_admin capability pre-flight"
  );
  // Submit is gated on form validity only; the responder line is a notice,
  // not a gate - no "blocked" naming, no alert semantics, no password field.
  assert.ok(/disabled=\{!canStart\}/.test(src), "submit disables on !canStart only");
  assert.ok(!/sources-form-blocked/.test(src), "the responder notice must not read as a gate");
  assert.ok(/sources-form-notice" role="note"/.test(src), "the responder line is a note");
  assert.ok(!/type="password"/.test(src), "no password field on the Add share form");
});
