const DEFAULT_VOLUME = 40;
const VOLUME_STEP = 5;
const MIN_VOLUME_STEP = 1;
const MAX_VOLUME_STEP = 20;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOLUME;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function nextVolumeFromDelta(
  currentVolume: number | undefined,
  delta: number
): number {
  const base = typeof currentVolume === "number" ? currentVolume : DEFAULT_VOLUME;
  return clampVolume(base + delta);
}

export function resolveMuteToggleVolume(
  currentVolume: number | undefined,
  lastNonZeroVolume: number | undefined
): { targetVolume: number; nextRememberedVolume: number } {
  const safeCurrent = clampVolume(typeof currentVolume === "number" ? currentVolume : DEFAULT_VOLUME);
  const safeRemembered = clampVolume(
    typeof lastNonZeroVolume === "number" ? lastNonZeroVolume : DEFAULT_VOLUME
  );

  if (safeCurrent > 0) {
    return {
      targetVolume: 0,
      nextRememberedVolume: safeCurrent
    };
  }

  const restore = safeRemembered > 0 ? safeRemembered : DEFAULT_VOLUME;
  return {
    targetVolume: restore,
    nextRememberedVolume: restore
  };
}

export const PLAYBACK_VOLUME_STEP = VOLUME_STEP;

export function normalizeVolumeStep(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return VOLUME_STEP;
  }
  return Math.max(MIN_VOLUME_STEP, Math.min(MAX_VOLUME_STEP, Math.round(value)));
}
