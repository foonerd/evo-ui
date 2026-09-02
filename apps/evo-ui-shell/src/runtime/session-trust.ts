// session-trust - one-shot callers for the framework's session-trust
// core ops: pair_begin / pair_complete /
// set_kiosk_password / step_up_auth_verify.
//
// Kiosk-mint / pair-once / step-up model: a device pairs ONCE to
// gain an operator bearer; privileged verbs re-verify the operator
// password per action. Headless devices bootstrap their first pair
// from a preseed value on the boot partition.
//
// Contract facts, verified against the live framework transport:
//   - Ops ride the standard frame envelope {frame_type:"request",
//     request_id, op, payload} on the same-origin /api/v1/ws proxy.
//     A raw ClientRequest without the envelope is refused with
//     frame_parse - WsTransport.dispatch already wraps correctly.
//   - pair_begin returns {pair_began, pair_id, expires_at_ms}. The
//     8-digit code is NEVER in this response - it renders on the
//     player's own screen. The browser only sends it back via
//     pair_complete.
//   - Headless bootstrap: pair_complete {pair_id:"bootstrap", code:
//     <preseed>} - the value the operator wrote to the boot
//     partition (single-use; wrong value consumes the slot).
//   - Bearer storage: localStorage + the evo.bearer.<token>
//     subprotocol is the sole supported auth path. The cookie-
//     on-upgrade path is explicitly NOT used.
//
// Each call opens its own short-lived transport: pairing happens
// before any long-lived app transport exists, and step-up rides the
// operator's paired bearer, which may be newer than the transports
// already mounted.

import { WsTransport } from "./ws-transport.ts";

/** Same resolution as use-shelf-subject's frameworkUrl (kept local
 *  so this module - and its contract tests - never pull the hook
 *  chain): explicit override > same-origin /api/v1/ws proxy, the
 *  supported transport for session-trust ops. */
function frameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

export type TrustOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: string; message: string };

/** subclass > code: subclasses are the operator-copy keys
 *  (pair_wrong_code, step_up_rate_limited, ...); code is the
 *  transport-level fallback (connection_closed, frame_parse). */
function refusalKey(error: { code: string; subclass?: string }): string {
  return error.subclass !== undefined && error.subclass.length > 0
    ? error.subclass
    : error.code;
}

async function trustOp(
  op: string,
  payload: Record<string, unknown>,
  bearerToken?: string
): Promise<TrustOpResult<unknown>> {
  const transport = new WsTransport({ url: frameworkUrl(), bearerToken });
  try {
    await transport.connect();
    const result = await transport.dispatch(op, payload);
    if (result.error !== undefined) {
      const err = result.error as { code: string; message: string; subclass?: string };
      return { ok: false, refusal: refusalKey(err), message: err.message };
    }
    return { ok: true, value: result.value };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, refusal: "unreachable", message: detail };
  } finally {
    void transport.close();
  }
}

export interface PairBegun {
  pairId: string;
  expiresAtMs: number;
}

