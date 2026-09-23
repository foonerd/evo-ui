// Contract (matrix line 12): a valid user+password Add share form
// starts - Add and mount is active - and the secret is typed on
// that same dialog. File-sharing PasswordField stays held.
//
// The fail-closed seat gate (7b1d8c8, restored in c9645b3) stays
// lifted: on a screen that did not hold the responder seat the
// button was grey and no NAS share could be added at all. The
// submit is gated on form validity only. Guest and NFS start on
// validity as before. No 018bb51 mutateOk (it greyed guest / NFS).
// Not a Pair ceremony, not the retired network_admin pre-flight.
//
// Authority lifted the "no Sources password field" invert on
// 2026-09-20 after the Owner ordered the industry same-dialog
// path. This pin goes RED if a valid user+password form stops
// starting (grey Add), RED if the Add dialog loses the password
// field or its eye reveal, RED if PasswordField is imported, and
// RED if mutateOk returns.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { addNeedsResponder, canStartShareAdd } from "../../src/features/sources/share-add-gate.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const surface = src("features/sources/SourcesSurface.tsx");
const gate = src("features/sources/share-add-gate.ts");
const shares = src("features/sources/useNetworkShares.ts");

test("addNeedsResponder: Add does not raise a prompt card", () => {
  assert.equal(addNeedsResponder("user_password"), false);
  assert.equal(addNeedsResponder("guest"), false);
});

test("PIN (Authority-held): a valid user+password form starts - Add and mount is active", () => {
  assert.equal(canStartShareAdd({ valid: true, credKind: "user_password" }), true);
  assert.ok(!/responderGranted/.test(gate), "the seat is not an input to the start gate");
  assert.ok(!/showCredentialResponderNotice/.test(gate), "no closer on the form");
});

test("guest and NFS start on validity", () => {
  assert.equal(canStartShareAdd({ valid: true, credKind: "guest" }), true);
});

test("an invalid form never starts, credentialed or guest", () => {
  assert.equal(canStartShareAdd({ valid: false, credKind: "guest" }), false);
  assert.equal(canStartShareAdd({ valid: false, credKind: "user_password" }), false);
});

test("SourcesSurface gates submit on the valid-form gate only; password is on this dialog", () => {
  assert.match(surface, /canStartShareAdd\(\{ valid, credKind \}\)/, "the submit goes through the start gate, seat not consulted");
  assert.match(surface, /disabled=\{!canStart\}/, "submit disables on !canStart only");
  assert.match(surface, /if \(!canStart\) return;/, "and the handler refuses an invalid form");
  assert.ok(!/useResponderGranted|responderGranted|showResponderNotice|showCredentialResponderNotice/.test(surface), "no seat read, no closer");
  assert.ok(!/credentialsNeedResponder|sources-form-notice|sources-form-blocked/.test(surface), "no closing line, no gate paint");
  assert.match(surface, /reveal \? "text" : "password"/, "user+password Add types the secret here");
  assert.match(surface, /password-reveal-button/, "the eye is the same reveal as every other credential field");
  assert.match(surface, /<EyeOff size=\{18\} \/>/);
  assert.match(surface, /t\("password\.show"\)/);
  assert.match(surface, /t\("sources\.form\.password"\)/);
  assert.match(shares, /password\?: string/);
  assert.ok(!/from ["'].*PasswordField["']/.test(surface), "file-sharing PasswordField stays held");
  assert.ok(!/passwordViaPrompt/.test(surface), "the secret does not wait on a second card");
  assert.ok(!/hasNetworkAdmin\s*\(|bearerCapabilities\s*\(|mutateOk/.test(surface), "no network_admin pre-flight, no 018bb51 mutateOk greying guest / NFS");
});

test("the closer copy is gone; the form label is the password field", () => {
  const closer = ["sources.form", "credentialsNeedResponder"].join(".");
  assert.ok(!(closer in en), "the closer key is deleted");
  assert.equal(en["sources.form.password"], "Password");
  assert.ok(!("sources.form.passwordViaPrompt" in en));
});

test("Sources has no Activity feed; Failed card still shows the operator reason", () => {
  assert.ok(
    !/t\("sources\.activity"\)/.test(surface) && !/ShareActivityFeed/.test(surface),
    "share operations do not paint on Sources"
  );
  assert.ok(!/sources-activity-detail/.test(surface) && !/ev\.detail/.test(surface), "Sources still does not paste journal");
  assert.ok(
    /share\.state === "failed" && share\.reason/.test(surface),
    "Failed card still shows the one-line reason"
  );
  assert.match(
    surface,
    /friendlyShareError\(share\.reason\)/,
    "the card reason is the operator line, never journalctl"
  );
});

test("PIN: share operations live on Settings Activity, as operator lines", () => {
  const feed = src("features/activity/ShareActivityFeed.tsx");
  const settings = src("features/system/SystemSurface.tsx");
  assert.match(settings, /props\.group === "activity"/);
  assert.match(settings, /<ShareActivityFeed \/>/);
  assert.ok(/eventLabelKey\(ev\.kind\)/.test(feed), "each row is the classified event label");
  assert.ok(
    !/sources-activity-detail/.test(feed) && !/ev\.detail/.test(feed),
    "must not paste ev.detail / systemd journal onto Activity"
  );
});
