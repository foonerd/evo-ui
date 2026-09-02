import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { SessionScope } from "./session-scope.ts";
import {
  applyPresentationPlanToRoot,
  buildPresentationPlan,
  readViewport,
  type DeviceKindSetting,
  type DisplayProfileSettings,
  type PresentationPlan,
  type ResolvedDeviceKind,
  type Viewport
} from "./presentation-target.ts";

export interface PresentationViewportOverride {
  readonly widthPx: number;
  readonly heightPx: number;
}

interface PresentationContextValue {
  readonly plan: PresentationPlan;
  readonly viewportOverride: PresentationViewportOverride | null;
  readonly presetId: string | null;
  readonly profileSettings: DisplayProfileSettings | null;
  readonly deviceKindSetting: DeviceKindSetting;
  readonly matrixDeviceKind: ResolvedDeviceKind | null;
  readonly diagonalInches: number | null;
  readonly dialTargetKey: string | null;
  readonly dialScope: SessionScope;
  setViewportOverride: (next: PresentationViewportOverride | null) => void;
  setPresetId: (id: string | null) => void;
  setProfileSettings: (next: DisplayProfileSettings | null) => void;
  setDeviceKindSetting: (next: DeviceKindSetting) => void;
  setMatrixDeviceKind: (next: ResolvedDeviceKind | null) => void;
  setDiagonalInches: (next: number | null) => void;
  setDialTargetKey: (next: string | null) => void;
  setDialScope: (next: SessionScope) => void;
}

const PresentationContext = createContext<PresentationContextValue | null>(null);

function resolveViewport(
  override: PresentationViewportOverride | null
): Viewport {
  if (override !== null) {
    return { widthPx: override.widthPx, heightPx: override.heightPx };
  }
  return readViewport();
}

export function PresentationProvider({
  children,
  initialViewportOverride = null,
  initialPresetId = null,
  initialDeviceKindSetting = "auto",
  initialProfileSettings = null,
  initialDiagonalInches = null,
  initialDialTargetKey = null,
  initialDialScope = "native"
}: {
  children: ComponentChildren;
  initialViewportOverride?: PresentationViewportOverride | null;
  initialPresetId?: string | null;
  initialDeviceKindSetting?: DeviceKindSetting;
  initialProfileSettings?: DisplayProfileSettings | null;
  initialDiagonalInches?: number | null;
  initialDialTargetKey?: string | null;
  initialDialScope?: SessionScope;
}) {
  const [viewportOverride, setViewportOverride] = useState(
    initialViewportOverride
  );
  const [presetId, setPresetId] = useState<string | null>(initialPresetId);
  const [profileSettings, setProfileSettings] = useState<DisplayProfileSettings | null>(
    initialProfileSettings
  );
  const [deviceKindSetting, setDeviceKindSetting] = useState<DeviceKindSetting>(
    initialDeviceKindSetting
  );
  const [matrixDeviceKind, setMatrixDeviceKind] = useState<ResolvedDeviceKind | null>(
    null
  );
  const [diagonalInches, setDiagonalInches] = useState<number | null>(
    initialDiagonalInches
  );
  const [dialTargetKey, setDialTargetKey] = useState<string | null>(
    initialDialTargetKey
  );
  const [dialScope, setDialScope] = useState<SessionScope>(initialDialScope);
  const [windowTick, setWindowTick] = useState(0);

  useEffect(() => {
    if (viewportOverride !== null || typeof window === "undefined") {
      return;
    }
    const onResize = () => setWindowTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [viewportOverride]);

  const plan = useMemo(
    () =>
      buildPresentationPlan({
        viewport: resolveViewport(viewportOverride),
        presetId,
        profileSettings,
        deviceKindSetting,
        matrixDeviceKind,
        diagonalInches,
        dialTargetKey,
        dialScope
      }),
    [
      viewportOverride?.widthPx,
      viewportOverride?.heightPx,
      presetId,
      profileSettings,
      deviceKindSetting,
      matrixDeviceKind,
      diagonalInches,
      dialTargetKey,
      dialScope,
      windowTick
    ]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    applyPresentationPlanToRoot(plan);
  }, [plan]);

  const value = useMemo(
    (): PresentationContextValue => ({
      plan,
      viewportOverride,
      presetId,
      profileSettings,
      deviceKindSetting,
      matrixDeviceKind,
      diagonalInches,
      dialTargetKey,
      dialScope,
      setViewportOverride,
      setPresetId,
      setProfileSettings,
      setDeviceKindSetting,
      setMatrixDeviceKind,
      setDiagonalInches,
      setDialTargetKey,
      setDialScope
    }),
    [plan, viewportOverride, presetId, profileSettings, deviceKindSetting, matrixDeviceKind, diagonalInches, dialTargetKey, dialScope]
  );

  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}

export function usePresentation(): PresentationContextValue {
  const ctx = useContext(PresentationContext);
  if (ctx === null) {
    throw new Error("usePresentation requires PresentationProvider");
  }
  return ctx;
}

/** Safe read when provider may be absent (should not happen in production). */
export function usePresentationPlan(): PresentationPlan {
  const ctx = useContext(PresentationContext);
  if (ctx !== null) {
    return ctx.plan;
  }
  return buildPresentationPlan({ viewport: readViewport() });
}
