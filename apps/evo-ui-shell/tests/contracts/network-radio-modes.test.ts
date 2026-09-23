// Contract: Settings -> Network says what this radio can do - station
// only, one role at a time, or both at once - from
// network.nm.wifi_devices, and tells the truth about a beaconing access
// point whatever its interface is called. The Access point tile is on for
// the connected row whose connection is the hotspot profile or whose ip4
// method is shared; its name is the beacon SSID, then the saved name, then
// Unnamed. The Wi-Fi tile never calls that row the home station. A
// station-only radio offers no access point. An empty radio list says
// nothing. The captive page keeps its own station filter byte for byte.
// Run:
//   node --experimental-strip-types --test tests/contracts/network-radio-modes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeDeviceTable,
  decodeWifiDevices,
  type DeviceTableRow
} from "../../src/features/network/network-nm-decoders.ts";
import {
  DEFAULT_HOTSPOT_CONNECTION,
  apDisplayName,
  findHotspotRow,
  findStationRow,
  hotspotConnectionName,
  isHotspotRow,
  isVirtualApIfname,
  radioMode,
  stationRadioIfnames
} from "../../src/features/network/network-radio-modes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const landing = readFileSync(join(root, "features", "network", "NetworkLanding.tsx"), "utf8");
const captive = readFileSync(join(root, "features", "network", "CaptivePortal.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

// One radio as network.nm.wifi_devices reports it. Names are placeholders.
function radio(modes: string[], both: boolean, ifname = "wlan0"): Record<string, unknown> {
  return {
    ifname,
    phy: "phy0",
    capability: {
      phy: "phy0",
      supports_managed_plus_ap: both,
      max_channels: 1,
      interface_modes: modes,
      bands: { ghz_2_4: true, ghz_5: true, ghz_6: false }
    },
    connection_class: "onboard",
    is_ap_vif: false
  };
}

// One device row as network.nm.status reports it.
function row(
  ifname: string,
  state: string,
  connection: string | null,
  method: string | null,
  ssid: string | null
): Record<string, unknown> {
  const r: Record<string, unknown> = { device: ifname, type: "wifi", state, connection: connection ?? "" };
  if (method !== null) r.ip4 = { method, addresses: ["10.42.0.1/24"], gateway: null, dns: [], domains: [] };
  if (ssid !== null) r.wifi = { ssid };
  return r;
}

function rows(list: Record<string, unknown>[]): DeviceTableRow[] {
  return decodeDeviceTable({ devices: list });
}

test("the decoder keeps interface_modes instead of dropping it on the floor", () => {
  const both = decodeWifiDevices({ radios: [radio(["managed", "AP"], true)] });
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].interfaceModes, ["managed", "AP"]);
  assert.equal(both[0].supportsManagedPlusAp, true);
  const station = decodeWifiDevices({ radios: [radio(["managed"], false)] });
  assert.deepEqual(station[0].interfaceModes, ["managed"]);
  const bare = decodeWifiDevices({ radios: [{ ifname: "wlan0" }] });
  assert.deepEqual(bare[0].interfaceModes, []);
});

test("the radio mode is what the hardware says, and an empty list says nothing", () => {
  assert.equal(radioMode([]), "unknown");
  assert.equal(radioMode(decodeWifiDevices({ radios: [radio(["managed"], false)] })), "station-only");
  assert.equal(radioMode(decodeWifiDevices({ radios: [radio(["managed", "AP"], false)] })), "one-role");
  assert.equal(radioMode(decodeWifiDevices({ radios: [radio(["managed", "ap"], false)] })), "one-role");
  assert.equal(radioMode(decodeWifiDevices({ radios: [radio(["managed", "AP"], true)] })), "both-at-once");
  // Two interfaces on one radio (station + vif) still read as one radio's modes.
  assert.equal(
    radioMode(decodeWifiDevices({ radios: [radio(["managed", "AP"], true), radio(["managed", "AP"], true, "ap0")] })),
    "both-at-once"
  );
});

test("the hotspot profile name defaults when the intent leaves it blank", () => {
  assert.equal(DEFAULT_HOTSPOT_CONNECTION, "evo-network-hotspot");
  assert.equal(hotspotConnectionName(""), "evo-network-hotspot");
  assert.equal(hotspotConnectionName("  "), "evo-network-hotspot");
  assert.equal(hotspotConnectionName("house-ap"), "house-ap");
});

test("a beaconing wlan0 is the access point, whatever it is called", () => {
  const hs = hotspotConnectionName("");
  const [r] = rows([row("wlan0", "connected", "evo-network-hotspot", "shared", "beacon-name")]);
  assert.equal(isHotspotRow(r, hs), true);
  const found = findHotspotRow(rows([row("wlan0", "connected", "evo-network-hotspot", "shared", "beacon-name")]), hs);
  assert.ok(found !== null);
  assert.equal(found?.ifname, "wlan0");
  assert.equal(found?.ip4, "10.42.0.1/24");
  assert.equal(apDisplayName(found, "saved-name"), "beacon-name");
});

