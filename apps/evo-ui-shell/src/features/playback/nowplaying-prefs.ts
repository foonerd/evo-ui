// Per-device preference for how a long now-playing title/artist
// behaves on the compact surface: a gentle ticker ("scroll") or a
// 2-line clamp + ellipsis ("wrap"). Persisted in localStorage like the
// visualiser toggle (no framework schema dependency). A window event
// lets the browser designer update the live preview in-window without
// sharing React state across the App / sidebar subtrees.

import type { TextOverflowMode } from "../../components/ScrollingText";

const KEY = "evo.ui.nowplaying.title_overflow";
const EVENT = "evo:nowplaying-overflow-changed";

export function readTitleOverflow(): TextOverflowMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "wrap" || v === "truncate" ? v : "scroll";
  } catch {
    return "scroll";
  }
}

export function writeTitleOverflow(mode: TextOverflowMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Non-fatal: preference simply does not persist this session.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** Subscribe to changes (same-window event + cross-tab storage event).
 *  Returns an unsubscribe. */
export function onTitleOverflowChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
