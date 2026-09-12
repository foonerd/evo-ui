// Pure wire shapes + catalog math for household protection.
//
// No preact and no transport here - the hook (useHouseholdProtection) owns
// the IO; this module owns decode, catalog derivation, and the set-body
// builder so all of it is unit-testable without a socket. It mirrors the
// osk-state / kiosk-remote split.
//
// Frozen wire (do not drift):
//   household_protection_get {}            -> snapshot
//   household_protection_set  {set body}   -> snapshot (post-write)
//   happening household_protection_changed -> core fields, NO catalog
//
// Snapshot carries a top-level `household_protection` field that the happening
// does NOT. Because the happening replaces state and cannot refresh that
// field, the UI must never render from it (it would desync on the first
// happening). Everything the UI paints - chosen, level, lend,
// protected_groups, prior_level, catalog - is present on the get, and all but
// catalog ride every happening (catalog is reused from the last get). So we
// decode exactly those and intentionally drop `household_protection`.

export type HouseholdLevel = string; // catalog-driven; 4 known ids below

// The four levels the operator words are written for. The catalog is the
// source of truth for which levels exist and their order; this is only the
// fallback ordering + the key set for operator copy.
export const KNOWN_LEVELS = ["open", "low", "standard", "strict"] as const;
export type KnownLevel = (typeof KNOWN_LEVELS)[number];

export const HOUSEHOLD_HAPPENING_TYPE = "household_protection_changed";
export const HOUSEHOLD_GET_OP = "household_protection_get";
export const HOUSEHOLD_SET_OP = "household_protection_set";

const ALL = "*";

export interface HouseholdCatalogLevel {
  id: string;
  // "*" (every group) is normalized to the single-element list ["*"];
  // expand with resolveGroups / groupsForLevel.
  defaultGroups: readonly string[];
}
export interface HouseholdCatalogGroup {
  id: string;
  scopes: readonly string[];
}
export interface HouseholdCatalog {
  levels: readonly HouseholdCatalogLevel[];
  groups: readonly HouseholdCatalogGroup[];
}

export interface HouseholdSnapshot {
  chosen: boolean;
  level: HouseholdLevel;
  lend: boolean;
  // "*" normalized to ["*"]; expand with resolveGroups(catalog, ...).
  protectedGroups: readonly string[];
  priorLevel: HouseholdLevel | null;
  catalog: HouseholdCatalog;
}

export interface HouseholdHappening {
  chosen: boolean;
  level: HouseholdLevel;
  lend: boolean;
  protectedGroups: readonly string[];
  priorLevel: HouseholdLevel | null;
}

// The wire set body. lend is required; level and protected_groups are
// optional (omit level on unlock to let Framework restore prior_level; omit
// protected_groups to let Framework fill catalog defaults for the level).
export interface HouseholdSetBody {
  level?: HouseholdLevel;
  lend: boolean;
  protected_groups?: string[];
}

export interface HouseholdSetInput {
  // operator "none" is not a wire level; it maps to "open". Omit entirely on
  // unlock to let Framework restore prior_level.
  level?: string;
  lend: boolean;
  // omit to let Framework fill catalog defaults for the level.
  protectedGroups?: readonly string[];
}

// --- primitive coercion (untrusted JSON in) ------------------------------

function asObject(raw: unknown): Record<string, unknown> {
  return raw != null && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
}
function asBool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function asString(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : dflt;
}
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

// A group list is either an explicit list of ids or the wildcard "*". The
// wildcard is normalized to ["*"] whether it arrives as the bare string "*"
// or inside an array; expand it only when a catalog is in hand.
function decodeGroupList(raw: unknown): string[] {
  if (raw === ALL) return [ALL];
  if (Array.isArray(raw)) {
    const ids = asStrings(raw);
    return ids.includes(ALL) ? [ALL] : ids;
  }
  return [];
}

// --- catalog helpers -----------------------------------------------------

export function isAllGroups(list: readonly string[]): boolean {
  return list.length === 1 && list[0] === ALL;
}

// Expand a (possibly "*") group list against the catalog into concrete ids.
export function resolveGroups(
  catalog: HouseholdCatalog,
  list: readonly string[]
): string[] {
  return isAllGroups(list) ? catalog.groups.map((g) => g.id) : [...list];
}

// The concrete group ids a level protects by default, per the catalog
// ("*" -> every catalog group id). Unknown level -> [].
export function groupsForLevel(
  catalog: HouseholdCatalog,
  levelId: string
): string[] {
  const lvl = catalog.levels.find((l) => l.id === levelId);
  return lvl === undefined ? [] : resolveGroups(catalog, lvl.defaultGroups);
}

