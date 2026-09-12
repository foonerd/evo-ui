// system.power hook - the one canonical path for the host reboot
// and power-off verbs.
//
// Both verbs route through the framework `request` op against the
// system.power shelf and take an empty payload (payload_b64 = "").
// They are step_up:system_admin gated at the framework dispatcher;
// on the LAN-trust tier the principal carries that scope
// implicitly, so a plain request admits. A step-up token cannot
// ride the WS frame - the framework's deny_unknown_fields rejects
// any extra frame field - so on a Secure tier the dispatcher
// refuses with a PermissionDenied subclass that
// classifyPowerVerbOutcome routes to an honest message. The verbs
// are fire-and-shutdown: the host tears the framework down, so a
// dropped connection is the success path.
//
// `available` is the visibility gate: true only when a system.power
// plugin is admitted. A vendor build that suppressed the plugin
// leaves it false and the power affordances hidden.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { connectWithRetry } from "../../runtime/connect-retry";
import { storedBearer } from "../../runtime/bearer";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { decodeFlightEnabled } from "../network/network-nm-decoders";
import {
  decodePluginNames,
  classifyPowerVerbOutcome,
  SYSTEM_POWER_PLUGIN,
  type PowerVerbOutcome
} from "../audio/audio-options-decoders";

const POWER_SHELF = "system.power";
const NETWORK_SHELF = "networking.link";
const FLIGHT_GET = "network.nm.flight_mode.get";
const FLIGHT_SET = "network.nm.flight_mode.set";

/** Result of a Flight-mode toggle - a reversible network radio switch,
 *  so a plain ok/refused rather than the reboot/power-off outcomes. */
export interface FlightToggleResult {
  ok: boolean;
  message?: string;
}

/** Public surface of the hook. */
export interface SystemPowerState {
  /** True once a list_plugins probe confirms a system.power plugin
   *  is admitted. False until then, and on a build that suppressed
   *  the plugin - the power affordances stay hidden. */
  available: boolean;
  /** Dispatch reboot_device. */
  reboot: () => Promise<PowerVerbOutcome>;
  /** Dispatch power_off_device. */
  powerOff: () => Promise<PowerVerbOutcome>;
  /** True only when the device answers the network flight-mode read -
   *  so the power-cluster toggle stays hidden on a device without the
   *  network manager, per honest-surfaces. */
  flightAvailable: boolean;
  /** Current Flight mode (Wi-Fi + AP radios suspended). */
  flightEnabled: boolean;
  /** Toggle Flight mode via the existing network verb. */
  setFlight: (enabled: boolean) => Promise<FlightToggleResult>;
}

export function useSystemPower(): SystemPowerState {
  const [available, setAvailable] = useState(false);
  const [flightAvailable, setFlightAvailable] = useState(false);
  const [flightEnabled, setFlightEnabled] = useState(false);
  const transportRef = useRef<WsTransport | null>(null);
  // Separate bearer-scoped socket for the Flight-mode WRITE - opened
  // lazily on first toggle, torn down on unmount (see cleanup).
  const flightTxRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return undefined;
    let cancelled = false;
    const transport = new WsTransport({ url: frameworkWsUrl() });
    transportRef.current = transport;

    const seed = async (): Promise<void> => {
      try {
        await connectWithRetry(
          transport,
          () => {},
          () => cancelled
        );
        if (cancelled) return;
        const plugins = await transport.dispatch("list_plugins", {});
        if (!cancelled && plugins.error === undefined) {
          setAvailable(
            decodePluginNames(plugins.value).includes(SYSTEM_POWER_PLUGIN)
          );
        }
        // Flight-mode READ is anonymous-OK (verified live), so it rides
        // this same anonymous socket - no reinvented control plane, just
        // the existing network verb. Hidden until the device answers, so
        // a box without the network manager shows nothing rather than a
        // dead switch. Payload MUST mirror the Network panel's own read
        // (empty object): the verb's payload struct denies unknown
        // fields. The flag is nested under flight_mode.enabled - decoded
        // by the canonical network decoder, verified against the rig.
        const fl = await pluginRequest(transport, NETWORK_SHELF, FLIGHT_GET, {});
        if (!cancelled && fl.error === undefined) {
          const on = decodeFlightEnabled(fl.value);
          if (on !== null) {
            setFlightAvailable(true);
            setFlightEnabled(on);
          }
        }
      } catch {
        // The framework is unreachable: the power affordances stay
        // hidden rather than offered as buttons that cannot act.
      }
    };
    void seed();

    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
      if (flightTxRef.current !== null) {
        void flightTxRef.current.close();
        flightTxRef.current = null;
      }
    };
  }, []);

  // Dispatch a system.power verb through the canonical `request` op.
  // The payload is empty (payload_b64 = ""). On the LAN-trust tier
  // the request admits without a step-up token; the frame carries
  // only request_id / op / payload, as the framework requires.
  const dispatchVerb = useCallback(
    async (requestType: string): Promise<PowerVerbOutcome> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { kind: "error", message: "Not connected to the device." };
      }
      const result = await transport.dispatch("request", {
        shelf: POWER_SHELF,
        request_type: requestType,
        payload_b64: ""
      });
      return classifyPowerVerbOutcome(result.error);
    },
    []
  );

  const reboot = useCallback(
    () => dispatchVerb("reboot_device"),
    [dispatchVerb]
  );
  const powerOff = useCallback(
    () => dispatchVerb("power_off_device"),
    [dispatchVerb]
  );

  const setFlight = useCallback(
    async (enabled: boolean): Promise<FlightToggleResult> => {
      if (typeof WebSocket === "undefined") {
        return { ok: false, message: "Not connected to the device." };
      }
      // Flight write stays on this private socket so a stored bearer
      // can ride it after an API/headless pair. Under household policy
      // it is admitted on LAN-trust when unpaired — do not pre-flight
      // Pair. Opened lazily (first toggle) and torn down on unmount.
      let tx = flightTxRef.current;
      if (tx === null) {
        tx = new WsTransport({
          url: frameworkWsUrl(),
          bearerToken: storedBearer()
        });
        flightTxRef.current = tx;
      }
      // Mirror the Network panel's set exactly - { enabled } only.
      const r = await pluginRequest(tx, NETWORK_SHELF, FLIGHT_SET, { enabled });
      if (r.error === undefined) {
        setFlightEnabled(enabled);
        return { ok: true };
      }
      return {
        ok: false,
        message: verbErrorMessage(r.error, "Flight mode change was refused.")
      };
    },
    []
  );

  return {
    available,
    reboot,
    powerOff,
    flightAvailable,
    flightEnabled,
    setFlight
  };
}
