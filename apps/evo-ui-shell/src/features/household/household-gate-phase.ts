// household-gate-phase - in flight, failed, or seeded: the one decision
// the entry gate makes before it looks at the policy.
//
// `ready` only says a transport exists; `snapshot` is null until the
// household get lands; a get that FAILED used to look exactly like one
// still in flight, so every settings group and the Sources page said
// "Loading..." for the rest of the page's life. The hook now records a
// failed seed; this decides what that means for the gate:
//
//   in-flight  - the get has not answered yet: Loading is honest.
//   failed     - the get answered with an error: paint the error and a
//                retry. Never the children (a protested group must not
//                open without policy), never a fabricated snapshot.
//   seeded     - a snapshot exists: the policy decides (surfaceEntryLocked).
//   inert      - no transport (designer / tests): the gate steps aside.

export type HouseholdGatePhase = "inert" | "in-flight" | "failed" | "seeded";

export function householdGatePhase(input: {
  ready: boolean;
  snapshotPresent: boolean;
  seedError: string | null;
}): HouseholdGatePhase {
  if (!input.ready) return "inert";
  if (input.snapshotPresent) return "seeded";
  return input.seedError !== null ? "failed" : "in-flight";
}
