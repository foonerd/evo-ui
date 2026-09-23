// Contract: after the operator pairs, household.pairFirst must not stay on
// the error line.
//
// Field failure: set() wrote hh.error = household.pairFirst on the
// no-bearer refusal and exposed no clear; the modal's onPaired closed the
// pair door and cleared its own flag only. The alert kept saying
// "authorise this browser" after they had just done so, until a later
// Save happened to clear it. Same class as a stale list failure after
// the last answer. Pair success now clears that one error - and only
// that one: a refusal from the player stays until the next write answers
// it. Nothing is saved or dispatched on pair.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { householdSetAdmission } from "../../src/features/household/household-protection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/household/useHouseholdProtection.ts");
const modal = src("features/household/HouseholdModal.tsx");
const protection = src("features/household/household-protection.ts");

test("after onPaired, the surface does not paint household.pairFirst", () => {
  const onPaired = modal.slice(modal.indexOf("onPaired={() => {"), modal.indexOf("/>", modal.indexOf("onPaired={() => {")));
  assert.ok(/hh\.clearPairFirst\(\);/.test(onPaired), "pair success clears the pair-first line");
  assert.ok(/setPairOpen\(false\);/.test(onPaired) && /setNeedsPair\(false\);/.test(onPaired));
  assert.ok(!/hh\.set\(|hh\.unlock\(|save\(|settle\(/.test(onPaired), "no auto-Save, no dispatch on pair");
});

test("clearPairFirst clears only the pair-first refusal", () => {
  assert.ok(/lastRefusalRef\.current = "pair-first";\s*setError\(message\);/.test(hook), "the refusal is marked");
  assert.ok(
    /const clearPairFirst = useCallback\(\(\) => \{\s*if \(lastRefusalRef\.current !== "pair-first"\) return;\s*lastRefusalRef\.current = null;\s*setError\(null\);/.test(hook),
    "a player refusal is not cleared by a pair"
  );
  assert.ok(/lastRefusalRef\.current = null;\s*setBusy\(true\);\s*setError\(null\);/.test(hook), "the dispatch path resets the mark");
  assert.ok(/clearPairFirst: \(\) => void;/.test(hook) && /unlock,\s*clearPairFirst\s*\}/.test(hook), "exposed on the hook");
});

test("a pair completed anywhere on the page clears it too - through the one bearer bus", () => {
  assert.ok(
    /onBearerChange\(\(\) => \{\s*if \(storedBearer\(\) !== undefined\) clearPairFirst\(\);/.test(hook),
    "the bus clears it when a bearer is now stored"
  );
  const busBlock = hook.slice(hook.indexOf("onBearerChange(() => {"), hook.indexOf("[clearPairFirst]"));
  assert.ok(!/dispatch|set\(\{|HOUSEHOLD_SET_OP/.test(busBlock), "the bus never saves or dispatches");
});

test("admission, write socket and first paint are untouched", () => {
  assert.ok(/return hasStoredBearer \? "dispatch" : "pair-first";/.test(protection));
  assert.ok(/return hasStoredBearer \? "stored-bearer" : "shared";/.test(protection));
  const fp = protection.slice(protection.indexOf("export function firstPaintStep("), protection.indexOf("export function applyHappening("));
  assert.ok(/if \(!ready \|\| snapshot === null \|\| snapshot\.chosen !== false\) return "none";/.test(fp));
  assert.ok(/if \(isGlass \|\| hasBearer\) return "usage";/.test(fp));
  assert.equal((hook.match(/HOUSEHOLD_SET_OP/g) ?? []).length, 4, "no new send");
});

// ---- standing-neighbour locks -----------------------------------------
// Two neighbours, one file: LAN-trust cannot mutate protection, and the
// pair still mints. Goes red if a set can reach the wire with no stored
// bearer, if unlock stops being a set, or if PairDeviceFlow stops being
// pair_authenticate -> storeBearer -> hand over or reload with no save.

test("LOCK LAN-trust cannot mutate protection: no stored bearer is pair-first before the one send; unlock is a set", () => {
  assert.equal(householdSetAdmission(false), "pair-first");
  assert.equal(householdSetAdmission(true), "dispatch");
  const setFn = hook.slice(hook.indexOf("const set = useCallback("), hook.indexOf("const unlock = useCallback("));
  assert.ok(setFn.length > 0);
  const guard = setFn.indexOf('householdSetAdmission(storedBearer() !== undefined) === "pair-first"');
  const send = setFn.indexOf("dispatchHouseholdSet(transport, body)");
  assert.ok(guard >= 0 && send > guard, "the admission check sits before the send");
  assert.match(setFn, /return \{ ok: false, message, pairRequired: true \};/);
  assert.equal((setFn.match(/dispatchHouseholdSet\(/g) ?? []).length, 1, "one send");
  assert.ok(!/pluginRequest\(|\.dispatch\(/.test(setFn.slice(0, send)), "nothing goes out ahead of the admission");
  assert.match(hook, /const unlock = useCallback\(\s*\(\) => set\(\{ lend: false \}\),/, "unlock goes through the same admission");
});

test("LOCK pair mint: PairDeviceFlow is one pair_authenticate, then storeBearer, then hand over or reload - no save on pair", () => {
  const pair = src("features/pairing/PairDeviceFlow.tsx");
  const submit = pair.slice(pair.indexOf("const submit = async"), pair.indexOf("return (\n"));
  assert.ok(submit.length > 0);
  assert.match(submit, /const r = await pairAuthenticate\(deviceHint\(\), password\);/);
  assert.equal((submit.match(/pairAuthenticate\(/g) ?? []).length, 1, "one mint");
  assert.match(
    submit,
    /storeBearer\(r\.value\.token\);\s*if \(onPaired !== undefined\) \{\s*onPaired\(r\.value\.token\);\s*return;\s*\}[\s\S]*window\.location\.reload\(\);/
  );
  assert.match(submit, /if \(!r\.ok\) \{\s*setBusy\(false\);\s*setError\(refusalCopy\(r\.refusal, r\.message\)\);\s*return;/, "a refused mint stores nothing");
  assert.ok(!/set\(\{|household|dispatch\(|pluginRequest\(/.test(submit), "no auto-Save, no other send on pair");
  assert.match(pair, /import \{ pairAuthenticate, storeBearer \} from "\.\.\/\.\.\/runtime\/session-trust";/);
});
