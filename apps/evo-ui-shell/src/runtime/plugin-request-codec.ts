// Codec + dispatch helper for the framework's `request` wire op -
// the canonical routing verb for plugin Respondent request types.
//
// ROOT CAUSE this module addresses
// --------------------------------
// Plugin Respondent request types use dotted `shelf.verb` names
// (`options.set_mixer_type`, `delivery.list_cards`, ...). They are
// NOT flat top-level wire ops: the framework's wire-op-id parser
// rejects dotted ids with `unknown_op: invalid wire op id:
// InvalidShape(...)`. Dispatching them directly is the bug this
// codec retires.
//
// They route through the framework's flat `request` op. Wire
// shape verified against the framework reference implementation:
//
//   request frame  (evo-projection-ws IncomingFrame::Request -
//     all op params nest under `payload`):
//     { op: "request",
//       payload: { shelf, request_type, payload_b64 } }
//
//   success response (server.rs ClientResponse::Success, untagged
//     serde; envelope.rs ResponseOutcome::Ok { value }):
//     outcome.value = { payload_b64: <base64 of inner JSON> }
//
//   plugin / framework error: ResponseOutcome::Err { code, message }
//     - surfaced by WsTransport as result.error.
//
// This is the ONE canonical path for plugin requests; callers must
// not hand-roll the `request` op or dispatch dotted ids.

import type { WireOpResult } from "../sdk/types";

/** Outer frame body for the `request` op. Nests under the WS
 *  frame's `payload` field. A `step_up_token`, when an elevation
 *  retry needs one, is injected into this body by the transport's
 *  canonical step-up path (dispatchWithStepUp) - NOT here - so token
 *  handling lives in exactly one place. */
export interface PluginRequestBody {
  shelf: string;
  request_type: string;
  payload_b64: string;
  step_up_token?: string;
}

/** Encode an inner plugin-request payload into the `request` op
 *  body. The inner payload is JSON-serialised then base64-encoded
 *  (UTF-8 safe). */
export function encodePluginRequest(
  shelf: string,
  requestType: string,
  payload: unknown
): PluginRequestBody {
  const json = JSON.stringify(payload ?? {});
  return {
    shelf,
    request_type: requestType,
    payload_b64: base64Encode(json)
  };
}

/** Outcome of decoding a `request` op success value. Explicit
 *  failure variant - never a silent fallback. */
export type PluginResponseDecode =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** Decode the `request` op success value `{ payload_b64 }` into the
 *  inner plugin response JSON.
 *
 *  Explicit failure semantics (no silent fallback): a non-object
 *  envelope, a missing/non-string `payload_b64`, malformed base64,
 *  or non-JSON content each return `{ ok: false, message }`. The
 *  caller surfaces the message as an operator-facing error rather
 *  than degrading to a default value. */
export function decodePluginResponse(value: unknown): PluginResponseDecode {
  // Arrays are typeof "object" but are not a valid envelope; reject
  // them with the same explicit failure as primitives / null.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      message: "Plugin response envelope was not an object."
    };
  }
  const pb = (value as Record<string, unknown>)["payload_b64"];
  if (typeof pb !== "string") {
    return {
      ok: false,
      message: "Plugin response envelope missing the payload_b64 field."
    };
  }
  let json: string;
  try {
    json = base64Decode(pb);
  } catch {
    return {
      ok: false,
      message: "Plugin response payload was not valid base64."
    };
  }
  try {
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return {
      ok: false,
      message: "Plugin response payload was not valid JSON."
    };
  }
}

/** Per-call options forwarded to the transport. `signal` lets the
 *  caller impose a hard deadline on a request - the transport
 *  resolves the parked promise with an `aborted` error when it
 *  fires, so a seed read can never hang the critical path. */
export interface PluginRequestOpts {
  signal?: AbortSignal;
}

/** Minimal transport surface the plugin-request helper needs.
 *  WsTransport satisfies it; tests inject a fake. */
export interface RequestDispatcher {
  dispatch(
    op: string,
    payload: Record<string, unknown>,
    opts?: PluginRequestOpts
  ): Promise<WireOpResult>;
}

/** Dispatch a plugin Respondent request through the canonical
 *  `request` op and return a `WireOpResult` whose `value` is the
 *  decoded inner plugin response - so callers see plugin requests
 *  exactly as they see flat-op dispatches.
 *
 *  Failure routing (explicit, no fallback):
 *  - framework / plugin error -> passed through as `result.error`,
 *  - response-decode failure  -> `result.error` with code
 *    `plugin_response_decode` and the decoder's diagnostic. */
export async function pluginRequest(
  transport: RequestDispatcher,
  shelf: string,
  requestType: string,
  payload: unknown,
  opts?: PluginRequestOpts
): Promise<WireOpResult> {
  const body = encodePluginRequest(shelf, requestType, payload);
  const result = await transport.dispatch(
    "request",
    body as unknown as Record<string, unknown>,
    opts
  );
  if (result.error !== undefined) {
    return result;
  }
  const decoded = decodePluginResponse(result.value);
  if (!decoded.ok) {
    return {
      error: { code: "plugin_response_decode", message: decoded.message }
    };
  }
  return { value: decoded.value };
}

// --- UTF-8-safe base64 ------------------------------------------
// btoa/atob are latin1-only; round-trip through a byte string so
// non-ASCII content in a payload survives. btoa/atob are globals in
// the browser and in Node 18+ (the test runtime).

function base64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
