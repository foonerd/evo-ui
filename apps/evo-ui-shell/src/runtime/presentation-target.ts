// Presentation target — pure functions mapping viewport + preset context
// onto layout/interaction attributes for the shell root element.
//
// Authority: UI_ARCHITECTURE_ONE_PAGE.md, RESPONSIVE_FOLD_MODEL.md

import type { LayoutDocument } from "./layout-document.ts";
import type { SessionScope } from "./session-scope.ts";
import {
  resolveCompassMap,
  type CompassMap,
  type CompassOverrides
} from "./compass-map.ts";

/** Fold tier from effective viewport (w, h). */
export type FoldTier =
  | "solo"
  | "strip"
  | "bar"
  | "stack"
  | "split"
  | "full"
  | "cinema";

/** Computed interaction class — not a storage bucket for scale. */
export type SizeClass = "wearable" | "small" | "standard";

/** Operator / profile setting — `auto` resolves at runtime. */
export type DeviceKindSetting = "auto" | "panel" | "mobile" | "tablet";

/** Resolved primary screen kind (never `auto`). */
export type ResolvedDeviceKind = "panel" | "mobile" | "tablet";

export type DeviceKindSource = "profile" | "explicit" | "matrix" | "viewport" | "default";

/** Shell navigation / chrome mode. */
export type InteractionMode = "pivot" | "standard";

/** Compact panel home — compass-only default; track sheet on swipe up. */
export type SmallLanding = "compass" | "track";

/* The legacy profile-level rail placement is gone: the only rail is
 * the document page's rail region, governed by the page's own
 * railPosition (see layout-document.ts). One concept, one control. */

/** Full-screen display mode (player vs idle clock). */
export type DisplayMode = "player" | "idle";

export interface Viewport {
  readonly widthPx: number;
  readonly heightPx: number;
}

interface ScaleDialFields {
  /** Physical finger-floor in mm — the touch-target minimum guardrail. */
  touchFloorMm?: number;
  /** Comfort multiplier (>=1) applied above the finger floor. */
  touchScale?: number;
  /** Text scale, independent of the touch floor. */
  typeScale?: number;
  /** Display zoom: scales EVERYTHING (text + layout) by driving the root
   *  font-size, so all rem-based sizes grow together. Distinct from
   *  typeScale (text only). Default 1. */
  displayZoom?: number;
  /** Operator-entered physical diagonal (custom / projector / unknown). */
  diagonalInches?: number;
}

export interface DisplayProfileSettings {
  /** Per-target visual profiles keyed by "WxH@diagonal" (resolution +
   *  physical size, resolution normalised long x short). Vendor and
   *  hardware-timing identity are never a key - a panel's visual config
   *  depends only on its shape and size. */
  readonly byTarget?: Readonly<
    Record<
      string,
      {
        displayFactor?: number;
        deviceKind?: DeviceKindSetting;
        smallLanding?: "compass" | "track";
        compass?: CompassOverrides;
        homeMode?: "auto" | "compass" | "full";
        layout?: LayoutDocument;
      } & ScaleDialFields
    >
  >;
  /** DISPLAY PREFS for screens WITHOUT a target key (unknown
   *  diagonal -> no "WxH@diag" identity to file under). NOT dead:
   *  retiring it would strand un-diagonaled panels' scale dials.
   *  Its `layout` member IS retired (2026-07-13) - layouts are
   *  strictly per-target; the field remains in the type only so old
   *  stored payloads still parse (and are ignored). */
  readonly custom?: {
    displayFactor?: number;
    deviceKind?: DeviceKindSetting;
    smallLanding?: SmallLanding;
    compass?: CompassOverrides;
    homeMode?: "auto" | "compass" | "full";
    layout?: LayoutDocument;
  } & ScaleDialFields;
  /** The REMOTE scope - the single browser-facing screen (two-scope
   *  model). Independent of every native screen; stores its OWN scale
   *  dials (touch/type) and layout. When no layout is stored the remote
   *  default is the DERIVED full-reference view (never stored). */
  readonly remote?: {
    layout?: LayoutDocument;
  } & ScaleDialFields;
}

