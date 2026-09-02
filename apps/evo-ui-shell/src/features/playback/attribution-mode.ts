// Attribution link mode - a global device choice, not a per-widget one.
//
// On the kiosk build the fullscreen browser has no chrome, so an external
// attribution link strands the operator off the main screen with no way
// back. The mode gates how every AttributionLine renders its reference:
//   link - clickable, opens externally (remote / browser sessions)
//   qr   - source name + an on-device QR to the URL; scan to open the
//          reference on a phone, no navigation (kiosk-safe)
//   name - source name + license only
//
// Default qr on the appliance. Centralised here so every AttributionLine
// agrees; the System settings toggle (next slice) drives setAttributionMode.

export type AttributionMode = "link" | "qr" | "name";

let mode: AttributionMode = "qr";

export function attributionMode(): AttributionMode {
  return mode;
}

export function setAttributionMode(next: AttributionMode): void {
  mode = next;
}
