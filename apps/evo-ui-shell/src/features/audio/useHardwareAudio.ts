// Hardware-audio state hook.
//
// Consumes org.evoframework.hardware.audio-config: the DAC catalogue,
// the active DAC config, and the per-DAC DSP control set, plus the
// select_dac / clear_dac / confirm_reboot_required / dsp.set_control
// gestures.
//
// Mirrors useAudioOptions: pure decode lives in
// ./audio-options-decoders.ts; the request verbs are read at mount
// and re-read after each gesture; a subscribe_happenings
// subscription re-reads on framework-side hardware.audio changes
// (another client's gesture, or the bare-overlay failsafe
// re-publish). The framework's subscribe surface went live this
// cycle; before that this re-read path was inert.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { connectWithRetry } from "../../runtime/connect-retry";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import {
  decodeActiveDacConfig,
  decodeDacCatalogue,
  decodeCatalogueProfile,
  decodeDspCapabilities,
  decodeDacRebootRequired,
  decodeModderSurface,
  extractPluginEvent,
  type ActiveDacConfig,
  type DacCatalogueEntry,
  type DspCapabilities,
  type ModderSurface
} from "./audio-options-decoders";
import {
  decodeStreamFormatHappening,
  type StreamFormat
} from "./stream-format-decoders";

/** Connection lifecycle, mirrors the multi-room / audio hooks. */
export type HardwareAudioConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface HardwareAudioConnectionState {
  kind: HardwareAudioConnectionKind;
  reason?: string;
}

/** Result of a gesture dispatch. */
export type HardwareAudioResult =
  | { ok: true }
  | { ok: false; message: string };

/** Operator inputs for register_overlay. The hook assembles the
 *  RegisterOverlayPayload wire shape from this. */
export interface ModderRegisterInput {
  id: string;
  displayName: string;
  boardProfile: string;
  /** Bus topology: i2s / usb / spdif / hdmi / analog / bluetooth. */
  interface: string;
  /** dtoverlay token written to the boot config on select_dac. */
  overlay: string;
  alsaCardHint: string;
  inCardMixer: string;
  dspOptions: ReadonlyArray<string>;
  overrideBase: boolean;
  /** Raw DTBO blob bytes. */
  dtboBytes: ReadonlyArray<number>;
  /** SHA-256 of dtboBytes, hex-encoded. */
  dtboSha256: string;
  /** Two-step-confirm token; the literal `CONFIRM:<id>`. */
  confirmationToken: string;
}

/** Public surface of the hook. */
export interface HardwareAudioState {
  connection: HardwareAudioConnectionState;
  /** DAC catalogue for the host board profile. */
  catalogue: ReadonlyArray<DacCatalogueEntry>;
  /** Active DAC config, or null before the first successful read. */
  activeConfig: ActiveDacConfig | null;
  /** DSP capability set for the active DAC, or null before first
   *  read. */
  dspCapabilities: DspCapabilities | null;
  /** True when a select / clear is awaiting a device reboot. */
  pendingReboot: boolean;
  /** Registered custom-DAC overlays + the modder surface state, or
   *  null before the first read. */
  modderSurface: ModderSurface | null;
  /** Host board profile from the DAC catalogue - a registered
   *  overlay row must declare it. */
  boardProfile: string;
  /** Live stream format published by the playback warden, or null
   *  until the first stream_format subject-state happening is
   *  observed (nothing has played since this session connected). */
  streamFormat: StreamFormat | null;
  /** Select a DAC by catalogue id. Writes the boot-config overlay. */
  selectDac: (id: string) => Promise<HardwareAudioResult>;
  /** Clear the managed DAC overlay. */
  clearDac: () => Promise<HardwareAudioResult>;
  /** Acknowledge the reboot prompt (clears the pending state). */
  confirmReboot: () => Promise<HardwareAudioResult>;
  /** Write a DSP control value. */
  setDspControl: (
    control: string,
    value: string | number | boolean
  ) => Promise<HardwareAudioResult>;
  /** Register a custom-DAC overlay from an uploaded DTBO blob. */
  registerOverlay: (
    input: ModderRegisterInput
  ) => Promise<HardwareAudioResult>;
  /** Remove a registered custom-DAC overlay by id. */
  removeOverlay: (id: string) => Promise<HardwareAudioResult>;
}