/** Scale-engine defaults. Touch floor is anatomy (~9mm finger);
 *  scales default to 1 (at the floor / unscaled type). */
export const DEFAULT_TOUCH_FLOOR_MM = 9;
export const DEFAULT_TOUCH_SCALE = 1;
export const DEFAULT_TYPE_SCALE = 1;
export const DEFAULT_DISPLAY_ZOOM = 1;
/** Used only when the physical diagonal is unknown, so a px floor
 *  cannot be derived from PPI. The conventional touch minimum; the
 *  designer warns to set a real diagonal for true sizing. */
export const FALLBACK_TOUCH_FLOOR_PX = 44;

export interface PresentationInput {
  readonly viewport: Viewport;
  readonly presetId?: string | null;
  readonly displayMode?: DisplayMode;
  readonly profileSettings?: DisplayProfileSettings | null;
  readonly deviceKindSetting?: DeviceKindSetting | null;
  /** Designer: kind tag on the selected matrix row when setting is `auto`. */
  readonly matrixDeviceKind?: ResolvedDeviceKind | null;
  /** Physical diagonal for the active preset, from the catalogue.
   *  Drives PPI and the physical touch floor. Null when unknown
   *  (generic/custom) — a profile custom diagonal then applies, else
   *  the px floor falls back to the conventional minimum. */
  readonly diagonalInches?: number | null;
  /** Target key to resolve the per-target operator DIALS against
   *  (touch floor, touch scale, type scale) - the DECLARED native_target,
   *  not the measured-geometry key. On a real panel the measured key drifts
   *  from the declared one (DPR/rotation), so the designer writes the dials
   *  under the declared key while the glass would otherwise read the measured
   *  key and see nothing (same drift the layout doc keys off native_target
   *  for). Null (designer preview) falls back to the measured key, where the
   *  two are the same. */
  readonly dialTargetKey?: string | null;
  /** Which scope's dials to resolve. "remote" reads the browser-facing
   *  scope's own touch/type (independent of native); "native"/undefined
   *  reads the per-target native buckets. Set from the session scope on
   *  the glass/remote, and from the designer scope toggle in the workshop. */
  readonly dialScope?: SessionScope;
}

export interface PresentationPlan {
  readonly effectiveW: number;
  readonly effectiveH: number;
  readonly foldTier: FoldTier;
  readonly sizeClass: SizeClass;
  readonly deviceKindSetting: DeviceKindSetting;
  readonly deviceKind: ResolvedDeviceKind;
  readonly deviceKindSource: DeviceKindSource;
  readonly interaction: InteractionMode;
  readonly smallLanding: SmallLanding;
  /** Resolved compass slot map (compass-map.ts) - overrides applied
   *  over the classic default, Now playing presence guaranteed. */
  readonly compass: CompassMap;
  readonly displayMode: DisplayMode;
  readonly displayFactor: number;
  readonly is7kOverlay: boolean;
  /** Visual-profile key "WxH@diagonal", null when the diagonal is unknown. */
  readonly targetKey: string | null;
  /** Resolved physical diagonal (catalogue or custom), null if unknown. */
  readonly diagonalInches: number | null;
  /** Pixels per inch, null when the diagonal is unknown. */
  readonly ppi: number | null;
  /** Finger-floor policy in mm and comfort/type scales. */
  readonly touchFloorMm: number;
  readonly touchScale: number;
  readonly typeScale: number;
  /** Display zoom (scales everything via the root font-size). Default 1. */
  readonly displayZoom: number;
  /** Physical finger floor in px (from PPI), or the fallback minimum. */
  readonly touchFloorPx: number;
  /** Effective touch target px = floor * touchScale. touchScale >= 1
   *  keeps it at/above the finger floor; the operator may set it below
   *  1 (down to MIN_TOUCH_SCALE) to go under the floor deliberately. */
  readonly touchTargetPx: number;
}

