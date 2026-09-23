// bearer-handshake - the handshake reads the CURRENT bearer.
//
// A construction-time snapshot is not the handshake. Every socket that
// presents a bearer asks its source for the token at the moment it opens
// (first open and every reconnect), so a token written after the socket
// was built - kiosk silent remint, inline pair, a purge by the stale-
// bearer policy - is what the next upgrade carries. Nothing here touches
// storage or the network: pure functions the transport and the hooks
// compose, and the contract harness drives directly.
//
// The reconnect episode below does not replace the decision table in
// stale-bearer-policy.ts; it composes it. A dead bearer and a dead device
// look identical at the upgrade (WS close 1006), so the only honest
// discriminator is an anonymous read that lands. Purge only then.

import { resolveConnectFailure, resolveProbeRead } from "./stale-bearer-policy.ts";

/** Reads the bearer to present at the next handshake. `undefined` =
 *  open anonymously (LAN-trust). */
export type BearerSource = () => string | undefined;

function normalise(token: string | undefined): string | undefined {
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

/** The token a handshake presents: the live source when one is
 *  installed, else the fixed snapshot. Empty strings are "no bearer". */
export function handshakeBearer(
  source: BearerSource | undefined,
  snapshot: string | undefined
): string | undefined {
  return source !== undefined ? normalise(source()) : normalise(snapshot);
}

/** Canonical bearer subprotocol list for `new WebSocket(url, protocols)`:
 *  `evo.bearer.<token>` (the framework's extract path matches exactly
 *  this prefix), or no subprotocol at all for an anonymous upgrade. */
export function handshakeProtocols(
  token: string | undefined
): string[] | undefined {
  const t = normalise(token);
  return t === undefined ? undefined : [`evo.bearer.${t}`];
}

/** Whether this session may negotiate the prompt-responder seat. Only a
 *  bearer can carry `user_interaction_responder`; LAN-trust never does,
 *  so an anonymous socket must not even ask. */
export function shouldClaimResponder(bearer: string | undefined): boolean {
  return normalise(bearer) !== undefined;
}

/** Outcome of one reconnect episode on a bearer socket. */
export type ReconnectEpisodeOutcome =
  /** The anonymous probe read landed: the token is dead. Purge it and
   *  retry the same surface anonymously (LAN-trust reads keep it live). */
  | "purge-and-retry-anonymous"
  /** The anonymous probe could not connect either: the device is down.
   *  Keep the token, show the honest disconnected state, keep waiting. */
  | "keep-token-not-connected"
  /** The anonymous socket connected but the read was refused: this
   *  read needs a capability LAN-trust lacks, so the token cannot be
   *  blamed. Keep it and surface the honest error. */
  | "backout-keep-token"
  /** No bearer was presented: nothing to decide, ordinary outage rules. */
  | "no-bearer";

/** Compose the existing decision table over one reconnect episode:
 *  the bearer socket failed to (re)open; an anonymous probe was run. */
export function resolveReconnectEpisode(input: {
  hadStoredBearer: boolean;
  anonConnected: boolean;
  anonReadLanded: boolean;
}): ReconnectEpisodeOutcome {
  const first = resolveConnectFailure({
    hadStoredBearer: input.hadStoredBearer,
    probing: false
  });
  if (first !== "probe") return "no-bearer";
  if (!input.anonConnected) {
    // The probe's own connect failed: the table's probing=true branch is
    // "surface-error" - keep the token, never purge on an outage.
    return resolveConnectFailure({ hadStoredBearer: true, probing: true }) ===
      "surface-error"
      ? "keep-token-not-connected"
      : "backout-keep-token";
  }
  return resolveProbeRead({ probing: true, readLanded: input.anonReadLanded }) ===
    "purge"
    ? "purge-and-retry-anonymous"
    : "backout-keep-token";
}

/** What a bearer-scoped surface paints for its socket. `connected` is
 *  reserved for an OPEN socket; every other moment is honest. */
export type SocketPaint = "connected" | "disconnected" | "error";

export function socketPaint(input: {
  socketOpen: boolean;
  episode: ReconnectEpisodeOutcome | null;
}): SocketPaint {
  if (input.socketOpen) return "connected";
  if (input.episode === "backout-keep-token") return "error";
  return "disconnected";
}
