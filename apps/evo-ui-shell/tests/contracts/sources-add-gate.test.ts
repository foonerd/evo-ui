// Contract: a user+password NAS add fails CLOSED when this session cannot
// paint the password prompt - no start, so no persisted share left listed
// "Not connected". Guest add proceeds. The gate is the responder lock only -
// not the retired network_admin pre-flight, not a Pair ceremony.
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

test("user+password Add with NO responder does not start (fail-closed)", () => {
  assert.equal(
    canStartShareAdd({ valid: true, credKind: "user_password", responderGranted: false }),
    false
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

test("SourcesSurface gates the credentialed submit on the responder", () => {
  assert.ok(/useResponderGranted\(\)/.test(src), "must read the responder grant");
  assert.ok(/canStartShareAdd\(/.test(src), "the submit must go through the fail-closed gate");
  // The gate is the responder, not a re-added client-side network_admin
  // capability check (that pre-flight stays retired). Target the code
  // construct, not the word in a comment.
  assert.ok(
    !/hasNetworkAdmin\s*\(|bearerCapabilities\s*\(/.test(src),
    "must not re-add a client-side network_admin capability pre-flight"
  );
});
