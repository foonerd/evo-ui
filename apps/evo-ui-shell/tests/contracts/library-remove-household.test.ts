// Contract: Library Remove and the household door.
//
// Field failure: on a player whose household protects the sources group,
// Library Remove on a USB source released the queue, then the handoff to
// the USB writer was refused as household_policy_locked. The glass
// showed a bare refusal line, because useLibrary dropped the subclass;
// the Sources Safe remove wrapper set the subclass to null, so the same
// refusal opened Force; and the library socket was anonymous, so a
// sitting the operator proved on a paired browser or the glass (bound
// to its bearer) could not be spent by the nest.
//
// Now:
//  - useLibrary keeps the wire subclass on a refused verb.
//  - Library Remove (USB and every other kind) paints the one household
//    line and opens the one household door on household_policy_locked;
//    never the bare refusal, never Pair, never Force.
//  - The library socket presents the stored bearer at every handshake
//    and re-handshakes on the bearer bus; still one library socket.
//  - Sources Safe remove passes the library subclass on, so the
//    household branch of the one classifier answers before Force.
//  - When the household protects the sources group and no sitting is
//    cached, Library Remove raises the one existing card before anything
//    is sent; cancel sends nothing. No second ceremony.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-remove-household.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeHouseholdSnapshot } from "../../src/features/household/household-protection.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const helperPath = join(root, "features", "library", "remove-household.ts");
const hook = read("features/library/useLibrary.ts");
const surface = read("features/library/LibrarySurface.tsx");
const usb = read("features/sources/UsbDrivesSurface.tsx");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// The helper is new with this contract; load it lazily so a tree without
// it fails the clauses that need it, not the whole file at import.
async function helper(): Promise<typeof import("../../src/features/library/remove-household.ts")> {
  assert.ok(existsSync(helperPath), "features/library/remove-household.ts exists");
  return await import("../../src/features/library/remove-household.ts");
}