export interface PairedSession {
  token: string;
  expiresAtMs: number | null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Decode the pair_begin success value. Verbatim live shape
 *  (rig 2026-07-19): {expires_at_ms, pair_began, pair_id} - and the
 *  code is ABSENT by contract. */
export function decodePairBegan(raw: unknown): PairBegun | null {
  const rec = asRecord(raw);
  if (
    rec === null ||
    typeof rec["pair_id"] !== "string" ||
    typeof rec["expires_at_ms"] !== "number"
  ) {
    return null;
  }
  return { pairId: rec["pair_id"], expiresAtMs: rec["expires_at_ms"] };
}

/** Start the code ceremony. The code appears on the PLAYER's screen. */
export async function pairBegin(deviceHint: string): Promise<TrustOpResult<PairBegun>> {
  const r = await trustOp("pair_begin", { device_hint: deviceHint });
  if (!r.ok) return r;
  const value = decodePairBegan(r.value);
  if (value === null) {
    return { ok: false, refusal: "unrecognised", message: "pair_begin response" };
  }
  return { ok: true, value };
}

/** Complete a pair - code ceremony (real pair_id) or headless
 *  bootstrap (pair_id "bootstrap" + preseed value as the code). */
/** Decode the pair_complete success value - token required, expiry
 *  tolerated absent. */
export function decodePairedSession(raw: unknown): PairedSession | null {
  const rec = asRecord(raw);
  const token = rec?.["token"];
  if (typeof token !== "string" || token.length === 0) return null;
  const expires = rec?.["expires_at_ms"];
  return { token, expiresAtMs: typeof expires === "number" ? expires : null };
}

/** Pair THIS browser by authenticating with the player's system
 *  password (ruled 2026-07-20: the installation user's OS password
 *  IS the trust ceremony). Same verifier + limiter as step-up; on
 *  success the framework issues a paired-device bearer. */
export async function pairAuthenticate(
  deviceHint: string,
  password: string
): Promise<TrustOpResult<PairedSession>> {
  const r = await trustOp("pair_authenticate", {
    device_hint: deviceHint,
    secret_b64: b64Utf8(password),
    nonce: makeNonce()
  });
  if (!r.ok) return r;
  const value = decodePairedSession(r.value);
  if (value === null) {
    return { ok: false, refusal: "unrecognised", message: "pair_authenticate response" };
  }
  return { ok: true, value };
}

export async function pairComplete(
  pairId: string,
  code: string
): Promise<TrustOpResult<PairedSession>> {
  const r = await trustOp("pair_complete", { pair_id: pairId, code });
  if (!r.ok) return r;
  const value = decodePairedSession(r.value);
  if (value === null) {
    return { ok: false, refusal: "unrecognised", message: "pair_complete response" };
  }
  return { ok: true, value };
}

/** Set / rotate the player password. Admitted for a paired-device
 *  bearer carrying plugins_admin (headless first-run path). */
export async function setKioskPassword(
  newPassword: string,
  bearerToken: string
): Promise<TrustOpResult<void>> {
  const r = await trustOp("set_kiosk_password", { new_password: newPassword }, bearerToken);
  if (!r.ok) return r;
  return { ok: true, value: undefined };
}

/** Verify the operator password for a step-up gate. Returns the
 *  short-lived step-up token - hold it in MEMORY only.
 *
 *  USERNAME CONTRACT (ruled 2026-07-19): the operator credential IS
 *  the OS runtime user's password, and only the framework knows that
 *  account's name (it differs per distribution). The UI therefore
 *  sends NO username; the
 *  framework resolves its own runtime user (username became
 *  Option + serde(default) per correction 3).
 *
 *  TRANSITION SHIM, delete after the 2026-08-02 walk: substrates
 *  from before correction 3 refuse an absent username with
 *  invalid_payload. On exactly that refusal, retry once with the
 *  legacy "operator" alias so the card degrades to a rendered
 *  refusal instead of a payload error on not-yet-updated players. */
export async function stepUpVerify(
  password: string,
  bearerToken: string | undefined
): Promise<TrustOpResult<string>> {
  const payload = {
    secret_b64: b64Utf8(password),
    nonce: makeNonce()
  };
  let r = await trustOp("step_up_auth_verify", payload, bearerToken);
  if (!r.ok && r.refusal === "invalid_payload") {
    r = await trustOp(
      "step_up_auth_verify",
      { username: "operator", ...payload, nonce: makeNonce() },
      bearerToken
    );
  }
  if (!r.ok) return r;
  const rec = asRecord(r.value);
  const token = rec?.["token"];
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, refusal: "unrecognised", message: "step_up_auth_verify response" };
  }
  return { ok: true, value: token };
}

/** Fresh 16-byte random nonce, base64url unpadded (30s replay
 *  window framework-side; never reuse - generate per attempt). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return b64UrlUnpadded(bytes);
}

/** UTF-8-safe base64 of a string (btoa alone corrupts non-ASCII). */
function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64UrlUnpadded(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Persist the paired bearer for every future transport handshake. */
export function storeBearer(token: string): void {
  window.localStorage.setItem("evoBearer", token);
}

/** Parse retry-after minutes out of a rate-limit refusal message
 *  ("... retry after 899560ms"). null when the message has no
 *  parsable figure - render the no-figure copy then. */
export function retryAfterMinutes(message: string): number | null {
  const m = /(\d+)\s*ms/.exec(message);
  if (m === null) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 60_000));
}
