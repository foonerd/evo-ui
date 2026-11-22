// Contract: the power cluster's Flight confirm and the household door.
//
// Field failure: at Everyday use with no sitting, confirming Flight from
// the power cluster (sidebar, pivot device reveal, Settings power tiles)
// sent network.nm.flight_mode.set, the household gate refused it as
// household_policy_locked, and the confirm painted the bare refusal
// ("refused: 403 Forbidden"). useSystemPower dropped the subclass, and
// the cluster had no door and no card.
//
// Now, the same pattern as Library Remove:
//  - When the household protects the network group (the group the
//    Settings Network entry gate keys on) and no sitting is cached, the
//    confirm asks the one existing card before anything is sent. Cancel
//    sends nothing, paints nothing, and the radios stay as they are.
//  - setFlight keeps the wire subclass on a refusal. A household lock
//    paints the one household line and opens the one household door;
//    never the bare refusal, never Pair.
//  - A landed set still announces once on the flight bus; the reboot and
//    power-off outcomes are unchanged.
// Run:
//   node --experimental-strip-types --test tests/contracts/power-flight-household.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeHouseholdSnapshot } from "../../src/features/household/household-protection.ts";
import { isHouseholdLocked } from "../../src/runtime/authz-classify.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const helperPath = join(root, "features", "system", "flight-household.ts");
const hook = read("features/system/useSystemPower.ts");
const confirmSrc = read("features/system/SystemPowerConfirm.tsx");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

async function helper(): Promise<typeof import("../../src/features/system/flight-household.ts")> {
  assert.ok(existsSync(helperPath), "features/system/flight-household.ts exists");
  return await import("../../src/features/system/flight-household.ts");
}

const CATALOG = {
  levels: [
    { id: "open", default_groups: [] },
    { id: "low", default_groups: ["network", "file-sharing", "sources"] },
    { id: "strict", default_groups: "*" }
  ],
  groups: [
    { id: "network", scopes: ["network_admin"] },
    { id: "file-sharing", scopes: ["network_admin"] },
    { id: "sources", scopes: ["network_admin"] },
    { id: "system", scopes: ["system_admin"] }
  ]
};
const snap = (level: string, extra: Record<string, unknown> = {}) =>
  decodeHouseholdSnapshot({ chosen: true, level, lend: false, protected_groups: [], catalog: CATALOG, ...extra });

const flightBranch = (): string => between(code(confirmSrc), 'if (confirm === "flight_on" || confirm === "flight_off") {', "const outcome =");

test("Flight asks the card for the network group; no snapshot or a cached sitting asks nothing", async () => {
  const { FLIGHT_HOUSEHOLD_GROUP, flightNeedsSitting } = await helper();
  assert.equal(FLIGHT_HOUSEHOLD_GROUP, "network", "the group the Settings Network entry gate keys on");
  assert.equal(flightNeedsSitting(snap("low"), false), true, "Everyday use protects network: card first");
  assert.equal(flightNeedsSitting(snap("strict"), false), true);
  assert.equal(flightNeedsSitting(snap("open"), false), false, "a home player: send as before");
  assert.equal(flightNeedsSitting(snap("low"), true), false, "a cached sitting rides the send");
  assert.equal(flightNeedsSitting(null, false), false, "no snapshot: no fabricated card");
  assert.equal(flightNeedsSitting(snap("open", { protected_groups: ["system"] }), false), false);
});

