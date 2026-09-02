import { useCallback, useEffect, useState } from "preact/hooks";
import {
  GatewayClient,
  UiSettingsRevisionConflictError
} from "../core/gateway-client";
import { usePresentation } from "../runtime/presentation-context";
import {
  deviceKindFromProfile,
  mergeCustomDisplayProfile,
  mergeTargetDisplayProfile,
  parseDisplayProfileSettings,
  readDisplayPresetId,
  UI_NATIVE_TARGET_KEY,
  UI_PROFILE_SETTINGS_KEY
} from "../runtime/ui-profile";
import type { DeviceKindSetting } from "../runtime/presentation-target";
import { readDesignerTheme } from "../runtime/designer-appearance";
import { t } from "../runtime/i18n";

export type DesignerApplyState = "idle" | "saving" | "saved" | "error";

/** Load gateway profile into presentation context (designer + device). */
export function useDesignerProfileSync(client: GatewayClient): {
  applyState: DesignerApplyState;
  applyMessage: string | null;
  applyPreviewProfile: () => Promise<void>;
} {
  const {
    profileSettings,
    deviceKindSetting,
    viewportOverride,
    plan,
    setPresetId,
    setProfileSettings,
    setDeviceKindSetting
  } = usePresentation();
  const [applyState, setApplyState] = useState<DesignerApplyState>("idle");
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [settingsRevision, setSettingsRevision] = useState<number | null>(null);

  const hydrateFromSettings = useCallback(
    (settings: Record<string, unknown>) => {
      const parsed = parseDisplayProfileSettings(settings[UI_PROFILE_SETTINGS_KEY]);
      setProfileSettings(parsed);
      const runtimePresetId = readDisplayPresetId(settings);
      if (runtimePresetId !== null) {
        setPresetId(runtimePresetId);
      }
      const storedKind = deviceKindFromProfile(parsed, null);
      if (storedKind != null) {
        setDeviceKindSetting(storedKind);
      }
    },
    [setDeviceKindSetting, setPresetId, setProfileSettings]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.getUiSettings();
        if (cancelled) {
          return;
        }
        setSettingsRevision(payload.revision);
        hydrateFromSettings(payload.settings);
      } catch {
        // Mock/offline — designer preview still works locally.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, hydrateFromSettings]);

  const patchProfile = useCallback(
    async (
      nextProfile: ReturnType<typeof mergeCustomDisplayProfile>,
      extraSettings: Record<string, unknown> = {}
    ) => {
      setApplyState("saving");
      setApplyMessage(null);
      const changes = { [UI_PROFILE_SETTINGS_KEY]: nextProfile, ...extraSettings };
      try {
        const payload = await client.patchUiSettings(
          changes,
          settingsRevision ?? undefined
        );
        setSettingsRevision(payload.revision);
        setProfileSettings(parseDisplayProfileSettings(payload.settings[UI_PROFILE_SETTINGS_KEY]));
        setApplyState("saved");
        setApplyMessage(t("designer.saved"));
      } catch (error) {
        if (error instanceof UiSettingsRevisionConflictError) {
          try {
            const latest = await client.getUiSettings();
            setSettingsRevision(latest.revision);
            const retry = await client.patchUiSettings(
              changes,
              latest.revision
            );
            setSettingsRevision(retry.revision);
            setProfileSettings(parseDisplayProfileSettings(retry.settings[UI_PROFILE_SETTINGS_KEY]));
            setApplyState("saved");
            setApplyMessage(t("designer.saved"));
            return;
          } catch {
            // fall through
          }
        }
        setApplyState("error");
        setApplyMessage(t("designer.saveFailed"));
      }
    },
    [client, settingsRevision, setProfileSettings]
  );

  const applyPreviewProfile = useCallback(async () => {
    // Native per-target visual config committed against the (resolution,
    // size) key. The scale DIALS (touchFloorMm/touchScale/typeScale) are NOT
    // stamped here: they are scope-routed by their own sliders
    // (mergeScopedDial - native -> byTarget, remote -> ui.profile.remote) and
    // already live in profileSettings. Re-stamping the resolved plan dial
    // into the native target clobbered native with whatever scope was being
    // previewed (a remote touch edit leaked onto the panel).
    const dials = {
      deviceKind: deviceKindSetting,
      smallLanding: plan.smallLanding,
      displayFactor: plan.displayFactor
    };

    const nextProfile =
      plan.targetKey != null
        ? mergeTargetDisplayProfile(profileSettings, plan.targetKey, dials)
        : mergeCustomDisplayProfile(profileSettings, {
            ...dials,
            ...(plan.diagonalInches != null ? { diagonalInches: plan.diagonalInches } : {}),
            ...(viewportOverride != null
              ? {
                  widthPx: viewportOverride.widthPx,
                  heightPx: viewportOverride.heightPx
                }
              : {})
          });

    // Applying with a catalogue screen selected DECLARES the device's
    // attached display identity - vendor-free, as the target key
    // "WxH@diagonal" (the designer never cites hardware). This is the
    // producer the consumers always assumed existed: the panel session
    // derives diagonal -> target key -> its byTarget layout from it,
    // and the /native mirror derives the glass geometry from it.
    // Operator declaration stands until the DRM/EDID probe supplies
    // the same fact from hardware. Custom sizes declare nothing.
    //
    // THEME rides Apply too (consolidation slice 2, 2026-07-14): the
    // picker previews instantly via the designer override; Apply
    // makes the previewed theme the DEVICE theme (ui.theme) - the
    // designer is the appearance authority, Settings no longer
    // carries a theme select.
    const previewTheme = readDesignerTheme();
    await patchProfile(nextProfile, {
      ...(plan.targetKey != null ? { [UI_NATIVE_TARGET_KEY]: plan.targetKey } : {}),
      ...(previewTheme != null ? { "ui.theme": previewTheme } : {})
    });
  }, [
    deviceKindSetting,
    patchProfile,
    plan.targetKey,
    plan.smallLanding,
    plan.displayFactor,
    plan.diagonalInches,
    profileSettings,
    viewportOverride
  ]);

  return { applyState, applyMessage, applyPreviewProfile };
}

export function designerApplyLabel(state: DesignerApplyState): string {
  switch (state) {
    case "saving":
      return t("designer.applySaving");
    case "saved":
      return t("designer.applyApplied");
    default:
      return t("designer.applyIdle");
  }
}

export function isDeviceKindSetting(value: string): value is DeviceKindSetting {
  return value === "auto" || value === "panel" || value === "mobile" || value === "tablet";
}