// Frozen with Framework `protected_scopes` / `HouseholdProtectionPolicy`:
// empty `protected_groups` means "the level's default groups", not
// "nothing marked". Until chosen, the box admits as open. Lend unions
// the `low` floor and never subtracts below it. `*` expands against
// the catalog. The usage modal omits marks on set (level + lend only),
// so Play only arrives as `{ level: "strict", protected_groups: [] }`.
export function protectedGroupIds(snapshot: HouseholdSnapshot): string[] {
  const level = snapshot.chosen ? snapshot.level : "open";
  if (!snapshot.lend && level === "open") return [];
  const keys =
    snapshot.protectedGroups.length === 0
      ? groupsForLevel(snapshot.catalog, level)
      : resolveGroups(snapshot.catalog, snapshot.protectedGroups);
  if (!snapshot.lend) return keys;
  const out = [...keys];
  for (const key of groupsForLevel(snapshot.catalog, "low")) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// Is a capability group currently protected? The ONE membership resolver.
// Settings surfaces key the entry gate off this (plus a live override
// sitting). Expands "*". Empty marks follow the level defaults.
export function isGroupProtected(
  snapshot: HouseholdSnapshot,
  group: string
): boolean {
  return protectedGroupIds(snapshot).includes(group);
}

// Settings entry gate. A protested group does not open as itself.
// Null snapshot: do not fabricate a lock (designer / get in flight).
// A live override sitting (step-up token for this caller) opens the
// surface with no fuss; the household level is unchanged.
export function surfaceEntryLocked(
  snapshot: HouseholdSnapshot | null,
  group: string,
  overrideLive: boolean
): boolean {
  if (snapshot === null || overrideLive) return false;
  return isGroupProtected(snapshot, group);
}

// --- decoders ------------------------------------------------------------

function decodeCatalog(raw: unknown): HouseholdCatalog {
  const o = asObject(raw);
  const levels: HouseholdCatalogLevel[] = Array.isArray(o.levels)
    ? o.levels.map((l) => {
        const lo = asObject(l);
        return {
          id: asString(lo.id),
          defaultGroups: decodeGroupList(lo.default_groups)
        };
      })
    : [];
  const groups: HouseholdCatalogGroup[] = Array.isArray(o.groups)
    ? o.groups.map((g) => {
        const go = asObject(g);
        return { id: asString(go.id), scopes: asStrings(go.scopes) };
      })
    : [];
  return { levels, groups };
}

export function decodeHouseholdSnapshot(raw: unknown): HouseholdSnapshot {
  const o = asObject(raw);
  return {
    chosen: asBool(o.chosen, false),
    level: asString(o.level, "open"),
    lend: asBool(o.lend, false),
    protectedGroups: decodeGroupList(o.protected_groups),
    priorLevel: asStringOrNull(o.prior_level),
    catalog: decodeCatalog(o.catalog)
  };
}

// Returns null for any envelope that is not the household happening, so the
// subscriber can match on a single call (happening.type gate).
export function decodeHouseholdHappening(
  raw: unknown
): HouseholdHappening | null {
  const o = asObject(raw);
  if (o.type !== HOUSEHOLD_HAPPENING_TYPE) return null;
  return {
    chosen: asBool(o.chosen, false),
    level: asString(o.level, "open"),
    lend: asBool(o.lend, false),
    protectedGroups: decodeGroupList(o.protected_groups),
    priorLevel: asStringOrNull(o.prior_level)
  };
}

// Fold a happening onto the current snapshot: it replaces the core fields
// and reuses the catalog (never on the happening).
/** First-paint gate. A failed or in-flight get leaves snapshot null —
 *  the player chrome stays live and this must not fabricate a modal. */
/** Which onboarding step (if any) to force on a fresh start. After a wipe /
 *  first start device onboarding is ONE sequence: step 1 pair, step 2 usage.
 *
 *  - `none`  : nothing forced. chosen === true (already onboarded), an unready
 *              transport, or an in-flight / failed get (snapshot null) - never
 *              a fabricated usage modal.
 *  - `pair`  : chosen === false on a BROWSER with no stored bearer. A private
 *              session cannot mint a bearer from the household modal, so it
 *              pairs first (existing PairDeviceFlow), then lands on usage.
 *  - `usage` : chosen === false and either GLASS (kiosk already minted a local
 *              bearer, so pair is skipped) OR a browser that already holds a
 *              stored bearer (pair already done).
 *
 *  Pure: the host passes the live signals (storedBearer present, kioskMode
 *  glass) so the harness drives every branch without touching window. */
export type FirstPaintStep = "none" | "pair" | "usage";

export function firstPaintStep(input: {
  ready: boolean;
  snapshot: HouseholdSnapshot | null;
  hasBearer: boolean;
  isGlass: boolean;
}): FirstPaintStep {
  const { ready, snapshot, hasBearer, isGlass } = input;
  if (!ready || snapshot === null || snapshot.chosen !== false) return "none";
  // chosen === false -> onboarding. Glass skips pair (local mint); a browser
  // with a bearer already paired; a browser with none must pair first.
  if (isGlass || hasBearer) return "usage";
  return "pair";
}

export function applyHappening(
  prev: HouseholdSnapshot,
  h: HouseholdHappening
): HouseholdSnapshot {
  return {
    catalog: prev.catalog,
    chosen: h.chosen,
    level: h.level,
    lend: h.lend,
    protectedGroups: h.protectedGroups,
    priorLevel: h.priorLevel
  };
}

// --- set body ------------------------------------------------------------

/** Which socket `household_protection_set` must ride.
 *
 *  StepUpHost verifies with `storedBearer()` when one exists, so the
 *  sitting is bound to `bearer:<token-id>`. The shared page socket is
 *  anonymous LAN-trust (`lan-trust-operator`). A widen sent on that
 *  socket cannot spend a kiosk or pair sitting — validate returns
 *  WrongPeer / `step_up_required` and the level never moves. That is
 *  why Play only could be chosen (first-start needs no sitting) and
 *  then could not be left on glass or a paired browser.
 *
 *  Unpaired LAN-trust has no stored bearer; verify and set are both
 *  `lan-trust-operator`, so the shared socket is the right one.
 */
export type HouseholdWriteSocket = "shared" | "stored-bearer";

export function householdWriteSocket(
  hasStoredBearer: boolean
): HouseholdWriteSocket {
  return hasStoredBearer ? "stored-bearer" : "shared";
}

export function buildSetBody(input: HouseholdSetInput): HouseholdSetBody {
  const body: HouseholdSetBody = { lend: input.lend };
  if (input.level !== undefined) {
    body.level = input.level === "none" ? "open" : input.level;
  }
  if (input.protectedGroups !== undefined) {
    body.protected_groups = [...input.protectedGroups];
  }
  return body;
}
