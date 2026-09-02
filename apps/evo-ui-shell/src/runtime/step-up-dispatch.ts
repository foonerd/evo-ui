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
}

const TOKEN_KEY = "step_up_token";

// The flat wire op that carries a plugin shelf verb (shelf +
// request_type + payload_b64). Its authority is decided ENTIRELY by
// the caller's bearer capabilities: the framework gates the shelf
// verb on `granted_capabilities` / `step_up_scopes`, both flattened
// from the bearer at admission. It never reads a
// `step_up_token` from the request body, and nothing mutates the
// connection's step-up scopes after admission. So an inline operator-
// password step-up CANNOT satisfy a shelf-verb refusal - the only
// remedy is a bearer that already carries the scope (obtained by
// pairing). Raising the password card here was a dead-end loop:
// operator types the password, the token rides the body, the gate
// ignores it, the retry refuses again. We therefore never elevate the
// `request` op; the refusal passes through for the surface to render
// as a "pair this device" prompt.
const PLUGIN_REQUEST_OP = "request";

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
  const first = await send(op, payload, opts);
  if (
    first.error === undefined ||
    !isElevationRequired(first.error) ||
    op === PLUGIN_REQUEST_OP ||
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
