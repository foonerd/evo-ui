// Remote (paired-browser) transport for the Display & Touch panel. A
// remote browser has no window.webkit handlers, so it drives the player's
// display over the framework WS instead. These verbs are the writer for the
// rotation/touch overlays now, from a remote browser exactly as from the
// glass (one shared evo-kiosk-config crate, so the two can't drift). On the
// binary glass and VM run (75796d9) the WebKit touch slots are gone and
// rotation is a presence probe; the old binary's handlers still wrote them
// in-process, but no UI code reaches for them. Launch the calibration wizard
// on the player's own screen.
//
// Live on the org.evoframework.system.kiosk plugin (shelf `system.kiosk`),
// auth `write:system_admin`, no step-up. A player that hasn't loaded the
// plugin refuses the verb, so `dispatch` resolves { ok:false } and the
// panel shows the not-yet-available banner - honest per-player state, not
// a global assumption.
//
// Wire shapes (inner payload, base64'd by the codec) - verified against
// the plugin source (evo-device-audio/plugins/org.evoframework.system.kiosk):
//   set_display_rotation  { rotation }              -> { ok, display_rotation }
//   set_touch_calibration { rotation,hflip,vflip }  -> { ok, touch_* }
//   derive_touch_calibration_from_corners { samples:[4] }
//                        -> { ok, touch_rotation, touch_hflip, touch_vflip,
//                             mean_error }
//       (the wizard's own write: derives the best triple from four
//       (target, actual) taps and persists it. Same evo-kiosk-config
//       function, and therefore the same overlay bytes, as the on-glass
//       WebKit handler used to call in-process - the difference is that
//       this one passes the dispatcher's write:system_admin gate, so a
//       household policy can refuse it.)
//   launch_touch_calibration { }                    -> { ok, launched_at_ms }
//   set_enabled { enabled }                         -> { ok, enabled }
//   set_brightness { percent }  (0..=100)           -> { ok, brightness_percent }
//   set_sleep_timeout { seconds } (0=never,>=5)     -> { ok, sleep_timeout_seconds }
//   set_sleep_inhibit_while_playing { enabled }     -> { ok, ... }
//   set_osk { enabled }                             -> { ok, osk_enabled }
//   set_cursor { visible }                          -> { ok, cursor_visible }
//       (writes the overlay; the hide/show applies when the kiosk session
//       (re)starts, not instantly.)
//   get_display_state { }  -> { ok, display_rotation, touch:{rotation,hflip,
//       vflip}, brightness_percent, sleep_timeout_seconds,
//       sleep_inhibit_while_playing, enabled, osk_enabled, cursor_visible }
//       (READ - the device is the source of truth; the panel seeds from this
//       on mount so a fresh boot shows the real configured values.)
//
// set_enabled/brightness/sleep have no on-glass WebKit handler; they always
// go over the plugin verb from both glass and remote (the framework
// transport is present in both).
//
// Sockets: reads (get_display_state) ride the shared page-lifetime
// LAN-trust socket. WRITES ride a private socket that presents the
// stored kiosk / pair bearer when one is stored (read at every
// handshake, rotated by the bearer bus, closed on unmount); with no
// bearer they stay on the shared socket. The shared socket is never
// given a bearer.

import { useCallback, useEffect, useRef } from "preact/hooks";
import {
  frameworkWsUrl,
  tryUseFrameworkTransport
} from "../../runtime/framework-transport";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import type { CalibrationSample, Rotation } from "./kiosk-bridge";
import { kioskWriteSocket, readOskEnabled, readCursorVisible } from "./osk-state";

const KIOSK_SHELF = "system.kiosk";

export interface KioskRemoteResult {
  ok: boolean;
  message?: string;
  /** The plugin's own response body on success. Most verbs echo what
   *  they applied and callers ignore it; the wizard's derive needs the
   *  triple it computed. Carried here rather than through a second
   *  dispatch path, so every verb keeps one route and one classifier. */
  value?: Record<string, unknown>;
  /** Structured refusal subclass lifted from the wire error (e.g.
   *  household_policy_locked), so the panel can classify a locked write
   *  instead of mislabelling every failure "player-side controls not in
   *  place". Absent on success and on the plugin's inner ok:false. */
  subclass?: string;
}

