// Contract for the pure household-protection wire module.
// Run: node --experimental-strip-types --test tests/contracts/household-protection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeHouseholdSnapshot,
  decodeHouseholdHappening,
  applyHappening,
  buildSetBody,
  groupsForLevel,
  resolveGroups,
  isAllGroups,
  isGroupProtected,
  protectedGroupIds,
  surfaceEntryLocked,
  firstPaintStep,
  HOUSEHOLD_HAPPENING_TYPE
} from "../../src/features/household/household-protection.ts";

const CATALOG = {
  levels: [
    { id: "open", default_groups: [] },
    { id: "low", default_groups: ["admin"] },
    { id: "standard", default_groups: ["admin", "sources"] },
    { id: "strict", default_groups: "*" }
  ],
  groups: [
    { id: "admin", scopes: ["network_admin", "system_admin"] },
    { id: "sources", scopes: ["sources_write"] },
    { id: "playback", scopes: ["transport"] }
  ]
};

test("fresh snapshot decodes to the unchosen open default", () => {
  const s = decodeHouseholdSnapshot({
    household_protection: { anything: true },
    chosen: false,
    level: "open",
    lend: false,
    protected_groups: [],
    prior_level: null,
    catalog: CATALOG
  });
  assert.equal(s.chosen, false);
  assert.equal(s.level, "open");
  assert.equal(s.lend, false);
  assert.deepEqual(s.protectedGroups, []);
  assert.equal(s.priorLevel, null);
  assert.equal(s.catalog.levels.length, 4);
  assert.equal(s.catalog.groups.length, 3);
});

test("a chosen strict snapshot carries prior_level and normalizes catalog '*'", () => {
  const s = decodeHouseholdSnapshot({
    chosen: true,
    level: "strict",
    lend: true,
    protected_groups: "*",
    prior_level: "standard",
    catalog: CATALOG
  });
  assert.equal(s.chosen, true);
  assert.equal(s.level, "strict");
  assert.equal(s.lend, true);
  assert.equal(s.priorLevel, "standard");
  assert.ok(isAllGroups(s.protectedGroups));
  const strict = s.catalog.levels.find((l) => l.id === "strict");
  assert.ok(strict !== undefined && isAllGroups(strict.defaultGroups));
});

test("missing / malformed fields fall back, never throw", () => {
  const s = decodeHouseholdSnapshot({});
  assert.equal(s.chosen, false);
  assert.equal(s.level, "open");
  assert.equal(s.lend, false);
  assert.deepEqual(s.protectedGroups, []);
  assert.equal(s.priorLevel, null);
  assert.deepEqual(s.catalog, { levels: [], groups: [] });
  // total garbage
  assert.equal(decodeHouseholdSnapshot(undefined).level, "open");
  assert.equal(decodeHouseholdSnapshot("nope").level, "open");
});

test("groupsForLevel expands '*' to every catalog group, explicit lists pass through", () => {
  const s = decodeHouseholdSnapshot({ catalog: CATALOG });
  assert.deepEqual(groupsForLevel(s.catalog, "strict"), [
    "admin",
    "sources",
    "playback"
  ]);
  assert.deepEqual(groupsForLevel(s.catalog, "standard"), ["admin", "sources"]);
  assert.deepEqual(groupsForLevel(s.catalog, "open"), []);
  assert.deepEqual(groupsForLevel(s.catalog, "does-not-exist"), []);
});

test("resolveGroups expands the wildcard, leaves explicit ids alone", () => {
  const s = decodeHouseholdSnapshot({ catalog: CATALOG });
  assert.deepEqual(resolveGroups(s.catalog, ["*"]), [
    "admin",
    "sources",
    "playback"
  ]);
  assert.deepEqual(resolveGroups(s.catalog, ["admin"]), ["admin"]);
});

test("isGroupProtected: membership after resolving the wildcard", () => {
  const strict = decodeHouseholdSnapshot({
    chosen: true,
    level: "strict",
    protected_groups: "*",
    catalog: CATALOG
  });
  assert.equal(isGroupProtected(strict, "admin"), true);
  assert.equal(isGroupProtected(strict, "playback"), true);
  const standard = decodeHouseholdSnapshot({
    chosen: true,
    level: "standard",
    protected_groups: ["admin", "sources"],
    catalog: CATALOG
  });
  assert.equal(isGroupProtected(standard, "admin"), true);
  assert.equal(isGroupProtected(standard, "playback"), false);
  const openSnap = decodeHouseholdSnapshot({
    chosen: true,
    level: "open",
    protected_groups: [],
    catalog: CATALOG
  });
  assert.equal(isGroupProtected(openSnap, "admin"), false);
});

test("empty marks follow the level defaults — Play only set body", () => {
  // household_protection_set from the usage modal omits protected_groups.
  // Framework stores [] and reads it as "this level's defaults".
  const playOnly = decodeHouseholdSnapshot({
    chosen: true,
    level: "strict",
    lend: false,
    protected_groups: [],
    catalog: CATALOG
  });
  assert.deepEqual(protectedGroupIds(playOnly), ["admin", "sources", "playback"]);
  assert.equal(isGroupProtected(playOnly, "admin"), true);
  assert.equal(surfaceEntryLocked(playOnly, "admin", false), true);
  assert.equal(surfaceEntryLocked(playOnly, "admin", true), false);

  const unchosen = decodeHouseholdSnapshot({
    chosen: false,
    level: "strict",
    protected_groups: [],
    catalog: CATALOG
  });
  assert.deepEqual(protectedGroupIds(unchosen), []);
  assert.equal(surfaceEntryLocked(unchosen, "admin", false), false);

  const lentOpen = decodeHouseholdSnapshot({
    chosen: true,
    level: "open",
    lend: true,
    protected_groups: [],
    catalog: CATALOG
  });
  assert.deepEqual(protectedGroupIds(lentOpen), ["admin"]);
});