const SHELF = "hardware.audio";
const PAYLOAD_VERSION = 1;

function frameworkUrl(): string {
  if (typeof window === "undefined") return "ws://localhost/api/v1/ws";
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "The audio hardware refused the change.";
}

/** True when a happening frame concerns the hardware.audio plugin -
 *  either a `hardware.audio.*` plugin event or a SubjectStateChanged
 *  for a `hardware_audio_*` subject. Used as a re-read trigger. */
function isHardwareAudioHappening(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const frame = extractPluginEvent(raw);
  if ((frame?.eventType ?? "").startsWith("hardware.audio")) return true;
  const rec = raw as Record<string, unknown>;
  const inner =
    typeof rec["happening"] === "object" && rec["happening"] !== null
      ? (rec["happening"] as Record<string, unknown>)
      : rec;
  const subjectType = inner["subject_type"];
  return (
    typeof subjectType === "string" &&
    subjectType.startsWith("hardware_audio")
  );
}

export function useHardwareAudio(): HardwareAudioState {
  const [connection, setConnection] = useState<HardwareAudioConnectionState>({
    kind: "connecting"
  });
  const [catalogue, setCatalogue] = useState<
    ReadonlyArray<DacCatalogueEntry>
  >([]);
  const [activeConfig, setActiveConfig] = useState<ActiveDacConfig | null>(
    null
  );
  const [dspCapabilities, setDspCapabilities] =
    useState<DspCapabilities | null>(null);
  const [pendingReboot, setPendingReboot] = useState(false);
  const [modderSurface, setModderSurface] = useState<ModderSurface | null>(
    null
  );
  const [boardProfile, setBoardProfile] = useState("");
  const [streamFormat, setStreamFormat] = useState<StreamFormat | null>(null);
  const transportRef = useRef<WsTransport | null>(null);

  // Re-read the active config + DSP controls via the canonical
  // `request` op. Called at connect and after every gesture or
  // relevant happening.
  const refreshState = useCallback(
    async (transport: WsTransport): Promise<void> => {
      const cfg = await pluginRequest(
        transport,
        SHELF,
        "hardware.audio.current_config",
        { v: PAYLOAD_VERSION }
      );
      if (cfg.error === undefined) {
        const decoded = decodeActiveDacConfig(cfg.value);
        if (decoded !== null) setActiveConfig(decoded);
      }
      const dsp = await pluginRequest(
        transport,
        SHELF,
        "hardware.audio.dsp.list_controls",
        { v: PAYLOAD_VERSION }
      );
      if (dsp.error === undefined) {
        const decoded = decodeDspCapabilities(dsp.value);
        if (decoded !== null) setDspCapabilities(decoded);
      }
      const overlays = await pluginRequest(
        transport,
        SHELF,
        "hardware.audio.modder.list_overlays",
        { v: PAYLOAD_VERSION }
      );
      if (overlays.error === undefined) {
        const decoded = decodeModderSurface(overlays.value);
        if (decoded !== null) setModderSurface(decoded);
      }
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
          () => {
            if (!cancelled) setConnection({ kind: "connecting" });
          },
          () => cancelled
        );
        if (cancelled) return;
        setConnection({ kind: "connected" });
        const cat = await pluginRequest(
          transport,
          SHELF,
          "hardware.audio.list_dac_catalogue",
          { v: PAYLOAD_VERSION }
        );
        if (!cancelled && cat.error === undefined) {
          setCatalogue(decodeDacCatalogue(cat.value));
          setBoardProfile(decodeCatalogueProfile(cat.value));
        }
        await refreshState(transport);
        if (cancelled) return;

        const handleHappening = (raw: unknown): void => {
          if (cancelled) return;
          // The playback warden's stream_format subject rides the
          // same happenings stream as a subject_state_changed frame.
          const sf = decodeStreamFormatHappening(raw);
          if (sf !== null) {
            setStreamFormat(sf);
            return;
          }
          if (isHardwareAudioHappening(raw)) {
            void refreshState(transport);
          }
        };
        const abort = new AbortController();
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: abort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              handleHappening(event);
            }
          } catch {
            // Subscription ended; transport reconnect re-establishes.
          }
        })();
        transport.onHappening((f) => handleHappening(f.happening));
      } catch (err) {
        if (cancelled) return;
        setConnection({
          kind: "error",
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    };
    void seed();

    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
    };
  }, [refreshState]);

  // Generic gesture dispatch through the canonical `request` op.
  // Re-reads state on success so the panel reflects persisted truth.
  const dispatch = useCallback(
    async (
      requestType: string,
      payload: Record<string, unknown>
    ): Promise<{ result: HardwareAudioResult; value: unknown }> => {
      const transport = transportRef.current;
      if (transport === null) {
        return {
          result: {
            ok: false,
            message: "Not connected to the audio hardware."
          },
          value: null
        };
      }
      const r = await pluginRequest(transport, SHELF, requestType, payload);
      if (r.error !== undefined) {
        return {
          result: { ok: false, message: errorMessage(r.error) },
          value: null
        };
      }
      await refreshState(transport);
      return { result: { ok: true }, value: r.value };
    },
    [refreshState]
  );

  const selectDac = useCallback(
    async (id: string): Promise<HardwareAudioResult> => {
      const { result, value } = await dispatch("hardware.audio.select_dac", {
        v: PAYLOAD_VERSION,
        id
      });
      if (result.ok && decodeDacRebootRequired(value)) setPendingReboot(true);
      return result;
    },
    [dispatch]
  );

  const clearDac = useCallback(async (): Promise<HardwareAudioResult> => {
    const { result, value } = await dispatch("hardware.audio.clear_dac", {
      v: PAYLOAD_VERSION
    });
    if (result.ok && decodeDacRebootRequired(value)) setPendingReboot(true);
    return result;
  }, [dispatch]);

  const confirmReboot = useCallback(async (): Promise<HardwareAudioResult> => {
    const { result } = await dispatch(
      "hardware.audio.confirm_reboot_required",
      { v: PAYLOAD_VERSION }
    );
    if (result.ok) setPendingReboot(false);
    return result;
  }, [dispatch]);

  const setDspControl = useCallback(
    async (
      control: string,
      value: string | number | boolean
    ): Promise<HardwareAudioResult> => {
      const { result } = await dispatch("hardware.audio.dsp.set_control", {
        v: PAYLOAD_VERSION,
        control,
        value
      });
      return result;
    },
    [dispatch]
  );

  const registerOverlay = useCallback(
    async (input: ModderRegisterInput): Promise<HardwareAudioResult> => {
      const { result } = await dispatch(
        "hardware.audio.modder.register_overlay",
        {
          v: PAYLOAD_VERSION,
          row: {
            id: input.id,
            display_name: input.displayName,
            board_profile: input.boardProfile,
            interface: input.interface,
            overlay: input.overlay,
            dtbo_sha256_hex: input.dtboSha256,
            alsa_card_hint: input.alsaCardHint,
            in_card_mixer: input.inCardMixer,
            dsp_options: [...input.dspOptions],
            override_base: input.overrideBase
          },
          dtbo_sha256_hex: input.dtboSha256,
          dtbo_bytes: [...input.dtboBytes],
          confirmation_token: input.confirmationToken
        }
      );
      return result;
    },
    [dispatch]
  );

  const removeOverlay = useCallback(
    async (id: string): Promise<HardwareAudioResult> => {
      const { result } = await dispatch(
        "hardware.audio.modder.remove_overlay",
        { v: PAYLOAD_VERSION, id }
      );
      return result;
    },
    [dispatch]
  );

  return {
    connection,
    catalogue,
    activeConfig,
    dspCapabilities,
    pendingReboot,
    modderSurface,
    boardProfile,
    streamFormat,
    selectDac,
    clearDac,
    confirmReboot,
    setDspControl,
    registerOverlay,
    removeOverlay
  };
}