/** Current device display/touch state, read from the persisted overlays via
 *  get_display_state. Null fields are never returned by the device (it fills
 *  documented defaults), so every field is present. */
export interface KioskDisplayState {
  displayRotation: Rotation;
  touchRotation: Rotation;
  hflip: boolean;
  vflip: boolean;
  brightnessPercent: number;
  sleepTimeoutSeconds: number;
  sleepInhibitWhilePlaying: boolean;
  enabled: boolean;
  /** true/false when the device reports osk_enabled; null when the key is
   *  absent (a player still on the old verb) - the panel then DISABLES the
   *  On-screen keyboard row rather than inventing a value. */
  oskEnabled: boolean | null;
  /** true/false when the device reports cursor_visible; null when the key is
   *  absent (old verb) - the panel DISABLES the Mouse pointer row. */
  cursorVisible: boolean | null;
}

function asRotation(v: unknown): Rotation {
  return v === "90" || v === "180" || v === "270" ? v : "0";
}

export interface KioskRemote {
  ready: boolean;
  /** Read the device's current state; null if the read fails / not connected
   *  (the panel then keeps its optimistic cache). */
  getDisplayState: () => Promise<KioskDisplayState | null>;
  setDisplayRotation: (rotation: Rotation) => Promise<KioskRemoteResult>;
  setTouchCalibration: (
    rotation: Rotation,
    hflip: boolean,
    vflip: boolean,
    opts?: { signal?: AbortSignal }
  ) => Promise<KioskRemoteResult>;
  /** The wizard's write. Four (target, actual) taps in, the derived
   *  triple out, already persisted by the player. Refused like every
   *  other write on this shelf when the household policy protects it. */
  deriveTouchCalibrationFromCorners: (
    samples: ReadonlyArray<CalibrationSample>,
    opts?: { signal?: AbortSignal }
  ) => Promise<KioskRemoteResult>;
  launchCalibration: () => Promise<KioskRemoteResult>;
  setEnabled: (enabled: boolean) => Promise<KioskRemoteResult>;
  setBrightness: (percent: number) => Promise<KioskRemoteResult>;
  setSleepTimeout: (seconds: number) => Promise<KioskRemoteResult>;
  setSleepInhibitWhilePlaying: (enabled: boolean) => Promise<KioskRemoteResult>;
  /** Toggle the on-screen keyboard. write:system_admin, no step-up, glass +
   *  remote (no WebKit handler), same path as brightness. */
  setOsk: (enabled: boolean) => Promise<KioskRemoteResult>;
  /** Toggle the mouse pointer. Writes the overlay; the hide/show applies
   *  when the kiosk session (re)starts. Same auth/path as setOsk. */
  setCursor: (visible: boolean) => Promise<KioskRemoteResult>;
}