const FOLD = {
  soloW: 480,
  soloH: 480,
  stripH: 430,
  stripW: 1180,
  stackW: 800,
  splitW: 1180,
  cinemaW: 2400,
  sevenK: { minW: 1180, maxW: 1600, minH: 680, maxH: 820 }
} as const;

/** Fold tier — docs/RESPONSIVE_FOLD_MODEL.md decision tree. */
export function foldTierFor(widthPx: number, heightPx: number): FoldTier {
  const w = Math.max(0, Math.floor(widthPx));
  const h = Math.max(0, Math.floor(heightPx));
  if (w < FOLD.soloW && h < FOLD.soloH) return "solo";
  if (h < FOLD.stripH && w < FOLD.stripW) return "strip";
  if (h < FOLD.stripH && w >= FOLD.stripW) return "bar";
  if (w < FOLD.stackW) return "stack";
  if (w < FOLD.splitW) return "split";
  if (w >= FOLD.cinemaW) return "cinema";
  return "full";
}

/** Minimum widget fold-priority that survives at a fold tier
 *  (docs/RESPONSIVE_FOLD_MODEL.md: lowest-priority regions fold away
 *  first as space runs out). Priority 5 survives everything;
 *  priority 1 folds first. Contract blocks never shed regardless. */
export function foldMinPriority(tier: FoldTier): number {
  switch (tier) {
    case "cinema":
    case "full":
      return 1;
    case "split":
      return 2;
    case "stack":
      return 3;
    case "bar":
      return 4;
    case "strip":
    case "solo":
      return 5;
  }
}

/** Size class — DISPLAY_RESOLUTIONS.md §F. */
export function sizeClassFor(widthPx: number, heightPx: number): SizeClass {
  const w = Math.max(0, Math.floor(widthPx));
  const h = Math.max(0, Math.floor(heightPx));
  const mn = Math.min(w, h);
  if (mn <= 360) return "wearable";
  if (h <= 320 && w <= 640) return "wearable";
  if (w <= 480 && h <= 480) return "wearable";
  if (w < FOLD.stackW) return "small";
  return "standard";
}

/** Known mobile reference viewports — DISPLAY_RESOLUTIONS.md §H (portrait-native ids). */
const MOBILE_VIEWPORT_IDS = new Set([
  "360x640",
  "375x667",
  "390x844",
  "414x896",
  "480x854",
  "540x960"
]);

/** Known tablet reference viewports — DISPLAY_RESOLUTIONS.md §H. */
const TABLET_VIEWPORT_IDS = new Set(["768x1024"]);

function viewportKey(widthPx: number, heightPx: number): string {
  return `${Math.max(0, Math.floor(widthPx))}x${Math.max(0, Math.floor(heightPx))}`;
}

export function deviceKindFromViewport(
  widthPx: number,
  heightPx: number
): ResolvedDeviceKind | null {
  const a = viewportKey(widthPx, heightPx);
  const b = viewportKey(heightPx, widthPx);
  if (MOBILE_VIEWPORT_IDS.has(a) || MOBILE_VIEWPORT_IDS.has(b)) {
    return "mobile";
  }
  if (TABLET_VIEWPORT_IDS.has(a) || TABLET_VIEWPORT_IDS.has(b)) {
    return "tablet";
  }
  return null;
}

function profileDeviceKindSetting(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): DeviceKindSetting | null {
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.deviceKind != null) {
    return profileSettings.byTarget[targetKey].deviceKind!;
  }
  if (profileSettings?.custom?.deviceKind != null) {
    return profileSettings.custom.deviceKind;
  }
  return null;
}

