// KioskCalibrationHost - the glass-side half of "Calibrate touch on the
// player". A remote paired browser fires the launch_touch_calibration
// wire op; the plugin writes /var/lib/evo/settings/kiosk/calibrate_trigger;
// the kiosk-browser's poll loop stats that file and, on mtime change,
// dispatches the `evo:touch-calibration-launch` CustomEvent on window.
// THIS host - mounted once at the app root ON THE GLASS ONLY - opens the
// full-screen wizard on that event, wherever the operator's screen is, so
// the remote launch is not a visible no-op on the device.
//
// Delivery note: the wire op + trigger file are live (org.evoframework.
// system.kiosk on .24); the browser poll loop that emits the window event
// is a flagged kiosk-side follow-on. Until it ships this event never
// fires, so the host is a safe no-op - no coupled release: the wizard
// starts auto-opening the moment the browser loop lands. (Meanwhile a
// remote operator can still recalibrate via the advanced touch controls,
// which drive set_touch_calibration directly.)
//
// Mirrors the window-event contract already used for the derived-result
// hand-back (evo:touch-calibration-derived in kiosk-bridge.ts).

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { TouchCalibrationWizard } from "./TouchCalibrationWizard";

const LAUNCH_EVENT = "evo:touch-calibration-launch";

export function KioskCalibrationHost(): JSX.Element | null {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onLaunch = (): void => setOpen(true);
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    return () => window.removeEventListener(LAUNCH_EVENT, onLaunch);
  }, []);

  if (!open) return null;
  return <TouchCalibrationWizard onClose={() => setOpen(false)} />;
}
