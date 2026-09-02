// Pure decoders for multi-room wire-op responses.
//
// Extracted from useMultiroomState.ts so each decoder can be unit-tested
// independently of the Preact runtime + WsTransport. Each decoder takes
// the raw `result.value` shape that the WS transport produces and
// returns a discriminated UI-side type. Decoders are responsible for:
//
//   - rejecting malformed envelopes with a structured failure result,
//     rather than silently classifying them as a degenerate happy-path,
//   - tolerating forward-compatible field additions (extra keys are
//     ignored, never refused),
//   - extracting only fields with the expected types (numbers must be
//     finite, strings must be strings, booleans must be booleans).
//
// Helpers `isObject` / `stringField` / `numberField` / `boolField` are
// duplicated locally so this module has no dependency on the hook file
// itself. This keeps the test surface narrow and the module graph flat.
// The i18n runtime is preact-free by design, so t() is safe here.

import { t } from "../../runtime/i18n.ts";

/** Operator-declared per-device multi-room role from the RoleStore. Mirrors
 *  the type declared in `useMultiroomState.ts`; re-declared here so the
 *  decoder module has no dependency on the hook file. */
export type DeviceRole = "source" | "receiver" | "auto";

/** Outcome of a reconnect-storm dispatch. `winningCarrier` is null on
 *  exhaustion, set to the named carrier on success. `elapsedMs`
 *  measures the wall-clock spent storming. Mirrors the type in
 *  useMultiroomState.ts. */
export interface ReconnectOutcome {
  reconnected: boolean;
  winningCarrier: string | null;
  elapsedMs: number;
}

/** Outcome wrapper for the long-running `reconnect_peer` dispatch.
 *  `ok: true` carries the storm outcome; `ok: false` is a
 *  dispatch-level or decode-level error. */
export type ReconnectResult =
  | { ok: true; outcome: ReconnectOutcome }
  | { ok: false; message: string };

/** Decode the framework's `reconnect_peer` response envelope into a
 *  `ReconnectResult` discriminated union.
 *
 *  The wire shape carries the storm outcome under
 *  `value.reconnect_outcome`. The `reconnected` discriminant is taken
 *  from an explicit `reconnected: boolean` field if the framework
 *  provides one; otherwise it falls back to `winning_carrier !== null`
 *  for backwards compatibility with the original wire shape.
 *
 *  Shapes handled:
 *
 *    Happy path - explicit success:
 *      { reconnect_outcome: { reconnected: true, winning_carrier: "wifi", elapsed_ms: 1234 } }
 *        -> { ok: true, outcome: { reconnected: true, ... } }
 *
 *    Happy path - no explicit flag, success inferred from carrier:
 *      { reconnect_outcome: { winning_carrier: "wifi", elapsed_ms: 1234 } }
 *        -> { ok: true, outcome: { reconnected: true, ... } }
 *
 *    Exhaustion (every carrier tried, none won):
 *      { reconnect_outcome: { reconnected: false, winning_carrier: null, elapsed_ms: 30000 } }
 *      { reconnect_outcome: { winning_carrier: null, elapsed_ms: 30000 } }
 *        -> { ok: true, outcome: { reconnected: false, winningCarrier: null, ... } }
 *
 *    Malformed envelope - response is not an object, or missing the
 *    `reconnect_outcome` field entirely:
 *        -> { ok: false, message: "..." }
 *
 *  Previously, a missing envelope was silently treated as
 *  "exhausted" via the `winning_carrier !== null` heuristic. The
 *  decoder now distinguishes "framework said no carrier won" from
 *  "framework's response was unparsable" so the operator banner
 *  ("Could not reach X" vs "Reconnect to X failed") tells the
 *  truth. */
export function decodeReconnectOutcome(rawValue: unknown): ReconnectResult {
  if (!isObject(rawValue)) {
    return {
      ok: false,
      message: t("multiroom.err.reconnectNotObject")
    };
  }
  const oc = rawValue["reconnect_outcome"];
  if (!isObject(oc)) {
    return {
      ok: false,
      message: t("multiroom.err.reconnectMissingOutcome")
    };
  }
  const winningCarrier = stringField(oc, "winning_carrier");
  const elapsedMs = numberField(oc, "elapsed_ms") ?? 0;
  const explicitFlag = boolField(oc, "reconnected");
  const reconnected = explicitFlag !== null ? explicitFlag : winningCarrier !== null;
  return { ok: true, outcome: { reconnected, winningCarrier, elapsedMs } };
}

/** The five-state LAN presence projection carried per
 *  `list_discovered_peers` entry (joined at read time from the
 *  chain-scope presence correlator's snapshot). snake_case wire
 *  strings, matching what `peer_presence_changed` emits. */
export type PresenceState =
  | "live"
  | "quiet"
  | "stalled"
  | "absent"
  | "discarded";

const PRESENCE_STATES: ReadonlySet<string> = new Set<string>([
  "live",
  "quiet",
  "stalled",
  "absent",
  "discarded"
]);

/** Decoded presence facts for one discovered peer. `presenceState`
 *  is null when the framework has not classified the peer yet (the
 *  UI renders that as "unknown"). */
export interface PeerPresence {
  presenceState: PresenceState | null;
  lastTransitionAtMs: number | null;
  network: string | null;
}

/** Validate a raw `presence_state` value against the five-state
 *  domain. Returns null for null / missing / any unrecognised
 *  value - the UI renders null as "unknown". */
export function decodePresenceState(raw: unknown): PresenceState | null {
  return typeof raw === "string" && PRESENCE_STATES.has(raw)
    ? (raw as PresenceState)
    : null;
}