export function resolveDeviceKind(input: {
  readonly setting?: DeviceKindSetting | null;
  readonly targetKey?: string | null;
  readonly profileSettings?: DisplayProfileSettings | null;
  readonly matrixDeviceKind?: ResolvedDeviceKind | null;
  readonly viewport: Viewport;
}): {
  readonly setting: DeviceKindSetting;
  readonly resolved: ResolvedDeviceKind;
  readonly source: DeviceKindSource;
} {
  const profileSetting = profileDeviceKindSetting(input.targetKey, input.profileSettings);
  const setting = input.setting ?? "auto";

  if (setting !== "auto") {
    return {
      setting,
      resolved: setting,
      source: "explicit"
    };
  }

  if (profileSetting != null && profileSetting !== "auto") {
    return { setting, resolved: profileSetting, source: "profile" };
  }

  if (input.matrixDeviceKind != null) {
    return { setting, resolved: input.matrixDeviceKind, source: "matrix" };
  }

  const fromViewport = deviceKindFromViewport(
    input.viewport.widthPx,
    input.viewport.heightPx
  );
  if (fromViewport != null) {
    return { setting, resolved: fromViewport, source: "viewport" };
  }

  return { setting, resolved: "panel", source: "default" };
}

export function deviceKindLabel(kind: ResolvedDeviceKind): string {
  switch (kind) {
    case "panel":
      return "Panel";
    case "mobile":
      return "Mobile";
    case "tablet":
      return "Tablet";
  }
}

export function deviceKindSettingLabel(setting: DeviceKindSetting): string {
  return setting === "auto" ? "Auto" : deviceKindLabel(setting);
}

export function interactionFor(
  sizeClass: SizeClass,
  deviceKind: ResolvedDeviceKind,
  foldTier: FoldTier
): InteractionMode {
  if (deviceKind === "mobile" || deviceKind === "tablet") {
    return "standard";
  }
  // Pivot (the compass) is for genuinely compact panels only. The fold
  // model and DISPLAY_RESOLUTIONS put every Stack-tier panel - tall narrow
  // portraits like 480x800 - in the STANDARD single column, not the
  // compass. A small panel keeps the compass only while solo/strip; once
  // it is tall enough to be Stack it routes to the standard column.
  if (sizeClass === "wearable") {
    return "pivot";
  }
  if (sizeClass === "small") {
    return foldTier === "stack" ? "standard" : "pivot";
  }
  return "standard";
}

/** 7K kiosk overlay — RESPONSIVE_FOLD_MODEL.md. */
export function is7kOverlay(widthPx: number, heightPx: number): boolean {
  const w = Math.max(0, Math.floor(widthPx));
  const h = Math.max(0, Math.floor(heightPx));
  const { minW, maxW, minH, maxH } = FOLD.sevenK;
  return w >= minW && w <= maxW && h >= minH && h <= maxH && w >= h;
}

/** Apply the operator's home-style override to the heuristic. */
export function interactionWithHomeMode(
  heuristic: InteractionMode,
  homeMode: "auto" | "compass" | "full"
): InteractionMode {
  if (homeMode === "full") return "standard";
  if (homeMode === "compass") return "pivot";
  return heuristic;
}

/** Home style override — preset primary, custom fallback, default
 *  auto (the size heuristic decides). "full" forces the standard
 *  layout onto glass the heuristic would give the compass (sharp
 *  small OLEDs - the true-PPI touch floor keeps targets safe);
 *  "compass" forces the gesture home. */
export function resolveHomeMode(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): "auto" | "compass" | "full" {
  // Same chain as smallLanding / compass: preset primary, custom
  // fallback, default auto.
  const t = targetKey ? profileSettings?.byTarget?.[targetKey]?.homeMode : undefined;
  if (t === "compass" || t === "full") return t;
  const c = profileSettings?.custom?.homeMode;
  if (c === "compass" || c === "full") return c;
  return "auto";
}

/** Compass slot map — preset primary, custom fallback, classic default.
 *  Same resolution chain as smallLanding. */
export function resolveCompass(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): CompassMap {
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.compass != null) {
    return resolveCompassMap(profileSettings.byTarget[targetKey].compass);
  }
  return resolveCompassMap(profileSettings?.custom?.compass);
}