test("setFlight keeps the wire subclass on a refusal; the landed set and the messages are unchanged", () => {
  const c = code(hook);
  assert.ok(/export interface FlightToggleResult \{\s*ok: boolean;\s*message\?: string;\s*subclass\?: string \| null;\s*\}/.test(c), "the result carries the subclass");
  const set = between(c, "const setFlight = useCallback", "return {\n    available,");
  assert.ok(
    /return \{\s*ok: false,\s*message: verbErrorMessage\(r\.error, "Flight mode change was refused\."\),\s*subclass: r\.error\.subclass \?\? null\s*\};/.test(set),
    "the refusal keeps its subclass beside the same message"
  );
  assert.ok(/if \(r\.error === undefined\) \{\s*setFlightEnabled\(enabled\);\s*notifyFlightChange\(\);\s*return \{ ok: true \};/.test(set), "a landed set still announces once");
  assert.equal((set.match(/notifyFlightChange\(\)/g) ?? []).length, 1);
  assert.equal((set.match(/pluginRequest\(/g) ?? []).length, 1, "one send");
  // The field refusal, as the WS frame carries it, is the household lock.
  assert.equal(isHouseholdLocked({ message: "refused: 403 Forbidden", subclass: "household_policy_locked" }), true);
});

test("the confirm asks the existing card before Flight is sent; cancel sends nothing and paints nothing", () => {
  const branch = flightBranch();
  assert.ok(
    /if \(\s*flightNeedsSitting\(household\?\.household\.snapshot \?\? null, sitting\.live\) &&\s*!\(await sitting\.request\(\)\)\s*\) \{\s*setBusy\(false\);\s*return;\s*\}/.test(branch),
    "protected and no sitting: the one card; cancel stops here"
  );
  const ask = branch.indexOf("flightNeedsSitting(");
  const send = branch.indexOf("power.setFlight(");
  assert.ok(ask >= 0 && send > ask, "the card is asked before the send");
  assert.equal((branch.match(/power\.setFlight\(/g) ?? []).length, 1, "one send");
  const cancel = between(branch, "!(await sitting.request())", "const res =");
  assert.ok(!/setError|household\.open|setFlight/.test(cancel), "cancel: no send, no paint");
  const c = code(confirmSrc);
  assert.ok(/const sitting = useStepUpSitting\(\);/.test(c), "the one card, through the existing sitting hook");
  assert.ok(!/\.acquire\(|setStepUpBridge|<StepUpHost|getStepUpBridge|PairDeviceFlow|PairHost|HouseholdSurfaceGate|HouseholdModalProvider/.test(c), "no second ceremony, no Pair, no gate");
});

test("a household-locked Flight opens the household door, never the bare refusal", () => {
  const branch = flightBranch();
  assert.ok(
    /const res = await power\.setFlight\(confirm === "flight_on"\);\s*setBusy\(false\);\s*if \(res\.ok\) \{\s*closeConfirm\(\);\s*\} else if \(isHouseholdLocked\(res\)\) \{\s*if \(household !== null\) \{\s*closeConfirm\(\);\s*household\.open\(\);\s*\} else \{\s*setError\(t\("household\.locked\.body"\)\);\s*\}\s*\} else \{\s*setError\(res\.message \?\? t\("power\.flightFailed"\)\);\s*\}\s*return;/.test(branch),
    "the lock is the door (the confirm steps aside for it), or the household line with no door host; any other refusal is its message, as before"
  );
  // The door is the dialog band, below the confirm's step-up band: the
  // confirm must close for the door to be on top.
  assert.ok(/band="dialog"/.test(read("features/household/HouseholdModal.tsx")));
  assert.ok(/band="stepup"/.test(read("components/StepUpConfirm.tsx")));
  assert.ok(/dialog < stepup < prompt < banner/.test(read("components/AttentionLayer.tsx")));
  assert.ok(/import \{ isHouseholdLocked \} from "\.\.\/\.\.\/runtime\/authz-classify";/.test(confirmSrc), "the one classifier");
  assert.equal((code(confirmSrc).match(/useHouseholdModal\(\)/g) ?? []).length, 1, "one door handle");
  assert.equal(en["household.locked.body"], "These settings are locked by household protection.");
});

test("reboot and power-off outcomes are unchanged", () => {
  const c = code(confirmSrc);
  const tail = between(c, "const outcome =", "return {\n    available: power.available,");
  assert.ok(/if \(outcome\.kind === "not_authorised"\) \{\s*setError\(t\("power\.notAuthorised"\)\);\s*\} else if \(outcome\.kind === "step_up_required"\) \{\s*setError\(t\("power\.stepUpRequired"\)\);\s*\} else \{\s*setError\(outcome\.message\);\s*\}/.test(tail));
  assert.ok(!/flightNeedsSitting|sitting\.request|isHouseholdLocked/.test(tail), "the card-first rule is Flight's, not the power verbs'");
});

test("source carries no row id; the helper is ASCII", () => {
  for (const s of [hook, confirmSrc]) assert.ok(!/\b[A-Z][0-9]\b/.test(code(s)), "no row id in source");
  if (existsSync(helperPath)) {
    const h = readFileSync(helperPath, "utf8");
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(h));
    assert.ok(!/\b[A-Z][0-9]\b/.test(h));
  }
});
