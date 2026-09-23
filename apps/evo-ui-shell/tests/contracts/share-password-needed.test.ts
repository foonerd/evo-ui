// Contract: a share whose vault has no password is told where the
// password goes - not that the device failed to set one.
//
// The plugin's mount refusal on an empty vault is exactly
// "credential vault has no entry for key {key}" (MountError::
// CredentialMissing Display). It arrives on Sources three ways: the
// page line after Connect (shares.mount), the page line after an Add
// whose mount failed (mount_error), and the Failed card's reason.
// friendlyVerbError maps it to err.credentialMissing, whose sentence
// belongs to File-sharing user-add ("The device couldn't set this
// user's password"). On Sources the truth is different: the operator
// types the password on Edit, then presses Connect.
//
// Sources paints through friendlyShareError, which puts that one
// operator sentence ahead of friendlyVerbError for exactly that
// Display and defers to it for everything else. File-sharing keeps
// friendlyVerbError and its sentence. Connect stays shares.mount with
// share_id; no dialog, no field, no card on this path.
//
// Goes RED if Sources paints err.credentialMissing for that string,
// if any Sources paint bypasses friendlyShareError, if Connect opens a
// dialog, if PasswordField is imported, if ev.detail reaches the
// surface, or if the mount dispatch changes shape.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isSharePasswordMissing } from "../../src/features/sources/share-password-needed.ts";
import { friendlyShareError, friendlyVerbError } from "../../src/features/sources/friendly-error.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

const MISSING = "credential vault has no entry for key share.music";
const MISSING_CHAIN = `plugin error: permanent error: verb execution failed: ${MISSING}`;
const BUSY = "unmount refused for share 1d2c3b4a-0000-4000-8000-000000000001: target is busy";
const AUTH = "authentication refused for share 1d2c3b4a: exit=Some(13), stderr=mount error(13): Permission denied";

test("classifier: exactly the empty-vault Display, bare or wrapped, and nothing else", () => {
  assert.equal(isSharePasswordMissing(MISSING), true);
  assert.equal(isSharePasswordMissing(MISSING_CHAIN), true);
  assert.equal(isSharePasswordMissing("Credential vault has no entry for key share.x"), true);
  assert.equal(isSharePasswordMissing(BUSY), false);
  assert.equal(isSharePasswordMissing(AUTH), false);
  assert.equal(isSharePasswordMissing("password prompt failed for key share.x: no responder"), false);
  assert.equal(isSharePasswordMissing("operator declined password prompt for key share.x"), false);
  assert.equal(isSharePasswordMissing(undefined), false);
  assert.equal(isSharePasswordMissing(null), false);
  assert.equal(isSharePasswordMissing(""), false);
});

test("friendlyShareError: the operator sentence for that string; friendlyVerbError for the rest", () => {
  const sentence = en["sources.err.passwordNeeded"];
  assert.equal(sentence, "Type the password on Edit, then Connect.");
  assert.equal(friendlyShareError(MISSING), sentence);
  assert.equal(friendlyShareError(MISSING_CHAIN), sentence);
  assert.notEqual(friendlyShareError(MISSING), en["err.credentialMissing"]);
  assert.ok(!/share\.music|1d2c3b4a/.test(friendlyShareError(MISSING_CHAIN)), "no key, no id on the glass");
  assert.equal(friendlyShareError(BUSY), en["err.shareBusy"]);
  assert.equal(friendlyShareError(AUTH), en["err.shareAccessRefused"]);
  assert.equal(friendlyShareError("mount failed for share x: exit=Some(32), stderr=Job failed"), en["err.generic"]);
  assert.equal(friendlyShareError(undefined), en["err.generic"]);
});

test("File-sharing keeps today's sentence: friendlyVerbError is untouched for the same string", () => {
  assert.equal(friendlyVerbError(MISSING), en["err.credentialMissing"]);
  assert.equal(
    en["err.credentialMissing"],
    "The device couldn't set this user's password. This needs fixing on the device."
  );
  const smb = src("features/sources/SmbServerSurface.tsx");
  assert.match(smb, /friendlyVerbError\(/);
  assert.ok(!/friendlyShareError/.test(smb), "File-sharing does not take the Sources sentence");
});

test("PIN: every Sources paint goes through friendlyShareError; Connect is shares.mount and opens nothing", () => {
  const surface = src("features/sources/SourcesSurface.tsx");
  assert.match(surface, /import \{ friendlyShareError \} from "\.\/friendly-error"/);
  assert.ok(!/friendlyVerbError\(/.test(surface), "no Sources paint bypasses friendlyShareError");
  assert.match(surface, /setFeedback\(friendlyShareError\(r\.message\)\)/, "page line after Connect / Add");
  assert.match(surface, /\{friendlyShareError\(share\.reason\)\}/, "Failed card reason");
  assert.match(surface, /setFeedback\(friendlyShareError\(m\.message\)\)/, "Connect after Edit");
  // Connect: the mount verb with share_id, from the card button, nothing else.
  assert.match(surface, /: void run\(\(\) => shares\.mount\(share\.shareId\)\)/);
  const hook = src("features/sources/useNetworkShares.ts");
  assert.match(hook, /"network\.share\.mount",\s*\{ share_id: shareId, \.\.\.extra \}/);
  assert.ok(!/kind: "password"|kind: "connect"/.test(surface), "Connect opens no dialog");
  assert.ok(!/from ["'].*PasswordField["']/.test(surface), "file-sharing PasswordField stays held");
  assert.ok(!/ev\.detail/.test(surface), "ev.detail never reaches the surface");
  assert.ok(/^[\x20-\x7E]+$/.test(en["sources.err.passwordNeeded"]), "7-bit ASCII");
});
