// Contract: File sharing says an SMB user is required - on entry (the group
// copy) and on an enabled server with no users - not after a failed guest
// drop. Per the smb-server inventory: stock and delivery shares are
// authenticated (guest ok = no); a device with SMB enabled and no SMB user
// exports nothing an operator can reach. Add user stays the existing control;
// credential_put + user_add stay the only password path; no guest toggle on
// stock shares.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");
const surface = readFileSync(join(root, "features", "sources", "SmbServerSurface.tsx"), "utf8");

function copy(key: string): string {
  const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*\\n?\\s*"([^"]*)"`).exec(en);
  assert.notEqual(m, null, `${key} must exist`);
  return m![1].toLowerCase();
}

test("the File sharing group copy says a user is required, on entry", () => {
  for (const key of ["settings.group.file-sharing.description", "smb.description"]) {
    const c = copy(key);
    assert.ok(/\buser\b/.test(c), `${key} must mention a user`);
    assert.ok(
      /need|require|until you add|nothing is reachable|password/.test(c),
      `${key} must make the user requirement obvious`
    );
  }
});

test("an enabled server with no users says nothing is reachable until one is added", () => {
  const c = copy("smb.noUsersEnabled");
  assert.ok(/\buser\b/.test(c));
  assert.ok(/nothing|not reachable|no one can|until you add/.test(c), "must say nothing is reachable yet");
  assert.ok(/add/.test(c), "must point at Add user");
  // Disabled + no users still says a user is required, not a bare 'none yet'.
  assert.ok(/\buser\b/.test(copy("smb.noUsers")));
  assert.ok(/need|require/.test(copy("smb.noUsers")));
});

test("the surface picks the enabled copy when the server is on and the list is empty", () => {
  assert.ok(
    /t\(state\.enabled \? "smb\.noUsersEnabled" : "smb\.noUsers"\)/.test(surface),
    "empty-user copy must depend on state.enabled"
  );
});

test("neighbours stay put: Add user control, one user-add path, no stock guest toggle", () => {
  assert.ok(/t\("smb\.addUser"\)/.test(surface), "Add user stays the existing control");
  assert.equal(
    (surface.match(/smb\.addUser/g) ?? []).length >= 1,
    true
  );
  // credential_put then shelf user_add is the only password path.
  assert.ok(/credentialPut\(/.test(surface), "credential_put stays the vault path");
  assert.ok(/smb\.addUser\(/.test(surface), "user_add stays the shelf path");
  // No guest toggle was added for stock shares (guest_ok belongs to extra shares only).
  assert.ok(!/stockGuest|guestOk.*stock|stock.*guest_ok/i.test(surface));
});