export function useKioskRemote(): KioskRemote {
  const transport = tryUseFrameworkTransport();

  // The write socket for a session with a stored bearer. Opened lazily on
  // the first bearer write, reads the bearer at every handshake, and is
  // re-handshaken by the bearer bus (a pair or a purge) so it never keeps
  // an identity the session has left. Closed on unmount.
  const writeTxRef = useRef<WsTransport | null>(null);
  useEffect(() => {
    const off = onBearerChange(() => {
      const tx = writeTxRef.current;
      if (tx !== null) tx.rotateBearer();
    });
    return () => {
      off();
      const tx = writeTxRef.current;
      writeTxRef.current = null;
      if (tx !== null) void tx.close();
    };
  }, []);
  const writeTransport = useCallback((): WsTransport | null => {
    if (kioskWriteSocket(storedBearer() !== undefined) === "shared") {
      return transport;
    }
    let tx = writeTxRef.current;
    if (tx === null && typeof WebSocket !== "undefined") {
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      writeTxRef.current = tx;
    }
    return tx ?? transport;
  }, [transport]);

  const dispatch = useCallback(
    async (
      verb: string,
      payload: Record<string, unknown>,
      opts?: { signal?: AbortSignal }
    ): Promise<KioskRemoteResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: "not connected" };
      }
      let r: Awaited<ReturnType<typeof pluginRequest>>;
      try {
        r = await pluginRequest(tx, KIOSK_SHELF, verb, payload, opts);
      } catch (err) {
        // The private write socket could not open (bearer refused at the
        // upgrade, device down): an honest refusal, never a silent no-op.
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err)
        };
      }
      if (r.error !== undefined) {
        return {
          ok: false,
          message: r.error.message ?? r.error.code,
          subclass: r.error.subclass
        };
      }
      // Honour the plugin's own outcome: the inner payload carries
      // { ok: boolean, ... }. A transport-level success with ok:false is
      // an application refusal (e.g. an unsupported rotation), surfaced as
      // blocked rather than silently treated as applied.
      const v = r.value;
      if (
        typeof v === "object" &&
        v !== null &&
        (v as Record<string, unknown>).ok === false
      ) {
        const msg = (v as Record<string, unknown>).message;
        return { ok: false, message: typeof msg === "string" ? msg : "refused" };
      }
      return {
        ok: true,
        value:
          typeof v === "object" && v !== null
            ? (v as Record<string, unknown>)
            : undefined
      };
    },
    [writeTransport]
  );

  // READ: always the shared LAN-trust socket, bearer or not.
  const getDisplayState =
    useCallback(async (): Promise<KioskDisplayState | null> => {
      if (transport === null) return null;
      const r = await pluginRequest(transport, KIOSK_SHELF, "get_display_state", {});
      if (r.error !== undefined) return null;
      const v = r.value;
      if (typeof v !== "object" || v === null) return null;
      const o = v as Record<string, unknown>;
      if (o.ok === false) return null;
      const touch = (typeof o.touch === "object" && o.touch !== null
        ? o.touch
        : {}) as Record<string, unknown>;
      const num = (x: unknown, d: number): number =>
        typeof x === "number" && Number.isFinite(x) ? x : d;
      return {
        displayRotation: asRotation(o.display_rotation),
        touchRotation: asRotation(touch.rotation),
        hflip: touch.hflip === true,
        vflip: touch.vflip === true,
        brightnessPercent: num(o.brightness_percent, 100),
        sleepTimeoutSeconds: num(o.sleep_timeout_seconds, 120),
        sleepInhibitWhilePlaying: o.sleep_inhibit_while_playing !== false,
        enabled: o.enabled !== false,
        oskEnabled: readOskEnabled(o),
        cursorVisible: readCursorVisible(o)
      };
    }, [transport]);

  return {
    ready: transport !== null,
    getDisplayState,
    setDisplayRotation: (rotation) =>
      dispatch("set_display_rotation", { rotation }),
    setTouchCalibration: (rotation, hflip, vflip, opts) =>
      dispatch("set_touch_calibration", { rotation, hflip, vflip }, opts),
    deriveTouchCalibrationFromCorners: (samples, opts) =>
      dispatch(
        "derive_touch_calibration_from_corners",
        {
          samples: samples.map((s) => ({
            target_x: s.target_x,
            target_y: s.target_y,
            actual_x: s.actual_x,
            actual_y: s.actual_y
          }))
        },
        opts
      ),
    launchCalibration: () => dispatch("launch_touch_calibration", {}),
    setEnabled: (enabled) => dispatch("set_enabled", { enabled }),
    setBrightness: (percent) => dispatch("set_brightness", { percent }),
    setSleepTimeout: (seconds) => dispatch("set_sleep_timeout", { seconds }),
    setSleepInhibitWhilePlaying: (enabled) =>
      dispatch("set_sleep_inhibit_while_playing", { enabled }),
    setOsk: (enabled) => dispatch("set_osk", { enabled }),
    setCursor: (visible) => dispatch("set_cursor", { visible })
  };
}
