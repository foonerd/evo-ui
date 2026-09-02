// Info-first network landing: read-only tiles (Ethernet / Wi-Fi / Access
// point / Advanced) whose kebab menus open focused change/manage popups.
// Each apply runs a heartbeat then the tile reflects the change on the
// next refresh. Bearer-scoped verbs come from useNetworkLink.
//
// Data notes: per-interface IP comes from the supervisor device table's
// `ip4` when present (framework follow-up); until then we fall back to
// static-from-intent, then the default-route IP for the active uplink,
// then a dash. The AP address is the fixed NM shared subnet gateway.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  Wifi,
  Cable,
  Router,
  SlidersHorizontal,
  MoreVertical,
  Lock,
  Unlock,
  EyeOff
} from "lucide-preact";
import { Modal } from "../../components/dialogs";
import { PasswordField } from "../../components/PasswordField";
import { EvoSelect } from "../../components/EvoSelect";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useNetworkLink } from "./useNetworkLink";
import {
  bandLabel,
  deviceConnected,
  isOpen,
  type DeviceTableRow,
  type NetworkIntent
} from "./network-nm-decoders";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import { CaptivePortal } from "./CaptivePortal";
import { HeartbeatMark } from "../../components/HeartbeatMark";

const AP_GATEWAY = "10.42.0.1";

type Link = ReturnType<typeof useNetworkLink>;
type Popup =
  | null
  | { kind: "ethIp" }
  | { kind: "wifiIp" }
  | { kind: "wifiConnect" }
  | { kind: "wifiHidden" }
  | { kind: "wifiForget" }
  | { kind: "apEdit" }
  | { kind: "apDisable" };

function up(s: string): string {
  return s.toUpperCase();
}

// Tiles show the plain address; the /prefix belongs in the edit form.
function ipOnly(v: string | null): string | null {
  if (v === null) return null;
  const s = v.split("/")[0].trim();
  return s.length > 0 ? s : null;
}

// The intent stores the address as CIDR ("192.168.1.50/24"), but the
// operator sees plain "IP address" + "Subnet mask" like every OS and
// router - the word CIDR never reaches the screen. These convert.
function splitCidr(v: string): { addr: string; prefix: number | null } {
  const s = v.trim();
  if (s === "") return { addr: "", prefix: null };
  const slash = s.indexOf("/");
  if (slash < 0) return { addr: s, prefix: null };
  const p = s.slice(slash + 1);
  return { addr: s.slice(0, slash), prefix: /^\d+$/.test(p) ? Number(p) : null };
}
function prefixToMask(prefix: number): string {
  const p = Math.max(0, Math.min(32, prefix));
  const bits = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  return [24, 16, 8, 0].map((sh) => (bits >>> sh) & 255).join(".");
}
function maskToPrefix(mask: string): number | null {
  const parts = mask.trim().split(".");
  if (parts.length !== 4 || parts.some((x) => !/^\d+$/.test(x) || Number(x) > 255)) {
    return null;
  }
  let bits = 0;
  for (const x of parts) bits = ((bits << 8) | Number(x)) >>> 0;
  let count = 0;
  let seenZero = false;
  for (let k = 31; k >= 0; k -= 1) {
    if (((bits >>> k) & 1) === 1) {
      if (seenZero) return null;
      count += 1;
    } else {
      seenZero = true;
    }
  }
  return count;
}

function Sticker({
  label,
  tone
}: {
  label: string;
  tone: "ok" | "warn" | "accent" | "muted";
}): JSX.Element {
  return <span className={"net-sticker net-sticker-" + tone}>{label}</span>;
}