/** Compact panel landing — preset primary, custom fallback, default compass. */
export function resolveSmallLanding(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): SmallLanding {
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.smallLanding != null) {
    return profileSettings.byTarget[targetKey].smallLanding!;
  }
  if (profileSettings?.custom?.smallLanding != null) {
    return profileSettings.custom.smallLanding;
  }
  return "compass";
}

/** NATIVE-scope layout document - PER TARGET, STRICTLY: the designer
 *  designs FOR a target resolution, and an 800x480 panel's layout is
 *  a different design than a square 800x800's. Resolution: the
 *  screen's own byTarget entry, else null = shipped defaults.
 *
 *  RETIRED 2026-07-13: the ui.profile.custom.layout
 *  fallback. It was the pre-target-era generic slot and it leaked a
 *  stale arrangement (two-thirds + bottom rail) into every native
 *  screen without a stored layout - invisible inheritance, the same
 *  defect class as invisible scoping. Native layouts now have exactly
 *  two sources: the target's own document or the shipped default.
 *  Remote sessions never call this: see resolveRemoteLayoutDocument. */
export function resolveLayoutDocument(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): LayoutDocument | null {
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.layout != null) {
    return profileSettings.byTarget[targetKey].layout!;
  }
  return null;
}

/** REMOTE-scope layout document. The remote screen is one scope for
 *  all browsers; it never reads byTarget/custom (those are native
 *  screens' storage). Null = the caller renders the DERIVED
 *  full-reference default, never a stored document. */
export function resolveRemoteLayoutDocument(
  profileSettings: DisplayProfileSettings | null | undefined
): LayoutDocument | null {
  return profileSettings?.remote?.layout ?? null;
}

/** Display factor — preset primary, custom fallback, default 1. */
export function resolveDisplayFactor(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined
): number {
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.displayFactor != null) {
    return profileSettings.byTarget[targetKey].displayFactor!;
  }
  if (profileSettings?.custom?.displayFactor != null) {
    return profileSettings.custom.displayFactor;
  }
  return 1;
}

/** Pixels per inch from effective resolution + physical diagonal.
 *  Null when the diagonal is unknown or non-positive. */
export function ppiFor(
  widthPx: number,
  heightPx: number,
  diagonalInches: number | null | undefined
): number | null {
  if (diagonalInches == null || !Number.isFinite(diagonalInches) || diagonalInches <= 0) {
    return null;
  }
  const w = Math.max(0, Math.floor(widthPx));
  const h = Math.max(0, Math.floor(heightPx));
  return Math.sqrt(w * w + h * h) / diagonalInches;
}

/** Physical touch floor in px from PPI, or the fallback minimum when
 *  the diagonal is unknown. */
export function touchFloorPxFor(
  ppi: number | null,
  touchFloorMm: number
): number {
  if (ppi == null) {
    return FALLBACK_TOUCH_FLOOR_PX;
  }
  return Math.round((touchFloorMm * ppi) / 25.4);
}

function resolveDialField(
  field: keyof Pick<
    NonNullable<DisplayProfileSettings["custom"]>,
    "touchFloorMm" | "touchScale" | "typeScale" | "displayZoom" | "diagonalInches"
  >,
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined,
  scope?: SessionScope
): number | null {
  // The remote scope keeps its own dials (independent of every native
  // screen); read those directly, never the per-target native buckets.
  if (scope === "remote") {
    const v = profileSettings?.remote?.[field];
    return typeof v === "number" ? v : null;
  }
  if (targetKey && profileSettings?.byTarget?.[targetKey]?.[field] != null) {
    return profileSettings.byTarget[targetKey][field]!;
  }
  if (profileSettings?.custom?.[field] != null) {
    return profileSettings.custom[field]!;
  }
  return null;
}

export function resolveTouchFloorMm(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined,
  scope?: SessionScope
): number {
  return resolveDialField("touchFloorMm", targetKey, profileSettings, scope) ?? DEFAULT_TOUCH_FLOOR_MM;
}

