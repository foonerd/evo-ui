// stale-bearer-policy - the decision surface for recovering a private
// bearer socket whose upgrade the framework refused.
//
// Context (verified against the live framework):
//   * ws_endpoint refuses a dead/invalid bearer at the HTTP upgrade with
//     401 ("token verify failed" / "malformed bearer token"), so
//     transport.connect() REJECTS - identical, from the browser's view,
//     to an unreachable device (both collapse to WS close 1006). The UI
//     therefore CANNOT tell "token dead" from "device down" at connect.
//   * A no-bearer upgrade from a LAN/trusted origin succeeds (101) with
//     LAN-trust caps, so a capability-none read still lands anonymously.
//
// Strategy: when a bearer socket fails, RE-PROBE anonymously. If the
// anonymous read lands, the device is reachable and the token is the
// thing that was refused (device reset / revoked / expired) -> purge it.
// If the anonymous connect ALSO fails, the device is genuinely down ->
// keep the token and surface an honest error. This is self-proving and
// needs no new framework refusal class.

/** What to do when a private socket's connect (with retry) has failed. */
export type ConnectFailureResolution =
  /** Re-open anonymously to find out whether the token or the device is
   *  at fault. Only chosen the FIRST time, with a bearer actually stored. */
  | "probe"
  /** Terminal: no bearer to blame, or the anonymous probe's connect also
   *  failed (device unreachable). Surface the honest transport error. */
  | "surface-error";

/** What to do with the read result WHILE probing anonymously. */
export type ProbeReadResolution =
  /** The anonymous read landed -> the stored token is dead. Purge it. */
  | "purge"
  /** The anonymous socket connected but the read was refused even
   *  anonymously (this shelf's read needs a capability the LAN principal
   *  lacks) -> cannot blame the token; back out and keep it. */
  | "backout"
  /** Not probing: ordinary read handling applies, no bearer decision. */
  | "none";

/** Decide the response to a private-socket connect failure. `probing`
 *  is true when THIS attempt was already an anonymous re-probe. */
export function resolveConnectFailure(opts: {
  hadStoredBearer: boolean;
  probing: boolean;
}): ConnectFailureResolution {
  return opts.hadStoredBearer && !opts.probing ? "probe" : "surface-error";
}

/** Decide what a read result means for the stored bearer. `readLanded`
 *  is `initial.error === undefined` (a clean, non-refused response). */
export function resolveProbeRead(opts: {
  probing: boolean;
  readLanded: boolean;
}): ProbeReadResolution {
  if (!opts.probing) return "none";
  return opts.readLanded ? "purge" : "backout";
}
