// The ONE classifier for operator-trust refusals.
//
// Surfaces dispatch work. This module decides whether the refusal is
// Pair, the password card, or an honest pass-through. There is no fourth
// predicate and no per-surface regex. Pair and StepUp stay two separate
// ceremonies (pairing mints the operator bearer; step-up verifies the
// operator password). The responder lock is neither, and neither is the
// household policy.
//
//   elevate — subclass === "step_up_required"
//            consumed by dispatchWithStepUp / StepUpHost
//   pair    — the pair ceremony only: pair_expired, pair_unknown,
//            pair_wrong_code
//            consumed by the Pair flow (one host; surfaces must not
//            invent a second guess)
//   pass    — everything else, and it is dispatched on the LAN-trust
//            socket as-is. This INCLUDES:
//              - verb_capability_scope_not_granted: a LAN-trust caller is
//                admitted for these verbs; a scope miss is not a pairing
//                signal and must not open Pair.
//              - household_policy_locked (class permission_denied): the
//                player is locked by the household level. Settings
//                entry is the two-door gate (change household or
//                override); this is NOT Pair and NOT a 403 banner.
//              - bare permission_denied and any responder-lock refusal
//                (granted: [], AlreadyHeld).
//
// A LAN-trust surface therefore never opens Pair pre-flight on session
// state; it dispatches, and only a genuine pair-ceremony subclass on the
// wire opens Pair. household_policy_locked routes to the household modal,
// step_up_required to the password card.

import { isElevationRequired } from "./step-up-elevation.ts";

export type AuthzKind = "elevate" | "pair" | "pass";

export interface AuthzRefusal {
  subclass?: string | null;
  code?: string;
  message?: string;
}

const PAIR_CEREMONY_SUBCLASSES: ReadonlySet<string> = new Set([
  "pair_expired",
  "pair_unknown",
  "pair_wrong_code"
]);

export function classifyAuthz(
  error: AuthzRefusal | undefined
): AuthzKind {
  if (error === undefined) return "pass";
  if (
    isElevationRequired({
      code: error.code ?? "permission_denied",
      message: error.message ?? "",
      subclass: error.subclass ?? undefined
    })
  ) {
    return "elevate";
  }
  if (error.subclass != null && PAIR_CEREMONY_SUBCLASSES.has(error.subclass)) {
    return "pair";
  }
  return "pass";
}

/** Surface helper: show the Pair notice / open Pair. Never true for
 *  step_up_required (that is the password card), household_policy_locked
 *  (that is the household modal), a scope miss, or a lock miss. */
export function isPairRequired(error: AuthzRefusal | undefined): boolean {
  return classifyAuthz(error) === "pair";
}

/** Surface helper: this refusal is the household policy lock. classifyAuthz
 *  returns "pass" for it (not Pair, not step-up). Settings must not paint
 *  it as 403; the entry gate is the lock. */
export function isHouseholdLocked(error: AuthzRefusal | undefined): boolean {
  return error?.subclass === "household_policy_locked";
}
