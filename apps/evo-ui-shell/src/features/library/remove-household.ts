// Library Remove and the household policy. Pure: no preact, no socket.
//
// Remove belongs to the sources group of the household catalogue - the
// same id the Sources entry gate keys on. When the household protects
// that group and this sitting has no cached override, the surface asks
// the one existing card before it sends Remove, so the handoff to the
// USB writer carries the sitting instead of being refused after the
// queue was already released.

import { surfaceEntryLocked } from "../household/household-protection.ts";
import type { HouseholdSnapshot } from "../household/household-protection.ts";

/** The household group Remove belongs to. */
export const REMOVE_HOUSEHOLD_GROUP = "sources";

/** True when Remove must ask the card first: the household protects the
 *  sources group and no sitting is cached. No snapshot (in flight,
 *  failed, designer) raises nothing - the same rule as the entry gate. */
export function removeNeedsSitting(
  snapshot: HouseholdSnapshot | null,
  sittingCached: boolean
): boolean {
  return surfaceEntryLocked(snapshot, REMOVE_HOUSEHOLD_GROUP, sittingCached);
}

/** The wire subclass a refused library verb carries, or null. */
export function refusalSubclass(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const s = (error as Record<string, unknown>)["subclass"];
    if (typeof s === "string" && s.length > 0) return s;
  }
  return null;
}