test("the open recovery profile is the access point by its shared address, not its name", () => {
  const hs = hotspotConnectionName("");
  const [r] = rows([row("wlan0", "connected", "evo-network-hotspot-recovery", "shared", "beacon-name")]);
  assert.equal(isHotspotRow(r, hs), true);
});

test("a cable sharing its uplink is not an access point", () => {
  const hs = hotspotConnectionName("");
  const [eth] = decodeDeviceTable({
    devices: [
      {
        device: "eth0",
        type: "ethernet",
        state: "connected",
        connection: "wired-share",
        ip4: { method: "shared", addresses: ["10.42.0.1/24"], gateway: null, dns: [], domains: [] }
      }
    ]
  });
  assert.equal(isHotspotRow(eth, hs), false);
});

test("both at once keeps the vif row as the access point", () => {
  const hs = hotspotConnectionName("");
  const table = rows([
    row("wlan0", "connected", "evo-network-wifi-sta", "auto", "home-network"),
    row("ap0", "connected", "evo-network-hotspot", "shared", "beacon-name")
  ]);
  const ap = findHotspotRow(table, hs);
  assert.equal(ap?.ifname, "ap0");
  const station = findStationRow(table, "wlan0", hs);
  assert.equal(station?.ifname, "wlan0");
  assert.equal(station?.ssid, "home-network");
});

test("the Wi-Fi tile excludes the hotspot row before it chooses the station", () => {
  const hs = hotspotConnectionName("");
  const table = rows([row("wlan0", "connected", "evo-network-hotspot", "shared", "beacon-name")]);
  assert.equal(findStationRow(table, "wlan0", hs), null);
  // A disconnected station row is still the station row: not connected, not the hotspot.
  const idle = rows([row("wlan0", "disconnected", null, null, null)]);
  assert.equal(findStationRow(idle, "wlan0", hs)?.ifname, "wlan0");
  assert.equal(isHotspotRow(idle[0], hs), false);
});

test("a disconnected hotspot profile is not an access point, and Off carries no address", () => {
  const hs = hotspotConnectionName("");
  const table = rows([row("wlan0", "disconnected", "evo-network-hotspot", null, null)]);
  assert.equal(findHotspotRow(table, hs), null);
  assert.equal(apDisplayName(null, "saved-name"), "saved-name");
  assert.equal(apDisplayName(null, "   "), null);
});

test("the name is the beacon SSID, then the saved name, then nothing", () => {
  const [named] = rows([row("wlan0", "connected", "evo-network-hotspot", "shared", "beacon-name")]);
  const [nameless] = rows([row("wlan0", "connected", "evo-network-hotspot", "shared", null)]);
  assert.equal(apDisplayName(named, "saved-name"), "beacon-name");
  assert.equal(apDisplayName(nameless, "saved-name"), "saved-name");
  assert.equal(apDisplayName(nameless, ""), null);
});

test("the preferred Wi-Fi radio is never the virtual access-point interface", () => {
  assert.equal(isVirtualApIfname("ap0"), true);
  assert.equal(isVirtualApIfname("ap"), true);
  assert.equal(isVirtualApIfname("wlan0"), false);
  assert.deepEqual(stationRadioIfnames([{ ifname: "ap0" }, { ifname: "wlan0" }]), ["wlan0"]);
  assert.ok(/stationRadioIfnames\(/.test(landing), "the preferred radio list drops the virtual interface");
});

test("the landing paints the tiles through the role predicates, never a name test", () => {
  assert.ok(/radioMode\(/.test(landing), "the mode line reads radioMode");
  assert.ok(/findHotspotRow\(/.test(landing), "the Access point tile reads findHotspotRow");
  assert.ok(/findStationRow\(/.test(landing), "the Wi-Fi tile reads findStationRow");
  assert.ok(/apDisplayName\(/.test(landing), "the Access point name goes through apDisplayName");
  assert.ok(!/\/\^ap\//.test(landing), "no interface-name test decides a tile on the landing");
  assert.ok(/settings\.network\.radioStationOnly/.test(landing), "station only is said on the page");
  assert.ok(/settings\.network\.radioOneRole/.test(landing), "one role at a time is said on the page");
  assert.ok(/settings\.network\.radioBothAtOnce/.test(landing), "both at once is said on the page");
  assert.ok(/settings\.network\.apNotOffered/.test(landing), "a station-only radio says so on the tile");
  // A station-only radio offers no enable item: the kebab is gated on the mode.
  assert.ok(/mode !== "station-only"/.test(landing), "the Access point kebab is gated on the radio mode");
});

test("the four strings exist and are plain ASCII", () => {
  for (const key of [
    "settings.network.radioStationOnly",
    "settings.network.radioOneRole",
    "settings.network.radioBothAtOnce",
    "settings.network.apNotOffered"
  ]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

test("the captive page keeps its own station filter byte for byte", () => {
  assert.ok(
    /\(\/wifi\|wireless\/i\.test\(d\.kind \?\? ""\) && !\/\^ap\/i\.test\(d\.ifname\)\)/.test(captive),
    "CaptivePortal.tsx still filters the station by name; not this row"
  );
});
