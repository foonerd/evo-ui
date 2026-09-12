// Contract: the onboarding host runs ONE sequence over TWO reused ceremonies.
// Structural on purpose - it guards the architecture the decision test cannot:
// the host asks firstPaintStep (not a re-derived chosen check), renders the
// EXISTING PairDeviceFlow for step 1 wired in-surface (onPaired, no reload),
// reuses the EXISTING HouseholdModal for step 2, and builds no second pair and
// no second household. The per-step behaviour is in household-protection.test
// (firstPaintStep) and PairDeviceFlow's / HouseholdModal's own tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, "..", "..", "src", "features", "household", "HouseholdModalHost.tsx"),
  "utf8"
);

test("the host decides the step through firstPaintStep, with the live signals", () => {
  assert.ok(/firstPaintStep\(/.test(src), "must call the extracted gate");
  assert.ok(
    /storedBearer\(\)/.test(src),
    "hasBearer must come from the stored bearer (browser pairing signal)"
  );
  assert.ok(
    /kioskMode\(\)\s*===\s*"glass"/.test(src),
    "isGlass must come from kioskMode (glass skips pair)"
  );
});

test("step 1 reuses PairDeviceFlow in-surface: onPaired, never a reload", () => {
  assert.ok(/<PairDeviceFlow\b/.test(src), "the pair step must reuse PairDeviceFlow");
  assert.ok(
    /onPaired=\{onPaired\}/.test(src),
    "PairDeviceFlow must be wired in-surface via onPaired (no reload)"
  );
  assert.ok(
    !/location\.reload/.test(src),
    "the host must never full-page-reload past usage"
  );
  // Pairing flips the browser bearer signal so the sequence advances to step 2.
  assert.ok(
    /setHasBearer\(true\)/.test(src),
    "onPaired must advance the sequence (hasBearer -> true), landing on usage"
  );
});

test("step 2 reuses the one HouseholdModal - no second pair, no second household", () => {
  assert.ok(/<HouseholdModal\b/.test(src), "usage must reuse HouseholdModal");
  // Exactly one of each ceremony is mounted here.
  assert.equal(
    (src.match(/<PairDeviceFlow\b/g) ?? []).length,
    1,
    "exactly one PairDeviceFlow (no second pair host)"
  );
  assert.equal(
    (src.match(/<HouseholdModal\b/g) ?? []).length,
    1,
    "exactly one HouseholdModal (no second household)"
  );
});

test("first-paint usage stays forced; only the manual door is dismissible", () => {
  assert.ok(
    /dismissible = step !== "usage"/.test(src),
    "first-paint usage must be non-dismissible; the Settings-door open is dismissible"
  );
});
