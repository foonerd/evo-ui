// Contract: a password typed on the Edit dialog is never dropped.
//
// Edit reuses the Add dialog. Left blank, the vaulted secret stays.
// Typed, the secret goes to the device vault under the key the share
// record will carry after the edit, through the framework's own
// credential_put (the same op the file-sharing surface uses to stock
// an SMB user), then network.share.edit carries the field changes,
// then a share that is not Connected is connected with the new secret.
// The secret never rides network.share.edit: the plugin's ShareEdits
// has no password field and would drop it in silence, which is the
// bug this pins shut.
//
// Goes RED if the edit payload carries a password, if the vault write
// targets any key but the record's, if the write comes after the edit,
// if a Failed share is left unconnected after a new password, if the
// Edit field stops saying blank keeps the current one, or if the Add
// path changes shape.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SHARES_PLUGIN_ID,
  diffShareEdits,
  passwordKeyForEdit,
  shareCredentialKey
} from "../../src/features/sources/share-edit.ts";
import { decodeConfiguredShares } from "../../src/features/sources/share-decoders.ts";
import type { AddSharePayload, ShareItem } from "../../src/features/sources/useNetworkShares.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

const share: ShareItem = {
  shareId: "1d2c3b4a-0000-4000-8000-000000000001",
  alias: "Music",
  host: "192.0.2.10",
  path: "music",
  fstype: "cifs",
  credentialsKind: "user_password",
  username: "listener",
  domain: null,
  advancedOptions: "",
  mountRoot: "/var/lib/evo/music/NAS/Music",
  persistedVers: null,
  credentialKey: "share.music",
  state: "failed",
  reason: null,
  negotiated: null
};

const same: AddSharePayload = {
  alias: "Music",
  fstype: "cifs",
  host: "192.0.2.10",
  path: "music",
  credentials: { kind: "user_password", username: "listener", credential_key: "share.music" },
  password: "new-secret"
};

test("the record carries its vault key; guest carries none", () => {
  const s = decodeConfiguredShares({
    envelope: {
      shares: [
        {
          share_id: "a",
          alias: "Music",
          host: "192.0.2.10",
          path: "music",
          fstype: "cifs",
          credentials: { kind: "user_password", username: "listener", credential_key: "share.music" },
          advanced_options: "",
          mount_root: "/var/lib/evo/music/NAS/Music"
        },
        {
          share_id: "b",
          alias: "Open",
          host: "192.0.2.11",
          path: "open",
          fstype: "nfs",
          credentials: { kind: "guest" },
          advanced_options: "",
          mount_root: "/var/lib/evo/music/NAS/Open"
        }
      ]
    }
  });
  assert.ok(s !== null);
  assert.equal(s.shares[0].credentialKey, "share.music");
  assert.equal(s.shares[1].credentialKey, null);
});

test("shareCredentialKey: the Add-time slug, one definition", () => {
  assert.equal(shareCredentialKey("Music"), "share.music");
  assert.equal(shareCredentialKey(" My NAS / Audio "), "share.my_nas_audio");
  assert.equal(SHARES_PLUGIN_ID, "org.evoframework.network.shares");
});

test("diffShareEdits never carries the secret, and a password-only edit is empty", () => {
  const edits = diffShareEdits(share, same);
  assert.deepEqual(edits, {});
  assert.ok(!("password" in edits));
  const renamed = diffShareEdits(share, { ...same, alias: "Music 2" });
  assert.deepEqual(renamed, { alias: "Music 2" });
  const user = diffShareEdits(share, {
    ...same,
    credentials: { kind: "user_password", username: "other", credential_key: "share.music" }
  });
  assert.deepEqual(user, {
    credentials: { kind: "user_password", username: "other", credential_key: "share.music" }
  });
  assert.ok(!("password" in user));
});

test("passwordKeyForEdit: the key the record carries after the edit", () => {
  // Nothing about the credentials changed: the record's key.
  assert.equal(passwordKeyForEdit(share, {}, same.alias), "share.music");
  // Credentials replaced: the key the new credentials name.
  assert.equal(
    passwordKeyForEdit(
      share,
      { credentials: { kind: "user_password", username: "other", credential_key: "share.other" } },
      same.alias
    ),
    "share.other"
  );
  // A guest record turned user+password carries no key yet: the
  // Add-time slug of the alias being saved.
  const guest: ShareItem = { ...share, credentialsKind: "guest", username: null, credentialKey: null };
  assert.equal(passwordKeyForEdit(guest, {}, "Music 2"), "share.music_2");
});

test("PIN: Edit stocks the vault first, then edits, then connects a share that is not Connected", () => {
  const surface = src("features/sources/SourcesSurface.tsx");
  assert.match(surface, /const runEdit = async \(share: ShareItem, payload: AddSharePayload\)/);
  assert.match(surface, /void runEdit\(share, payload\)/, "the Edit dialog submits through runEdit");
  assert.ok(!/run\(\(\) => shares\.edit\(/.test(surface), "the old edit press is gone");
  const put = surface.indexOf("credentialPut(fwTransport, {");
  const edit = surface.indexOf("shares.edit(share.shareId, edits)");
  const mount = surface.indexOf('share.state !== "mounted"');
  assert.ok(put > 0 && edit > put && mount > edit, "put, then edit, then connect - in that order");
  assert.match(surface, /pluginId: SHARES_PLUGIN_ID/);
  assert.match(surface, /const key = passwordKeyForEdit\(share, edits, payload\.alias\)/);
  assert.match(surface, /key,\s*value: secret,/);
  assert.match(
    surface,
    /const secret =\s*payload\.credentials\.kind === "user_password" && payload\.password !== undefined\s*\?\s*payload\.password\s*:\s*"";/,
    "the secret is the typed password on a user+password form, else nothing"
  );
  assert.match(surface, /if \(secret\.length > 0\) \{/, "blank keeps the vaulted secret - no put");
  assert.match(surface, /uninstallPolicy: "preserve_for_reinstall"/);
  assert.match(surface, /shares\.mount\(share\.shareId\)/);
  assert.ok(!/edits\.password|password: payload\.password/.test(surface), "the secret never rides network.share.edit");
  assert.match(surface, /import \{ credentialPut \} from "\.\.\/credentials\/credential-ops"/);
  assert.ok(!/from ["'].*PasswordField["']/.test(surface), "file-sharing PasswordField stays held");
  // Add is untouched: the secret still rides network.share.add.
  assert.match(surface, /credKind === "user_password" && password\.length > 0\s*\?\s*\{ password \}/);
  assert.match(surface, /credential_key: shareCredentialKey\(alias\)/);
});

test("copy: blank keeps the current password; refusals name the cause", () => {
  assert.equal(en["sources.form.passwordKeep"], "Leave blank to keep the current password.");
  const surface = src("features/sources/SourcesSurface.tsx");
  assert.match(surface, /placeholder=\{editShare \? t\("sources\.form\.passwordKeep"\) : undefined\}/);
  assert.match(surface, /t\("smb\.err\.needOperatorPassword"\)/);
  assert.match(surface, /t\("smb\.err\.vaultUnavailable"\)/);
  for (const key of ["sources.form.passwordKeep"] as const) {
    assert.ok(/^[\x20-\x7E]+$/.test(en[key]), `${key} is 7-bit ASCII`);
  }
});
