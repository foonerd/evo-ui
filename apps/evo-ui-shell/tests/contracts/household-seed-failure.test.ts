// Contract: a failed household get is not perpetual Loading.
//
// Field failure: useHouseholdProtection's seed returned on r.error and
// recorded nothing, `ready` only meant "a transport exists", and the
// entry gate painted household.loading for ready && snapshot === null
// with no retry. One failed household_protection_get left every
// Settings group and the Sources page saying "Loading..." for the rest
// of the page's life. The gate now tells in-flight from failed: a
// failed get paints an honest error with a retry that re-runs the seed;
// in flight is still Loading; the children never mount on a failure
// (a protested group must not open with no policy); no snapshot is
// fabricated.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { householdGatePhase } from "../../src/features/household/household-gate-phase.ts";

test("failed get is not household.loading", () => {
  assert.equal(
    householdGatePhase({ ready: true, snapshotPresent: false, seedError: "unknown_op" }),
    "failed"
  );
});

test("in-flight is still Loading", () => {
  assert.equal(
    householdGatePhase({ ready: true, snapshotPresent: false, seedError: null }),
    "in-flight"
  );
});

test("a landed snapshot is seeded - the policy decides, whatever an earlier error said", () => {
  assert.equal(
    householdGatePhase({ ready: true, snapshotPresent: true, seedError: null }),
    "seeded"
  );
  // A stale error string cannot outrank a snapshot that has landed.
  assert.equal(
    householdGatePhase({ ready: true, snapshotPresent: true, seedError: "old" }),
    "seeded"
  );
});

test("no transport (designer / tests) is inert, not failed", () => {
  assert.equal(
    householdGatePhase({ ready: false, snapshotPresent: false, seedError: null }),
    "inert"
  );
});

// ---- the hook and the gate ---------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/household/useHouseholdProtection.ts");
const gate = src("features/household/HouseholdSurfaceGate.tsx");

test("the hook records a failed get and clears it on a landed one - no fabricated snapshot", () => {
  assert.ok(
    /if \(r\.error !== undefined\) \{\s*setSeedError\(/.test(hook),
    "a failed get sets seedError"
  );
  assert.ok(/setSeedError\(null\);\s*setSnapshot\(decodeHouseholdSnapshot\(r\.value\)\);/.test(hook),
    "a landed get clears the error and seeds the real snapshot");
  assert.ok(!/setSnapshot\(\{/.test(hook), "no snapshot literal is ever fabricated");
  assert.ok(/seedError,\s*reseed,/.test(hook), "seedError and reseed are exposed");
});

test("retry re-seeds: reseed() re-runs the same seed on the same socket", () => {
  assert.ok(/seedRef\.current = seed;/.test(hook), "the seed closure is kept for retry");
  assert.ok(
    /const seed = seedRef\.current;\s*if \(seed !== null\) void seed\(\);/.test(hook),
    "reseed runs it"
  );
  assert.ok(/setSeedNonce\(\(n\) => n \+ 1\)/.test(hook));
  assert.ok(/onClick=\{ctx\.household\.reseed\}/.test(gate), "the gate's retry calls reseed");
  assert.ok(!/attachSharedHappenings\([\s\S]*attachSharedHappenings\(/.test(hook), "one attach, never a second");
});

test("children do not mount on fail; in-flight and failed are two paints", () => {
  assert.ok(/householdGatePhase\(\{/.test(gate), "the gate decides through the phase");
  const inFlight = gate.indexOf('phase === "in-flight"');
  const failed = gate.indexOf('phase === "failed"');
  const policy = gate.indexOf("surfaceEntryLocked(");
  assert.ok(inFlight >= 0 && failed >= 0 && policy >= 0);
  assert.ok(inFlight < policy && failed < policy, "both paints return before the policy is read");
  const failedBlock = gate.slice(failed, policy);
  assert.ok(/t\("household\.loadFailed"\)/.test(failedBlock), "failed paints the honest error");
  assert.ok(/t\("household\.loadRetry"\)/.test(failedBlock), "failed offers the retry");
  assert.ok(!/\{children\}/.test(failedBlock), "the children never mount on a failed get");
  assert.ok(!/household\.loading/.test(failedBlock), "failed is not Loading");
  const inFlightBlock = gate.slice(inFlight, failed);
  assert.ok(/t\("household\.loading"\)/.test(inFlightBlock), "in flight is still Loading");
});

test("the doors and the policy read are untouched", () => {
  assert.ok(/surfaceEntryLocked\(ctx\.household\.snapshot, group, sitting\.live\)/.test(gate));
  assert.ok(/household\.gate\.change/.test(gate) && /household\.gate\.override/.test(gate));
  const en = src("locales/en.ts");
  for (const key of ["household.loadFailed", "household.loadRetry"]) {
    const m = new RegExp(`"${key.split(".").join("\\.")}":\\s*"([^"]*)"`).exec(en);
    assert.ok(m !== null, `${key} exists`);
    assert.ok(/^[\x20-\x7E]+$/.test(m![1]), `${key} is 7-bit`);
  }
});
