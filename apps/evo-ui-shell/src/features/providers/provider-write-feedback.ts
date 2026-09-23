// provider-write-feedback - what the Providers panel paints after a write.
//
// The hook answers every set with { ok } or { ok: false, message }. A
// refusal (household lock, scope, a write socket that could not open)
// paints the hook's message, verbatim - never a guess at why. A success
// paints nothing of its own: the hook re-lists on ok and the re-listed
// state is the paint, so no copy is invented for it.

import { isHouseholdLocked } from "../../runtime/authz-classify.ts";
import type { ProviderActionResult } from "./useProviders";

export function providerWriteFeedback(r: ProviderActionResult): string | null {
  return r.ok ? null : r.message;
}

/** A household lock opens the one existing door. Scope / socket
 *  refusals paint only. Never Pair. */
export function providerWriteOpensHousehold(r: ProviderActionResult): boolean {
  return !r.ok && isHouseholdLocked({ subclass: r.subclass ?? undefined });
}
