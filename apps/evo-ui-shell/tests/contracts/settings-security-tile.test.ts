// Contract: Settings has a Security tile, and BOTH device-security ceremonies
// live there - off the System group: PairingSettingsRow (authorise this
// browser) and HouseholdSettingsRow (household lockdown). Structural on purpose:
// the failure this guards is either row drifting back onto System, or the
// Security group vanishing from the landing grid. The two ceremonies stay two;
// copy/behaviour are covered by pairing-settings-copy.test, PairDeviceFlow's own
// tests, and the household modal's tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, "..", "..", "src", "features", "system", "SystemSurface.tsx"),
  "utf8"
);

// One top-level `function <name>(` body, up to the next top-level function
// (or EOF) - enough to assert which component mounts a row.
function fnBody(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

function groupList(): string {
  const start = src.indexOf("const SETTINGS_GROUPS");
  assert.notEqual(start, -1, "SETTINGS_GROUPS not found");
  return src.slice(start, src.indexOf("]", start));
}

test("the Settings group list includes security", () => {
  assert.ok(
    /"security"/.test(groupList()),
    'SETTINGS_GROUPS must include "security"'
  );
});

test("the Security group body mounts both ceremonies, pair row then household", () => {
  assert.ok(
    /props\.group === "security" \? <SecurityGroup/.test(src),
    "GroupContent must route the security group to SecurityGroup"
  );
  const security = fnBody("SecurityGroup");
  assert.ok(
    /<PairingSettingsRow/.test(security),
    "SecurityGroup must mount PairingSettingsRow"
  );
  assert.ok(
    /<HouseholdSettingsRow/.test(security),
    "SecurityGroup must mount HouseholdSettingsRow (household lockdown moved here)"
  );
  assert.ok(
    security.indexOf("<PairingSettingsRow") < security.indexOf("<HouseholdSettingsRow"),
    "the pair row must precede the household row"
  );
});

test("the System group body mounts NEITHER ceremony (both on the Security tile)", () => {
  const system = fnBody("SystemGroup");
  assert.ok(
    !/<PairingSettingsRow/.test(system),
    "SystemGroup must not mount PairingSettingsRow (it moved to the Security tile)"
  );
  assert.ok(
    !/<HouseholdSettingsRow/.test(system),
    "SystemGroup must not mount HouseholdSettingsRow (household lockdown moved to the Security tile)"
  );
});