/** Decode the three presence fields the framework attaches to each
 *  `list_discovered_peers` entry: `presence_state`,
 *  `last_transition_at_ms`, `network`. All three are Option fields
 *  - absent / null is tolerated and yields nulls. */
export function decodePeerPresence(entry: unknown): PeerPresence {
  if (!isObject(entry)) {
    return { presenceState: null, lastTransitionAtMs: null, network: null };
  }
  return {
    presenceState: decodePresenceState(entry["presence_state"]),
    lastTransitionAtMs: numberField(entry, "last_transition_at_ms"),
    network: stringField(entry, "network")
  };
}

/** Generic dispatch-result shape produced by `WsTransport.dispatch`.
 *  Mirrored here as a structural type so the classifier below has no
 *  dependency on the transport implementation. */
interface DispatchResult {
  value?: unknown;
  error?: unknown;
}

/** Outcome of classifying a `roster_snap` dispatch result. `ok: true`
 *  carries the parsed snap value; `ok: false` carries an operator-
 *  facing message ready to surface in the SnapStatusBar. */
export type SnapDispatchOutcome<TSnap> =
  | { ok: true; snap: TSnap }
  | { ok: false; message: string };

/** Classify a `roster_snap` dispatch result into either a parsed snap
 *  or an operator-facing error message.
 *
 *  The classifier is parametric over the snap-decoder function so this
 *  module stays free of the per-snap decoding helpers + the wider hook
 *  surface; tests can inject any compatible decode function. The hook
 *  in `useMultiroomState.ts` wires the real `decodeRosterSnap`.
 *
 *  Failure categories are distinguished here so that all snap
 *  failures surface a structured operator message rather than a
 *  silent `null`:
 *
 *  - Dispatch-level error (`result.error` present): the framework
 *    refused, the transport timed out, or capability gating fired.
 *    `humaniseSnapError` extracts the operator-readable message.
 *  - Decode-level failure (`decodeFn(value)` returns null): the
 *    framework accepted the dispatch but the response shape did not
 *    match the documented envelope. Surface a structured message so
 *    the operator knows the snap was attempted but is unusable. */
export function classifyRosterSnapResult<TSnap>(
  result: DispatchResult,
  decodeFn: (value: unknown) => TSnap | null
): SnapDispatchOutcome<TSnap> {
  if (result.error !== undefined) {
    return { ok: false, message: humaniseSnapError(result.error) };
  }
  const snap = decodeFn(result.value);
  if (snap === null) {
    return {
      ok: false,
      message:
        t("multiroom.err.snapUnparsable")
    };
  }
  return { ok: true, snap };
}

/** Convert an arbitrary error envelope from the WS transport into a
 *  single-line operator message. Handles strings (passed through),
 *  structured `{ message }` envelopes, and `{ subclass }` envelopes
 *  that fall out of the framework's typed-error contract. Anything
 *  else falls back to a generic message; the diagnosis path is the
 *  console log on the transport side rather than the operator banner. */
export function humaniseSnapError(err: unknown): string {
  if (typeof err === "string" && err.length > 0) return err;
  if (isObject(err)) {
    const message = stringField(err, "message");
    if (message !== null && message.length > 0) return message;
    const subclass = stringField(err, "subclass");
    if (subclass !== null && subclass.length > 0) {
      return t("multiroom.err.snapRefused", { subclass });
    }
  }
  return t("multiroom.err.snapUnknown");
}

// Structural duplicate of the MoveMemberResult tagged union from
// useMultiroomState.ts. Duplicated here so the move-self transition
// function below is testable without importing the hook file. Keep
// the two definitions in sync; the duplication is intentional and
// narrow (three variants, two with one field).
export type MoveMemberResultShape =
  | { kind: "moved" }
  | {
      kind: "successor_required";
      departingDeviceId: string;
      eligibleDeviceIds: ReadonlyArray<string>;
    }
  | { kind: "failed"; message: string };

/** UI state transition for the move-self path after a `move_member`
 *  dispatch. Three outcomes:
 *
 *  - `completed`: the framework moved the device; close the picker.
 *  - `successorRequired`: the framework refused to auto-elect a new
 *    leader for the source group; the operator must pick one before
 *    the move can land. Operator sees an inline SuccessorPicker
 *    pre-bound to the destination group; selection re-dispatches with
 *    `successor_device_id` set. This is the audit-flagged path that
 *    previously fell into a no-progress state.
 *  - `showError`: dispatch-level failure; surface the message.
 *
 *  The transition function is parametric over the source-group id +
 *  destination context so the caller can preserve the move target
 *  across the successor-picker round-trip. Pure / no I/O - testable
 *  in `tests/contracts/`. */
export type MoveSelfTransition =
  | { kind: "completed" }
  | {
      kind: "successorRequired";
      departingDeviceId: string;
      eligibleDeviceIds: ReadonlyArray<string>;
      toGroupId: string;
      toGroupName: string;
    }
  | { kind: "showError"; message: string };

export function moveSelfTransition(
  result: MoveMemberResultShape,
  toGroupId: string,
  toGroupName: string
): MoveSelfTransition {
  if (result.kind === "moved") {
    return { kind: "completed" };
  }
  if (result.kind === "failed") {
    return { kind: "showError", message: result.message };
  }
  // successor_required - carry the destination context forward so
  // the second dispatch (with successor_device_id) can target it.
  return {
    kind: "successorRequired",
    departingDeviceId: result.departingDeviceId,
    eligibleDeviceIds: result.eligibleDeviceIds,
    toGroupId,
    toGroupName
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolField(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}
