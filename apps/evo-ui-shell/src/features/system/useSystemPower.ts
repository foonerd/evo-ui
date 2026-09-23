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
//
// Sockets: the reads (list_plugins, the flight-mode read) ride the
// private anonymous seed socket opened at mount. reboot_device /
// power_off_device ride a private socket that presents the stored
// pair / kiosk bearer when one is stored (read at every handshake,
// rotated by the bearer bus, closed on unmount); with no bearer they
// stay on the seed socket. The Flight write keeps its own socket on
// the networking shelf. The seed socket is never given a bearer. See
// ./power-write-socket.ts.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import type { WireOpResult } from "../../sdk/types";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { connectWithRetry } from "../../runtime/connect-retry";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { onFlightChange, notifyFlightChange } from "../../runtime/flight-bus";
import { frameworkWsUrl } from "../../runtime/framework-transport";
import { powerWriteSocket } from "./power-write-socket";
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

  // Follow every Flight set made elsewhere on this page - Settings >
  // Network's toggle, another power-cluster instance - by re-reading
  // the flag from the player on the seed socket. The announced value is
  // not the truth; the player's answer is. One signal, one anonymous
  // read: the framework publishes no Flight happening, and this read
  // never rides a bearer socket. A read that cannot go out leaves the
  // paint as it was.
  useEffect(() => {
    let cancelled = false;
    const off = onFlightChange(() => {
      const transport = transportRef.current;
      if (transport === null) return;
      void (async (): Promise<void> => {
        try {
          const fl = await pluginRequest(transport, NETWORK_SHELF, FLIGHT_GET, {});
          if (cancelled || fl.error !== undefined) return;
          const on = decodeFlightEnabled(fl.value);
          if (on !== null) {
            setFlightAvailable(true);
            setFlightEnabled(on);
          }
        } catch {
          // The seed socket could not carry the read: the last painted
          // state stands until the next signal.
        }
      })();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // The write socket for reboot / power-off in a session with a stored
  // bearer. Opened lazily on the first bearer verb, reads the bearer at
  // every handshake, and is re-handshaken by the bearer bus (a pair or
  // a purge) so it never keeps an identity the session has left.
  // Closed on unmount. Its own socket: the Flight write is a different
  // shelf on its own. The seed socket above is never given a bearer:
  // the reads stay anonymous.
  //
  // One bus signal, both bearer sockets: the Flight write socket reads
  // the bearer at its handshake too, so a pair or a purge re-handshakes
  // it here as well - now, not on its next accidental drop. (Its close
  // stays in the seed cleanup above.)
  const powerTxRef = useRef<WsTransport | null>(null);
  useEffect(() => {
    const off = onBearerChange(() => {
      const tx = powerTxRef.current;
      if (tx !== null) tx.rotateBearer();
      const flight = flightTxRef.current;
      if (flight !== null) flight.rotateBearer();
    });
    return () => {
      off();
      const tx = powerTxRef.current;
      powerTxRef.current = null;
      if (tx !== null) void tx.close();
    };
  }, []);
  const writeTransport = useCallback((): WsTransport | null => {
    if (powerWriteSocket(storedBearer() !== undefined) === "seed") {
      return transportRef.current;
    }
    let tx = powerTxRef.current;
    if (tx === null) {
      // With a bearer stored, a verb never falls back to the seed
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      powerTxRef.current = tx;
    }
    return tx;
  }, []);

  // Dispatch a system.power verb through the canonical `request` op.
  // The payload is empty (payload_b64 = ""). On the LAN-trust tier
  // the request admits without a step-up token; the frame carries
  // only request_id / op / payload, as the framework requires.
  const dispatchVerb = useCallback(
    async (requestType: string): Promise<PowerVerbOutcome> => {
      const transport = writeTransport();
      if (transport === null) {
        return { kind: "error", message: "Not connected to the device." };
      }
      let result: WireOpResult;
      try {
        result = await transport.dispatch("request", {
          shelf: POWER_SHELF,
          request_type: requestType,
          payload_b64: ""
        });
      } catch (err) {
        // The write socket could not open (bearer refused at the
        // upgrade, device down): the verb was never sent, so this is
        // an honest error - not the fire-and-shutdown drop the
        // classifier reads as accepted.
        return {
          kind: "error",
          message: err instanceof Error ? err.message : String(err)
        };
      }
      return classifyPowerVerbOutcome(result.error);
    },
    [writeTransport]
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
          // Read at every handshake - one bearer bus, no snapshot.
          bearerSource: storedBearer
        });
        flightTxRef.current = tx;
      }
      // Mirror the Network panel's set exactly - { enabled } only. A
      // refused upgrade (dead bearer / device down) rejects the dispatch:
      // surface it honestly rather than leaving the toggle silent.
      let r: Awaited<ReturnType<typeof pluginRequest>>;
      try {
        r = await pluginRequest(tx, NETWORK_SHELF, FLIGHT_SET, { enabled });
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : "Not connected to the device."
        };
      }
      if (r.error === undefined) {
        setFlightEnabled(enabled);
        notifyFlightChange();
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
