// Bound the "Checking" state on the Network tiles.
//
// The tiles paint from the per-interface device table that network.nm.status
// returns. Until it answers the table is empty and the tiles say "Checking".
// That must not be indefinite: past a short grace an empty table is an honest
// "the player did not report its network status", or the existing Pair CTA
// when the classifier said pair. When nm.status does answer, the table fills
// and the tiles paint real state - the quiet poll keeps re-asking as before.
//
// The grace matches File sharing's (8s) so the two surfaces feel the same.
// Pure - the contract harness drives every branch.

/** Grace before an empty device table stops reading as "Checking". Parity
 *  with SmbServerSurface's timedOut grace. */
export const NETWORK_STATUS_GRACE_MS = 8000;

export type StatusPaint = "loaded" | "checking" | "pair" | "error";

/** What the tiles paint for the device-table state.
 *  - loaded   : the table answered, paint real state (timer irrelevant).
 *  - checking : empty, still inside the grace.
 *  - pair     : empty past the grace and the classifier said pair -> the
 *               existing Pair CTA (authNeeded), never a household stand-in.
 *  - error    : empty past the grace -> the honest status notice. */
export function statusPaint(input: {
  loaded: boolean;
  timedOut: boolean;
  pair: boolean;
}): StatusPaint {
  if (input.loaded) return "loaded";
  if (!input.timedOut) return "checking";
  return input.pair ? "pair" : "error";
}
