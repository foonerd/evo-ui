// Single source of truth for "this refusal means the operator must step
// up" - i.e. raise the operator-password card and retry the op with a
// step_up_token.
//
// NARROW predicate (fixed 2026): ONLY the explicit `step_up_required`
// subclass raises the card. A bare `permission_denied` is NOT
// step-up-curable - the framework returns it for wrong-password,
// rate-limit (`step_up_rate_limited`), schema-gate misses, a capability
// the bearer will never gain by typing a password, and
// `release_user_interaction_responder` on a LAN-trust socket. Treating
// every `permission_denied` as "raise the card" stacked the step-up card
// on top of Pair (and on PromptSurface's always-mounted release cleanup)
// on every surface - an unbreakable authentication loop. A
// capability/scope refusal is cured by the surface (pair to obtain a
// bearer that carries the scope), never by this card.

import type { WireOpError } from "../sdk/types";

export function isElevationRequired(error: WireOpError | undefined): boolean {
  if (error === undefined) return false;
  return error.subclass === "step_up_required";
}
