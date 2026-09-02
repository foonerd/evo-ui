// Parse and merge `ui.profile` gateway settings — UI_ARCHITECTURE_ONE_PAGE.md

import type {
  DeviceKindSetting,
  DisplayProfileSettings
} from "./presentation-target.ts";

import {
  decodeLayoutDocument,
  type LayoutDocument
} from "./layout-document.ts";
import {
  decodeCompassOverrides,
  type CompassOverrides
} from "./compass-map.ts";

export const UI_PROFILE_SETTINGS_KEY = "ui.profile";
export const UI_DISPLAY_PRESET_KEY = "ui.display.preset_id";
/** The device's attached screen, DECLARED vendor-free as a target key
 *  "WxH@diagonal" - written by the designer's Apply when a catalogue
 *  screen is selected (the operator stating what glass is attached),
 *  read by the panel session (diagonal -> target key -> its layout)
 *  and the /native mirror (glass geometry). Stands until a DRM/EDID
 *  probe supplies the same fact from hardware. */
export const UI_NATIVE_TARGET_KEY = "ui.display.native_target";

export interface ScaleDials {
  readonly touchFloorMm?: number;
  readonly touchScale?: number;
  readonly typeScale?: number;
  readonly displayZoom?: number;
  readonly diagonalInches?: number;
}

/** Per-target home style: auto = the size heuristic; compass / full
 *  force the interaction regardless of it (sharp small OLEDs can
 *  take the full designer - operator's explicit choice). */
export type HomeModeSetting = "auto" | "compass" | "full";
export function isHomeModeSetting(v: unknown): v is HomeModeSetting {
  return v === "auto" || v === "compass" || v === "full";
}

export interface CustomDisplayProfile extends ScaleDials {
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly displayFactor?: number;
  readonly deviceKind?: DeviceKindSetting;
  readonly smallLanding?: "compass" | "track";
  /** Compass slot overrides (compass-map.ts); omitted = classic. */
  readonly compass?: CompassOverrides;
  /** Home style override; omitted = auto. */
  readonly homeMode?: HomeModeSetting;
  /** Operator-arranged layout document (builder). */
  readonly layout?: LayoutDocument;
}

export interface TargetDisplayProfile extends ScaleDials {
  readonly displayFactor?: number;
  readonly deviceKind?: DeviceKindSetting;
  readonly smallLanding?: "compass" | "track";
  /** Compass slot overrides (compass-map.ts); omitted = classic. */
  readonly compass?: CompassOverrides;
  /** Home style override; omitted = auto. */
  readonly homeMode?: HomeModeSetting;
  /** Operator-arranged layout document (builder). */
  readonly layout?: LayoutDocument;
}

/** Parse the four numeric scale dials from a raw record. */
function parseScaleDials(record: Record<string, unknown>): ScaleDials {
  const keys: (keyof ScaleDials)[] = [
    "touchFloorMm",
    "touchScale",
    "typeScale",
    "displayZoom",
    "diagonalInches"
  ];
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (typeof record[k] === "number" && Number.isFinite(record[k])) {
      out[k] = record[k] as number;
    }
  }
  return out;
}

function isDeviceKindSetting(value: unknown): value is DeviceKindSetting {
  return (
    value === "auto" ||
    value === "panel" ||
    value === "mobile" ||
    value === "tablet"
  );
}

function isSmallLanding(value: unknown): value is "compass" | "track" {
  return value === "compass" || value === "track";
}

function parseTargetProfile(raw: unknown): TargetDisplayProfile | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const layout = decodeLayoutDocument(record.layout);
  const compass = decodeCompassOverrides(record.compass);
  const next: TargetDisplayProfile = {
    ...(typeof record.displayFactor === "number"
      ? { displayFactor: record.displayFactor }
      : {}),
    ...(isDeviceKindSetting(record.deviceKind) ? { deviceKind: record.deviceKind } : {}),
    ...(isSmallLanding(record.smallLanding) ? { smallLanding: record.smallLanding } : {}),
    ...(compass !== null ? { compass } : {}),
    ...(isHomeModeSetting(record.homeMode) && record.homeMode !== "auto"
      ? { homeMode: record.homeMode }
      : {}),
    ...(layout !== null ? { layout } : {}),
    ...parseScaleDials(record)
  };
  return Object.keys(next).length > 0 ? next : null;
}

function parseCustomProfile(raw: unknown): CustomDisplayProfile | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const layout = decodeLayoutDocument(record.layout);
  const compass = decodeCompassOverrides(record.compass);
  const next: CustomDisplayProfile = {
    ...(typeof record.widthPx === "number" ? { widthPx: record.widthPx } : {}),
    ...(typeof record.heightPx === "number" ? { heightPx: record.heightPx } : {}),
    ...(typeof record.displayFactor === "number"
      ? { displayFactor: record.displayFactor }
      : {}),
    ...(isDeviceKindSetting(record.deviceKind) ? { deviceKind: record.deviceKind } : {}),
    ...(isSmallLanding(record.smallLanding) ? { smallLanding: record.smallLanding } : {}),
    ...(compass !== null ? { compass } : {}),
    ...(isHomeModeSetting(record.homeMode) && record.homeMode !== "auto"
      ? { homeMode: record.homeMode }
      : {}),
    ...(layout !== null ? { layout } : {}),
    ...parseScaleDials(record)
  };
  return Object.keys(next).length > 0 ? next : null;
}

