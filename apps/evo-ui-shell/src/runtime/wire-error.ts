// Lift the structured refusal `subclass` out of a framework error object,
// wherever the framework placed it.
//
// The canonical ApiError serialises the discriminator UNDER `details`
// ({ class, message, details: { subclass } }). But the direct server ops -
// household_protection_set among them - flatten it straight onto the error as
// `subclass`, which is why the framework's OWN reader (evo
// household_policy_gate_e2e's `subclass_of`) accepts it at BOTH
// `/error/details/subclass` AND `/error/subclass`. When a UI decode boundary
// read only `details.subclass` it dropped the direct-op `step_up_required`,
// isElevationRequired went false, and the operator-password card never opened -
// the glass painted a bare "permission denied" (403) instead.
//
// So every decode boundary (WS ok+value.error, WS not-ok outcome, HTTP error
// body) lifts the subclass through THIS one reader, mirroring the framework's
// tolerance. Pure - no transport / preact import - so the contract harness
// exercises it directly.
export function liftErrorSubclass(
  err: Record<string, unknown> | undefined
): string | undefined {
  if (err === undefined) return undefined;
  // Prefer the canonical `details.subclass`...
  const details = err["details"];
  if (
    typeof details === "object" &&
    details !== null &&
    !Array.isArray(details)
  ) {
    const nested = (details as Record<string, unknown>)["subclass"];
    if (typeof nested === "string" && nested.length > 0) return nested;
  }
  // ...then the flattened `subclass` the direct ops emit.
  const flat = err["subclass"];
  if (typeof flat === "string" && flat.length > 0) return flat;
  return undefined;
}
