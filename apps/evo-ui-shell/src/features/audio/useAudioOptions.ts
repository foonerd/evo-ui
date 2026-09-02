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

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
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
  type ResamplingPolicy,
  type MixerType,
  type MixerTransitionPhase,
  type VerifyInstallReport,
  type VolumeCurve
} from "./audio-options-decoders";
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
  setVolumeNormalization: (value: boolean) => Promise<AudioSetterResult>;
  /** Toggle exclusive (hog) device mode. The framework setter
   *  refuses when the active delivery plugin is not bit-perfect
   *  capable; the refusal surfaces as `ok: false`. */
  setExclusiveMode: (value: boolean) => Promise<AudioSetterResult>;
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
   *  refusal reason rides the outcome. eqModeActive updates on a
   *  successful select. */
  selectEqMode: (on: boolean) => Promise<SelectModeOutcome>;
  /** True when this session has selected eq_only. Optimistic - the
   *  framework exposes no composition-mode read; false on mount
   *  (the plugin defaults to passthrough at load). */
  eqModeActive: boolean;
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
  const [transitionPhase, setTransitionPhase] =
    useState<MixerTransitionPhase>(IDLE_TRANSITION);
  const [eqModeActive, setEqModeActive] = useState(false);
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
    // refreshSettings + refreshOutputDevices are stable (useCallback
    // with empty deps).
  }, [refreshSettings, refreshOutputDevices]);

  // Generic value-setter dispatch. `requestType` is the options.*
  // request type; `value` is the wire value. Routes through the
  // canonical `request` op. Re-reads settings on success so the
  // controls reflect persisted truth without waiting for the
  // happening round-trip.
  const dispatchSetter = useCallback(
    async (requestType: string, value: unknown): Promise<AudioSetterResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(transport, OPTIONS_SHELF, requestType, {
        v: PAYLOAD_VERSION,
        value
      });
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      await refreshSettings(transport);
      return { ok: true };
    },
    [refreshSettings]
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
  const setVolumeNormalization = useCallback(
    (value: boolean) =>
      dispatchSetter("options.set_volume_normalization", value),
    [dispatchSetter]
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
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
        OPTIONS_SHELF,
        "options.set_eq_band",
        eqBandToPayload(index, band)
      );
      if (result.error !== undefined) {
        return { ok: false, message: errorMessage(result.error) };
      }
      return { ok: true };
    },
    []
  );

  // Composition-mode select routes through the audio.composition
  // shelf. The plugin answers an OK frame whose `status` carries the
  // verdict, so a format refusal is decoded from the value, not the
  // transport error.
  const selectEqMode = useCallback(
    async (on: boolean): Promise<SelectModeOutcome> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, reason: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
        COMPOSITION_SHELF,
        "composition.select_mode",
        { v: PAYLOAD_VERSION, mode: on ? "eq_only" : "passthrough" }
      );
      if (result.error !== undefined) {
        return { ok: false, reason: errorMessage(result.error) };
      }
      const outcome = decodeSelectModeOutcome(result.value);
      if (outcome.ok) setEqModeActive(on);
      return outcome;
    },
    []
  );

  // EQ preset library verbs on the audio.options shelf. recall
  // emits a single audio.options.changed (field eq_bands), which
  // the happening handler already routes into a settings re-read,
  // so the recalled curve flows back without an extra fetch here.
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
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
        OPTIONS_SHELF,
        "options.save_eq_preset",
        { v: PAYLOAD_VERSION, name, bands: bands.map(eqBandToWire) }
      );
      return presetOpResult(result, "The device refused the preset.");
    },
    []
  );

  const recallEqPreset = useCallback(
    async (name: string): Promise<AudioSetterResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
        OPTIONS_SHELF,
        "options.recall_eq_preset",
        { v: PAYLOAD_VERSION, name }
      );
      return presetOpResult(result, "The device could not recall that preset.");
    },
    []
  );

  const deleteEqPreset = useCallback(
    async (name: string): Promise<AudioSetterResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
        OPTIONS_SHELF,
        "options.delete_eq_preset",
        { v: PAYLOAD_VERSION, name }
      );
      return presetOpResult(result, "The device could not delete that preset.");
    },
    []
  );

  // Resampling carries a `policy` payload, not the generic `value`
  // envelope dispatchSetter sends, so it has its own dispatch.
  const setResampling = useCallback(
    async (policy: ResamplingPolicy): Promise<AudioSetterResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the audio system." };
      }
      const result = await pluginRequest(
        transport,
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
      await refreshSettings(transport);
      return { ok: true };
    },
    [refreshSettings]
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
    setGapless,
    setEqEngaged,
    setEqBand,
    selectEqMode,
    eqModeActive,
    listEqPresets,
    saveEqPreset,
    recallEqPreset,
    deleteEqPreset,
    setResampling,
    verifyInstall,
    emitTestTone
  };
}
