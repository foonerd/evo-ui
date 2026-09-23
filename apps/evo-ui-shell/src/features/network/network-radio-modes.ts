// The glass says what this radio can do and tells the truth about a
// beaconing access point whatever its interface is called.
//
// The radio's modes come from network.nm.wifi_devices (the hardware's
// supported interface modes and whether the phy carries a station and an
// access point at once). Which row IS the access point comes from
// network.nm.status: the connected row whose connection is the hotspot
// profile, or whose ip4 method is shared - never from the interface name.
// The home station is chosen only after that row is set aside.

import { deviceConnected, type DeviceTableRow, type WifiDeviceRow } from "./network-nm-decoders.ts";

/** The device's default hotspot profile name when the intent leaves
 *  fallback.hotspot_connection_name blank. */
export const DEFAULT_HOTSPOT_CONNECTION = "evo-network-hotspot";

/** One physical radio has three modes; "unknown" is an empty radio list,
 *  and the page then says nothing rather than guessing. */
export type RadioMode = "unknown" | "station-only" | "one-role" | "both-at-once";

function listsAp(d: WifiDeviceRow): boolean {
  return d.interfaceModes.some((m) => m.trim().toLowerCase() === "ap");
}

export function radioMode(devices: ReadonlyArray<WifiDeviceRow>): RadioMode {
  if (devices.length === 0) return "unknown";
  if (!devices.some(listsAp)) return "station-only";
  return devices.some((d) => d.supportsManagedPlusAp) ? "both-at-once" : "one-role";
}

/** `ap`, `ap0`, `ap1` — the virtual access-point interface. It is
 *  not a station, so it is never the preferred Wi-Fi radio. A
 *  physical radio keeps its own name while it is beaconing. */
export function isVirtualApIfname(ifname: string): boolean {
  const n = ifname.trim().toLowerCase();
  if (!n.startsWith("ap")) return false;
  const rest = n.slice(2);
  return rest.length === 0 || /^[0-9]+$/.test(rest);
}

/** Station radios: every reported interface except the virtual
 *  access-point one. */
export function stationRadioIfnames(devices: ReadonlyArray<{ ifname: string }>): string[] {
  return devices.map((d) => d.ifname).filter((n) => !isVirtualApIfname(n));
}

export function hotspotConnectionName(configured: string): string {
  const n = configured.trim();
  return n.length > 0 ? n : DEFAULT_HOTSPOT_CONNECTION;
}

/** A connected row is the access point when its connection is the hotspot
 *  profile or it is a Wi-Fi row whose address is the shared (hotspot)
 *  kind. The open recovery profile has its own name and a shared address,
 *  so it reads as the access point too. A disconnected hotspot profile is
 *  not an access point, and a cable sharing its uplink is not one either. */
export function isHotspotRow(row: DeviceTableRow, hotspotName: string): boolean {
  if (!deviceConnected(row.state)) return false;
  const connection = (row.connection ?? "").trim();
  if (connection.length > 0 && connection === hotspotName) return true;
  const wireless = /wifi|wireless/i.test(row.kind ?? "");
  return wireless && (row.ip4Method ?? "").trim().toLowerCase() === "shared";
}

export function findHotspotRow(
  rows: ReadonlyArray<DeviceTableRow>,
  hotspotName: string
): DeviceTableRow | null {
  return rows.find((r) => isHotspotRow(r, hotspotName)) ?? null;
}

/** The home station: the row named in the intent, else the first Wi-Fi
 *  row - with the access point row set aside first, so a radio that is
 *  the access point is never painted as the station. */
export function findStationRow(
  rows: ReadonlyArray<DeviceTableRow>,
  intentIfname: string,
  hotspotName: string
): DeviceTableRow | null {
  const candidates = rows.filter((r) => !isHotspotRow(r, hotspotName));
  const named = intentIfname.trim();
  const byName = named.length > 0 ? candidates.find((r) => r.ifname === named) : undefined;
  if (byName !== undefined) return byName;
  return candidates.find((r) => /wifi|wireless/i.test(r.kind ?? "")) ?? null;
}

/** The access point's name: the beacon SSID the device reports for that
 *  row, then the saved name, then null (the tile says Unnamed). */
export function apDisplayName(row: DeviceTableRow | null, savedName: string): string | null {
  const live = (row?.ssid ?? "").trim();
  if (live.length > 0) return live;
  const saved = savedName.trim();
  return saved.length > 0 ? saved : null;
}