function Kebab({
  label,
  items
}: {
  label: string;
  items: { icon?: JSX.Element; text: string; danger?: boolean; onClick: () => void }[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="net-kebab-wrap">
      <button
        type="button"
        className="net-kebab"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size={18} />
      </button>
      {open ? (
        <>
          <div className="net-kebab-scrim" onClick={() => setOpen(false)} />
          <div className="net-kebab-menu" role="menu">
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                className={"net-mi" + (it.danger ? " net-mi-danger" : "")}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon}
                <span>{it.text}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function NetworkLanding(): JSX.Element {
  useLocale();
  const link = useNetworkLink();
  const [popup, setPopup] = useState<Popup>(null);
  const [pairOpen, setPairOpen] = useState(false);

  const intent = link.intent;
  const dt = link.deviceTable;
  // network.nm.status carries every interface's IP + state. When it hasn't
  // answered yet (empty table - e.g. the verb is blocked during NM churn),
  // show "Checking" rather than falsely asserting Disconnected with no IP.
  const dtLoaded = dt.length > 0;
  const ethRow = dt.find((d) => /ethernet/i.test(d.kind ?? "") || /^(eth|en)/i.test(d.ifname));
  const wifiRow = dt.find((d) => d.ifname === intent.wifi.ifname || (/wifi|wireless/i.test(d.kind ?? "") && !/^ap/i.test(d.ifname)));
  const apRow = dt.find((d) => /^ap/i.test(d.ifname));

  const ethConnected = deviceConnected(ethRow?.state ?? null);
  const wifiConnected = deviceConnected(wifiRow?.state ?? null);
  const defaultIp = link.reachability?.ipAddress ?? null;

  const ethIp = ipOnly(
    ethRow?.ip4 ??
      (intent.ethernet.ipv4_mode === "static" && intent.ethernet.ipv4_address
        ? intent.ethernet.ipv4_address
        : ethConnected
          ? defaultIp
          : null)
  );
  const wifiIp = ipOnly(
    wifiRow?.ip4 ??
      (intent.wifi.sta_ipv4_mode === "static" && intent.wifi.sta_ipv4_address
        ? intent.wifi.sta_ipv4_address
        : wifiConnected
          ? ethConnected
            ? null
            : defaultIp
          : null)
  );

  // The device is the truth for what Wi-Fi is actually connected to. Fall
  // back to the saved intent SSID only when the radio isn't associated
  // (saved-but-offline). Prevents the "Not connected + live IP" mismatch
  // when intent and device disagree (e.g. Forget cleared intent but the
  // NM profile is still auto-joined).
  const liveSsid = wifiConnected ? (wifiRow?.ssid ?? intent.wifi.sta_ssid.trim()) : "";
  const savedSsid = intent.wifi.sta_ssid.trim();
  const wifiSsid = liveSsid || savedSsid;
  const hasWifi = wifiConnected || savedSsid.length > 0;
  const apEnabled = intent.fallback.hotspot_enabled;
  const apName = intent.wifi.ap_ssid.trim();
  const apIp = ipOnly(apRow?.ip4 ?? AP_GATEWAY) ?? AP_GATEWAY;

  const close = (): void => setPopup(null);

  const authError = link.error !== null && /step.?up|scope|permission|denied|unauthori|not.hold/i.test(link.error);

  return (
    <>
      {authError ? (
        <div className="net-notice">
          <span>{t("settings.network.authNeeded")}</span>
          <button type="button" className="settings-link-button" onClick={() => setPairOpen(true)}>
            {t("settings.network.pairToManage")}
          </button>
        </div>
      ) : null}

      <CaptivePortal link={link} />

      <div className="net-tiles">
        <div className="net-tile">
          <div className="net-tile-head">
            <Cable size={20} className="net-tile-icon" />
            <span className="net-tile-title">{t("settings.network.ethernet")}</span>
            <Sticker label={up(intent.ethernet.ipv4_mode)} tone={intent.ethernet.ipv4_mode === "static" ? "warn" : "ok"} />
            <Kebab
              label={t("settings.network.ethernet")}
              items={[{ text: t("settings.network.changeIp"), onClick: () => setPopup({ kind: "ethIp" }) }]}
            />
          </div>
          <div className="net-tile-ip">{ethIp ?? (!dtLoaded ? t("settings.network.checking") : ethConnected ? t("settings.network.connected") : "—")}</div>
          <div className="net-tile-sub">{(ethRow?.ifname ?? "eth0") + " · " + (!dtLoaded ? t("settings.network.checking") : ethConnected ? t("settings.network.connected") : t("settings.network.disconnected"))}</div>
        </div>

        <div className="net-tile">
          <div className="net-tile-head">
            <Wifi size={20} className="net-tile-icon" />
            <span className="net-tile-title">{t("settings.network.wifi")}</span>
            {hasWifi ? (
              <Sticker label={up(intent.wifi.sta_ipv4_mode)} tone={intent.wifi.sta_ipv4_mode === "static" ? "warn" : "ok"} />
            ) : null}
            <Kebab
              label={t("settings.network.wifi")}
              items={[
                { icon: <Wifi size={16} />, text: t("settings.network.connectWifi"), onClick: () => { setPopup({ kind: "wifiConnect" }); void link.scan(); } },
                { icon: <EyeOff size={16} />, text: t("settings.network.connectHidden"), onClick: () => setPopup({ kind: "wifiHidden" }) },
                ...(hasWifi
                  ? [
                      { icon: <Router size={16} />, text: t("settings.network.changeIp"), onClick: () => setPopup({ kind: "wifiIp" }) },
                      ...(wifiConnected
                        ? [{ text: t("settings.network.disconnect"), onClick: () => void link.disconnectWifi() }]
                        : []),
                      { text: t("settings.network.forget"), danger: true, onClick: () => setPopup({ kind: "wifiForget" }) }
                    ]
                  : [])
              ]}
            />
          </div>
          <div className="net-tile-name">{!dtLoaded && !hasWifi ? t("settings.network.checking") : hasWifi ? wifiSsid : t("settings.network.notConnectedWifi")}</div>
          <div className="net-tile-ip">{wifiIp ?? (!dtLoaded ? t("settings.network.checking") : wifiConnected ? t("settings.network.connected") : "—")}</div>
          <div className="net-tile-sub">{intent.wifi.ifname + " · " + (!dtLoaded ? t("settings.network.checking") : wifiConnected ? t("settings.network.connected") : hasWifi ? t("settings.network.saved") : t("settings.network.disconnected"))}</div>
        </div>

        <div className="net-tile">
          <div className="net-tile-head">
            <Router size={20} className="net-tile-icon" />
            <span className="net-tile-title">{t("settings.network.accessPoint")}</span>
            <Sticker label={apEnabled ? t("settings.network.enabled") : t("settings.network.disabled")} tone={apEnabled ? "accent" : "muted"} />
            <Kebab
              label={t("settings.network.accessPoint")}
              items={
                apEnabled
                  ? [
                      { icon: <Router size={16} />, text: t("settings.network.changeApName"), onClick: () => setPopup({ kind: "apEdit" }) },
                      { text: t("settings.network.disableAp"), danger: true, onClick: () => setPopup({ kind: "apDisable" }) }
                    ]
                  : [{ icon: <Router size={16} />, text: t("settings.network.enableAp"), onClick: () => setPopup({ kind: "apEdit" }) }]
              }
            />
          </div>
          <div className="net-tile-name">{apEnabled ? (apName || t("settings.network.unnamedAp")) : t("settings.network.apOff")}</div>
          {apEnabled ? <div className="net-tile-ip">{apIp}</div> : null}
          <div className="net-tile-sub">{(apRow?.ifname ?? "ap0") + " · " + (apEnabled ? t("settings.network.startsOnBoot") : t("settings.network.off"))}</div>
        </div>

        <AdvancedTile link={link} />
      </div>

      {popup !== null ? (
        <PopupHost popup={popup} link={link} onClose={close} ethRow={ethRow} wifiRow={wifiRow} />
      ) : null}
      {pairOpen ? (
        <PairDeviceFlow
          onClose={() => setPairOpen(false)}
          onPaired={() => {
            setPairOpen(false);
            link.reauth();
          }}
        />
      ) : null}
    </>
  );
}

function AdvancedTile({ link }: { link: Link }): JSX.Element {
  const intent = link.intent;
  const rp = intent.radio_policy;
  const radios = link.devices.filter((d) => !d.isVirtualAp).map((d) => d.ifname);
  const physical = radios.length > 0 ? radios : [intent.wifi.ifname];

  const applyRadio = (patch: Partial<NetworkIntent["radio_policy"]>): void => {
    void link.saveAndApply({ ...intent, radio_policy: { ...rp, ...patch } });
  };
  const setBand = (which: "band_2ghz" | "band_5ghz" | "band_6ghz"): void => {
    applyRadio({ [which]: !rp[which] } as Partial<NetworkIntent["radio_policy"]>);
  };

  return (
    <div className="net-tile">
      <div className="net-tile-head">
        <SlidersHorizontal size={20} className="net-tile-icon" />
        <span className="net-tile-title">{t("settings.network.advanced")}</span>
      </div>
      <div className="net-adv-row">
        <span>{t("settings.network.country")}</span>
        <EvoSelect
          ariaLabel={t("settings.network.country")}
          value={rp.country || ""}
          options={[rp.country || "", "GB", "US", "DE", "FR", "NL", "IE"]
            .filter((v, i, a) => v !== "" && a.indexOf(v) === i)
            .map((c) => ({ value: c, label: c }))}
          onChange={(v) => applyRadio({ country: v })}
        />
      </div>
      <div className="net-adv-row">
        <span>{t("settings.network.bands")}</span>
        <span className="net-band-chips">
          <button type="button" className={"net-chip" + (rp.band_2ghz ? " on" : "")} onClick={() => setBand("band_2ghz")}>2.4</button>
          <button type="button" className={"net-chip" + (rp.band_5ghz ? " on" : "")} onClick={() => setBand("band_5ghz")}>5</button>
          <button type="button" className={"net-chip" + (rp.band_6ghz ? " on" : "")} onClick={() => setBand("band_6ghz")}>6&nbsp;GHz</button>
        </span>
      </div>
      <div className="net-adv-row">
        <span>{t("settings.network.preferredRadio")}</span>
        <EvoSelect
          ariaLabel={t("settings.network.preferredRadio")}
          value={intent.wifi.ifname}
          options={physical.map((r) => ({ value: r, label: r }))}
          onChange={(v) => link.saveAndApply({ ...intent, wifi: { ...intent.wifi, ifname: v } })}
        />
      </div>
      <div className="net-adv-row">
        <span>{t("settings.network.flightMode")}</span>
        <button
          type="button"
          className={"net-toggle" + (link.flightMode ? " on" : "")}
          aria-pressed={link.flightMode}
          onClick={() => void link.setFlight(!link.flightMode)}
        >
          {link.flightMode ? t("settings.network.on") : t("settings.network.off")}
        </button>
      </div>
      <div className="net-adv-row">
        <span>{t("settings.network.randomMac")}</span>
        <button
          type="button"
          className={"net-toggle" + (intent.wifi.sta_mac_random ? " on" : "")}
          aria-pressed={intent.wifi.sta_mac_random}
          onClick={() =>
            void link.saveAndApply({ ...intent, wifi: { ...intent.wifi, sta_mac_random: !intent.wifi.sta_mac_random } })
          }
        >
          {intent.wifi.sta_mac_random ? t("settings.network.on") : t("settings.network.off")}
        </button>
      </div>
      {intent.wifi.sta_mac_random ? (
        <div className="net-tile-sub">{t("settings.network.randomMacHint")}</div>
      ) : null}
      <div className="net-tile-sub">
        {link.flightMode ? t("settings.network.flightOnHint") : t("settings.network.flightOffHint")}
      </div>
    </div>
  );
}

function PopupHost({
  popup,
  link,
  onClose,
  ethRow,
  wifiRow
}: {
  popup: NonNullable<Popup>;
  link: Link;
  onClose: () => void;
  ethRow: DeviceTableRow | undefined;
  wifiRow: DeviceTableRow | undefined;
}): JSX.Element | null {
  const [hb, setHb] = useState<string | null>(null);
  const run = async (msg: string, fn: () => Promise<unknown>): Promise<void> => {
    setHb(msg);
    await fn();
    setHb(null);
    onClose();
  };

  if (hb !== null) {
    return (
      <Modal title={t("settings.network.working")} onCancel={() => {}}>
        <div className="net-heartbeat">
          <HeartbeatMark size="sm" />
          <span>{hb}</span>
        </div>
      </Modal>
    );
  }

  switch (popup.kind) {
    case "ethIp":
      return <IpForm title={t("settings.network.ethernet")} link={link} target="eth" onClose={onClose} run={run} row={ethRow} />;
    case "wifiIp":
      return <IpForm title={t("settings.network.wifi")} link={link} target="wifi" onClose={onClose} run={run} row={wifiRow} />;
    case "wifiConnect":
      return <WifiConnect link={link} onClose={onClose} run={run} />;
    case "wifiHidden":
      return <WifiHidden link={link} onClose={onClose} run={run} />;
    case "wifiForget":
      return (
        <Modal title={t("settings.network.forgetTitle", { ssid: link.intent.wifi.sta_ssid })} onCancel={onClose}>
          <p className="evo-modal-hint">{t("settings.network.forgetBody")}</p>
          <div className="evo-modal-actions">
            <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
            <button type="button" className="evo-modal-button evo-modal-button-danger" onClick={() => void run(t("settings.network.forgetting"), () => link.forgetWifi())}>{t("settings.network.forget")}</button>
          </div>
        </Modal>
      );
    case "apEdit":
      return <ApEdit link={link} onClose={onClose} run={run} />;
    case "apDisable":
      return (
        <Modal title={t("settings.network.disableApTitle")} onCancel={onClose}>
          <p className="evo-modal-hint">{t("settings.network.disableApBody")}</p>
          <div className="evo-modal-actions">
            <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
            <button type="button" className="evo-modal-button evo-modal-button-danger" onClick={() => void run(t("settings.network.disablingAp"), () => link.saveAndApply({ ...link.intent, fallback: { ...link.intent.fallback, hotspot_enabled: false } }))}>{t("settings.network.disableAp")}</button>
          </div>
        </Modal>
      );
    default:
      return null;
  }
}

function IpForm({
  title,
  link,
  target,
  onClose,
  run,
  row
}: {
  title: string;
  link: Link;
  target: "eth" | "wifi";
  onClose: () => void;
  run: (m: string, fn: () => Promise<unknown>) => Promise<void>;
  row: DeviceTableRow | undefined;
}): JSX.Element {
  const i = link.intent;
  const isEth = target === "eth";
  const curMode = isEth ? i.ethernet.ipv4_mode : i.wifi.sta_ipv4_mode;
  const curAddr = isEth ? i.ethernet.ipv4_address : i.wifi.sta_ipv4_address;
  const curGw = isEth ? i.ethernet.ipv4_gateway : i.wifi.sta_ipv4_gateway;
  const curDns = isEth ? i.ethernet.ipv4_dns : i.wifi.sta_ipv4_dns;

  // Pre-fill with the current settings so switching to Static pins the
  // lease the device is on right now: prefer the saved static value, else
  // the live effective value from the device table (address/gateway/DNS).
  const seed = splitCidr(curAddr || row?.ip4 || "");
  const [mode, setMode] = useState(curMode === "static" ? "static" : "dhcp");
  const [addr, setAddr] = useState(seed.addr);
  const [mask, setMask] = useState(prefixToMask(seed.prefix ?? 24));
  const [gw, setGw] = useState(curGw || row?.gateway4 || "");
  const [dns, setDns] = useState(
    (curDns.length > 0 ? curDns : (row?.dns4 ?? [])).join(", ")
  );

  const save = (): void => {
    const prefix = maskToPrefix(mask) ?? 24;
    const cidr = addr.trim() === "" ? "" : addr.trim() + "/" + prefix;
    const dnsList = dns.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const st = mode === "static";
    const next: NetworkIntent = isEth
      ? { ...i, ethernet: { ...i.ethernet, ipv4_mode: mode, ipv4_address: st ? cidr : "", ipv4_gateway: st ? gw.trim() : "", ipv4_dns: st ? dnsList : [] } }
      : { ...i, wifi: { ...i.wifi, sta_ipv4_mode: mode, sta_ipv4_address: st ? cidr : "", sta_ipv4_gateway: st ? gw.trim() : "", sta_ipv4_dns: st ? dnsList : [] } };
    void run(t("settings.network.applyingIp"), () => link.saveAndApply(next));
  };

  return (
    <Modal title={title + " · " + t("settings.network.ipSettings")} onCancel={onClose}>
      <div className="net-seg">
        <button type="button" className={mode === "dhcp" ? "on" : ""} onClick={() => setMode("dhcp")}>{t("settings.network.dhcp")}</button>
        <button type="button" className={mode === "static" ? "on" : ""} onClick={() => setMode("static")}>{t("settings.network.static")}</button>
      </div>
      {mode === "dhcp" ? (
        <p className="evo-modal-hint">{t("settings.network.dhcpHint")}</p>
      ) : (
        <>
          <p className="evo-modal-hint">{t("settings.network.staticHint")}</p>
          <label className="evo-modal-label">{t("settings.network.ipAddress")}
            <input className="evo-modal-input" value={addr} onInput={(e) => setAddr((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label className="evo-modal-label">{t("settings.network.subnetMask")}
            <input className="evo-modal-input" value={mask} onInput={(e) => setMask((e.currentTarget as HTMLInputElement).value)} />
            <span className="net-field-hint">{t("settings.network.maskHint")}</span>
          </label>
          <label className="evo-modal-label">{t("settings.network.router")}
            <input className="evo-modal-input" value={gw} onInput={(e) => setGw((e.currentTarget as HTMLInputElement).value)} />
            <span className="net-field-hint">{t("settings.network.routerHint")}</span>
          </label>
          <label className="evo-modal-label">{t("settings.network.dnsOptional")}
            <input className="evo-modal-input" value={dns} onInput={(e) => setDns((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </>
      )}
      <div className="evo-modal-actions">
        <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
        <button type="button" className="evo-modal-button evo-modal-button-primary" disabled={mode === "static" && (addr.trim() === "" || gw.trim() === "")} onClick={save}>{t("settings.network.save")}</button>
      </div>
    </Modal>
  );
}

function WifiConnect({
  link,
  onClose,
  run
}: {
  link: Link;
  onClose: () => void;
  run: (m: string, fn: () => Promise<unknown>) => Promise<void>;
}): JSX.Element {
  const [sel, setSel] = useState<string | null>(null);
  const [psk, setPsk] = useState("");
  const rows = link.scanRows;
  const selRow = rows.find((r) => r.ssid === sel);
  const open = selRow ? isOpen(selRow.security) : false;

  if (sel !== null && selRow) {
    return (
      <Modal title={sel} onCancel={onClose}>
        {open ? (
          <p className="evo-modal-hint">{t("settings.network.openJoinHint")}</p>
        ) : (
          <label className="evo-modal-label">{t("settings.network.psk")}
            <PasswordField className="evo-modal-input" value={psk} autofocus onInput={setPsk} />
          </label>
        )}
        <div className="evo-modal-actions">
          <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={() => setSel(null)}>{t("dialog.back")}</button>
          <button type="button" className="evo-modal-button evo-modal-button-primary" disabled={!open && psk.length === 0} onClick={() => void run(t("settings.network.joining", { ssid: sel }), () => link.joinSsid(sel, open ? "" : psk, open, false))}>{t("settings.network.join")}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("settings.network.connectWifi")} onCancel={onClose}>
      {link.busy && rows.length === 0 ? (
        <div className="net-heartbeat"><HeartbeatMark size="sm" /><span>{t("settings.network.scanning")}</span></div>
      ) : rows.length === 0 ? (
        <p className="evo-modal-hint">{t("settings.network.scanEmpty")}</p>
      ) : (
        <div className="net-scanlist">
          {rows.map((r) => {
            const o = isOpen(r.security);
            return (
              <button key={r.ssid} type="button" className="net-scan-row" onClick={() => { setSel(r.ssid); setPsk(""); }}>
                {o ? <Unlock size={15} /> : <Lock size={15} />}
                <span className="net-scan-ssid">{r.ssid}</span>
                <span className="net-scan-meta">{o ? t("settings.network.openLabel") : up(r.security ?? "")}{bandLabel(r.band) ? " · " + bandLabel(r.band) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="evo-modal-actions">
        <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={() => void link.scan()}>{t("settings.network.scan")}</button>
        <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
      </div>
    </Modal>
  );
}

function WifiHidden({
  link,
  onClose,
  run
}: {
  link: Link;
  onClose: () => void;
  run: (m: string, fn: () => Promise<unknown>) => Promise<void>;
}): JSX.Element {
  const [ssid, setSsid] = useState("");
  const [sec, setSec] = useState("wpa");
  const [psk, setPsk] = useState("");
  const open = sec === "open";
  return (
    <Modal title={t("settings.network.connectHidden")} onCancel={onClose}>
      <label className="evo-modal-label">{t("settings.network.ssid")}
        <input className="evo-modal-input" value={ssid} autofocus onInput={(e) => setSsid((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label className="evo-modal-label">{t("settings.network.security")}
        <EvoSelect
          className="evo-modal-input"
          ariaLabel={t("settings.network.security")}
          value={sec}
          options={[
            { value: "wpa", label: "WPA2 / WPA3" },
            { value: "open", label: t("settings.network.openLabel") }
          ]}
          onChange={setSec}
        />
      </label>
      {!open ? (
        <label className="evo-modal-label">{t("settings.network.psk")}
          <PasswordField className="evo-modal-input" value={psk} onInput={setPsk} />
        </label>
      ) : null}
      <div className="evo-modal-actions">
        <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
        <button type="button" className="evo-modal-button evo-modal-button-primary" disabled={ssid.trim() === "" || (!open && psk.length === 0)} onClick={() => void run(t("settings.network.joining", { ssid: ssid.trim() }), () => link.joinSsid(ssid.trim(), open ? "" : psk, open, true))}>{t("settings.network.join")}</button>
      </div>
    </Modal>
  );
}

function ApEdit({
  link,
  onClose,
  run
}: {
  link: Link;
  onClose: () => void;
  run: (m: string, fn: () => Promise<unknown>) => Promise<void>;
}): JSX.Element {
  const i = link.intent;
  const [name, setName] = useState(i.wifi.ap_ssid);
  const [psk, setPsk] = useState("");
  const wasEnabled = i.fallback.hotspot_enabled;
  return (
    <Modal title={t("settings.network.accessPoint")} onCancel={onClose}>
      <label className="evo-modal-label">{t("settings.network.apName")}
        <input className="evo-modal-input" value={name} autofocus placeholder="evo-xxxx" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label className="evo-modal-label">{t("settings.network.apPsk")}
        <PasswordField className="evo-modal-input" value={psk} onInput={setPsk} />
      </label>
      <div className="evo-modal-actions">
        <button type="button" className="evo-modal-button evo-modal-button-secondary" onClick={onClose}>{t("dialog.cancel")}</button>
        <button type="button" className="evo-modal-button evo-modal-button-primary" disabled={name.trim() === ""} onClick={() => void run(wasEnabled ? t("settings.network.restartingAp") : t("settings.network.startingAp"), () => link.saveAndApply({ ...i, fallback: { ...i.fallback, hotspot_enabled: true }, wifi: { ...i.wifi, ap_ssid: name.trim() } }, { apPsk: psk.length > 0 ? psk : undefined }))}>{t("settings.network.save")}</button>
      </div>
    </Modal>
  );
}