/** Minimum touch scale. Below 1 takes targets below the 9mm finger
 *  floor - allowed (operator choice; the designer surfaces the
 *  resulting px so they see when it drops under the floor), but
 *  bounded so a target can never collapse toward zero. */
export const MIN_TOUCH_SCALE = 0.5;

export function resolveTouchScale(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined,
  scope?: SessionScope
): number {
  const v = resolveDialField("touchScale", targetKey, profileSettings, scope) ?? DEFAULT_TOUCH_SCALE;
  return v < MIN_TOUCH_SCALE ? MIN_TOUCH_SCALE : v;
}

export function resolveTypeScale(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined,
  scope?: SessionScope
): number {
  return resolveDialField("typeScale", targetKey, profileSettings, scope) ?? DEFAULT_TYPE_SCALE;
}

/** Minimum display zoom - a floor so the whole UI can never collapse. */
export const MIN_DISPLAY_ZOOM = 0.5;

export function resolveDisplayZoom(
  targetKey: string | null | undefined,
  profileSettings: DisplayProfileSettings | null | undefined,
  scope?: SessionScope
): number {
  const v = resolveDialField("displayZoom", targetKey, profileSettings, scope) ?? DEFAULT_DISPLAY_ZOOM;
  return v < MIN_DISPLAY_ZOOM ? MIN_DISPLAY_ZOOM : v;
}

/** Catalogue diagonal is the hardware truth; a profile custom diagonal
 *  is the operator fallback for unknown / projector panels. The diagonal
 *  is part of the target key, so it is never looked up by key. */
export function resolveDiagonalInches(
  profileSettings: DisplayProfileSettings | null | undefined,
  catalogueDiagonalInches: number | null | undefined
): number | null {
  if (catalogueDiagonalInches != null && Number.isFinite(catalogueDiagonalInches)) {
    return catalogueDiagonalInches;
  }
  if (profileSettings?.custom?.diagonalInches != null) {
    return profileSettings.custom.diagonalInches;
  }
  return null;
}

/** Visual-profile key: resolution (normalised long x short) + physical
 *  diagonal. Null when the diagonal is unknown, so the profile then falls
 *  back to custom / defaults. Vendor identity never appears here. */
export function targetKeyFor(
  widthPx: number,
  heightPx: number,
  diagonalInches: number | null
): string | null {
  if (diagonalInches == null || !Number.isFinite(diagonalInches) || diagonalInches <= 0) {
    return null;
  }
  const w = Math.max(0, Math.floor(widthPx));
  const h = Math.max(0, Math.floor(heightPx));
  return `${Math.max(w, h)}x${Math.min(w, h)}@${diagonalInches}`;
}

export interface ParsedTargetKey {
  /** Long edge in px (keys are normalised long x short). */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly diagonalInches: number;
}

/** Inverse of targetKeyFor - lives beside it so encode and decode
 *  can never drift. Null for anything that is not a well-formed
 *  "WxH@diagonal" key. */
