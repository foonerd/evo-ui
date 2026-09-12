// Contract: a protested settings group does not open as itself. Entry is
// HouseholdSurfaceGate (two doors). Mute-and-403-after-click is retired.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const system = readFileSync(join(root, "features/system/SystemSurface.tsx"), "utf8");
const app = readFileSync(join(root, "app/App.tsx"), "utf8");
const network = readFileSync(join(root, "features/network/NetworkLanding.tsx"), "utf8");
const sources = readFileSync(join(root, "features/sources/SourcesSurface.tsx"), "utf8");
const smb = readFileSync(join(root, "features/sources/SmbServerSurface.tsx"), "utf8");
const gate = readFileSync(
  join(root, "features/household/HouseholdSurfaceGate.tsx"),
  "utf8"
);

test("the gate keys off surfaceEntryLocked and the two existing doors", () => {
  assert.ok(/surfaceEntryLocked\(/.test(gate));
  assert.ok(/useStepUpSitting\(\)/.test(gate));
  assert.ok(/ctx\.open/.test(gate));
  assert.ok(/sitting\.request\(\)/.test(gate));
  assert.ok(/household\.gate\.change/.test(gate));
  assert.ok(/household\.gate\.override/.test(gate));
});

test("Settings group bodies mount behind HouseholdSurfaceGate", () => {
  assert.ok(/<HouseholdSurfaceGate group=\{props\.group\}>/.test(system));
  assert.ok(!/HouseholdLockedNotice/.test(system));
  assert.ok(!/household-mute/.test(system));
});

test("Sources destination mounts behind one sources gate", () => {
  assert.ok(
    /<HouseholdSurfaceGate group="sources">/.test(app),
    "Sources + USB share one sources entry gate"
  );
});

test("App wraps only the Sources destination, never playback", () => {
  const gates = [...app.matchAll(/HouseholdSurfaceGate\s+group="([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(gates, ["sources"]);
});

test("Network / Sources / SMB no longer mute-in-place or paint the old notice", () => {
  assert.ok(!/isGroupProtected\(/.test(network));
  assert.ok(!/HouseholdLockedNotice/.test(network));
  assert.ok(!/disabled=\{muted\}/.test(network));
  assert.ok(!/disabled=\{disabled\}/.test(network));
  assert.ok(!/isGroupProtected\(/.test(sources));
  assert.ok(!/HouseholdLockedNotice/.test(sources));
  assert.ok(!/isGroupProtected\(/.test(smb));
  assert.ok(!/HouseholdLockedNotice/.test(smb));
});
