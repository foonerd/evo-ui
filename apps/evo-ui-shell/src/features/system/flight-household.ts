// The power cluster's Flight confirm and the household policy. Pure: no
// preact, no socket.
//
// Flight belongs to the network group of the household catalogue - the
// same id the Settings Network entry gate keys on. When the household
// protects that group and this sitting has no cached override, the
// confirm asks the one existing card before it sends the Flight set, so
// the set carries the sitting instead of being refused by the household
// gate.

import { surfaceEntryLocked } from "../household/household-protection.ts";
import type { HouseholdSnapshot } from "../household/household-protection.ts";

/** The household group Flight belongs to. */
export const FLIGHT_HOUSEHOLD_GROUP = "network";

/** True when the Flight confirm must ask the card first: the household
 *  protects the network group and no sitting is cached. No snapshot (in
 *  flight, failed, designer) asks nothing - the same rule as the entry
 *  gate. */
export function flightNeedsSitting(
  snapshot: HouseholdSnapshot | null,
  sittingCached: boolean
): boolean {
  return surfaceEntryLocked(snapshot, FLIGHT_HOUSEHOLD_GROUP, sittingCached);
}
