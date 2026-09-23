// Contract: a share that refused access must not paint as a
// device-permission fault.
//
// After add/mount is not-ok, SourcesSurface.run paints
// friendlyVerbError(r.message). CIFS/NFS auth refusal is
// MountError::AuthenticationRefused — Display
// "authentication refused for share {id}: …" plus helper
// stderr (mount error(13), NT_STATUS_LOGON_FAILURE,
// Permission denied). The generic permission branch used to
// win and return err.permission, which blames this device.
// A local smb.conf EACCES without those tokens must still
// be err.permission.

import test from "node:test";
import assert from "node:assert/strict";
import { friendlyVerbError } from "../../src/features/sources/friendly-error.ts";
import { en } from "../../src/locales/en.ts";

test("authentication-refused Display paints share refusal, not device permission", () => {
  const raw =
    "authentication refused for share 86cb08ee: exit=Some(13), stderr=mount error(13): Permission denied";
  assert.equal(friendlyVerbError(raw), en["err.shareAccessRefused"]);
  assert.notEqual(friendlyVerbError(raw), en["err.permission"]);
});

test("NT_STATUS_LOGON_FAILURE paints share refusal", () => {
  const raw =
    "authentication refused for share 86cb08ee: exit=Some(32), stderr=mount error(13): NT_STATUS_LOGON_FAILURE";
  assert.equal(friendlyVerbError(raw), en["err.shareAccessRefused"]);
});

test("NFS access denied by server paints share refusal", () => {
  const raw =
    "authentication refused for share 86cb08ee: exit=Some(32), stderr=access denied by server while mounting";
  assert.equal(friendlyVerbError(raw), en["err.shareAccessRefused"]);
});

test("smb.conf install Permission denied (os error 13) still blames the device", () => {
  const raw =
    "plugin error: permanent error: transient error: verb execution failed: smb.conf install failed: Permission denied (os error 13)";
  assert.equal(friendlyVerbError(raw), en["err.permission"]);
});

test("vault-empty still uses err.credentialMissing", () => {
  assert.equal(
    friendlyVerbError("credential vault has no entry for key share.audio"),
    en["err.credentialMissing"]
  );
});