export function parseTargetKey(key: string): ParsedTargetKey | null {
  const m = /^(\d+)x(\d+)@(\d+(?:\.\d+)?)$/.exec(key);
  if (m === null) {
    return null;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  const diagonalInches = Number(m[3]);
  if (a <= 0 || b <= 0 || !(diagonalInches > 0)) {
    return null;
  }
  return { widthPx: Math.max(a, b), heightPx: Math.min(a, b), diagonalInches };
}

export function buildPresentationPlan(input: PresentationInput): PresentationPlan {
  const w = Math.max(0, Math.floor(input.viewport.widthPx));
  const h = Math.max(0, Math.floor(input.viewport.heightPx));
  const sizeClass = sizeClassFor(w, h);
  const foldTier = foldTierFor(w, h);
  // Diagonal first (from catalogue input or custom), then the target key it
  // forms, then every per-target value resolves against that key.
  const diagonalInches = resolveDiagonalInches(input.profileSettings, input.diagonalInches);
  const targetKey = targetKeyFor(w, h, diagonalInches);
  const deviceKindPlan = resolveDeviceKind({
    setting: input.deviceKindSetting,
    targetKey,
    profileSettings: input.profileSettings,
    matrixDeviceKind: input.matrixDeviceKind,
    viewport: { widthPx: w, heightPx: h }
  });
  const ppi = ppiFor(w, h, diagonalInches);
  // Dials are operator per-target choices the designer writes under the
  // DECLARED target key; on the glass resolve them off that same key
  // (native_target), not the measured key, or the value never lands.
  // Geometry (ppi, effective px, fold) stays on the measured key - it is
  // the physical truth of what is actually on screen.
  const dialKey = input.dialTargetKey ?? targetKey;
  const touchFloorMm = resolveTouchFloorMm(dialKey, input.profileSettings, input.dialScope);
  const touchScale = resolveTouchScale(dialKey, input.profileSettings, input.dialScope);
  const typeScale = resolveTypeScale(dialKey, input.profileSettings, input.dialScope);
  const displayZoom = resolveDisplayZoom(dialKey, input.profileSettings, input.dialScope);
  const touchFloorPx = touchFloorPxFor(ppi, touchFloorMm);
  const touchTargetPx = Math.round(touchFloorPx * touchScale);
  return {
    effectiveW: w,
    effectiveH: h,
    foldTier,
    sizeClass,
    deviceKindSetting: deviceKindPlan.setting,
    deviceKind: deviceKindPlan.resolved,
    deviceKindSource: deviceKindPlan.source,
    interaction: interactionWithHomeMode(
      interactionFor(sizeClass, deviceKindPlan.resolved, foldTier),
      resolveHomeMode(targetKey, input.profileSettings)
    ),
    smallLanding: resolveSmallLanding(targetKey, input.profileSettings),
    compass: resolveCompass(targetKey, input.profileSettings),
    displayMode: input.displayMode ?? "player",
    displayFactor: resolveDisplayFactor(targetKey, input.profileSettings),
    is7kOverlay: is7kOverlay(w, h),
    targetKey,
    diagonalInches,
    ppi,
    touchFloorMm,
    touchScale,
    typeScale,
    displayZoom,
    touchFloorPx,
    touchTargetPx
  };
}

/** Apply plan to `<html>` dataset and CSS vars for designer/runtime. */
export function applyPresentationPlanToRoot(
  plan: PresentationPlan,
  root: HTMLElement = document.documentElement
): void {
  root.dataset.foldTier = plan.foldTier;
  root.dataset.sizeClass = plan.sizeClass;
  root.dataset.deviceKind = plan.deviceKind;
  root.dataset.deviceKindSetting = plan.deviceKindSetting;
  root.dataset.interaction = plan.interaction;
  root.dataset.smallLanding = plan.smallLanding;
  root.dataset.displayMode = plan.displayMode;
  if (plan.is7kOverlay) {
    root.dataset.kiosk7k = "true";
  } else {
    delete root.dataset.kiosk7k;
  }
  root.dataset.diagonalKnown = plan.ppi != null ? "true" : "false";
  root.style.setProperty("--display-w", `${plan.effectiveW}px`);
  root.style.setProperty("--display-h", `${plan.effectiveH}px`);
  root.style.setProperty("--display-factor", String(plan.displayFactor));
  root.style.setProperty("--type-scale", String(plan.typeScale));
  root.style.setProperty("--display-zoom", String(plan.displayZoom));
  root.style.setProperty("--touch-floor-px", `${plan.touchFloorPx}px`);
  root.style.setProperty("--touch-target-px", `${plan.touchTargetPx}px`);
}

export function readViewport(): Viewport {
  if (typeof window === "undefined") {
    return { widthPx: 1280, heightPx: 720 };
  }
  return {
    widthPx: window.innerWidth,
    heightPx: window.innerHeight
  };
}