test("surfaceEntryLocked: open and override sit open; protected group locks", () => {
  const openSnap = decodeHouseholdSnapshot({
    chosen: true,
    level: "open",
    protected_groups: [],
    catalog: CATALOG
  });
  const strict = decodeHouseholdSnapshot({
    chosen: true,
    level: "strict",
    protected_groups: "*",
    catalog: CATALOG
  });
  assert.equal(surfaceEntryLocked(null, "admin", false), false);
  assert.equal(surfaceEntryLocked(openSnap, "admin", false), false);
  assert.equal(surfaceEntryLocked(strict, "admin", false), true);
  assert.equal(surfaceEntryLocked(strict, "admin", true), false);
  assert.equal(surfaceEntryLocked(strict, "not-a-group", false), false);
});

test("happening decodes on the type match and is null otherwise", () => {
  const h = decodeHouseholdHappening({
    type: HOUSEHOLD_HAPPENING_TYPE,
    chosen: true,
    level: "low",
    lend: false,
    protected_groups: ["admin"],
    prior_level: "open"
  });
  assert.ok(h !== null);
  assert.equal(h.level, "low");
  assert.deepEqual(h.protectedGroups, ["admin"]);
  assert.equal(decodeHouseholdHappening({ type: "something_else" }), null);
  assert.equal(decodeHouseholdHappening({}), null);
  assert.equal(decodeHouseholdHappening(undefined), null);
});

test("applyHappening replaces core fields but reuses the catalog", () => {
  const base = decodeHouseholdSnapshot({
    chosen: false,
    level: "open",
    lend: false,
    catalog: CATALOG
  });
  const h = decodeHouseholdHappening({
    type: HOUSEHOLD_HAPPENING_TYPE,
    chosen: true,
    level: "standard",
    lend: true,
    protected_groups: ["admin", "sources"],
    prior_level: "open"
  });
  assert.ok(h !== null);
  const next = applyHappening(base, h);
  assert.equal(next.chosen, true);
  assert.equal(next.level, "standard");
  assert.equal(next.lend, true);
  assert.deepEqual(next.protectedGroups, ["admin", "sources"]);
  assert.equal(next.priorLevel, "open");
  // catalog is the same reference the get delivered
  assert.equal(next.catalog, base.catalog);
});

test("set body always carries lend; omits level and groups when unset", () => {
  assert.deepEqual(buildSetBody({ lend: false }), { lend: false });
  assert.deepEqual(buildSetBody({ level: "strict", lend: true }), {
    level: "strict",
    lend: true
  });
  assert.deepEqual(
    buildSetBody({ level: "standard", lend: false, protectedGroups: ["admin"] }),
    { level: "standard", lend: false, protected_groups: ["admin"] }
  );
});

test("operator 'none' maps to the wire level 'open'", () => {
  assert.deepEqual(buildSetBody({ level: "none", lend: false }), {
    level: "open",
    lend: false
  });
});

test("unlock omits level so Framework restores prior_level", () => {
  // lend:false with no level is the unlock; Framework restores prior_level.
  assert.deepEqual(buildSetBody({ lend: false }), { lend: false });
});

const UNCHOSEN = () =>
  decodeHouseholdSnapshot({
    chosen: false,
    level: "open",
    lend: false,
    protected_groups: [],
    prior_level: null,
    catalog: CATALOG
  });

test("firstPaintStep: browser, no bearer, unchosen -> pair (not usage)", () => {
  assert.equal(
    firstPaintStep({ ready: true, snapshot: UNCHOSEN(), hasBearer: false, isGlass: false }),
    "pair"
  );
});

test("firstPaintStep: browser, valid stored bearer, unchosen -> usage (pair done)", () => {
  assert.equal(
    firstPaintStep({ ready: true, snapshot: UNCHOSEN(), hasBearer: true, isGlass: false }),
    "usage"
  );
});

test("firstPaintStep: glass, unchosen -> usage, never pair (kiosk already minted)", () => {
  // Glass skips pair even when no browser bearer is stored.
  assert.equal(
    firstPaintStep({ ready: true, snapshot: UNCHOSEN(), hasBearer: false, isGlass: true }),
    "usage"
  );
});

test("firstPaintStep: chosen -> neither step, browser or glass", () => {
  const chosen = decodeHouseholdSnapshot({
    chosen: true,
    level: "open",
    lend: false,
    catalog: CATALOG
  });
  assert.equal(
    firstPaintStep({ ready: true, snapshot: chosen, hasBearer: false, isGlass: false }),
    "none"
  );
  assert.equal(
    firstPaintStep({ ready: true, snapshot: chosen, hasBearer: true, isGlass: true }),
    "none"
  );
});

test("firstPaintStep: in-flight / failed get -> none (no fabricated usage modal)", () => {
  assert.equal(
    firstPaintStep({ ready: true, snapshot: null, hasBearer: false, isGlass: false }),
    "none"
  );
  assert.equal(
    firstPaintStep({ ready: false, snapshot: null, hasBearer: true, isGlass: true }),
    "none"
  );
  assert.equal(
    firstPaintStep({ ready: false, snapshot: UNCHOSEN(), hasBearer: false, isGlass: false }),
    "none"
  );
});
