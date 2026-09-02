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
import { connectWithRetry } from "../../runtime/connect-retry";
import {
  decodePluginNames,
  classifyPowerVerbOutcome,
  SYSTEM_POWER_PLUGIN,
  type PowerVerbOutcome
} from "../audio/audio-options-decoders";

const POWER_SHELF = "system.power";

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
}

function frameworkUrl(): string {
  if (typeof window === "undefined") return "ws://localhost/api/v1/ws";
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

export function useSystemPower(): SystemPowerState {
  const [available, setAvailable] = useState(false);
  const transportRef = useRef<WsTransport | null>(null);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return undefined;
    let cancelled = false;
    const transport = new WsTransport({ url: frameworkUrl() });
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

  return { available, reboot, powerOff };
}
