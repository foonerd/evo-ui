// Contract: a household-locked verb on the Sources page paints.
//
// Field failure: SourcesSurface.run() and UsbDrivesSurface.refuse()
// answered household_policy_locked by clearing the pair flag and
// returning - no line, no door - so a locked Mount / Add share / Remove /
// Rename looked idle. The page's entry gate (HouseholdSurfaceGate,
// group "sources") is the lock on entry; this is the refuse after the
// page is already up - a spent override sitting, or a policy that still
// locks the verb. Both now paint the one existing household line and
// open the one existing household door, exactly as the kiosk wizard and
// the Providers panel do. Pair-required still opens Pair; a lock never
// does. No second banner, no second modal host, no second send.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const sources = src("features/sources/SourcesSurface.tsx");
const usb = src("features/sources/UsbDrivesSurface.tsx");
const wizard = src("features/kiosk/TouchCalibrationWizard.tsx");
const app = src("app/App.tsx");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

// The household-locked branch of each classifier, and nothing after it.
const sourcesLocked = between(sources, "} else if (isHouseholdLocked(r)) {", "} else {");
const usbLocked = between(usb, "if (isHouseholdLocked(r)) {", "const probe =");

test("Sources: a household-locked add / mount / edit / remove paints the household line and opens the door", () => {
  assert.match(sourcesLocked, /setFeedback\(t\("household\.locked\.body"\)\);/, "the line");
  assert.match(sourcesLocked, /if \(household !== null\) household\.open\(\);/, "the door");
  assert.ok(!/setFeedback\(""\)/.test(sourcesLocked), "no longer cleared to nothing");
  assert.ok(!/setAuthRefused\(true\)|setPairOpen\(true\)/.test(sourcesLocked), "a lock never opens Pair");
  assert.match(sources, /const household = useHouseholdModal\(\);/);
  assert.match(sources, /import \{ useHouseholdModal \} from "\.\.\/household\/HouseholdModalHost";/);
});

test("USB: a household-locked mount / safe remove / repair / rename paints the household line and opens the door", () => {
  assert.match(usbLocked, /setFeedback\(t\("household\.locked\.body"\)\);/, "the line");
  assert.match(usbLocked, /if \(household !== null\) household\.open\(\);/, "the door");
  assert.match(usbLocked, /return;/, "and stops there - never the busy / repair / copy classifiers");
  assert.ok(!/setAuthRefused\(true\)|setModal\(/.test(usbLocked), "a lock never opens Pair or another modal");
  assert.match(usb, /const household = useHouseholdModal\(\);/);
  assert.match(usb, /import \{ useHouseholdModal \} from "\.\.\/household\/HouseholdModalHost";/);
});

test("pair-required still opens Pair on both surfaces, ahead of the lock branch", () => {
  const sourcesRun = between(sources, "const run = async (", "// Pair is offered ONLY");
  assert.match(sourcesRun, /if \(isPairRequired\(r\)\) \{\s*setAuthRefused\(true\);\s*setFeedback\(""\);\s*\} else if \(isHouseholdLocked\(r\)\)/);
  const usbRefuse = between(usb, "const refuse = (", "const run = async (");
  assert.match(usbRefuse, /if \(isPairRequired\(r\)\) \{\s*setAuthRefused\(true\);\s*return;\s*\}\s*if \(isHouseholdLocked\(r\)\)/);
  // A failed Safe Remove opens Force. The library drop hides the busy
  // text, so Force is not gated on that probe.
  assert.match(
    usbRefuse,
    /if \(ctx === "saferemove"\) \{\s*setModal\(\{ kind: "force", drive, holders: r\.data\.holders \}\);\s*return;\s*\}/,
    "a failed Safe Remove opens Force"
  );
  assert.ok(
    !/ctx === "saferemove" && \/busy\|still open\|holders\//.test(usbRefuse),
    "Force is not gated on the busy text"
  );
  assert.ok(/ctx === "repair" && \/repair\.\?fail\//.test(usbRefuse), "repair escalate unchanged");
});

test("the same paint the kiosk wizard uses: one line, one door, no second banner or host", () => {
  assert.equal(en["household.locked.body"], "These settings are locked by household protection.");
  assert.ok(/^[\x20-\x7E]+$/.test(en["household.locked.body"]));
  assert.match(wizard, /household\.open\(\);/);
  assert.match(wizard, /setErrorMsg\(t\("household\.locked\.body"\)\);/);
  for (const [name, s] of [["Sources", sources], ["USB", usb]] as const) {
    assert.equal((s.match(/useHouseholdModal\(\)/g) ?? []).length, 1, `${name}: one door handle`);
    assert.ok(!/HouseholdModalProvider|HouseholdSurfaceGate|<HouseholdModal/.test(s), `${name}: no second host, no second gate`);
    assert.ok(!/household\.gate\.|household\.locked\.door/.test(s), `${name}: no invented banner copy`);
  }
  // The entry gate is untouched: still one wrap around both surfaces.
  assert.match(app, /<HouseholdSurfaceGate group="sources">\s*<SourcesSurface onOpenInLibrary=\{openInLibrary\} \/>\s*<UsbDrivesSurface \/>\s*<\/HouseholdSurfaceGate>/);
});

test("the verbs themselves are untouched - the paint is the only change", () => {
  const hook = src("features/sources/useUsbDrives.ts");
  assert.match(hook, /dispatch\("storage\.usb\.mount", \{ stable_id: stableId \}\)/);
  assert.match(hook, /dispatch\("storage\.usb\.safe_remove", \{/);
  assert.match(hook, /dispatch\("storage\.usb\.repair_filesystem", \{/);
  assert.match(hook, /dispatch\("storage\.usb\.rename", \{/);
  const shares = src("features/sources/useNetworkShares.ts");
  assert.match(shares, /"network\.share\.add"/);
  assert.match(shares, /"network\.share\.mount"/);
  assert.ok(!/household/.test(hook) && !/household/.test(shares), "no household logic moved into the hooks");
});
