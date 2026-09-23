// flight-bus - the one in-page signal that Flight mode was set.
//
// Flight mode is written from two places - Settings > Network's toggle
// and the power cluster (sidebar, pivot, Settings > System) - and each
// hook holds its own copy of the flag, read once at mount. The
// framework publishes no Flight happening and no subject, so a set from
// one place left every other copy showing the old radio state until
// remount. Every landed set announces here, once; each power-cluster
// instance answers by re-reading the flag from the player on its own
// anonymous seed socket. Network's link hook already follows on its
// quiet poll.
//
// Mirrors the bearer bus: in-page only, no payload. The announced
// value is never the truth - the player's answer to the next read is.

const flightListeners = new Set<() => void>();

/** Listen for in-page Flight sets. Returns the release. */
export function onFlightChange(listener: () => void): () => void {
  flightListeners.add(listener);
  return (): void => {
    flightListeners.delete(listener);
  };
}

/** Announce a Flight set that the player accepted. */
export function notifyFlightChange(): void {
  for (const l of flightListeners) l();
}
