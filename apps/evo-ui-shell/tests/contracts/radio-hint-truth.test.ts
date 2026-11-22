// Contract: the radio line under Settings -> Network says what the radios
// are actually doing. Flight off used to read "Wi-Fi and AP active"
// unconditionally - on a device whose access point is off, and on one with
// no radio able to carry an access point at all. The line asserted a thing
// the Access point card beside it was calling Off.
//
// The access point's liveness here is the same fact that card uses, so the
// two cannot disagree: the connected row whose connection is the hotspot
// profile or whose address is shared.
// Run:
//   node --experimental-strip-types --test tests/contracts/radio-hint-truth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const landing = readFileSync(
  join(root, "features", "network", "NetworkLanding.tsx"),
  "utf8"
);
const locales = readFileSync(join(root, "locales", "en.ts"), "utf8");

test("flight-off does not claim the access point is active", () => {
  // The line is not a binary on flight mode. That binary is the defect:
  // it has no term for the access point being off.
  assert.ok(
    !/link\.flightMode \? t\("settings\.network\.flightOnHint"\) : t\("settings\.network\.flightOffHint"\)/.test(landing),
    "the hint must not be a bare flight-mode binary"
  );
  assert.ok(
    /function radioHint\(link: Link\): string \{/.test(landing),
    "the hint is derived, not asserted"
  );
  // Derived from the access point's own liveness, the same way the card is.
  const hint = landing.slice(landing.indexOf("function radioHint("));
  const body = hint.slice(0, hint.indexOf("\n}\n") + 3);
  assert.ok(
    /findHotspotRow\(link\.deviceTable, hotspotName\)/.test(body),
    `the hint must read the live hotspot row: ${body}`
  );
  assert.ok(
    /apLive[\s\S]*flightOffHint[\s\S]*flightOffApOffHint/.test(body),
    `an active AP says active, an inactive one does not: ${body}`
  );
  assert.ok(
    /if \(link\.flightMode\) return t\("settings\.network\.flightOnHint"\)/.test(body),
    "flight on still suspends everything and still says so"
  );
});

test("the off-AP line exists and does not claim the AP is active", () => {
  const line = locales
    .split("\n")
    .find((l) => l.includes("settings.network.flightOffApOffHint"));
  assert.ok(line !== undefined, "the off-AP hint must be translated");
  assert.ok(
    /AP off/.test(line as string),
    `the line must say the access point is off: ${line}`
  );
  assert.ok(
    !/AP active/.test(line as string),
    `the off-AP line must not say active: ${line}`
  );
  // And the active line still means active.
  const active = locales
    .split("\n")
    .find((l) => l.includes("settings.network.flightOffHint\""));
  assert.ok(
    /AP active/.test(active as string),
    `the active line still reads active: ${active}`
  );
});
