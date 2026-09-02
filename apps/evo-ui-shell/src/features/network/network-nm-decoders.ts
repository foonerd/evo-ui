/** Decoders for networking.link / network.nm.* wire responses. */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(
  o: Record<string, unknown>,
  key: string
): string | null {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function boolField(o: Record<string, unknown>, key: string, d = false): boolean {
  const v = o[key];
  return typeof v === "boolean" ? v : d;
}

export interface ScanApRow {
  ssid: string;
  signal: number | null;
  security: string | null;
  band: string | null;
  active: boolean;
}

/** Human label for the wire band code (ghz2_4|ghz5|ghz6|unknown).
 *  Returns null for unknown/absent so the UI can omit it. */
export function bandLabel(code: string | null): string | null {
  switch (code) {
    case "ghz2_4":
      return "2.4 GHz";
    case "ghz5":
      return "5 GHz";
    case "ghz6":
      return "6 GHz";
    default:
      return null;
  }
}

/** Count of APs the operator's band filter removed from the last scan,
 *  from the scan response's band_gate block. Lets the UI show an honest
 *  "(N hidden by band filter)" note instead of a silently shorter list. */
export interface BandGateDrop {
  droppedAvailable: number;
  droppedCandidates: number;
}

export function decodeBandGate(raw: unknown): BandGateDrop | null {
  if (!isObject(raw)) return null;
  const bg = isObject(raw["band_gate"]) ? raw["band_gate"] : null;
  if (bg === null) return null;
  const num = (k: string): number =>
    typeof bg[k] === "number" && Number.isFinite(bg[k] as number)
      ? (bg[k] as number)
      : 0;
  return {
    droppedAvailable: num("dropped_available"),
    droppedCandidates: num("dropped_candidates")
  };
}

export interface NetworkIntent {
  version: number;
  ethernet: {
    enabled: boolean;
    device: string;
    ipv4_mode: string;
    ipv4_address: string;
    ipv4_gateway: string;
    ipv4_dns: string[];
  };
  wifi: {
    ifname: string;
    role: string;
    sta_ssid: string;
    sta_open: boolean;
    sta_hidden: boolean;
    sta_ipv4_mode: string;
    sta_ipv4_address: string;
    sta_ipv4_gateway: string;
    sta_ipv4_dns: string[];
    sta_mac_random: boolean;
    ap_ssid: string;
    ap_channel: number;
    ap_band: string;
  };
  fallback: {
    hotspot_enabled: boolean;
    hotspot_connection_name: string;
    hotspot_ifname: string;
    hotspot_fallback: boolean;
  };
  radio_policy: {
    flight_mode: boolean;
    wifi_enabled_pref: boolean;
    country: string;
    band_2ghz: boolean;
    band_5ghz: boolean;
    band_6ghz: boolean;
  };
}

export function emptyIntent(): NetworkIntent {
  return {
    version: 1,
    ethernet: {
      enabled: true,
      device: "",
      ipv4_mode: "dhcp",
      ipv4_address: "",
      ipv4_gateway: "",
      ipv4_dns: []
    },
    wifi: {
      ifname: "wlan0",
      role: "sta",
      sta_ssid: "",
      sta_open: false,
      sta_hidden: false,
      sta_ipv4_mode: "dhcp",
      sta_ipv4_address: "",
      sta_ipv4_gateway: "",
      sta_ipv4_dns: [],
      sta_mac_random: false,
      ap_ssid: "",
      ap_channel: 4,
      ap_band: ""
    },
    fallback: {
      hotspot_enabled: true,
      hotspot_connection_name: "",
      hotspot_ifname: "",
      hotspot_fallback: false
    },
    radio_policy: {
      flight_mode: false,
      wifi_enabled_pref: true,
      country: "",
      band_2ghz: true,
      band_5ghz: true,
      band_6ghz: true
    }
  };
}

export function decodeScanAvailable(raw: unknown): ScanApRow[] {
  if (!isObject(raw)) return [];
  const list = raw["available"];
  if (!Array.isArray(list)) return [];
  const out: ScanApRow[] = [];
  for (const row of list) {
    if (!isObject(row)) continue;
    const ssid = stringField(row, "ssid");
    if (ssid === null) continue;
    const signalRaw = row["signal"];
    const signal =
      typeof signalRaw === "number"
        ? signalRaw
        : typeof signalRaw === "string"
          ? Number(signalRaw)
          : null;
    out.push({
      ssid,
      signal: Number.isFinite(signal) ? signal : null,
      security: stringField(row, "security"),
      band: stringField(row, "band"),
      active: boolField(row, "active", false)
    });
  }
  return out;
}

function decodeDns(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function decodeIntent(raw: unknown): NetworkIntent | null {
  if (!isObject(raw)) return null;
  const intentRaw = isObject(raw["intent"]) ? raw["intent"] : raw;
  if (!isObject(intentRaw)) return null;
  const base = emptyIntent();
  const eth = isObject(intentRaw["ethernet"]) ? intentRaw["ethernet"] : {};
  const wifi = isObject(intentRaw["wifi"]) ? intentRaw["wifi"] : {};
  const fallback = isObject(intentRaw["fallback"])
    ? intentRaw["fallback"]
    : {};
  const radio = isObject(intentRaw["radio_policy"])
    ? intentRaw["radio_policy"]
    : {};
  return {
    version:
      typeof intentRaw["version"] === "number" ? intentRaw["version"] : 1,
    ethernet: {
      enabled: boolField(eth, "enabled", true),
      device:
        stringField(eth, "device") ?? stringField(eth, "ifname") ?? "",
      ipv4_mode: stringField(eth, "ipv4_mode") ?? "dhcp",
      ipv4_address: stringField(eth, "ipv4_address") ?? "",
      ipv4_gateway: stringField(eth, "ipv4_gateway") ?? "",
      ipv4_dns: decodeDns(eth["ipv4_dns"])
    },
    wifi: {
      ifname: stringField(wifi, "ifname") ?? "wlan0",
      role: stringField(wifi, "role") ?? "sta",
      sta_ssid: stringField(wifi, "sta_ssid") ?? "",
      sta_open: boolField(wifi, "sta_open", false),
      sta_hidden: boolField(wifi, "sta_hidden", false),
      sta_ipv4_mode: stringField(wifi, "sta_ipv4_mode") ?? "dhcp",
      sta_ipv4_address: stringField(wifi, "sta_ipv4_address") ?? "",
      sta_ipv4_gateway: stringField(wifi, "sta_ipv4_gateway") ?? "",
      sta_ipv4_dns: decodeDns(wifi["sta_ipv4_dns"]),
      sta_mac_random: boolField(wifi, "sta_mac_random", false),
      ap_ssid: stringField(wifi, "ap_ssid") ?? "",
      ap_channel:
        typeof wifi["ap_channel"] === "number" ? wifi["ap_channel"] : 4,
      ap_band: stringField(wifi, "ap_band") ?? ""
    },
    fallback: {
      hotspot_enabled: boolField(fallback, "hotspot_enabled", true),
      hotspot_connection_name:
        stringField(fallback, "hotspot_connection_name") ?? "",
      hotspot_ifname: stringField(fallback, "hotspot_ifname") ?? "",
      hotspot_fallback: boolField(fallback, "hotspot_fallback", false)
    },
    radio_policy: {
      flight_mode: boolField(radio, "flight_mode", base.radio_policy.flight_mode),
      wifi_enabled_pref: boolField(
        radio,
        "wifi_enabled_pref",
        true
      ),
      country: stringField(radio, "country") ?? "",
      band_2ghz: boolField(radio, "band_2ghz", true),
      band_5ghz: boolField(radio, "band_5ghz", true),
      band_6ghz: boolField(radio, "band_6ghz", true)
    }
  };
}

export function decodeFlightEnabled(raw: unknown): boolean | null {
  if (!isObject(raw)) return null;
  const fm = raw["flight_mode"];
  if (typeof fm === "boolean") return fm;
  if (isObject(fm) && typeof fm["enabled"] === "boolean") return fm["enabled"];
  return null;
}

export interface WifiDeviceRow {
  ifname: string;
  phy: string | null;
  supportsManagedPlusAp: boolean;
  isVirtualAp: boolean;
}

// network.nm.wifi_devices returns { radios: [ WifiRadio ] } where each
// WifiRadio = { ifname, phy, capability: { supports_managed_plus_ap, ... },
// connection_class, is_ap_vif }. The prior decoder read the wrong keys
// (`devices`, top-level `supports_managed_plus_ap`, `is_virtual_ap_vif`)
// so it always returned [] against the real serializer - the preferred-
// radio picker and the STA+AP concurrency hint were dead.
export function decodeWifiDevices(raw: unknown): WifiDeviceRow[] {
  if (!isObject(raw)) return [];
  const list = Array.isArray(raw["radios"])
    ? raw["radios"]
    : Array.isArray(raw["devices"])
      ? raw["devices"]
      : null;
  if (list === null) return [];
  const out: WifiDeviceRow[] = [];
  for (const row of list) {
    if (!isObject(row)) continue;
    const ifname = stringField(row, "ifname");
    if (ifname === null) continue;
    const cap = isObject(row["capability"]) ? row["capability"] : row;
    out.push({
      ifname,
      phy: stringField(row, "phy") ?? stringField(cap, "phy"),
      supportsManagedPlusAp: boolField(cap, "supports_managed_plus_ap", false),
      isVirtualAp:
        boolField(row, "is_ap_vif", false) ||
        boolField(row, "is_virtual_ap_vif", false)
    });
  }
  return out;
}

/** Reachability verdict from network.nm.supervisor.status
 *  ({ supervisor: { reachability } }); the connectivity pill's
 *  four-state truth. Falls back to "unknown". */
export type Reachability =
  | "unknown"
  | "online"
  | "portal"
  | "limited"
  | "offline";

export interface NetworkReachability {
  reachability: Reachability;
  ipAddress: string | null;
  gateway: string | null;
  portalUrl: string | null;
}

function asReachability(v: unknown): Reachability {
  return v === "online" ||
    v === "portal" ||
    v === "limited" ||
    v === "offline"
    ? v
    : "unknown";
}

export function decodeReachability(raw: unknown): NetworkReachability | null {
  if (!isObject(raw)) return null;
  const sup = isObject(raw["supervisor"]) ? raw["supervisor"] : raw;
  if (!isObject(sup)) return null;
  const portal = isObject(sup["portal"]) ? sup["portal"] : null;
  return {
    reachability: asReachability(sup["reachability"]),
    ipAddress: null,
    gateway: null,
    portalUrl: portal !== null ? stringField(portal, "portal_url") : null
  };
}

/** IP-level detail from network.refresh_connectivity
 *  ({ connectivity: { ip_address, default_gateway, ... } }). */
export function decodeConnectivity(
  raw: unknown
): { ipAddress: string | null; gateway: string | null } | null {
  if (!isObject(raw)) return null;
  const c = isObject(raw["connectivity"]) ? raw["connectivity"] : raw;
  if (!isObject(c)) return null;
  return {
    ipAddress: stringField(c, "ip_address"),
    gateway: stringField(c, "default_gateway")
  };
}

/** Per-interface row from supervisor.status `devices[]`. State is the
 *  NM device state string (e.g. "connected", "disconnected"). `ip4` is
 *  the per-interface address IF the device table carries it (framework
 *  follow-up); null until then, in which case the UI falls back to the
 *  default-route IP from reachability for the active uplink. */
export interface DeviceTableRow {
  ifname: string;
  kind: string | null;
  state: string | null;
  connection: string | null;
  ip4: string | null; // primary address as CIDR
  ip4Method: string | null; // auto|manual|disabled|link-local|shared
  gateway4: string | null;
  dns4: string[];
  domains: string[];
  ssid: string | null; // live associated SSID (wifi devices), device truth
}

export function decodeDeviceTable(raw: unknown): DeviceTableRow[] {
  if (!isObject(raw)) return [];
  const sup = isObject(raw["supervisor"]) ? raw["supervisor"] : raw;
  const list = isObject(sup) && Array.isArray(sup["devices"])
    ? sup["devices"]
    : Array.isArray((raw as Record<string, unknown>)["devices"])
      ? ((raw as Record<string, unknown>)["devices"] as unknown[])
      : null;
  if (list === null) return [];
  const out: DeviceTableRow[] = [];
  for (const row of list) {
    if (!isObject(row)) continue;
    const ifname = stringField(row, "device") ?? stringField(row, "ifname");
    if (ifname === null) continue;
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    // network.nm.status (797ce3a) ships ip4 as a structured object
    // { method, addresses:[cidr], gateway, dns:[], domains:[] }. Keep a
    // back-compat path for the earlier `ip4: string` shape.
    const ip4obj = isObject(row["ip4"]) ? row["ip4"] : null;
    const ip4Legacy = typeof row["ip4"] === "string" ? (row["ip4"] as string) : null;
    const addresses = ip4obj ? strArr(ip4obj["addresses"]) : [];
    out.push({
      ifname,
      kind: stringField(row, "type") ?? stringField(row, "kind"),
      state: stringField(row, "state"),
      connection: stringField(row, "connection"),
      ip4: (addresses.length > 0 ? addresses[0] : null) ?? ip4Legacy ?? stringField(row, "ip4_address"),
      ip4Method: ip4obj ? stringField(ip4obj, "method") : null,
      gateway4: ip4obj
        ? stringField(ip4obj, "gateway")
        : stringField(row, "gateway4") ?? stringField(row, "ip4_gateway") ?? stringField(row, "gateway"),
      dns4: ip4obj
        ? strArr(ip4obj["dns"])
        : strArr(row["dns4"]).length > 0
          ? strArr(row["dns4"])
          : strArr(row["ip4_dns"]),
      domains: ip4obj ? strArr(ip4obj["domains"]) : [],
      ssid: isObject(row["wifi"]) ? stringField(row["wifi"], "ssid") : null
    });
  }
  return out;
}

export function deviceConnected(state: string | null): boolean {
  if (state === null) return false;
  return /connected|activated/i.test(state) && !/disconnected/i.test(state);
}

/** An AP is open when it advertises no security. The device labels open
 *  APs "open" (or empty / "--" / "none"); those join with no password. */
export function isOpen(security: string | null): boolean {
  if (security === null) return true;
  const s = security.trim().toLowerCase();
  return s === "" || s === "open" || s === "--" || s === "none";
}

/** One field of the portal's parsed form, as discovered device-side and
 *  handed to the UI to render. Hidden fields (CSRF tokens) are stripped
 *  server-side and never appear here - the device re-merges them on
 *  submit. */
export interface CaptiveField {
  name: string;
  type: string; // text | password | email | tel | number | checkbox | radio | select
  label: string | null;
  required: boolean;
  options: string[] | null; // for select / radio
  value: string | null; // prefill / default
}

export interface CaptiveForm {
  action: string | null;
  method: string; // POST | GET
  fields: CaptiveField[];
}

/** A backend-provided action the UI renders as a button (e.g.
 *  confirm_replay). The action model is the device's, not inferred from
 *  free-form text. */
export interface CaptiveAction {
  id: string;
  label: string;
}

export interface CaptiveStatus {
  phase: string;
  captive: boolean;
  portalUrl: string | null;
  /** The portal can't be handled as a static form (captcha / JS-only /
   *  MFA / SSO) - the UI must say so plainly rather than pretend. */
  requiresInteractive: boolean;
  requiresUserConfirmation: boolean;
  form: CaptiveForm | null;
  actions: CaptiveAction[];
  lastError: string | null;
  secondsRemaining: number | null;
  bytesRemaining: number | null;
}

function numField(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decodeCaptiveField(raw: unknown): CaptiveField | null {
  if (!isObject(raw)) return null;
  const name = stringField(raw, "name");
  if (name === null) return null;
  const type = (stringField(raw, "type") ?? "text").toLowerCase();
  if (type === "hidden" || type === "submit" || type === "button") return null;
  const optsRaw = raw["options"];
  const options = Array.isArray(optsRaw)
    ? optsRaw.filter((x): x is string => typeof x === "string")
    : [];
  return {
    name,
    type,
    label: stringField(raw, "label"),
    required: boolField(raw, "required", false),
    options: options.length > 0 ? options : null,
    value: stringField(raw, "value")
  };
}

function decodeCaptiveForm(raw: unknown): CaptiveForm | null {
  if (!isObject(raw)) return null;
  const fields: CaptiveField[] = [];
  const fieldsRaw = raw["fields"];
  if (Array.isArray(fieldsRaw)) {
    for (const f of fieldsRaw) {
      const d = decodeCaptiveField(f);
      if (d !== null) fields.push(d);
    }
  }
  return {
    action: stringField(raw, "action"),
    method: (stringField(raw, "method") ?? "POST").toUpperCase(),
    fields
  };
}

function decodeCaptiveActions(raw: unknown): CaptiveAction[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptiveAction[] = [];
  for (const a of raw) {
    if (!isObject(a)) continue;
    const id = stringField(a, "id");
    if (id === null) continue;
    out.push({ id, label: stringField(a, "label") ?? id });
  }
  return out;
}

// Build the values map to submit: operator-entered values, else the
// field's device-provided default; empties (unchecked boxes, blanks) are
// dropped so the portal sees absence, matching real form semantics. The
// device re-merges the hidden fields it holds - the UI never sends them.
export function collectCaptiveValues(
  form: CaptiveForm | null,
  vals: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  if (form === null) return { ...vals };
  for (const f of form.fields) {
    const v = f.name in vals ? vals[f.name] : (f.value ?? "");
    if (v !== "") out[f.name] = v;
  }
  return out;
}

export function decodeCaptiveStatus(raw: unknown): CaptiveStatus | null {
  if (!isObject(raw)) return null;
  const c = isObject(raw["captive"]) ? raw["captive"] : raw;
  if (!isObject(c)) return null;
  return {
    phase: stringField(c, "phase") ?? "idle",
    captive: boolField(c, "captive", false),
    portalUrl: stringField(c, "user_portal_url") ?? stringField(c, "portal_url"),
    requiresInteractive: boolField(c, "requires_interactive", false),
    requiresUserConfirmation: boolField(c, "requires_user_confirmation", false),
    form: decodeCaptiveForm(c["form"]),
    actions: decodeCaptiveActions(c["actions"]),
    lastError: stringField(c, "last_error"),
    secondsRemaining: numField(c, "seconds_remaining"),
    bytesRemaining: numField(c, "bytes_remaining")
  };
}
