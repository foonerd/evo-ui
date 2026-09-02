// One read path and one write path for designer layout edits, routed
// by scope. Every editor (Pages, Menu, build stage) uses THESE and
// nothing else, so the scope binding can never diverge between
// controls - the label/control parity rule applied to storage.

import type { LayoutDocument } from "../runtime/layout-document";
import {
  resolveLayoutDocument,
  resolveRemoteLayoutDocument,
  type DisplayProfileSettings
} from "../runtime/presentation-target";
import {
  mergeCustomDisplayProfile,
  mergeRemoteDisplayProfile,
  mergeTargetDisplayProfile,
  type ScaleDials,
  type TargetDisplayProfile
} from "../runtime/ui-profile";
import type { SessionScope } from "../runtime/session-scope";
import { synthesizeRemoteReference } from "../app/widget-catalog";
import { t } from "../runtime/i18n";

/** The document the designer edits for a scope. Native: the selected
 *  screen's stored layout (null = shipped defaults, the editors
 *  synthesize per surface). Remote: the stored remote layout, else
 *  the DERIVED full-reference view as the copy-on-write base. */
export function resolveScopedLayout(
  scope: SessionScope,
  targetKey: string | null,
  profileSettings: DisplayProfileSettings | null
): LayoutDocument | null {
  if (scope === "remote") {
    return resolveRemoteLayoutDocument(profileSettings) ?? synthesizeRemoteReference();
  }
  return resolveLayoutDocument(targetKey, profileSettings);
}

/** Route a layout write to the scope's storage. `layout: undefined`
 *  is the per-scope reset - the scope falls back to its own default
 *  (native: shipped arrangement; remote: derived reference).
 *  Native writes are strictly per-target: with no target key there is
 *  nowhere correct to write, so the write is refused unchanged (the
 *  custom.layout generic slot is RETIRED - it leaked stale
 *  arrangements into every unconfigured screen). */
export function mergeScopedLayout(
  scope: SessionScope,
  current: DisplayProfileSettings | null,
  targetKey: string | null,
  layout: LayoutDocument | undefined
): DisplayProfileSettings {
  if (scope === "remote") {
    return mergeRemoteDisplayProfile(current, { layout });
  }
  if (targetKey == null) return current ?? {};
  return mergeTargetDisplayProfile(current, targetKey, { layout });
}

/** True when the scope has a STORED layout (reset would change something). */
export function scopedLayoutStored(
  scope: SessionScope,
  targetKey: string | null,
  profileSettings: DisplayProfileSettings | null
): boolean {
  if (scope === "remote") {
    return resolveRemoteLayoutDocument(profileSettings) != null;
  }
  return resolveLayoutDocument(targetKey, profileSettings) != null;
}

/** DISPLAY-PREFS write path (smallLanding, compass, scale dials):
 *  per-target when a key exists, else the custom container - the
 *  documented home for screens WITHOUT a target key. Layout edits do
 *  NOT come through here (they are scope-routed, native strictly
 *  per-target); display prefs deliberately keep the custom fallback. */
export function mergeProfileForTarget(
  current: DisplayProfileSettings | null,
  targetKey: string | null,
  patch: TargetDisplayProfile
): DisplayProfileSettings {
  return targetKey != null
    ? mergeTargetDisplayProfile(current, targetKey, patch)
    : mergeCustomDisplayProfile(current, patch);
}

/** Route a scale-dial write (touch/type) to the scope's storage - mirrors
 *  mergeScopedLayout. Native -> the per-target bucket (byTarget[key]);
 *  remote -> the remote scope's own dials, edited independently of every
 *  native screen. */
export function mergeScopedDial(
  scope: SessionScope,
  current: DisplayProfileSettings | null,
  targetKey: string | null,
  patch: ScaleDials
): DisplayProfileSettings {
  return scope === "remote"
    ? mergeRemoteDisplayProfile(current, patch)
    : mergeProfileForTarget(current, targetKey, patch);
}

/** True when layout edits CAN be stored for this scope. Native needs
 *  a target key (per-target strictly); remote always can. Editors
 *  must check this and show the banner instead of editing - a write
 *  that silently goes nowhere is a forbidden failure mode. */
export function canEditScope(
  scope: SessionScope,
  targetKey: string | null
): boolean {
  return scope === "remote" || targetKey != null;
}

/** The visible scope binding - never invisible, by ruling. */
export function scopeBannerText(
  scope: SessionScope,
  targetKey: string | null
): string {
  if (scope === "remote") {
    return t("designer.scopeRemote");
  }
  if (targetKey != null) {
    return t("designer.scopeNative", { target: targetKey });
  }
  return t("designer.scopeNone");
}
