// The compass map - WHICH reveal sits on WHICH gesture of the
// compact-panel compass, as curated DATA in ui.profile (per target,
// custom fallback), exactly like the menu arrangement. The compass
// stops being a fixed take-it-or-leave-it affordance: each of the
// five slots (four swipe directions + centre tap) carries one action
// from a curated vocabulary, or "off".
//
// Storage is OVERRIDES-ONLY: slots matching the classic default are
// omitted, so untouched devices store nothing and the default stays
// byte-stable. Resolution guarantees Now playing ("track") remains
// reachable - the analogue of the menu's Home presence lock: if the
// stored overrides strip the last track slot, the resolver reinstates
// track on its default slot (up) rather than shipping a compass that
// cannot reach the music.
//
// Pure module: no preact, no DOM - contract-tested directly.

export type CompassSlot = "up" | "left" | "center" | "right" | "down";
/** Reveals (overlays on the pivot home) plus NAVIGATION destinations
 *  (favourites / playlists leave home for their surfaces, like the
 *  Device tiles already do for Alarms and Multi-room), plus off. */
export type CompassAction =
  | "track" | "art" | "bio" | "library" | "device"
  | "favourites" | "playlists"
  | "off";
export type CompassMap = Readonly<Record<CompassSlot, CompassAction>>;
export type CompassOverrides = Partial<Record<CompassSlot, CompassAction>>;

export const COMPASS_SLOTS: readonly CompassSlot[] = [
  "up", "left", "center", "right", "down",
];
export const COMPASS_ACTIONS: readonly CompassAction[] = [
  "track", "art", "bio", "library", "favourites", "playlists", "device", "off",
];

/** Actions that NAVIGATE to a full surface instead of opening a
 *  pivot reveal overlay. */
export const COMPASS_NAV_ACTIONS = ["favourites", "playlists"] as const;
export type CompassNavAction = (typeof COMPASS_NAV_ACTIONS)[number];
export function isCompassNavAction(a: CompassAction): a is CompassNavAction {
  return a === "favourites" || a === "playlists";
}

/** The classic compass - the wiring the pivot has always shipped. */
export const DEFAULT_COMPASS: CompassMap = {
  up: "track",
  left: "art",
  right: "bio",
  down: "library",
  center: "device",
};

export function isCompassSlot(v: unknown): v is CompassSlot {
  return typeof v === "string" && (COMPASS_SLOTS as readonly string[]).includes(v);
}
export function isCompassAction(v: unknown): v is CompassAction {
  return typeof v === "string" && (COMPASS_ACTIONS as readonly string[]).includes(v);
}

/** Tolerant decode of a stored overrides record. Unknown slots and
 *  invalid actions are dropped; entries equal to the default are
 *  normalised away. Returns null when nothing valid remains (the
 *  member should then be omitted entirely). */
export function decodeCompassOverrides(raw: unknown): CompassOverrides | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const out: CompassOverrides = {};
  for (const slot of COMPASS_SLOTS) {
    const v = record[slot];
    if (isCompassAction(v) && v !== DEFAULT_COMPASS[slot]) {
      out[slot] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Normalise a full map back to storable overrides. Undefined when
 *  the map IS the default (store nothing - byte-stable). */
export function compassOverrides(map: CompassMap): CompassOverrides | undefined {
  const out: CompassOverrides = {};
  for (const slot of COMPASS_SLOTS) {
    if (map[slot] !== DEFAULT_COMPASS[slot]) {
      out[slot] = map[slot];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Overrides -> full map, with the Now-playing presence lock: if no
 *  slot resolves to "track", track is reinstated on its default slot
 *  (up). The designer refuses edits that would do this; the resolver
 *  is the backstop for stale or hand-edited data. */
export function resolveCompassMap(
  overrides: CompassOverrides | null | undefined
): CompassMap {
  const map: Record<CompassSlot, CompassAction> = { ...DEFAULT_COMPASS };
  if (overrides) {
    for (const slot of COMPASS_SLOTS) {
      const v = overrides[slot];
      if (isCompassAction(v)) {
        map[slot] = v;
      }
    }
  }
  if (!COMPASS_SLOTS.some((slot) => map[slot] === "track")) {
    map.up = "track";
  }
  return map;
}

/** True when `slot` holds the ONLY "track" in the map - reassigning
 *  it away must be refused (with the reason surfaced), mirroring the
 *  menu's Home lock. */
export function isLastTrackSlot(map: CompassMap, slot: CompassSlot): boolean {
  if (map[slot] !== "track") return false;
  return COMPASS_SLOTS.every((s) => s === slot || map[s] !== "track");
}
