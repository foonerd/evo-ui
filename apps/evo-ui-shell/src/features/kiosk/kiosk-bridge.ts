// Bridge to the kiosk browser's native message handlers (WPE WebKit).
// These exist ONLY inside the on-device kiosk browser; a paired laptop or
// phone has no window.webkit handlers, so every entry point here is a
// safe no-op off-device and the whole Display & Touch panel is hidden via
// inKioskBrowser(). Handlers are fire-and-forget (postMessage on an
// unregistered handler is silently dropped, so shipping the UI ahead of
// the kiosk-browser rollout is safe). The calibration wizard's result is
// delivered back only as a DOM event, never a return value.

export type Rotation = "0" | "90" | "180" | "270";

export interface CalibrationSample {
  target_x: number;
  target_y: number;
  actual_x: number;
  actual_y: number;
}

export interface DerivedCalibration {
  ok: boolean;
  rotation: Rotation;
  hflip: boolean;
  vflip: boolean;
  mean_error: number;
}

interface Handler {
  postMessage: (message: string) => void;
}
interface KioskHandlers {
  evo_set_display_rotation?: Handler;
  evo_set_touch_calibration?: Handler;
  evo_sample_touch_calibration_from_corners?: Handler;
}

function handlers(): KioskHandlers | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { webkit?: { messageHandlers?: KioskHandlers } };
  return typeof w.webkit === "object" && w.webkit !== null
    ? w.webkit.messageHandlers
    : undefined;
}

function hasGlassHandlers(): boolean {
  const h = handlers();
  return (
    h !== undefined &&
    typeof h.evo_set_display_rotation?.postMessage === "function"
  );
}

/** Which mechanism the Display & Touch panel dispatches through:
 *  - "glass": on-device kiosk browser (WebKit handlers present) - controls
 *    apply locally, the calibration wizard runs on this screen.
 *  - "remote": any other browser - controls apply to the player over the
 *    system.kiosk WS verbs, and calibration is launched ON the player's own
 *    screen (a laptop/phone tap can't sample the device digitiser).
 *  The `?kiosksettings=1` opt-in is RETIRED (2026-08-04): Display & Touch is
 *  a normal Settings section, always available; a plain browser dispatches
 *  the same way a paired one did. */
export function kioskMode(): "glass" | "remote" {
  return hasGlassHandlers() ? "glass" : "remote";
}

/** Display & Touch is always available now (normal Settings section). Kept as
 *  a named predicate for the few call sites that gated on it. */
export function inKioskBrowser(): boolean {
  return true;
}

/** Persist + apply display orientation. Fire-and-forget: the display
 *  physically rotating (~1s) is the only confirmation. */
export function setDisplayRotation(rotation: Rotation): void {
  handlers()?.evo_set_display_rotation?.postMessage(rotation);
}

/** Batched touch calibration: all three fields in one call. Idempotent. */
export function setTouchCalibration(
  rotation: Rotation,
  hflip: boolean,
  vflip: boolean
): void {
  handlers()?.evo_set_touch_calibration?.postMessage(
    JSON.stringify({ rotation, hflip, vflip })
  );
}

/** Submit four normalised corner samples; resolves with the native-derived
 *  calibration via the `evo:touch-calibration-derived` DOM event (5s
 *  timeout). Samples MUST be captured with calibration reset to identity. */
export function sampleTouchFromCorners(
  samples: CalibrationSample[]
): Promise<DerivedCalibration> {
  return new Promise((resolve, reject) => {
    const h = handlers();
    if (h?.evo_sample_touch_calibration_from_corners === undefined) {
      reject(new Error("kiosk handler unavailable"));
      return;
    }
    const timeout = setTimeout(() => {
      window.removeEventListener("evo:touch-calibration-derived", onDerived);
      reject(new Error("wizard timeout"));
    }, 5000);
    const onDerived = (ev: Event): void => {
      clearTimeout(timeout);
      resolve((ev as CustomEvent<DerivedCalibration>).detail);
    };
    window.addEventListener("evo:touch-calibration-derived", onDerived, {
      once: true
    });
    h.evo_sample_touch_calibration_from_corners.postMessage(
      JSON.stringify({ samples })
    );
  });
}
