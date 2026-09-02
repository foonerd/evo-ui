// Same-origin channel that carries the designer's selected device
// PROFILE to the embedded preview <App> running inside the designer's
// <iframe>. The iframe is a separate document, so the designer's in-tree
// React context cannot reach it - but localStorage is shared across
// same-origin documents and the `storage` event fires in OTHER documents
// on write, which is exactly the parent -> iframe direction we need.
//
// Sizing (width/height) is deliberately NOT carried here: the iframe
// element is sized to the panel, so the embedded App's own viewport
// already equals the panel and every vh/vw/@media in the app resolves
// correctly with no override. Only the non-viewport profile - physical
// diagonal, touch/type scale, device-kind, preset - needs the channel.

import type {
  DeviceKindSetting,
  DisplayProfileSettings
} from "./presentation-target.ts";
import type { SessionScope } from "./session-scope.ts";

const KEY = "evo.designer.embed_profile";
const EVENT = "evo:designer-embed-changed";

export interface DesignerEmbedProfile {
  readonly diagonalInches: number | null;
  readonly deviceKindSetting: DeviceKindSetting;
  readonly profileSettings: DisplayProfileSettings | null;
  readonly presetId: string | null;
  /** Which scope the preview simulates (two-scope model). The iframe's
   *  own URL must never classify it - the designer says what it is.
   *  Absent = native (older writers). */
  readonly scope?: SessionScope;
}

/** Parent (designer) -> publish the current profile for the iframe. */
export function writeEmbedProfile(profile: DesignerEmbedProfile): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Non-fatal: the preview just keeps the last profile this session.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** Embedded preview -> read the current profile (null before first write). */
export function readEmbedProfile(): DesignerEmbedProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null || raw.length === 0) {
      return null;
    }
    return JSON.parse(raw) as DesignerEmbedProfile;
  } catch {
    return null;
  }
}

/** Subscribe to profile changes (cross-document `storage` + same-window
 *  event). Returns an unsubscribe. */
export function onEmbedProfileChange(cb: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
