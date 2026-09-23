// Contract: a session with no stored bearer must not dispatch
// household_protection_set.
//
// Field failure: the framework admits a same-or-narrower set from
// LAN-trust with no sitting (first start has to be possible), and the
// hook sent set on the shared LAN-trust socket whenever no bearer was
// stored. An unpaired browser on the LAN could put a player on Play
// only with no password and leave the owner to unlock it. The hook now
// refuses locally - nothing dispatched - and the modal offers the
// existing pair door. A session with a bearer dispatches exactly as
// before, on the socket householdWriteSocket chose. First paint is not
// touched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  firstPaintStep,
  householdSetAdmission,
  householdWriteSocket
} from "../../src/features/household/household-protection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/household/useHouseholdProtection.ts");
const modal = src("features/household/HouseholdModal.tsx");
const protection = src("features/household/household-protection.ts");

test("no stored bearer -> set/unlock do not dispatch", () => {
  assert.equal(householdSetAdmission(false), "pair-first");
  // The refusal sits before busy / body / dispatch, and carries the
  // pair-first mark for the surface.
  const setBody = hook.slice(hook.indexOf("const set = useCallback"), hook.indexOf("const unlock = useCallback"));
  const refuse = setBody.indexOf('householdSetAdmission(storedBearer() !== undefined) === "pair-first"');
  const dispatch = setBody.indexOf("dispatchHouseholdSet(transport, body)");
  const busy = setBody.indexOf("setBusy(true)");
  assert.ok(refuse >= 0 && dispatch >= 0 && busy >= 0);
  assert.ok(refuse < busy && refuse < dispatch, "refused before anything is sent");
  assert.ok(/return \{ ok: false, message, pairRequired: true \};/.test(setBody));
  // unlock is set({ lend: false }) - the same door, the same refusal.
  assert.ok(/const unlock = useCallback\(\s*\(\) => set\(\{ lend: false \}\),/.test(hook));
});

test("a stored bearer still dispatches on the write socket 5d5262d chose", () => {
  assert.equal(householdSetAdmission(true), "dispatch");
  assert.equal(householdWriteSocket(true), "stored-bearer");
  assert.equal(householdWriteSocket(false), "shared");
  assert.ok(
    /const write = new WsTransport\(\{\s*url: frameworkWsUrl\(\),\s*bearerToken: bearer\s*\}\);/.test(hook),
    "the bearer write socket is built as before"
  );
  assert.ok(/return await write\.dispatch\(HOUSEHOLD_SET_OP, body\);/.test(hook));
});

test("firstPaintStep unchanged", () => {
  const body = protection.slice(
    protection.indexOf("export function firstPaintStep("),
    protection.indexOf("export function applyHappening(")
  );
  assert.ok(
    /if \(!ready \|\| snapshot === null \|\| snapshot\.chosen !== false\) return "none";/.test(body)
  );
  assert.ok(/if \(isGlass \|\| hasBearer\) return "usage";/.test(body));
  assert.ok(/return "pair";/.test(body));
  assert.ok(!/householdSetAdmission/.test(body), "first paint does not consult the set admission");
  const unchosen = {
    catalog: { levels: [], groups: [] },
    chosen: false,
    level: "open" as const,
    lend: false,
    protectedGroups: [],
    priorLevel: null
  };
  assert.equal(firstPaintStep({ ready: true, snapshot: unchosen, hasBearer: false, isGlass: false }), "pair");
  assert.equal(firstPaintStep({ ready: true, snapshot: unchosen, hasBearer: true, isGlass: false }), "usage");
  assert.equal(firstPaintStep({ ready: true, snapshot: unchosen, hasBearer: false, isGlass: true }), "usage");
  assert.equal(firstPaintStep({ ready: true, snapshot: null, hasBearer: false, isGlass: false }), "none");
});

test("the modal sends a refused session to the existing pair door - no second password card", () => {
  assert.ok(/import \{ PairDeviceFlow \} from "\.\.\/pairing\/PairDeviceFlow";/.test(modal));
  assert.ok(/setNeedsPair\(r\.pairRequired === true\);/.test(modal), "the refusal is read off the set result");
  assert.ok(/t\("pairing\.settings\.label"\)/.test(modal), "the existing door label");
  assert.ok(/<PairDeviceFlow\s+onClose=\{\(\) => setPairOpen\(false\)\}\s+onPaired=/.test(modal), "in place, onPaired, no reload");
  assert.ok(!/forced/.test(modal), "the door from the modal is the cancellable one");
  assert.ok(!/PasswordField|stepUpVerify|type="password"/.test(modal), "no second password card");
  assert.ok(/settle\(await hh\.set\(\{ level: selected, lend: snap\.lend \}\)\)/.test(modal), "Save still asks the hook");
  assert.ok(/settle\(await hh\.unlock\(\)\)/.test(modal));
  const en = src("locales/en.ts");
  const m = /"household\.pairFirst":\s*\n?\s*"([^"]*)"/.exec(en);
  assert.ok(m !== null && /^[\x20-\x7E]+$/.test(m![1]));
});

test("one household_protection_set, one write socket rule: nothing else moved", () => {
  assert.equal(
    (hook.match(/HOUSEHOLD_SET_OP/g) ?? []).length,
    4,
    "import + shared dispatch + no-bearer fallback + bearer dispatch: the same four as before, no new send"
  );
  assert.ok(/return hasStoredBearer \? "stored-bearer" : "shared";/.test(protection), "householdWriteSocket unchanged");
});
