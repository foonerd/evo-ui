// Single source of truth for "this refusal means the operator must
// step up." The framework refuses a scope/step-up-gated verb at the
// dispatch boundary with wire code `permission_denied` (evidence:
// evo-runtime-http ws_endpoint.rs maps DispatchError::Forbidden ->
// "permission_denied"; the ResponseOutcome::Err carries only
// { code, message } - no subclass). Some trust-path refusals instead
// carry subclass `step_up_required`. Either one means: raise the
// operator-password card and retry.
//
// In this appliance the operator password IS the OS user's password
// and is the top authority - every capability scope (network_admin,
// system.admin, plugins_admin, ...) is grantable by a successful
// step-up. So a `permission_denied` is always "authenticate to
// proceed", never a dead end. That is why one predicate, not a
// per-scope table, is correct here.

import type { WireOpError } from "../sdk/types";

export function isElevationRequired(error: WireOpError | undefined): boolean {
  if (error === undefined) return false;
  return (
    error.code === "permission_denied" ||
    error.subclass === "step_up_required"
  );
}