const CATALOG = {
  levels: [
    { id: "open", default_groups: [] },
    { id: "low", default_groups: ["network", "file-sharing", "sources"] },
    { id: "standard", default_groups: ["network", "file-sharing", "sources", "system"] },
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

// ---- the wire subclass is kept --------------------------------------------

test("a refused library verb keeps the wire subclass", async () => {
  const { refusalSubclass } = await helper();
  assert.equal(refusalSubclass({ code: "permission_denied", message: "refused", subclass: "household_policy_locked" }), "household_policy_locked");
  assert.equal(refusalSubclass({ message: "refused" }), null);
  assert.equal(refusalSubclass({ subclass: "" }), null);
  assert.equal(refusalSubclass({ subclass: 7 }), null);
  assert.equal(refusalSubclass("refused"), null);
  assert.equal(refusalSubclass(null), null);
  const c = code(hook);
  assert.ok(/\| \{ ok: false; message: string; subclass\?: string \| null \};/.test(c), "the failure shape carries the subclass");
  const dispatch = between(c, "const dispatch = useCallback(", "const listSources = ");
  assert.ok(
    /if \(result\.error !== undefined\) \{\s*return \{\s*ok: false,\s*message: errorMessage\(result\.error\),\s*subclass: refusalSubclass\(result\.error\)\s*\};\s*\}/.test(dispatch),
    "the one verb dispatch returns the subclass beside the message"
  );
  assert.ok(/dispatch\("library\.remove_source", \{ source_id: sourceId \}\)/.test(c), "Remove is still that dispatch, { source_id }");
});

// ---- Library Remove paints the household line and the door ----------------

test("Library USB Remove: household_policy_locked paints the household line and opens the door, never the bare refusal", () => {
  const start = between(surface, "const startUsbRemove = useCallback", "// Stages: from the subject, and only from the subject.");
  assert.ok(
    /if \(!r\.ok\) \{\s*setUsbRemove\(null\);\s*setBusy\(false\);\s*if \(isHouseholdLocked\(r\)\) \{\s*setFeedback\(t\("household\.locked\.body"\)\);\s*if \(household !== null\) household\.open\(\);\s*return;\s*\}\s*setFeedback\(r\.message\);\s*return;\s*\}/.test(start),
    "the lock is the household line and the door; any other refusal is the message, as before"
  );
  assert.ok(!/setAuthRefused|PairDeviceFlow|force/i.test(start), "never Pair, never Force");
});

test("Library Remove of any other kind: household_policy_locked paints the household line and opens the door", () => {
  const confirm = between(surface, "{removeTarget !== null ? (", "{forgetTarget !== null ? (");
  const op = between(confirm, "void runAction(", "});\n");
  assert.ok(
    /const r = await library\.removeSource\(target\.id\);\s*if \(r\.ok\) return \{ ok: true \};\s*if \(isHouseholdLocked\(r\)\) \{\s*if \(household !== null\) household\.open\(\);\s*return \{ ok: false, message: t\("household\.locked\.body"\) \};\s*\}\s*return \{ ok: false, message: r\.message \};/.test(op),
    "the lock is the household line and the door"
  );
  assert.ok(/import \{ isHouseholdLocked \} from "\.\.\/\.\.\/runtime\/authz-classify";/.test(surface), "the one classifier");
  assert.equal((surface.match(/useHouseholdModal\(\)/g) ?? []).length, 1, "one door handle");
  assert.ok(!/HouseholdModalProvider|HouseholdSurfaceGate|<HouseholdModal|household\.gate\./.test(surface), "no second host, gate or banner");
  assert.equal(en["household.locked.body"], "These settings are locked by household protection.");
});

// ---- the library socket carries the bearer --------------------------------

test("the library socket presents the stored bearer and rotates on the bearer bus; still one socket", () => {
  const c = code(hook);
  assert.ok(/import \{ storedBearer, onBearerChange \} from "\.\.\/\.\.\/runtime\/bearer";/.test(hook));
  assert.ok(/const transport = new WsTransport\(\{ url: frameworkUrl\(\), bearerSource: storedBearer \}\);/.test(c), "the bearer is read at every handshake");
  assert.equal((c.match(/new WsTransport\(/g) ?? []).length, 1, "one library socket, no second bearer socket");
  assert.ok(!/setBearerToken|bearerToken:/.test(c), "no fixed snapshot of the bearer");
  const effect = between(c, "const transport = new WsTransport(", "const dispatch = useCallback(");
  assert.ok(/const offBearer = onBearerChange\(\(\) => \{\s*transport\.rotateBearer\(\);\s*\}\);/.test(effect), "a pair or a purge re-handshakes the socket");
  assert.ok(/offConn\(\);\s*offBearer\(\);\s*void transport\.close\(\);/.test(effect), "unsubscribed and closed on unmount");
});

// ---- Sources Safe remove keeps the subclass -------------------------------

test("Sources Safe remove passes the library subclass on; a household refusal never routes to Force", () => {
  const run = between(usb, "const runSafeRemove = async", "const renameValid =");
  assert.ok(/subclass: lr\.subclass \?\? null,/.test(run), "the library subclass reaches the classifier");
  assert.ok(!/subclass: null/.test(run), "never nulled into Force");
  const refuse = between(usb, "const refuse = (", "const run = async (");
  const lock = refuse.indexOf("if (isHouseholdLocked(r)) {");
  const force = refuse.indexOf('if (ctx === "saferemove") {');
  assert.ok(lock >= 0 && force > lock, "the household branch answers before Force");
  assert.ok(/if \(household !== null\) household\.open\(\);\s*return;/.test(refuse.slice(lock, force)), "and stops there");
});

// ---- the card before Remove ----------------------------------------------

test("the sources group is the group Remove raises the card for; no snapshot or a cached sitting raises nothing", async () => {
  const { REMOVE_HOUSEHOLD_GROUP, removeNeedsSitting } = await helper();
  assert.equal(REMOVE_HOUSEHOLD_GROUP, "sources");
  assert.equal(removeNeedsSitting(snap("low"), false), true, "low protects sources: raise the card");
  assert.equal(removeNeedsSitting(snap("strict"), false), true, "play only protects every group");
  assert.equal(removeNeedsSitting(snap("open"), false), false, "open: send as before");
  assert.equal(removeNeedsSitting(snap("open", { lend: true }), false), true, "lend unions the low floor");
  assert.equal(removeNeedsSitting(snap("open", { protected_groups: ["system"], lend: false }), false), false);
  assert.equal(removeNeedsSitting(snap("low"), true), false, "a cached sitting rides the first send");
  assert.equal(removeNeedsSitting(null, false), false, "no snapshot: no fabricated card");
  assert.equal(
    removeNeedsSitting(decodeHouseholdSnapshot({ chosen: false, level: "strict", protected_groups: [], catalog: CATALOG }), false),
    false,
    "not chosen: admits as open"
  );
});

test("Library Remove raises the one existing card before anything is sent; cancel sends nothing", () => {
  const admit = between(surface, "const admitRemove = useCallback(", "}, [household, sitting]);");
  assert.ok(
    /if \(\s*!removeNeedsSitting\(household\?\.household\.snapshot \?\? null, sitting\.live\)\s*\) \{\s*return true;\s*\}\s*return await sitting\.request\(\);/.test(admit),
    "protected and no sitting: the existing card; otherwise straight through"
  );
  assert.ok(/const sitting = useStepUpSitting\(\);/.test(surface), "the one card, through the existing sitting hook");
  assert.ok(!/\.acquire\(|setStepUpBridge|<StepUpHost|getStepUpBridge/.test(code(surface)), "no second ceremony");

  const confirm = between(surface, "{removeTarget !== null ? (", "{forgetTarget !== null ? (");
  const onConfirm = between(confirm, "onConfirm={() => {", "        />");
  const gate = onConfirm.indexOf("void admitRemove().then((admitted) => {");
  const stop = onConfirm.indexOf("if (!admitted) return;");
  const usbStart = onConfirm.indexOf("void startUsbRemove(target);");
  const otherSend = onConfirm.indexOf("library.removeSource(target.id)");
  assert.ok(gate >= 0 && stop > gate, "the card is asked first, and a refusal stops there");
  assert.ok(usbStart > stop && otherSend > stop, "both Remove paths are behind the card");
  assert.equal((code(surface).match(/startUsbRemove\(target\)/g) ?? []).length, 1, "USB Remove starts only from the admitted branch");
  assert.equal((code(surface).match(/library\.removeSource\(/g) ?? []).length, 2, "two sends in the surface: USB start and the other kinds");
  const start = between(surface, "const startUsbRemove = useCallback", "// Stages: from the subject, and only from the subject.");
  assert.equal((start.match(/await library\.removeSource\(/g) ?? []).length, 1, "USB start: one send");
  assert.ok(!/admitRemove|sitting/.test(start), "the heartbeat mounts only after the card answered");
});

test("source and strings carry no row id; added lines are ASCII", () => {
  for (const s of [hook, surface, usb]) assert.ok(!/\b[A-Z][0-9]\b/.test(code(s)), "no row id in source");
  if (existsSync(helperPath)) {
    const h = readFileSync(helperPath, "utf8");
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(h), "helper is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(h), "no row id in the helper");
  }
});
