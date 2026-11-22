// Audio-options state hook.
//
// Consumes the org.evoframework.playback.options shape-2 contract:
//   - reads + writes the audio.options.settings projection
//     (mixer type, mixer device/control, startup/max volume,
//     volume curve) via the options.* wire ops,
//   - tracks the four audio.mixer_transition.* lifecycle happenings
//     into a UI-facing transition phase (drives the "Applying audio
//     mode" overlay, the rolled-back banner, the failed modal),
//   - dispatches the hardware.audio.verify_install self-test.
//
// Mirrors the connection + happening-subscription shape of
// useMultiroomState. Pure decode + reduce logic lives in
// ./audio-options-decoders.ts so it is unit-tested independently.
//
// Sockets: reads (get_settings, list_outputs, list_eq_presets,
// verify_install) and the happenings subscription ride the private
// anonymous seed socket opened at mount. WRITES ride a second private
// socket that presents the stored pair / kiosk bearer when one is
// stored (read at every handshake, rotated by the bearer bus, closed
// on unmount); with no bearer they stay on the seed socket. The seed
// socket is never given a bearer. See ./audio-write-socket.ts.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import type { WireOpResult } from "../../sdk/types";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { audioWriteSocket } from "./audio-write-socket";
import {
  connectWithRetry,
  MAX_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry";
import {
  decodeAudioOptionsSettings,
  decodeMixerTransitionEvent,
  decodeAlsaOutputs,
  decodeVerifyInstallReport,
  extractPluginEvent,
  reduceMixerTransition,
  buildTestTonePayload,
  IDLE_TRANSITION,
  type TestToneChannel,
  type AudioOptionsSettings,
  type AlsaOutput,
  type CompositionMode,
  type ResamplingPolicy,
  type MixerType,
  type MixerTransitionPhase,
  type VerifyInstallReport,
  type VolumeCurve,
  type VolumeNormalizationMode
} from "./audio-options-decoders";
import {
  OUTPUT_VERBS,
  decodeOutputState,
  outputPayload,
  outputVolumePayload,
  type OutputState,
  type OutputPayload,
  type OutputVolumePayload
} from "./output-verbs";
import {
  LOGICAL_OUTPUT_VERBS,
  decodeLogicalOutputAnswer,
  decodeLogicalOutputList,
  withAdded,
  withUpdated,
  withRemoved,
  type LogicalOutput,
  type AddLogicalOutputPayload,
  type UpdateLogicalOutputPayload,
  type RemoveLogicalOutputPayload
} from "./logical-output-verbs";
import {
  ZONES_SHELF,
  ZONE_VERBS,
  decodeZoneAnswer,
  decodeZoneList,
  withZoneAdded,
  withZoneRemoved,
  withZoneUpdated,
  type AddZonePayload,
  type RemoveZonePayload,
  type UpdateZonePayload,
  type Zone,
  type ZoneEqBandPayload,
  type ZoneEqEngagedPayload
} from "./zone-verbs";
import { sleepTimerPayload } from "./sleep-timer";
import {
  ALARM_SHELF,
  ALARM_VERBS,
  decodeAlarmAnswer,
  decodeAlarmCleared,
  type Alarm,
  type AlarmSetPayload
} from "./alarm";
import {
  SCENE_VERBS,
  decodeSceneAnswer,
  decodeSceneList,
  withSceneRecalled,
  withSceneRemoved,
  withSceneSaved,
  type Scene,
  type SceneNamePayload
} from "./scene-verbs";
import {
  eqBandToPayload,
  eqBandToWire,
  decodeSelectModeOutcome,
  decodeEqPresetList,
  type EqBand,
  type EqPreset,
  type SelectModeOutcome
} from "./eq-decoders";

/** Connection lifecycle, mirrors the multi-room hook's shape. */
export type AudioConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface AudioConnectionState {
  kind: AudioConnectionKind;
  reason?: string;
  /** 1-based connect attempt while `kind` is "connecting". Drives
   *  the reconnecting heartbeat label. */
  attempt?: number;
}

/** Result of a setter dispatch. On `ok: false` the message is
 *  operator-facing. */
export type AudioSetterResult =
  | { ok: true }
  | { ok: false; message: string };

/** Result of one per-output verb: that output's answered state. */
export type OutputVerbResult =
  | { ok: true; value: OutputState }
  | { ok: false; message: string };

/** Result of one named-output verb: the row it made, changed, or took
 *  away. */
export type ZoneVerbResult =
  | { ok: true; value: Zone }
  | { ok: false; message: string };

/** Result of one scene verb: the scene it stored, recalled, or took
 *  away. */
export type SceneVerbResult =
  | { ok: true; value: Scene }
  | { ok: false; message: string };

/** Result of one alarm verb: the decoded answer. */
export type AlarmVerbResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type LogicalOutputVerbResult =
  | { ok: true; value: LogicalOutput }
  | { ok: false; message: string };

/** Result of the verify_install self-test. */
export type VerifyInstallResult =
  | { ok: true; report: VerifyInstallReport }
  | { ok: false; message: string };

// Shelf addressing for the `request` op. Plugin Respondent request
// types are NOT flat wire ops - they route through the framework's
// `request` op keyed by the plugin's `<rack>.<shelf>` address.
//
//   audio.options  -> org.evoframework.playback.options (shape 2)
//   audio.delivery -> org.evoframework.delivery.alsa
//   hardware.audio -> org.evoframework.hardware.audio-config
const OPTIONS_SHELF = "audio.options";
const DELIVERY_SHELF = "audio.delivery";
const HARDWARE_AUDIO_SHELF = "hardware.audio";
const COMPOSITION_SHELF = "audio.composition";

/** Request type for the hardware-audio install self-test. */
const VERIFY_INSTALL_REQUEST_TYPE = "hardware.audio.verify_install";

/** Public surface of the hook. */
export interface AudioOptionsState {
  connection: AudioConnectionState;
  /** Current audio.options.settings projection, or null before the
   *  first successful read / when the connection failed. */
  settings: AudioOptionsSettings | null;
  /** Physical audio outputs from delivery.list_outputs - already
   *  collapsed + classified framework-side. Empty until the first
   *  successful read, or when the delivery plugin did not answer. */
  alsaOutputs: ReadonlyArray<AlsaOutput>;
  /** Current mixer-transition phase. `idle` when nothing is in
   *  flight; drives the overlay / banner / modal affordances. */
  transitionPhase: MixerTransitionPhase;
  /** Dismiss the current transition phase (operator closed the
   *  rolled-back banner, acknowledged the failed modal, or the
   *  applied-pulse timer fired). Returns the phase to `idle`. */
  dismissTransition: () => void;
  /** Set the mixer type. Drives the orchestrated transition; the
   *  four lifecycle happenings update `transitionPhase`. A
   *  hardware-mode pick with missing coordinates resolves to
   *  `ok: false, hardwareCoordinateRefusal: true`. */
  setMixerType: (value: MixerType) => Promise<AudioSetterResult>;
  /** Set the ALSA mixer device coordinate. Empty string clears. */
  setMixerDevice: (value: string) => Promise<AudioSetterResult>;
  /** Set the ALSA mixer control name. Empty string clears. */
  setMixerControl: (value: string) => Promise<AudioSetterResult>;
  /** Set the startup-volume floor (0..=100). */
  setStartupVolume: (value: number) => Promise<AudioSetterResult>;
  /** Set the maximum-volume ceiling (0..=100). */
  setMaxVolume: (value: number) => Promise<AudioSetterResult>;
  /** Set the perceived-loudness curve. */
  setVolumeCurve: (value: VolumeCurve) => Promise<AudioSetterResult>;
  /** Set the bound output device - the `alsa_id` of a
   *  delivery.list_outputs row; empty string selects the default. */
  setOutputDevice: (value: string) => Promise<AudioSetterResult>;
  /** Toggle bit-perfect DoP (DSD over PCM). */
  setDop: (value: boolean) => Promise<AudioSetterResult>;
  /** Toggle volume normalization. */
  /** Set the ReplayGain mode (options.set_volume_normalization, payload
   *  { v, mode }): disabled, track or album. One write; the re-read is
   *  a read on the seed socket. */
  setVolumeNormalization: (mode: VolumeNormalizationMode) => Promise<AudioSetterResult>;
  /** Toggle exclusive (hog) device mode. The framework setter
   *  refuses when the active delivery plugin is not bit-perfect
   *  capable; the refusal surfaces as `ok: false`. */
  setExclusiveMode: (value: boolean) => Promise<AudioSetterResult>;
  /** Arm the sleep timer (options.set_sleep_timer { v, seconds,
   *  fade_ms }) - one write on audio.options, not through dispatchSetter
   *  and not the crossfade. Whole numbers zero or greater; anything else
   *  is refused before a send. seconds 0 with fade_ms 0 cancels. The
   *  timer is not in the settings and is never read back. */
  setSleepTimer: (seconds: number, fadeMs: number) => Promise<AudioSetterResult>;
  /** Set the one alarm (alarm.set { v, weekdays, time, playlist_name } on
   *  audio.alarm); the answer is the alarm as set. Not dispatchSetter,
   *  not the sleep timer. There is no read of the alarm. */
  setAlarm: (payload: AlarmSetPayload) => Promise<AlarmVerbResult<Alarm>>;
  /** Clear the alarm (alarm.clear { v } on audio.alarm). */
  clearAlarm: () => Promise<AlarmVerbResult<true>>;
  /** Set the between-track crossfade duration in seconds (0..=30;
   *  0 disables). */
  setCrossfadeSeconds: (value: number) => Promise<AudioSetterResult>;
  /** Toggle gapless playback. */
  setGapless: (value: boolean) => Promise<AudioSetterResult>;
  /** Toggle the parametric-EQ A/B engagement (options.set_eq_engaged). */
  setEqEngaged: (value: boolean) => Promise<AudioSetterResult>;
  /** Write one of the 10 EQ bands (options.set_eq_band). index 0..9.
   *  Does not re-read settings - the editing surface owns the live
   *  band state during a drag. */
  setEqBand: (index: number, band: EqBand) => Promise<AudioSetterResult>;
  /** Select the composition mode - true selects eq_only, false
   *  passthrough. eq_only is refused on an unsupported format; the
   *  refusal reason rides the outcome. A successful select re-reads
   *  settings so eqMode follows the device, not the request. */
  selectEqMode: (on: boolean) => Promise<SelectModeOutcome>;
  /** The device's composition mode from options.settings
   *  (composition_mode): "eq_only", "passthrough", or null while the
   *  player has not reported it. Read at mount and on every changed
   *  happening; never a session guess. */
  eqMode: CompositionMode | null;
  /** Per-output verbs on the audio.delivery shelf, one write each with
   *  that row's hw:N,M id. Each answers that output's state and the
   *  caller paints that output only. Not the picker (options.
   *  set_output_device) and not the global volume. */
  enableOutput: (outputId: string) => Promise<OutputVerbResult>;
  disableOutput: (outputId: string) => Promise<OutputVerbResult>;
  playOutput: (outputId: string) => Promise<OutputVerbResult>;
  pauseOutput: (outputId: string) => Promise<OutputVerbResult>;
  /** 0 through 100, whole numbers; anything else is refused on the
   *  glass before a send. */
  setOutputVolume: (outputId: string, volume: number) => Promise<OutputVerbResult>;
  /** Named outputs from delivery.list_logical_outputs, in the answer's
   *  order. Read once, with the list that opened the stage, with { v }
   *  and nothing else. Empty until that read, or when the answer is
   *  empty. Never re-read: each write below answers the row it touched
   *  and this list becomes that answer. */
  logicalOutputs: ReadonlyArray<LogicalOutput>;
  /** The three named-output verbs (G2) on the audio.delivery shelf, one
   *  write each with the helper's payload and nothing else. Each answers
   *  the row it made, changed, or took away, and the list above becomes
   *  that answer: appended, replaced by id, or dropped by id. Not the
   *  picker, not the five physical-row verbs, not a volume. */
  addLogicalOutput: (payload: AddLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
  updateLogicalOutput: (payload: UpdateLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
  removeLogicalOutput: (payload: RemoveLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
  /** Zones from zone.list on shelf audio.zones, in the answer's order.
   *  Read once at connect with { v } and nothing else; never re-read -
   *  each zone write answers the zone it touched and this list becomes
   *  that answer. */
  zones: ReadonlyArray<Zone>;
  /** The three zone verbs (G3) on shelf audio.zones, one write each
   *  with the helper's payload and nothing else: appended, replaced by
   *  id, or dropped by id on the answer. Not a delivery verb. */
  addZone: (payload: AddZonePayload) => Promise<ZoneVerbResult>;
  updateZone: (payload: UpdateZonePayload) => Promise<ZoneVerbResult>;
  removeZone: (payload: RemoveZonePayload) => Promise<ZoneVerbResult>;
  /** The zone's own stored EQ (G3): zone.set_eq_engaged { id, engaged }
   *  and zone.set_eq_band { id, index, freq_hz, gain_db, q }, both on
   *  the same zoneVerb site on audio.zones; the answer replaces that
   *  zone by id. Not the global EQ on audio.options; selects no
   *  composition mode. */
  setZoneEqEngaged: (payload: ZoneEqEngagedPayload) => Promise<ZoneVerbResult>;
  setZoneEqBand: (payload: ZoneEqBandPayload) => Promise<ZoneVerbResult>;
  /** Scene names from scene.list on shelf audio.zones, in the answer's
   *  order. Read once at connect, after zone.list, with { v } and nothing
   *  else; never re-read - each scene write answers its scene and this
   *  list becomes that answer. */
  scenes: ReadonlyArray<string>;
  /** The three scene verbs (G3) on shelf audio.zones, one write each
   *  with { name }. Save and remove leave the zones on screen; recall
   *  sets them to the answered scene's zones, in that order, without
   *  reading zone.list again. A scene does not play. */
  saveScene: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
  recallScene: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
  removeScene: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
  /** Read the named-EQ-preset library (options.list_eq_presets). */
  listEqPresets: () => Promise<ReadonlyArray<EqPreset>>;
  /** Save the current bands under a name (options.save_eq_preset).
   *  Creates or overwrites; refuses on a bad domain / library cap. */
  saveEqPreset: (
    name: string,
    bands: ReadonlyArray<EqBand>
  ) => Promise<AudioSetterResult>;
  /** Recall a named preset (options.recall_eq_preset) - applies its
   *  10 bands atomically; refuses on an unknown name. */
  recallEqPreset: (name: string) => Promise<AudioSetterResult>;
  /** Delete a named preset (options.delete_eq_preset). */
  deleteEqPreset: (name: string) => Promise<AudioSetterResult>;
  /** Set the resampling / SRC policy. */
  setResampling: (policy: ResamplingPolicy) => Promise<AudioSetterResult>;
  /** Run the hardware-audio install self-test. */
  verifyInstall: () => Promise<VerifyInstallResult>;
  /** Play a diagnostic test tone through the full playback chain.
   *  Runs the warden custody sequence (take_custody ->
   *  course_correct emit_test_tone -> release_custody). The custody
   *  is exclusive, so this fails honestly while playback is active. */
  emitTestTone: (
    freqHz: number,
    durationMs: number,
    channel: TestToneChannel
  ) => Promise<AudioSetterResult>;
}

/** Envelope version every options.* request carries (PAYLOAD_VERSION
 *  in the plugin source). */
const PAYLOAD_VERSION = 1;

function frameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

/** Pull an operator-facing message out of a transport error
 *  envelope. */
function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const message = rec["message"];
    if (typeof message === "string" && message.length > 0) return message;
    const subclass = rec["subclass"];
    if (typeof subclass === "string" && subclass.length > 0) {
      return `Framework refused: ${subclass}`;
    }
  }
  return "The audio system refused the change for an unknown reason.";
}

/** Normalise an EQ-preset verb result. The preset verbs answer an
 *  OK frame whose `status` carries the verdict, but a structured
 *  Permanent refusal can also arrive as a transport / value error;
 *  this handles all three shapes. */
function presetOpResult(
  result: { error?: unknown; value?: unknown },
  fallback: string
): AudioSetterResult {
  if (result.error !== undefined) {
    return { ok: false, message: errorMessage(result.error) };
  }
  if (typeof result.value === "object" && result.value !== null) {
    const rec = result.value as Record<string, unknown>;
    if (typeof rec["error"] === "object" && rec["error"] !== null) {
      return { ok: false, message: errorMessage(rec["error"]) };
    }
    if (rec["status"] !== undefined && rec["status"] !== "ok") {
      const e = rec["error"];
      return {
        ok: false,
        message: typeof e === "string" && e.length > 0 ? e : fallback
      };
    }
  }
  return { ok: true };
}

export function useAudioOptions(): AudioOptionsState {
  const [connection, setConnection] = useState<AudioConnectionState>({
    kind: "connecting"
  });
  const [settings, setSettings] = useState<AudioOptionsSettings | null>(null);
  const [alsaOutputs, setAlsaOutputs] = useState<ReadonlyArray<AlsaOutput>>(
    []
  );
  const [logicalOutputs, setLogicalOutputs] = useState<ReadonlyArray<LogicalOutput>>(
    []
  );
  const [zones, setZones] = useState<ReadonlyArray<Zone>>([]);
  const [scenes, setScenes] = useState<ReadonlyArray<string>>([]);
  const [transitionPhase, setTransitionPhase] =
    useState<MixerTransitionPhase>(IDLE_TRANSITION);
  const transportRef = useRef<WsTransport | null>(null);

  const dismissTransition = useCallback(() => {
    setTransitionPhase((prev) =>
      reduceMixerTransition(prev, { kind: "dismiss" })
    );
  }, []);

  // Re-read the settings projection. Called after each setter and on
  // the audio.options.changed happening so the rendered controls
  // track the framework's persisted truth. Routes through the
  // canonical `request` op (plugin Respondent request type).
  const refreshSettings = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const result = await pluginRequest(
        transport,
        OPTIONS_SHELF,
        "options.get_settings",
        { v: PAYLOAD_VERSION }
      );
      if (result.error !== undefined) return;
      const decoded = decodeAudioOptionsSettings(result.value);
      if (decoded !== null) setSettings(decoded);
    },
    []
  );

  // Read the selectable output devices from the delivery plugin.
  // Called once on connect; the device set is hardware-stable so
  // there is no per-gesture refresh. Failure leaves the list empty
  // (the picker shows "no devices") - never a silent default.
  // Read the physical audio outputs from the delivery plugin. The
  // delivery.alsa plugin collapses + classifies the ALSA cards, so
  // the UI consumes the rows directly. Called once on connect.
  const refreshOutputDevices = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const result = await pluginRequest(
        transport,
        DELIVERY_SHELF,
        "delivery.list_outputs",
        { v: PAYLOAD_VERSION }
      );
      if (result.error !== undefined) return;
      setAlsaOutputs(decodeAlsaOutputs(result.value));
    },
    []
  );

  // Read the named outputs once, with the list that opened the stage:
  // { v } and nothing else, shown in the answer's order. This is the
  // only read of them. Each named-output write answers the row it
  // touched and the list becomes that answer, so there is no second
  // read. Failure leaves the list empty.
  const readLogicalOutputs = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const result = await pluginRequest(
        transport,
        DELIVERY_SHELF,
        LOGICAL_OUTPUT_VERBS.list,
        { v: PAYLOAD_VERSION }
      );
      if (result.error !== undefined) return;
      setLogicalOutputs(decodeLogicalOutputList(result.value));
    },
    []
  );

  // Read the zones once at connect, on shelf audio.zones: { v } and
  // nothing else, shown in the answer's order. This is the only list.
  // Each zone write answers the zone it touched and the list becomes
  // that answer, so there is no second list. Failure leaves it empty.
  const readZones = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const result = await pluginRequest(
        transport,
        ZONES_SHELF,
        ZONE_VERBS.list,
        { v: PAYLOAD_VERSION }
      );
      if (result.error !== undefined) return;
      setZones(decodeZoneList(result.value));
    },
    []
  );

  // Read the scene names once at connect, after zone.list, on shelf
  // audio.zones: { v } and nothing else, shown in the answer's order. An
  // empty answer is an empty list; failure leaves it empty. Each scene
  // write answers its scene, so there is no second read.
  const readScenes = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const result = await pluginRequest(
        transport,
        ZONES_SHELF,
        SCENE_VERBS.list,
        { v: PAYLOAD_VERSION }
      );
      if (result.error !== undefined) return;
      setScenes(decodeSceneList(result.value));
    },
    []
  );

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: "WebSocket unavailable" });
      return;
    }
    let cancelled = false;
    const transport = new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    setConnection({ kind: "connecting" });

    const seed = async (): Promise<void> => {
      try {
        await connectWithRetry(
          transport,
          (attempt) => {
            if (!cancelled) setConnection({ kind: "connecting", attempt });
          },
          () => cancelled
        );
        if (cancelled) return;
        setConnection({ kind: "connected" });
        await refreshSettings(transport);
        if (cancelled) return;
        await refreshOutputDevices(transport);
        if (cancelled) return;
        await readLogicalOutputs(transport);
        if (cancelled) return;
        await readZones(transport);
        if (cancelled) return;
        await readScenes(transport);
        if (cancelled) return;

        // Happening handler: route mixer-transition lifecycle
        // events into the transition reducer; re-read settings on
        // the generic audio.options.changed happening.
        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          const frame = extractPluginEvent(raw);
          if (frame === null) return;
          if (frame.eventType === "audio.options.changed") {
            void refreshSettings(transport);
            return;
          }
          const event = decodeMixerTransitionEvent(
            frame.eventType,
            frame.payload
          );
          if (event === null) return;
          setTransitionPhase((prev) =>
            reduceMixerTransition(prev, { kind: "event", event })
          );
          // A terminal transition event also lands the new
          // settings; re-read so the mixer-type selector reflects
          // the persisted value.
          if (event.kind !== "started") {
            void refreshSettings(transport);
          }
        };

        const subscriptionAbort = new AbortController();
        const consume = async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: subscriptionAbort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              handleHappening(event);
            }
          } catch {
            // Subscription ended; transport reconnect re-establishes.
          }
        };
        void consume();
        transport.onHappening((f) => handleHappening(f.happening));
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({
          kind: "error",
          reason:
            "The audio service did not respond after " +
            `${MAX_CONNECT_ATTEMPTS} connection attempts. It may be ` +
            `restarting. Last error: ${detail}`
        });
      }
    };
    void seed();

    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
    };
    // refreshSettings, refreshOutputDevices and readLogicalOutputs are
    // stable (useCallback with empty deps).
  }, [refreshSettings, refreshOutputDevices, readLogicalOutputs]);

  // The write socket for a session with a stored bearer. Opened lazily
  // on the first bearer write, reads the bearer at every handshake, and
  // is re-handshaken by the bearer bus (a pair or a purge) so it never
  // keeps an identity the session has left. Closed on unmount. The seed
  // socket above is never given a bearer: reads and happenings stay
  // anonymous.
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
    if (audioWriteSocket(storedBearer() !== undefined) === "seed") {
      return transportRef.current;
    }
    let tx = writeTxRef.current;
    if (tx === null) {
      // With a bearer stored, a write never falls back to the seed
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkUrl(), bearerSource: storedBearer });
      writeTxRef.current = tx;
    }
    return tx;
  }, []);

  // The one write path: pick the socket and send. A write socket that
  // could not open (bearer refused at the upgrade, device down) is an
  // error result - an honest refusal on the control, never a throw out
  // of a setter.
  const writeRequest = useCallback(
    async (
      shelf: string,
      requestType: string,
      payload: unknown
    ): Promise<WireOpResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return {
          error: {
            code: "not_connected",
            message: "Not connected to the audio system."
          }
        };
      }
      try {
        return await pluginRequest(tx, shelf, requestType, payload);
      } catch (err) {
        return {
          error: {
            code: "not_connected",
            message: err instanceof Error ? err.message : String(err)
          }
        };
      }
    },
    [writeTransport]
  );

  // Generic value-setter dispatch. `requestType` is the options.*
  // request type; `value` is the wire value. Routes through the
  // canonical `request` op. Re-reads settings on success so the
  // controls reflect persisted truth without waiting for the
  // happening round-trip.
  const dispatchSetter = useCallback(
    async (requestType: string, value: unknown): Promise<AudioSetterResult> => {
      const result = await writeRequest(OPTIONS_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        value
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      // The re-read is a read: seed socket.
      const seed = transportRef.current;
      if (seed !== null) await refreshSettings(seed);
      return { ok: true };
    },
    [writeRequest, refreshSettings]
  );

  const setMixerType = useCallback(
    (value: MixerType) => dispatchSetter("options.set_mixer_type", value),
    [dispatchSetter]
  );
  const setMixerDevice = useCallback(
    (value: string) => dispatchSetter("options.set_mixer_device", value),
    [dispatchSetter]
  );
  const setMixerControl = useCallback(
    (value: string) => dispatchSetter("options.set_mixer_control", value),
    [dispatchSetter]
  );
  const setStartupVolume = useCallback(
    (value: number) => dispatchSetter("options.set_startup_volume", value),
    [dispatchSetter]
  );
  const setMaxVolume = useCallback(
    (value: number) => dispatchSetter("options.set_max_volume", value),
    [dispatchSetter]
  );
  const setVolumeCurve = useCallback(
    (value: VolumeCurve) => dispatchSetter("options.set_volume_curve", value),
    [dispatchSetter]
  );
  const setOutputDevice = useCallback(
    (value: string) => dispatchSetter("options.set_output_device", value),
    [dispatchSetter]
  );
  const setDop = useCallback(
    (value: boolean) => dispatchSetter("options.set_dop", value),
    [dispatchSetter]
  );
  // ReplayGain is a mode, not a switch: the payload carries `mode`, not
  // the generic `value` envelope, so this verb does not go through
  // dispatchSetter. Same shape otherwise: one write, then a seed re-read.
  const setVolumeNormalization = useCallback(
    async (mode: VolumeNormalizationMode): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.set_volume_normalization",
        { v: PAYLOAD_VERSION, mode }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const seed = transportRef.current;
      if (seed !== null) await refreshSettings(seed);
      return { ok: true };
    },
    [writeRequest, refreshSettings]
  );
  const setExclusiveMode = useCallback(
    (value: boolean) => dispatchSetter("options.set_exclusive_mode", value),
    [dispatchSetter]
  );
  const setCrossfadeSeconds = useCallback(
    (value: number) => dispatchSetter("options.set_crossfade_seconds", value),
    [dispatchSetter]
  );
  const setGapless = useCallback(
    (value: boolean) => dispatchSetter("options.set_gapless", value),
    [dispatchSetter]
  );
  const setEqEngaged = useCallback(
    (value: boolean) => dispatchSetter("options.set_eq_engaged", value),
    [dispatchSetter]
  );

  // One EQ band carries an {index, freq_hz, gain_db, q} payload, not
  // the generic {value} envelope. It deliberately does NOT re-read
  // settings: the curve editor owns the live band state during a
  // drag, and the audio.options.changed happening refreshes the
  // hook's settings once the drag settles.
  const setEqBand = useCallback(
    async (index: number, band: EqBand): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.set_eq_band",
        eqBandToPayload(index, band)
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      return { ok: true };
    },
    [writeRequest]
  );

  // Composition-mode select routes through the audio.composition
  // shelf. The plugin answers an OK frame whose `status` carries the
  // verdict, so a format refusal is decoded from the value, not the
  // transport error. A write of this panel: it rides the write socket.
  const selectEqMode = useCallback(
    async (on: boolean): Promise<SelectModeOutcome> => {
      const result = await writeRequest(
        COMPOSITION_SHELF,
        "composition.select_mode",
        { v: PAYLOAD_VERSION, mode: on ? "eq_only" : "passthrough" }
      );
      if (result.error !== undefined) {
        return { ok: false, reason: errorMessage(result.error) };
      }
      const outcome = decodeSelectModeOutcome(result.value);
      if (outcome.ok) {
        // The flag is the device's: re-read settings on the seed
        // socket so composition_mode arrives from the player.
        const seed = transportRef.current;
        if (seed !== null) await refreshSettings(seed);
      }
      return outcome;
    },
    [writeRequest, refreshSettings]
  );

  // EQ preset library verbs on the audio.options shelf. recall
  // emits a single audio.options.changed (field eq_bands), which
  // the happening handler already routes into a settings re-read,
  // so the recalled curve flows back without an extra fetch here.
  // The five per-output verbs (G1): one write site on the delivery
  // shelf, the versioned envelope around the helper's payload, the
  // answer decoded to that output's state. No options re-read: the
  // options settings did not change.
  const outputVerb = useCallback(
    async (
      requestType: string,
      payload: OutputPayload | OutputVolumePayload
    ): Promise<OutputVerbResult> => {
      const result = await writeRequest(DELIVERY_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const decoded = decodeOutputState(result.value);
      if (decoded === null) {
        return { ok: false, message: "The output system answered with nothing the glass can paint." };
      }
      return { ok: true, value: decoded };
    },
    [writeRequest]
  );
  const enableOutput = useCallback(
    (outputId: string) => outputVerb(OUTPUT_VERBS.enable, outputPayload(outputId)),
    [outputVerb]
  );
  const disableOutput = useCallback(
    (outputId: string) => outputVerb(OUTPUT_VERBS.disable, outputPayload(outputId)),
    [outputVerb]
  );
  const playOutput = useCallback(
    (outputId: string) => outputVerb(OUTPUT_VERBS.play, outputPayload(outputId)),
    [outputVerb]
  );
  const pauseOutput = useCallback(
    (outputId: string) => outputVerb(OUTPUT_VERBS.pause, outputPayload(outputId)),
    [outputVerb]
  );
  const setOutputVolume = useCallback(
    async (outputId: string, volume: number): Promise<OutputVerbResult> => {
      const payload = outputVolumePayload(outputId, volume);
      if (payload === null) {
        return { ok: false, message: "Volume must be a whole number from 0 to 100." };
      }
      return outputVerb(OUTPUT_VERBS.volume, payload);
    },
    [outputVerb]
  );

  // The three named-output verbs (G2): one write site on the delivery
  // shelf, the versioned envelope around the helper's payload, the
  // answer decoded to the row it names, and the list on screen made
  // that answer - appended, replaced by id, or dropped by id. No second
  // read and no options re-read: the physical rows did not change and
  // the options settings did not change.
  const logicalOutputVerb = useCallback(
    async (
      requestType: string,
      payload: AddLogicalOutputPayload | UpdateLogicalOutputPayload | RemoveLogicalOutputPayload,
      apply: (list: ReadonlyArray<LogicalOutput>, row: LogicalOutput) => ReadonlyArray<LogicalOutput>
    ): Promise<LogicalOutputVerbResult> => {
      const result = await writeRequest(DELIVERY_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const row = decodeLogicalOutputAnswer(result.value);
      if (row === null) {
        return { ok: false, message: "The output system answered with nothing the glass can paint." };
      }
      setLogicalOutputs((cur) => apply(cur, row));
      return { ok: true, value: row };
    },
    [writeRequest]
  );
  const addLogicalOutput = useCallback(
    (payload: AddLogicalOutputPayload) => logicalOutputVerb(LOGICAL_OUTPUT_VERBS.add, payload, withAdded),
    [logicalOutputVerb]
  );
  const updateLogicalOutput = useCallback(
    (payload: UpdateLogicalOutputPayload) => logicalOutputVerb(LOGICAL_OUTPUT_VERBS.update, payload, withUpdated),
    [logicalOutputVerb]
  );
  const removeLogicalOutput = useCallback(
    (payload: RemoveLogicalOutputPayload) => logicalOutputVerb(LOGICAL_OUTPUT_VERBS.remove, payload, withRemoved),
    [logicalOutputVerb]
  );

  // The three zone verbs (G3): one write site on shelf audio.zones, the
  // versioned envelope around the helper's payload, the answer decoded
  // to the zone it names, and the list on screen made that answer -
  // appended, replaced by id, or dropped by id. No second list and no
  // options re-read. Never on audio.delivery.
  const zoneVerb = useCallback(
    async (
      requestType: string,
      payload:
        | AddZonePayload
        | UpdateZonePayload
        | RemoveZonePayload
        | ZoneEqEngagedPayload
        | ZoneEqBandPayload,
      apply: (list: ReadonlyArray<Zone>, zone: Zone) => ReadonlyArray<Zone>
    ): Promise<ZoneVerbResult> => {
      const result = await writeRequest(ZONES_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const zone = decodeZoneAnswer(result.value);
      if (zone === null) {
        return { ok: false, message: "The zone system answered with nothing the glass can paint." };
      }
      setZones((cur) => apply(cur, zone));
      return { ok: true, value: zone };
    },
    [writeRequest]
  );
  const addZone = useCallback(
    (payload: AddZonePayload) => zoneVerb(ZONE_VERBS.add, payload, withZoneAdded),
    [zoneVerb]
  );
  const updateZone = useCallback(
    (payload: UpdateZonePayload) => zoneVerb(ZONE_VERBS.update, payload, withZoneUpdated),
    [zoneVerb]
  );
  const removeZone = useCallback(
    (payload: RemoveZonePayload) => zoneVerb(ZONE_VERBS.remove, payload, withZoneRemoved),
    [zoneVerb]
  );
  const setZoneEqEngaged = useCallback(
    (payload: ZoneEqEngagedPayload) => zoneVerb(ZONE_VERBS.setEqEngaged, payload, withZoneUpdated),
    [zoneVerb]
  );
  const setZoneEqBand = useCallback(
    (payload: ZoneEqBandPayload) => zoneVerb(ZONE_VERBS.setEqBand, payload, withZoneUpdated),
    [zoneVerb]
  );

  // The three scene verbs (G3): one write site on shelf audio.zones, the
  // versioned envelope around { name }, the answer decoded to its scene.
  // A scene whose zones do not all decode is a refusal and nothing is
  // painted. The names on screen become the answer (saved in place or
  // appended, dropped, or left as they were); a recall also sets the
  // zones on screen to the scene's zones, in that order. No zone.list,
  // no second scene read, no options re-read. Never on audio.delivery or
  // audio.options.
  const sceneVerb = useCallback(
    async (
      requestType: string,
      payload: SceneNamePayload,
      applyNames: (names: ReadonlyArray<string>, scene: Scene) => ReadonlyArray<string>,
      recall: boolean
    ): Promise<SceneVerbResult> => {
      const result = await writeRequest(ZONES_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const scene = decodeSceneAnswer(result.value);
      if (scene === null) {
        return { ok: false, message: "The zone system answered a scene the glass cannot paint; the zones on screen are unchanged." };
      }
      setScenes((cur) => applyNames(cur, scene));
      if (recall) setZones(scene.zones);
      return { ok: true, value: scene };
    },
    [writeRequest]
  );
  const saveScene = useCallback(
    (payload: SceneNamePayload) => sceneVerb(SCENE_VERBS.save, payload, withSceneSaved, false),
    [sceneVerb]
  );
  const recallScene = useCallback(
    (payload: SceneNamePayload) => sceneVerb(SCENE_VERBS.recall, payload, withSceneRecalled, true),
    [sceneVerb]
  );
  const removeScene = useCallback(
    (payload: SceneNamePayload) => sceneVerb(SCENE_VERBS.remove, payload, withSceneRemoved, false),
    [sceneVerb]
  );

  // The sleep timer (H2): one write site on audio.options, the versioned
  // envelope around { seconds, fade_ms }. Not dispatchSetter (whose
  // { v, value } envelope it is not) and no settings re-read - the timer
  // is not in the settings. A non-whole or negative number sends nothing.
  const setSleepTimer = useCallback(
    async (seconds: number, fadeMs: number): Promise<AudioSetterResult> => {
      const payload = sleepTimerPayload(seconds, fadeMs);
      if (payload === null) {
        return { ok: false, message: "The timer takes whole numbers, zero or greater." };
      }
      const result = await writeRequest(OPTIONS_SHELF, "options.set_sleep_timer", {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      return { ok: true };
    },
    [writeRequest]
  );

  // The alarm: one write site on audio.alarm, the versioned envelope
  // around the helper's payload, the answer decoded by the verb's own
  // decoder. Not dispatchSetter, no settings re-read, and no read of the
  // alarm anywhere - the glass shows what a set answered, or nothing.
  const alarmVerb = useCallback(
    async <T,>(
      requestType: string,
      payload: AlarmSetPayload | Record<string, never>,
      decode: (raw: unknown) => T | null
    ): Promise<AlarmVerbResult<T>> => {
      const result = await writeRequest(ALARM_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...payload
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      const value = decode(result.value);
      if (value === null) {
        return { ok: false, message: "The alarm answered with nothing the glass can show." };
      }
      return { ok: true, value };
    },
    [writeRequest]
  );
  const setAlarm = useCallback(
    (payload: AlarmSetPayload) => alarmVerb(ALARM_VERBS.set, payload, decodeAlarmAnswer),
    [alarmVerb]
  );
  const clearAlarm = useCallback(
    () => alarmVerb(ALARM_VERBS.clear, {}, decodeAlarmCleared),
    [alarmVerb]
  );

  const listEqPresets = useCallback(async (): Promise<
    ReadonlyArray<EqPreset>
  > => {
    const transport = transportRef.current;
    if (transport === null) return [];
    const result = await pluginRequest(
      transport,
      OPTIONS_SHELF,
      "options.list_eq_presets",
      { v: PAYLOAD_VERSION }
    );
    if (result.error !== undefined) return [];
    return decodeEqPresetList(result.value);
  }, []);

  const saveEqPreset = useCallback(
    async (
      name: string,
      bands: ReadonlyArray<EqBand>
    ): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.save_eq_preset",
        { v: PAYLOAD_VERSION, name, bands: bands.map(eqBandToWire) }
      );
      return presetOpResult(result, "The device refused the preset.");
    },
    [writeRequest]
  );

  const recallEqPreset = useCallback(
    async (name: string): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.recall_eq_preset",
        { v: PAYLOAD_VERSION, name }
      );
      return presetOpResult(result, "The device could not recall that preset.");
    },
    [writeRequest]
  );

  const deleteEqPreset = useCallback(
    async (name: string): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.delete_eq_preset",
        { v: PAYLOAD_VERSION, name }
      );
      return presetOpResult(result, "The device could not delete that preset.");
    },
    [writeRequest]
  );

  // Resampling carries a `policy` payload, not the generic `value`
  // envelope dispatchSetter sends, so it has its own dispatch.
  const setResampling = useCallback(
    async (policy: ResamplingPolicy): Promise<AudioSetterResult> => {
      const result = await writeRequest(
        OPTIONS_SHELF,
        "options.set_resampling",
        {
          v: PAYLOAD_VERSION,
          policy: {
            enabled: policy.enabled,
            target_bitdepth: policy.targetBitdepth,
            target_samplerate: policy.targetSamplerate,
            quality: policy.quality
          }
        }
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      // The re-read is a read: seed socket.
      const seed = transportRef.current;
      if (seed !== null) await refreshSettings(seed);
      return { ok: true };
    },
    [writeRequest, refreshSettings]
  );

  const verifyInstall = useCallback(async (): Promise<VerifyInstallResult> => {
    const transport = transportRef.current;
    if (transport === null) {
      return { ok: false, message: "Not connected to the audio system." };
    }
    const result = await pluginRequest(
      transport,
      HARDWARE_AUDIO_SHELF,
      VERIFY_INSTALL_REQUEST_TYPE,
      { v: PAYLOAD_VERSION }
    );
    if (result.error !== undefined) {
      return { ok: false, message: errorMessage(result.error) };
    }
    const report = decodeVerifyInstallReport(result.value);
    if (report === null) {
      return {
        ok: false,
        message:
          "The self-test ran but returned a result the UI could not read."
      };
    }
    return { ok: true, report };
  }, []);

  // Play a diagnostic test tone. emit_test_tone is a warden
  // course-correct verb on the audio.playback shelf, so it runs the
  // custody sequence: take_custody -> course_correct -> always
  // release_custody. The playback custody is exclusive, so a
  // take_custody failure most often means playback is active; the
  // message says so while still surfacing the framework's reason.
  const emitTestTone = useCallback(
    async (
      freqHz: number,
      durationMs: number,
      channel: TestToneChannel
    ): Promise<AudioSetterResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const valueError = (r: { error?: unknown; value?: unknown }): unknown => {
        if (r.error !== undefined) return r.error;
        if (typeof r.value === "object" && r.value !== null) {
          const e = (r.value as Record<string, unknown>)["error"];
          if (typeof e === "object" && e !== null) return e;
        }
        return undefined;
      };
      const tc = await transport.dispatch("take_custody", {
        shelf: "audio.playback",
        custody_type: "playback",
        payload_b64: btoa("{}")
      });
      const tcErr = valueError(tc);
      if (tcErr !== undefined) {
        return {
          ok: false,
          message:
            "Could not start the test tone. It needs exclusive use of " +
            "the audio output - if something is playing, stop it and " +
            `try again. (${errorMessage(tcErr)})`
        };
      }
      const handle =
        typeof tc.value === "object" && tc.value !== null
          ? (tc.value as Record<string, unknown>)["handle"]
          : undefined;
      if (handle === undefined) {
        return {
          ok: false,
          message: "The device did not return a custody handle."
        };
      }
      const cc = await transport.dispatch("course_correct", {
        shelf: "audio.playback",
        handle,
        correction_type: "emit_test_tone",
        payload_b64: btoa(
          JSON.stringify(buildTestTonePayload(freqHz, durationMs, channel))
        )
      });
      // Release the custody regardless of the course_correct result.
      await transport.dispatch("release_custody", {
        shelf: "audio.playback",
        handle
      });
      const ccErr = valueError(cc);
      if (ccErr !== undefined) {
        return { ok: false, message: errorMessage(ccErr) };
      }
      return { ok: true };
    },
    []
  );

  return {
    connection,
    settings,
    alsaOutputs,
    transitionPhase,
    dismissTransition,
    setMixerType,
    setMixerDevice,
    setMixerControl,
    setStartupVolume,
    setMaxVolume,
    setVolumeCurve,
    setOutputDevice,
    setDop,
    setVolumeNormalization,
    setExclusiveMode,
    setCrossfadeSeconds,
    setSleepTimer,
    setAlarm,
    clearAlarm,
    setGapless,
    setEqEngaged,
    setEqBand,
    selectEqMode,
    eqMode: settings?.compositionMode ?? null,
    enableOutput,
    disableOutput,
    playOutput,
    pauseOutput,
    setOutputVolume,
    logicalOutputs,
    addLogicalOutput,
    updateLogicalOutput,
    removeLogicalOutput,
    zones,
    addZone,
    updateZone,
    removeZone,
    setZoneEqEngaged,
    setZoneEqBand,
    scenes,
    saveScene,
    recallScene,
    removeScene,
    listEqPresets,
    saveEqPreset,
    recallEqPreset,
    deleteEqPreset,
    setResampling,
    verifyInstall,
    emitTestTone
  };
}