/** The remote scope stores its own layout AND its own scale dials
 *  (touch/type), edited and reset independently of every native screen.
 *  Rationale (ruling 2026-08-04): a browser session on a 70" TV wants
 *  bigger touch/type without touching the native panel, and vice versa -
 *  the whole point of the two-scope model. (diagonalInches stays a native
 *  physical fact and is not routed to remote; a browser has no fixed panel
 *  size, and the remote target key is not diagonal-derived.) */
export interface RemoteDisplayProfile extends ScaleDials {
  readonly layout?: LayoutDocument;
}

function parseRemoteProfile(raw: unknown): RemoteDisplayProfile | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const layout = decodeLayoutDocument(record.layout);
  const dials = parseScaleDials(record);
  const hasAny = layout !== null || Object.keys(dials).length > 0;
  if (!hasAny) return null;
  return { ...dials, ...(layout !== null ? { layout } : {}) };
}

/** Parse gateway `ui.profile` blob into typed settings. */
export function parseDisplayProfileSettings(
  raw: unknown
): DisplayProfileSettings | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const byTargetRaw = record.byTarget;
  const customRaw = record.custom;
  const byTarget: Record<string, TargetDisplayProfile> = {};
  if (byTargetRaw !== null && typeof byTargetRaw === "object" && !Array.isArray(byTargetRaw)) {
    for (const [key, value] of Object.entries(byTargetRaw)) {
      const parsed = parseTargetProfile(value);
      if (parsed !== null) {
        byTarget[key] = parsed;
      }
    }
  }
  const custom = parseCustomProfile(customRaw);
  const remote = parseRemoteProfile(record.remote);
  if (Object.keys(byTarget).length === 0 && custom === null && remote === null) {
    return null;
  }
  return {
    ...(Object.keys(byTarget).length > 0 ? { byTarget } : {}),
    ...(custom !== null ? { custom } : {}),
    ...(remote !== null ? { remote } : {})
  };
}

export function readDisplayPresetId(settings: Record<string, unknown>): string | null {
  const raw = settings[UI_DISPLAY_PRESET_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function readNativeTargetKey(settings: Record<string, unknown>): string | null {
  const raw = settings[UI_NATIVE_TARGET_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Merge a designer preview into `ui.profile.custom`. */
export function mergeCustomDisplayProfile(
  current: DisplayProfileSettings | null,
  patch: CustomDisplayProfile
): DisplayProfileSettings {
  const nextCustom: CustomDisplayProfile = { ...(current?.custom ?? {}), ...patch };
  return {
    ...(current?.byTarget ? { byTarget: { ...current.byTarget } } : {}),
    custom: nextCustom,
    ...(current?.remote ? { remote: { ...current.remote } } : {})
  };
}

/** Merge fields for a target key "WxH@diagonal" (resolution + size). */
export function mergeTargetDisplayProfile(
  current: DisplayProfileSettings | null,
  targetKey: string,
  patch: TargetDisplayProfile
): DisplayProfileSettings {
  const existing = current?.byTarget?.[targetKey] ?? {};
  return {
    byTarget: {
      ...(current?.byTarget ?? {}),
      [targetKey]: { ...existing, ...patch }
    },
    ...(current?.custom ? { custom: { ...current.custom } } : {}),
    ...(current?.remote ? { remote: { ...current.remote } } : {})
  };
}

/** Merge the remote scope's layout. `layout: undefined` is the reset:
 *  the slot empties and the remote screen falls back to the derived
 *  full-reference default. Native scopes are untouched - the two
 *  scopes edit and reset independently by ruling. */
export function mergeRemoteDisplayProfile(
  current: DisplayProfileSettings | null,
  patch: RemoteDisplayProfile
): DisplayProfileSettings {
  return {
    ...(current?.byTarget ? { byTarget: { ...current.byTarget } } : {}),
    ...(current?.custom ? { custom: { ...current.custom } } : {}),
    remote: { ...(current?.remote ?? {}), ...patch }
  };
}

/** Preferred deviceKind from stored profile (target key wins over custom). */
export function deviceKindFromProfile(
  profile: DisplayProfileSettings | null,
  targetKey: string | null
): DeviceKindSetting | null {
  if (targetKey && profile?.byTarget?.[targetKey]?.deviceKind != null) {
    return profile.byTarget[targetKey].deviceKind!;
  }
  if (profile?.custom?.deviceKind != null) {
    return profile.custom.deviceKind;
  }
  return null;
}
