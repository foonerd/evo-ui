// Truthful "content is loading" chrome for collection surfaces
// (queue, playlists, works, and network-source enumeration).
//
// STATE-DRIVEN, not clock-driven. The mode is a pure function of the
// surface's CURRENT STATE - is a load outstanding, do we already have
// rows, is it errored, is the source itself still enumerating. There
// is deliberately NO timer, NO elapsed clock, and NO wall-clock
// threshold: a stopwatch that escalates the UI (or aborts work) is
// exactly the trap this avoids. "Loading" shows while the load is
// genuinely outstanding and stops the instant a snapshot arrives.
//
// Two hard guarantees:
//  1. Flag-gated. `off` produces zero chrome (legacy behaviour), so
//     it reverts with one flag or one commit.
//  2. It can never regress the player's under-2s critical path: these
//     surfaces mount only after the player is live, and every function
//     here is pure and O(1) with no timers.
//
// Derive, do not store: the surface passes its live state and gets a
// mode back. No second stored phase to drift out of sync.

export type CollectionLoadFlag = "off" | "inline" | "heartbeat";

/** localStorage key. off | inline | heartbeat. */
export const COLLECTION_LOAD_FLAG_KEY = "evo.ui.collectionLoadChrome";

/** Default: inline truthful text, no prominent panel. Flip to
 *  "heartbeat" on a rig to allow the centered panel for a source that
 *  is genuinely still enumerating (a real state, not a clock). */
export const DEFAULT_COLLECTION_LOAD_FLAG: CollectionLoadFlag = "inline";

/** How the surface should render right now. `heartbeat` reuses the
 *  centered panel but the caller MUST give it mode="loading" so it is
 *  never read as a connection fault. */
export type CollectionChromeMode = "hidden" | "inline" | "heartbeat";

/** Read the flag from localStorage. SSR-safe and storage-fault safe;
 *  any unexpected value falls back to the default. */
export function readCollectionLoadFlag(): CollectionLoadFlag {
  if (typeof window === "undefined") return DEFAULT_COLLECTION_LOAD_FLAG;
  try {
    const v = window.localStorage.getItem(COLLECTION_LOAD_FLAG_KEY);
    if (v === "off" || v === "inline" || v === "heartbeat") return v;
  } catch {
    // storage unavailable - use the default
  }
  return DEFAULT_COLLECTION_LOAD_FLAG;
}

export interface CollectionLoadInputs {
  /** Flag ceiling: off = no chrome, inline = text only, heartbeat =
   *  text + panel when the source is genuinely probing. */
  flag: CollectionLoadFlag;
  /** True while a seed / refresh is genuinely outstanding. */
  loading: boolean;
  /** True when we already have decoded rows on screen (last-known). */
  hasSnapshot: boolean;
  /** Hard connection error - the surface owns that message, so the
   *  loading chrome hides rather than stacking on top of an error. */
  errored: boolean;
  /** A REAL state signal that the source is still enumerating (e.g.
   *  a library source in the `probing` state). This - never a clock -
   *  is the only thing that escalates an empty wait to the panel.
   *  Surfaces with no such signal (queue) pass false and stay inline. */
  probing: boolean;
}

/** The single decision. Pure, O(1), no timers. */
export function collectionChromeMode(
  i: CollectionLoadInputs
): CollectionChromeMode {
  if (i.flag === "off") return "hidden";
  if (i.errored) return "hidden";
  if (!i.loading) return "hidden";
  // Have rows already: never blank, never a panel - a quiet inline
  // "Updating..." over the existing list at most.
  if (i.hasSnapshot) return "inline";
  // Loading with nothing to show yet. Escalate to the panel ONLY when
  // the source itself reports it is still enumerating - a real state,
  // not "N seconds elapsed".
  if (i.flag === "heartbeat" && i.probing) return "heartbeat";
  return "inline";
}
