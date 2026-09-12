// Glass detection for the kiosk browser (WPE WebKit).
//
// This module used to be the write bridge: it posted to the kiosk
// browser's native message handlers, which apply display rotation and
// touch calibration in-process. Those writes reach the same overlay files
// the system.kiosk plugin verbs write, through the same evo-kiosk-config
// crate - but in-process means they never pass the framework dispatcher,
// so no capability gate and no household policy could refuse them. Every
// one of them has moved onto the verbs; what is left here is detection.
//
// window.webkit handlers exist ONLY inside the on-device kiosk browser, so
// their presence is a reliable "am I the glass" signal, and their absence
// off-device is why this whole module is inert in a paired browser.

export type Rotation = "0" | "90" | "180" | "270";

export interface CalibrationSample {
  target_x: number;
  target_y: number;
  actual_x: number;
  actual_y: number;
}

interface Handler {
  postMessage: (message: string) => void;
}
interface KioskHandlers {
  /// Read as a PRESENCE PROBE only - never posted to. Its presence is
  /// what distinguishes the on-device kiosk browser from any other
  /// browser; the browser registers others too, and this module
  /// deliberately does not name them.
  evo_set_display_rotation?: Handler;
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

// No display-rotation writer lives here any more. It used to postMessage
// evo_set_display_rotation, which reaches evo_kiosk_config::set_display_rotation
// inside the kiosk-browser process - the same overlay the plugin verb writes,
// but without passing the framework dispatcher, so no capability or household
// gate could refuse it. Display & Touch now dispatches the system.kiosk verb
// from the glass exactly as from a remote browser. The handler is still
// registered by the browser (see evo-kiosk-eng); this module simply does not
// offer the UI a way back onto it.

// No touch writers live here any more either. The wizard's reset and its
// derive both go over the system.kiosk verbs now, so this module offers
// the UI no ungated write of any kind - what remains is the glass/remote
// probe below and nothing else.
//
// The kiosk-browser dropped the two touch script-message handlers
// (evo_set_touch_calibration, evo_sample_touch_calibration_from_corners); its
// current binary registers only evo_set_display_rotation, and that slot is a
// PRESENCE PROBE, not a writer this module posts to. Glass and VM now run that
// binary (evo-kiosk-eng 75796d9). The NUC was not overlaid, and testers on
// Latest still have the old piece (all three handlers) until a remint is named.
// Either way no evo UI code reaches for any of them, so which handlers a given
// binary honours is a kiosk-eng matter, not this module's.
