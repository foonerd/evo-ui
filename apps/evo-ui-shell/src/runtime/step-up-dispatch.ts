// The ONE canonical inline-step-up path. Every wire dispatch funnels
// through here (WsTransport.dispatch wraps its raw send with it), so a
// scope/step-up refusal raises the operator-password card and retries -
// on every surface, with no per-surface gate. This retires the old
// model where each feature bolted on (or forgot) its own step-up.
//
// Failure semantics are explicit and deterministic:
//  - not an elevation refusal, or no bridge installed -> pass through.
//  - payload already carried a token -> do NOT loop; return as-is.
//  - a cached token satisfies the retry -> return the retry.
//  - cached token stale -> clear it, prompt once.
//  - operator cancels the card -> return the ORIGINAL refusal (never a
//    fabricated success).
//  - retry still refused -> return the retry's refusal (the real error
//    surfaces; no silent fallback).
//
// The token rides INSIDE the op payload (the frame is deny_unknown_fields;
// see WsTransport.dispatch), which is uniform for the `request` op and
// for direct ops alike.

import type { WireOpResult } from "../sdk/types";
import { isElevationRequired } from "./step-up-elevation.ts";
import { isHouseholdLocked } from "./authz-classify.ts";

/** Raw single-shot send - the transport's own frame send + await. */
export type RawSend = (
  op: string,
  payload: Record<string, unknown>,
  opts?: unknown
) => Promise<WireOpResult>;

/** Bridge to the app-level operator-password card + the in-memory
 *  token cache (one operator session shared across every socket). */
export interface StepUpBridge {
  getToken(): string | null;
  setToken(token: string | null): void;
  /** Show the card; resolve with a verified token, or null on cancel. */
  acquire(op: string): Promise<string | null>;
  /** Notify when the in-memory sitting token appears or is cleared. */
  subscribe?(listener: (token: string | null) => void): () => void;
}

const TOKEN_KEY = "step_up_token";

// The plugin shelf-verb op (`request`: shelf + request_type + payload_b64)
// is elevatable. A step_up_token on the request payload is validated by
// the steward for that dispatch: consumed before IncomingFrame parsing
// (deny_unknown_fields stays intact) and never reaches the plugin. Do
// not put `request` on the skip list.

// Ops that must NEVER raise the operator-password card, even on an
// elevation-shaped refusal:
//  - pair_begin / pair_authenticate / pair_complete: the Pair ceremony's
//    own submit. ClientRequest is deny_unknown_fields and PairAuthenticate
//    has no step_up_token field, so injecting one on retry is a parse
//    reject - Pair would never complete and both cards would stack.
//  - step_up_auth_verify: the card's OWN verify handshake.
//  - negotiate / release_user_interaction_responder / list_user_interactions:
//    the responder lifecycle; a refusal here (e.g. release on a LAN-trust
//    socket lacking user_interaction_responder) is not password-curable and
//    fires on every remount, app-wide.
const NON_ELEVATABLE_OPS = new Set<string>([
  "pair_begin",
  "pair_authenticate",
  "pair_complete",
  "step_up_auth_verify",
  "negotiate",
  "release_user_interaction_responder",
  "list_user_interactions"
]);

// Re-entrancy guard. Acquiring the token runs `step_up_auth_verify`,
// which is itself a dispatch through this same path. While the card is
// up we must NOT recurse into another acquire (that op is bearer-based
// and won't elevation-refuse, but the guard makes it deterministic and
// keeps exactly one card at a time app-wide).
let acquiring = false;

export async function dispatchWithStepUp(
  send: RawSend,
  op: string,
  payload: Record<string, unknown>,
  opts: unknown,
  bridge: StepUpBridge | null
): Promise<WireOpResult> {
  // A live override sitting must ride the first send. The household
  // gate admits a valid step-up token; it does not return
  // step_up_required, so a retry-only attach would still 403.
  const canCarryToken =
    bridge !== null &&
    !NON_ELEVATABLE_OPS.has(op) &&
    !(TOKEN_KEY in payload);
  const cachedUpFront = canCarryToken ? bridge.getToken() : null;
  const firstPayload =
    cachedUpFront !== null
      ? { ...payload, [TOKEN_KEY]: cachedUpFront }
      : payload;
  const first = await send(op, firstPayload, opts);
  if (
    first.error !== undefined &&
    isHouseholdLocked(first.error) &&
    cachedUpFront !== null &&
    bridge !== null
  ) {
    // The cached sitting rode the first send and the household gate
    // still refused: that sitting is spent (expired, revoked, a steward
    // restart). Clear it - and raise the ONE card once, so the operator
    // gets a fresh sitting instead of a dead end with no card and no
    // sitting. Cancel returns this original lock. The re-entrancy guard
    // keeps it to one card app-wide; a card already up means this
    // dispatch surfaces the lock and does not stack a second.
    bridge.setToken(null);
    if (NON_ELEVATABLE_OPS.has(op) || TOKEN_KEY in payload || acquiring) {
      return first;
    }
    acquiring = true;
    let fresh: string | null;
    try {
      fresh = await bridge.acquire(op);
    } finally {
      acquiring = false;
    }
    if (fresh === null) {
      return first; // operator cancelled - surface the original lock
    }
    bridge.setToken(fresh);
    const retried = await send(op, { ...payload, [TOKEN_KEY]: fresh }, opts);
    if (retried.error !== undefined && isHouseholdLocked(retried.error)) {
      // The card was already offered and the gate refused the fresh
      // sitting too. A sitting the household gate would not spend is
      // not a live override: clear it, so no gate opens on it, and
      // surface that lock. One card, no loop.
      bridge.setToken(null);
    }
    return retried;
  }
  if (
    first.error === undefined ||
    !isElevationRequired(first.error) ||
    NON_ELEVATABLE_OPS.has(op) ||
    bridge === null ||
    TOKEN_KEY in payload ||
    acquiring
  ) {
    return first;
  }

  // A cached token from an earlier prompt usually satisfies the retry
  // without re-prompting (one card per operator sitting).
  const cached = bridge.getToken();
  if (cached !== null) {
    const retry = await send(op, { ...payload, [TOKEN_KEY]: cached }, opts);
    if (retry.error === undefined || !isElevationRequired(retry.error)) {
      return retry;
    }
    bridge.setToken(null); // stale - fall through to a fresh prompt
  }

  acquiring = true;
  let token: string | null;
  try {
    token = await bridge.acquire(op);
  } finally {
    acquiring = false;
  }
  if (token === null) {
    return first; // operator cancelled - surface the original refusal
  }
  bridge.setToken(token);
  return await send(op, { ...payload, [TOKEN_KEY]: token }, opts);
}
