import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { frameworkWsUrl, tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { storedBearer } from "../../runtime/bearer";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { t } from "../../runtime/i18n";
import {
  decodeBandGate,
  decodeCaptiveStatus,
  decodeConnectivity,
  decodeDeviceTable,
  decodeFlightEnabled,
  decodeIntent,
  decodeReachability,
  decodeScanAvailable,
  decodeWifiDevices,
  emptyIntent,
  type BandGateDrop,
  type CaptiveStatus,
  type DeviceTableRow,
  type NetworkIntent,
  type NetworkReachability,
  type ScanApRow,
  type WifiDeviceRow
} from "./network-nm-decoders";

const SHELF = "networking.link";

export type NetworkLinkVerbResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function useNetworkLink() {
  // Network settings verbs are bearer-gated (write/step-up:network_admin).
  // They MUST ride a bearer-scoped socket seeded with the paired operator
  // bearer - NOT the shared anonymous framework transport, which carries
  // no credential and would refuse every mutation regardless of pairing.
  // (This mirrors useNetworkShares, which was already bearer-scoped.)
  // `socketGen` lets reauth() rebuild the socket with a freshly stored
  // bearer (after inline pairing) WITHOUT a full-page reload - so the
  // operator stays on the network page instead of bouncing to home.
  const [socketGen, setSocketGen] = useState(0);
  const transportRef = useRef<WsTransport | null>(null);
  if (transportRef.current === null && typeof WebSocket !== "undefined") {
    transportRef.current = new WsTransport({
      url: frameworkWsUrl(),
      bearerToken: storedBearer()
    });
  }
  const transport = transportRef.current;
  // Reads that populate the tiles (status/intent/flight/devices/captive/
  // supervisor/connectivity/scan) are anonymous-OK on the framework, so
  // they MUST ride the shared page-lifetime socket - NOT the private
  // bearer socket. A stale/absent bearer (e.g. after a device restart)
  // makes the bearer handshake fail; if the reads rode it, the tiles
  // would hang on "Checking" forever even though the reads would answer
  // anonymously. The shared socket is always warm, so the tiles load on
  // every refresh. Mutations keep the private bearer socket below.
  // (Null only in the designer/tests, where we fall back to `transport`.)
  const sharedTransport = tryUseFrameworkTransport();
  // socketGen is read here only so the linter sees it used; its purpose
  // is to force a re-render (and thus a fresh socket) from reauth().
  void socketGen;
  useEffect(() => {
    return () => {
      const tr = transportRef.current;
      transportRef.current = null;
      if (tr !== null) void tr.close();
    };
  }, []);
  const reauth = useCallback(() => {
    const tr = transportRef.current;
    transportRef.current = null;
    if (tr !== null) void tr.close();
    setSocketGen((g) => g + 1);
  }, []);
  const [intent, setIntent] = useState<NetworkIntent>(emptyIntent);
  const [scanRows, setScanRows] = useState<ScanApRow[]>([]);
  const [scanDropped, setScanDropped] = useState<BandGateDrop | null>(null);
  const [flightMode, setFlightMode] = useState(false);
  const [devices, setDevices] = useState<WifiDeviceRow[]>([]);
  const [deviceTable, setDeviceTable] = useState<DeviceTableRow[]>([]);
  const [captive, setCaptive] = useState<CaptiveStatus | null>(null);
  const [reachability, setReachability] =
    useState<NetworkReachability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (
      requestType: string,
      payload: Record<string, unknown> = {}
    ): Promise<NetworkLinkVerbResult<unknown>> => {
      if (transport === null) {
        return { ok: false, message: t("library.notConnected") };
      }
      const result = await pluginRequest(
        transport,
        SHELF,
        requestType,
        payload
      );
      if (result.error !== undefined) {
        return {
          ok: false,
          message: result.error.message ?? result.error.code
        };
      }
      return { ok: true, value: result.value };
    },
    [transport]
  );

  // Read path: anonymous shared socket (falls back to the bearer socket
  // only when the shared one is absent, i.e. designer/tests). This is
  // what keeps the tiles loading fast on every refresh, bearer or not.
  const readRequest = useCallback(
    async (
      requestType: string,
      payload: Record<string, unknown> = {}
    ): Promise<NetworkLinkVerbResult<unknown>> => {
      const tr = sharedTransport ?? transport;
      if (tr === null) {
        return { ok: false, message: t("library.notConnected") };
      }
      const result = await pluginRequest(tr, SHELF, requestType, payload);
      if (result.error !== undefined) {
        return {
          ok: false,
          message: result.error.message ?? result.error.code
        };
      }
      return { ok: true, value: result.value };
    },
    [sharedTransport, transport]
  );

  // Step-up is handled centrally by the transport (an elevation refusal
  // raises the one operator-password card and retries), so these verbs
  // dispatch plainly - no per-surface gate.

  // `quiet` = a background poll: refresh the tiles from live device state
  // WITHOUT flipping the global busy/loader or surfacing transient read
  // errors. The operator-initiated refresh (mount, post-action) passes
  // no arg and behaves as before.
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) {
      setBusy(true);
      setError(null);
    }
    try {
      const [intentR, flightR, devicesR, captiveR, supR, connR, statusR] =
        await Promise.all([
          readRequest("network.nm.intent.get"),
          readRequest("network.nm.flight_mode.get"),
          readRequest("network.nm.wifi_devices"),
          readRequest("network.nm.captive.status"),
          readRequest("network.nm.supervisor.status"),
          readRequest("network.refresh_connectivity"),
          readRequest("network.nm.status")
        ]);
      // Per-interface device table (device/state/connection) lives on
      // network.nm.status, NOT supervisor.status (which carries the
      // reachability verdict + carrier observations). Decode the table
      // here so the tiles reflect real interface state.
      if (statusR.ok) setDeviceTable(decodeDeviceTable(statusR.value));
      if (intentR.ok) {
        const decoded = decodeIntent(intentR.value);
        if (decoded !== null) setIntent(decoded);
      } else {
        if (!quiet) setError(intentR.message);
      }
      if (flightR.ok) {
        const on = decodeFlightEnabled(flightR.value);
        if (on !== null) setFlightMode(on);
      }
      if (devicesR.ok) setDevices(decodeWifiDevices(devicesR.value));
      if (captiveR.ok) setCaptive(decodeCaptiveStatus(captiveR.value));
      if (supR.ok) {
        const reach = decodeReachability(supR.value);
        if (reach !== null) {
          const ip = connR.ok ? decodeConnectivity(connR.value) : null;
          setReachability({
            ...reach,
            ipAddress: ip?.ipAddress ?? reach.ipAddress,
            gateway: ip?.gateway ?? reach.gateway
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }, [readRequest]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live refresh: the device changes link state on its own (STA restore,
  // captive appearing, supervisor raising/dropping the hotspot), so the
  // tiles and the captive panel must track it without an operator action.
  // The pre-rewrite page had a manual refresh; here we poll quietly every
  // few seconds (mirrors the playback/queue snapshot hooks). Skip while a
  // mutation is in flight or the tab is hidden so we never fight an action
  // or churn in the background.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh(true);
    }, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const scan = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await readRequest("network.nm.scan", { refresh: true });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setScanRows(decodeScanAvailable(r.value));
      setScanDropped(decodeBandGate(r.value));
    } finally {
      setBusy(false);
    }
  }, [readRequest]);

  const saveAndApply = useCallback(
    async (
      next: NetworkIntent,
      opts?: { staPsk?: string; apPsk?: string }
    ) => {
      setBusy(true);
      setError(null);
      try {
        const payload: Record<string, unknown> = {
          intent: next,
          apply: true
        };
        if (opts?.staPsk !== undefined && opts.staPsk.length > 0) {
          payload.sta_psk = opts.staPsk;
        }
        if (opts?.apPsk !== undefined && opts.apPsk.length > 0) {
          payload.ap_psk = opts.apPsk;
        }
        const r = await request("network.nm.intent.set", payload);
        if (!r.ok) {
          setError(r.message);
          return false;
        }
        setIntent(next);
        await refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [request, refresh]
  );

  const setFlight = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const r = await request("network.nm.flight_mode.set", { enabled });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        setFlightMode(enabled);
      } finally {
        setBusy(false);
      }
    },
    [request]
  );

  const joinSsid = useCallback(
    async (ssid: string, psk: string, open: boolean, hidden: boolean) => {
      const next: NetworkIntent = {
        ...intent,
        wifi: {
          ...intent.wifi,
          role: "sta",
          sta_ssid: ssid,
          sta_open: open,
          sta_hidden: hidden
        },
        radio_policy: {
          ...intent.radio_policy,
          flight_mode: false
        }
      };
      return saveAndApply(next, { staPsk: open ? undefined : psk });
    },
    [intent, saveAndApply]
  );

  // Forget the saved Wi-Fi network via the dedicated device verb: the plugin
  // deletes the evo-network-wifi-sta profile, removes the STA PSK sidecar,
  // and blanks the STA intent, so NetworkManager can't auto-rejoin it.
  const forgetWifi = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await request("network.nm.wifi.forget", {});
      if (!r.ok) {
        setError(r.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [request, refresh]);

  // Disconnect the active Wi-Fi link but KEEP the saved network (framework
  // network.nm.wifi.disconnect - drops the link and suspends autoconnect
  // until an explicit reconnect; idempotent on an already-down radio).
  const disconnectWifi = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await request("network.nm.wifi.disconnect", {});
      if (!r.ok) {
        setError(r.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [request, refresh]);

  // Device-proxied captive sign-in (framework endpoint). start returns a
  // same-origin session_url the operator's browser iframes; the framework
  // proxies every request to the portal via the wlan0-bound wrapper, so the
  // remote browser never touches the venue. close re-probes reachability.
  const startCaptiveSession = useCallback(
    async (): Promise<{ sessionId: string; sessionUrl: string } | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await request("network.nm.captive.session.start", {});
        if (!r.ok) {
          setError(r.message);
          return null;
        }
        const v = (r.value ?? {}) as Record<string, unknown>;
        const sid = typeof v["session_id"] === "string" ? (v["session_id"] as string) : null;
        const url = typeof v["session_url"] === "string" ? (v["session_url"] as string) : null;
        return sid !== null && url !== null ? { sessionId: sid, sessionUrl: url } : null;
      } finally {
        setBusy(false);
      }
    },
    [request]
  );

  const closeCaptiveSession = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        await request("network.nm.captive.session.close", { session_id: sessionId });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [request, refresh]
  );

  const completeCaptive = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await request("network.nm.captive.complete", {});
      if (!r.ok) {
        setError(r.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [request, refresh]);

  // Submit the operator's captive-portal field values. The device merges
  // the hidden fields it holds and POSTs to the portal on wlan0; we never
  // send hidden tokens from here. The response carries the updated status.
  const submitCaptive = useCallback(
    async (values: Record<string, string>) => {
      setBusy(true);
      setError(null);
      try {
        // Device contract (CaptiveSubmitRequest) reads the key `form`,
        // not `values` - the operator's field map is posted verbatim to
        // the portal.
        const r = await request("network.nm.captive.submit", { form: values });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        const decoded = decodeCaptiveStatus(r.value);
        if (decoded !== null) setCaptive(decoded);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [request, refresh]
  );

  // Run a backend-provided captive action[] (e.g. confirm_replay). The
  // device owns the semantics; confirm_replay lifts the single-use guard.
  const captiveAction = useCallback(
    async (actionId: string, values: Record<string, string>) => {
      setBusy(true);
      setError(null);
      try {
        const payload: Record<string, unknown> = { form: values };
        if (actionId.includes("confirm_replay")) payload.confirm_replay = true;
        const r = await request("network.nm.captive.submit", payload);
        if (!r.ok) {
          setError(r.message);
          return;
        }
        const decoded = decodeCaptiveStatus(r.value);
        if (decoded !== null) setCaptive(decoded);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [request, refresh]
  );

  return {
    transportReady: transport !== null,
    intent,
    setIntentLocal: setIntent,
    scanRows,
    scanDropped,
    flightMode,
    devices,
    deviceTable,
    captive,
    reachability,
    busy,
    error,
    refresh,
    reauth,
    scan,
    saveAndApply,
    setFlight,
    joinSsid,
    forgetWifi,
    disconnectWifi,
    startCaptiveSession,
    closeCaptiveSession,
    completeCaptive,
    submitCaptive,
    captiveAction
  };
}
