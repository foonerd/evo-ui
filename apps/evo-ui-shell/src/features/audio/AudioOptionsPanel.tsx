// Audio-options operator panel - signal-path / center-stage layout.
//
// The audio chain is a horizontal rail of stages:
//
//   Output -> DAC -> Mixer -> Volume -> Processing
//
// The operator picks one stage and it rises to "center stage" - one
// large, uncrowded editing surface. The other stages collapse to
// compact rail nodes that show their current value. Only the stage
// being configured occupies the screen.
//
// Capability gating is built into the rail, not buried:
//   - the DAC stage is present only on a board with a DAC catalogue
//     (a Pi); an amd64 box never grows that node;
//   - the Volume stage is dimmed and switched off when the mixer is
//     set to None - bit-perfect passthrough has no level to set;
//   - the DAC stage shows only the DSP controls amixer actually
//     reported for the fitted board.
//
// Long waits use the large multiroom-style HeartbeatPanel. The
// reboot-required prompt is a modal with a 15 s timeout. The four
// audio.mixer_transition.* lifecycle outcomes drive the heartbeat
// (applying), inline banners (applied / rolled_back) and a modal
// (failed).

import { Fragment } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Check,
  ChevronRight,
  Cpu,
  Layers,
  Plug,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  Waves,
  Wrench,
  X
} from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import { HeartbeatOverlay } from "../../app/components/HeartbeatOverlay";
import { MAX_CONNECT_ATTEMPTS } from "../../runtime/connect-retry";
import { useAudioOptions } from "./useAudioOptions";
import { useHardwareAudio } from "./useHardwareAudio";
import { useSystemPower } from "../system/useSystemPower";
import { DacOverlayManager } from "./DacOverlayManager";
import { StreamFormatReadout } from "./StreamFormatReadout";
import { EqPanel } from "./EqPanel";
import { EvoSelect } from "../../components/EvoSelect";
import {
  visibleOutputs,
  findSelectedOutput,
  isTransitionInFlight,
  outputClassLabel,
  clampCrossfadeSeconds,
  CROSSFADE_SECONDS_MAX,
  TEST_TONE_FREQ_MIN,
  TEST_TONE_FREQ_MAX,
  TEST_TONE_DURATION_MIN_MS,
  TEST_TONE_DURATION_MAX_MS,
  OUTPUT_CLASS_ORDER,
  type DspControl,
  type TestToneChannel,
  type MixerType,
  type OutputClass,
  type ResamplingPolicy,
  type VerifyInstallReport,
  type VolumeCurve
} from "./audio-options-decoders";

/** Resampling quality options ("" = the soxr default). */
const resamplingQualities = (): ReadonlyArray<{ value: string; label: string }> => [
  { value: "", label: t("audioopt.q.default") },
  { value: "quick", label: t("audioopt.q.quick") },
  { value: "low", label: t("audioopt.q.low") },
  { value: "medium", label: t("audioopt.q.medium") },
  { value: "high", label: t("audioopt.q.high") },
  { value: "very_high", label: t("audioopt.q.veryHigh") }
];

/** Resampling target bit-depth options ("" = match source). */
const resamplingBitdepths = (): ReadonlyArray<{ value: string; label: string }> => [
  { value: "", label: t("audioopt.matchSource") },
  { value: "16", label: "16-bit" },
  { value: "24", label: "24-bit" },
  { value: "32", label: "32-bit" },
  { value: "f", label: "32-bit float" }
];

/** Resampling target sample-rate options ("" = match source). */
const resamplingSamplerates = (): ReadonlyArray<{ value: string; label: string }> =>
  [
    { value: "", label: t("audioopt.matchSource") },
    { value: "44100", label: "44.1 kHz" },
    { value: "48000", label: "48 kHz" },
    { value: "88200", label: "88.2 kHz" },
    { value: "96000", label: "96 kHz" },
    { value: "176400", label: "176.4 kHz" },
    { value: "192000", label: "192 kHz" }
  ];

/** Sentinel option value for "no DAC selected". */
const NONE_VALUE = "__none__";

/** Seconds the reboot-required modal counts down before it
 *  auto-acknowledges. */
const REBOOT_MODAL_SECONDS = 15;

/** The stages of the audio chain, in signal order. */
type StageId = "output" | "dac" | "mixer" | "volume" | "processing";

const STAGE_ORDER: ReadonlyArray<StageId> = [
  "output",
  "dac",
  "mixer",
  "volume",
  "processing"
];

/** Short rail label per stage. */
const stageRailLabel = (id: StageId): string => t(`audioopt.stage.${id}`);

/** Human-readable label for a mixer type. */
function mixerTypeLabel(mt: MixerType): string {
  if (mt === "hardware") return t("audioopt.mixer.hardware");
  if (mt === "none") return t("audioopt.mixer.none");
  return t("audioopt.mixer.software");
}

/** Human-readable label for a volume curve. */
function volumeCurveLabel(c: VolumeCurve): string {
  if (c === "log") return t("audioopt.curve.log");
  if (c === "natural") return t("audioopt.curve.natural");
  return t("audioopt.curve.linear");
}

interface AudioOptionsPanelProps {
  /** Whether the UI-settings backend is reachable. Gates the
   *  volume-step control - a UI preference, not a framework
   *  audio.option. */
  canUseSettings: boolean;
  /** Current +/- volume increment. */
  playbackVolumeStep: number;
  /** Persist a new +/- volume increment. */
  onPlaybackVolumeStepChange: (step: number) => void;
}

export function AudioOptionsPanel({
  canUseSettings,
  playbackVolumeStep,
  onPlaybackVolumeStepChange
}: AudioOptionsPanelProps) {
  useLocale();
  const {
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
  } = useAudioOptions();

  const hw = useHardwareAudio();
  const power = useSystemPower();

  // Every audio-routing control is blocked while a transition is in
  // flight. isTransitionInFlight is true only in the `applying` phase.
  const locked = isTransitionInFlight(transitionPhase);

  // Which stage occupies center stage.
  const [activeStage, setActiveStage] = useState<StageId>("output");

  // Inline operator message from the most recent setter failure.
  const [setterError, setSetterError] = useState<string | null>(null);

  // Which output-class chip is active. Resolved from the persisted
  // output device once the output list lands; null until then.
  const [selectedClass, setSelectedClass] = useState<OutputClass | null>(null);

  // DAC-stage local state.
  const [dacError, setDacError] = useState<string | null>(null);
  const [dacBusy, setDacBusy] = useState(false);

  // Reboot-required modal countdown + dispatch state.
  const [rebootCountdown, setRebootCountdown] =
    useState<number>(REBOOT_MODAL_SECONDS);
  const [rebootBusy, setRebootBusy] = useState(false);
  const [rebootAccepted, setRebootAccepted] = useState(false);
  const [rebootError, setRebootError] = useState<string | null>(null);

  // verify_install self-test state.
  const [verifyReport, setVerifyReport] = useState<VerifyInstallReport | null>(
    null
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  // Output test-tone state.
  const [toneFreq, setToneFreq] = useState(1000);
  const [toneDuration, setToneDuration] = useState(1500);
  const [toneChannel, setToneChannel] = useState<TestToneChannel>("both");
  const [toneBusy, setToneBusy] = useState(false);
  const [toneOutcome, setToneOutcome] = useState<
    { ok: boolean; message: string } | null
  >(null);

  // Auto-dismiss the rolled_back banner after 15 s; the applied
  // confirmation after one read-budget window. The failed modal has
  // NO auto-dismiss - it requires explicit acknowledgement.
  useEffect(() => {
    if (transitionPhase.kind === "rolled_back") {
      const h = window.setTimeout(() => dismissTransition(), 15000);
      return () => window.clearTimeout(h);
    }
    if (transitionPhase.kind === "applied") {
      const h = window.setTimeout(() => dismissTransition(), 2500);
      return () => window.clearTimeout(h);
    }
    return undefined;
  }, [transitionPhase, dismissTransition]);

  // setterError has no lifecycle of its own - it is cleared at the
  // start of the next setter. Auto-dismiss it as well, so a one-off
  // failure cannot linger on the panel after the condition behind it
  // has cleared (e.g. a cold-start transition rollback the framework
  // recovers from on the next attempt).
  useEffect(() => {
    if (setterError === null) return undefined;
    const h = window.setTimeout(() => setSetterError(null), 10000);
    return () => window.clearTimeout(h);
  }, [setterError]);

  // Operator-relevant outputs from the delivery plugin (hidden rows
  // and the framework-internal Loopback dropped).
  const outputs = useMemo(() => visibleOutputs(alsaOutputs), [alsaOutputs]);
  const presentClasses = useMemo(
    () =>
      OUTPUT_CLASS_ORDER.filter((c) =>
        outputs.some((o) => o.outputClass === c)
      ),
    [outputs]
  );

  // The active output (the persisted selection). Drives the Mixer
  // stage: Hardware is offered only when this output declares a
  // hardware volume control.
  const selectedOutput =
    settings !== null
      ? findSelectedOutput(outputs, settings.outputDevice)
      : null;
  const hardwareMixerAvailable =
    selectedOutput !== null && selectedOutput.defaultMixerControl !== null;

  // The DAC stage exists only on a board with a managed-DAC concept
  // (a Pi). No catalogue and no resolved DAC means amd64 - the rail
  // never grows that node.
  const dacStagePresent =
    hw.connection.kind !== "error" &&
    !(
      hw.catalogue.length === 0 &&
      (hw.activeConfig?.catalogueId ?? null) === null
    );

  // Reset a stale active-stage pointer if the DAC stage vanishes.
  useEffect(() => {
    if (!dacStagePresent && activeStage === "dac") {
      setActiveStage("output");
    }
  }, [dacStagePresent, activeStage]);

  // Resolve the chip selection from the persisted output device the
  // first time outputs are available.
  useEffect(() => {
    if (selectedClass !== null || outputs.length === 0) return;
    const current =
      settings !== null
        ? findSelectedOutput(outputs, settings.outputDevice)
        : null;
    const fallback = OUTPUT_CLASS_ORDER.filter((c) =>
      outputs.some((o) => o.outputClass === c)
    )[0];
    setSelectedClass(current?.outputClass ?? fallback ?? null);
  }, [outputs, settings, selectedClass]);

  // Reboot modal: count down from 15 s, then auto-dismiss the
  // reminder (it acknowledges - it never auto-reboots; a reboot is
  // always a deliberate click). The countdown is suspended once a
  // reboot dispatch is in flight. confirmReboot clears the hook's
  // pendingReboot, so the modal then closes on its own.
  useEffect(() => {
    if (!hw.pendingReboot || rebootBusy) {
      setRebootCountdown(REBOOT_MODAL_SECONDS);
      return undefined;
    }
    setRebootCountdown(REBOOT_MODAL_SECONDS);
    const started = Date.now();
    const h = window.setInterval(() => {
      const left =
        REBOOT_MODAL_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(h);
        setRebootCountdown(0);
        void hw.confirmReboot();
      } else {
        setRebootCountdown(left);
      }
    }, 1000);
    return () => window.clearInterval(h);
  }, [hw.pendingReboot, hw.confirmReboot, rebootBusy]);

  // Clear the reboot dispatch state once the prompt is gone.
  useEffect(() => {
    if (!hw.pendingReboot) {
      setRebootBusy(false);
      setRebootAccepted(false);
      setRebootError(null);
    }
  }, [hw.pendingReboot]);

  // ----- gesture handlers --------------------------------------

  const onPickDevice = async (deviceIndex: string): Promise<void> => {
    setSetterError(null);
    if (deviceIndex.length === 0) return;
    const r = await setOutputDevice(deviceIndex);
    if (!r.ok) setSetterError(r.message);
  };

  const onPickMixerType = async (value: MixerType): Promise<void> => {
    setSetterError(null);
    if (value === "hardware") {
      // Hardware mixer coordinates are derived from the selected
      // output - the operator never types ALSA strings by hand.
      if (
        selectedOutput === null ||
        selectedOutput.defaultMixerControl === null
      ) {
        setSetterError(t("audioopt.noHwVolume"));
        return;
      }
      const dev = await setMixerDevice(`hw:${selectedOutput.cardIdx}`);
      if (!dev.ok) {
        setSetterError(dev.message);
        return;
      }
      const ctl = await setMixerControl(selectedOutput.defaultMixerControl);
      if (!ctl.ok) {
        setSetterError(ctl.message);
        return;
      }
    }
    // The mixer-type transition outcome is reported by the lifecycle
    // affordances - the applied confirmation, the rolled_back banner,
    // the failed modal - which are bounded and self-dismissing.
    // Routing it into setterError as well would double-report it and,
    // since setterError clears only on the next setter, leave a stale
    // message on the Mixer stage long after the transition settled.
    // The hardware pre-flight failures above are not transitions, so
    // they keep their own setterError.
    await setMixerType(value);
  };

  const onPickCurve = async (value: VolumeCurve): Promise<void> => {
    setSetterError(null);
    const r = await setVolumeCurve(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onResamplingChange = async (
    policy: ResamplingPolicy
  ): Promise<void> => {
    setSetterError(null);
    const r = await setResampling(policy);
    if (!r.ok) setSetterError(r.message);
  };

  const onDopChange = async (value: boolean): Promise<void> => {
    setSetterError(null);
    const r = await setDop(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onVolumeNormalizationChange = async (
    value: boolean
  ): Promise<void> => {
    setSetterError(null);
    const r = await setVolumeNormalization(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onExclusiveModeChange = async (value: boolean): Promise<void> => {
    setSetterError(null);
    const r = await setExclusiveMode(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onCrossfadeChange = async (raw: number): Promise<void> => {
    setSetterError(null);
    const r = await setCrossfadeSeconds(clampCrossfadeSeconds(raw));
    if (!r.ok) setSetterError(r.message);
  };

  const onGaplessChange = async (value: boolean): Promise<void> => {
    setSetterError(null);
    const r = await setGapless(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onCommitStartup = async (value: number): Promise<void> => {
    setSetterError(null);
    const r = await setStartupVolume(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onCommitMax = async (value: number): Promise<void> => {
    setSetterError(null);
    const r = await setMaxVolume(value);
    if (!r.ok) setSetterError(r.message);
  };

  const onPickDac = async (value: string): Promise<void> => {
    setDacError(null);
    setDacBusy(true);
    const r =
      value === NONE_VALUE ? await hw.clearDac() : await hw.selectDac(value);
    setDacBusy(false);
    if (!r.ok) setDacError(r.message);
  };

  const onSetDspControl = async (
    control: DspControl,
    value: string | number | boolean
  ): Promise<void> => {
    setDacError(null);
    const r = await hw.setDspControl(control.name, value);
    if (!r.ok) setDacError(r.message);
  };

  const onRebootNow = async (): Promise<void> => {
    setRebootError(null);
    setRebootBusy(true);
    const outcome = await power.reboot();
    if (outcome.kind === "accepted") {
      // The host is shutting down. Hold the modal on the
      // "restarting" view; the page reconnects when it is back.
      setRebootAccepted(true);
      return;
    }
    setRebootBusy(false);
    if (outcome.kind === "not_authorised") {
      setRebootError(t("audioopt.reboot.notAuthorised"));
    } else if (outcome.kind === "step_up_required") {
      setRebootError(t("audioopt.reboot.stepUp"));
    } else {
      setRebootError(outcome.message);
    }
  };

  const runSelfTest = async (): Promise<void> => {
    setVerifyBusy(true);
    setVerifyError(null);
    const r = await verifyInstall();
    setVerifyBusy(false);
    if (r.ok) {
      setVerifyReport(r.report);
    } else {
      setVerifyReport(null);
      setVerifyError(r.message);
    }
  };

  const playTestTone = async (): Promise<void> => {
    setToneBusy(true);
    setToneOutcome(null);
    const r = await emitTestTone(toneFreq, toneDuration, toneChannel);
    setToneBusy(false);
    setToneOutcome(
      r.ok
        ? { ok: true, message: t("audioopt.tone.played") }
        : { ok: false, message: r.message }
    );
  };

  // ----- early states ------------------------------------------

  // While the connect is being retried, show the large heartbeat
  // rather than a dead error. The error state is reached only after
  // every retry is exhausted.
  if (
    connection.kind === "connecting" ||
    connection.kind === "disconnected"
  ) {
    const attempt =
      connection.kind === "connecting" ? connection.attempt ?? 1 : 1;
    const label =
      attempt > 1
        ? t("audioopt.reconnecting", { n: attempt, max: MAX_CONNECT_ATTEMPTS })
        : t("audioopt.connecting");
    return (
      <div className="audio-options-panel audio-options-loading">
        <HeartbeatOverlay visible inline size="xl" label={label} />
      </div>
    );
  }

  if (connection.kind === "error") {
    return (
      <div className="audio-options-panel">
        <p className="feature-hint">
          {connection.reason ?? t("audioopt.unreachable")}{" "}
          {t("audioopt.reopenHint")}
        </p>
      </div>
    );
  }

  // Connected, but the first settings read is still in flight.
  if (settings === null) {
    return (
      <div className="audio-options-panel audio-options-loading">
        <HeartbeatOverlay
          visible
          inline
          size="xl"
          label={t("audioopt.loading")}
        />
      </div>
    );
  }

  // ----- derived rail data -------------------------------------

  const volumeOff = settings.mixerType === "none";

  const stageSummary = (id: StageId): string => {
    switch (id) {
      case "output":
        return selectedOutput?.label ?? t("audioopt.notSet");
      case "dac":
        return hw.activeConfig?.displayName ?? "(none)";
      case "mixer":
        return mixerTypeLabel(settings.mixerType);
      case "volume":
        return volumeOff
          ? t("audioopt.notInUse")
          : t("audioopt.startupSummary", { n: settings.startupVolumePercent });
      case "processing":
        return settings.resampling.enabled
          ? t("audioopt.resamplingOn")
          : t("audioopt.resamplingOff");
    }
  };

  const stageIcon = (id: StageId, size: number) => {
    switch (id) {
      case "output":
        return <Plug size={size} />;
      case "dac":
        return <Cpu size={size} />;
      case "mixer":
        return <SlidersHorizontal size={size} />;
      case "volume":
        return <Volume2 size={size} />;
      case "processing":
        return <Waves size={size} />;
    }
  };

  const railStages = STAGE_ORDER.filter(
    (id) => id !== "dac" || dacStagePresent
  );

  // Operator-facing reason the Hardware mixer mode is unavailable.
  const hardwareUnavailableReason = (): string => {
    if (selectedOutput === null) {
      return t("audioopt.pickOutputFirst");
    }
    if (selectedOutput.catalogProvenance === "unmapped") {
      return t("audioopt.notInCatalogue", { label: selectedOutput.label });
    }
    return t("audioopt.noHwControl", { label: selectedOutput.label });
  };

  const outputsInClass = outputs.filter(
    (o) => o.outputClass === selectedClass
  );
  const deviceSelectValue =
    selectedOutput !== null && selectedOutput.outputClass === selectedClass
      ? selectedOutput.alsaId
      : "";

  const dspControls = hw.dspCapabilities?.controls ?? [];
  const showDsp =
    (hw.dspCapabilities?.advancedSettingsEnabled ?? false) &&
    dspControls.length > 0;

  // ----- stage bodies ------------------------------------------

  const stageHeader = (id: StageId, title: string, intent: string) => (
    <header className="audio-stage-head">
      <span className="audio-stage-ic" aria-hidden>
        {stageIcon(id, 22)}
      </span>
      <div>
        <p className="audio-stage-title">{title}</p>
        <p className="audio-stage-intent">{intent}</p>
      </div>
    </header>
  );

  const renderOutputStage = () => (
    <>
      {stageHeader("output", t("audioopt.stage.output"), t("audioopt.intent.output"))}
      {outputs.length === 0 ? (
        <p className="audio-dest-empty">{t("audioopt.noOutputs")}</p>
      ) : (
        <>
          <div
            className="audio-dest-chips"
            role="radiogroup"
            aria-label={t("audioopt.outputTypeAria")}
          >
            {presentClasses.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selectedClass === c}
                className={
                  selectedClass === c
                    ? "audio-dest-chip audio-dest-chip-current"
                    : "audio-dest-chip"
                }
                disabled={locked}
                onClick={() => setSelectedClass(c)}
              >
                {outputClassLabel(c)}
              </button>
            ))}
          </div>
          <label className="settings-label" htmlFor="audio-output-device">
            <span>{t("audioopt.device")}</span>
            <EvoSelect
              ariaLabel={t("audioopt.device")}
              value={deviceSelectValue}
              disabled={locked || outputsInClass.length === 0}
              options={[
                ...(deviceSelectValue === ""
                  ? [{ value: "", label: t("audioopt.selectDevice") }]
                  : []),
                ...outputsInClass.map((o) => ({ value: o.alsaId, label: o.label }))
              ]}
              onChange={(v) => void onPickDevice(v)}
            />
          </label>
        </>
      )}
      <p className="audio-stage-note">{t("audioopt.outputNote")}</p>
    </>
  );

  const renderDacStage = () => {
    const activeId = hw.activeConfig?.catalogueId ?? null;
    return (
      <>
        {stageHeader("dac", t("audioopt.dacTitle"), t("audioopt.intent.dac"))}
        <label className="settings-label" htmlFor="hw-dac-select">
          <span>{t("audioopt.dacBoard")}</span>
          <EvoSelect
            ariaLabel={t("audioopt.dacBoard")}
            value={activeId ?? NONE_VALUE}
            disabled={dacBusy || locked}
            options={[
              { value: NONE_VALUE, label: t("audioopt.noneOption") },
              ...hw.catalogue.map((d) => ({ value: d.id, label: d.displayName }))
            ]}
            onChange={(v) => void onPickDac(v)}
          />
        </label>
        <p className="audio-stage-note">{t("audioopt.dacNote")}</p>

        <StreamFormatReadout format={hw.streamFormat} />

        {showDsp ? (
          <div className="audio-dsp">
            <p className="audio-dsp-title">{t("audioopt.dspTitle")}</p>
            {dspControls.map((c) => (
              <DspControlRow
                key={c.name}
                control={c}
                busy={dacBusy || locked}
                onSet={onSetDspControl}
              />
            ))}
            <p className="audio-stage-note">{t("audioopt.dspOnlyReported")}</p>
          </div>
        ) : (
          <p className="audio-stage-note">{t("audioopt.dspNone")}</p>
        )}

        {dacError !== null ? (
          <div className="audio-options-setter-error" role="alert">
            <span>{dacError}</span>
          </div>
        ) : null}

        {hw.modderSurface !== null ? (
          <section className="audio-dac-modder">
            <header className="audio-stage-head">
              <span className="audio-stage-ic" aria-hidden>
                <Layers size={22} />
              </span>
              <div>
                <p className="audio-stage-title">{t("audioopt.customDac")}</p>
                <p className="audio-stage-intent">{t("audioopt.customDacIntent")}</p>
              </div>
            </header>
            <p className="audio-stage-note">{t("audioopt.customDacNote")}</p>
            <DacOverlayManager
              surface={hw.modderSurface}
              boardProfile={hw.boardProfile}
              busy={dacBusy || locked}
              onRegister={hw.registerOverlay}
              onRemove={hw.removeOverlay}
            />
          </section>
        ) : null}
      </>
    );
  };

  const renderMixerStage = () => (
    <>
      {stageHeader("mixer", t("audioopt.stage.mixer"), t("audioopt.intent.mixer"))}
      <div
        className="audio-mixer-type-group"
        role="radiogroup"
        aria-label={t("audioopt.mixerModeAria")}
      >
        {(["hardware", "software", "none"] as ReadonlyArray<MixerType>).map(
          (mt) => {
            const optionDisabled =
              locked || (mt === "hardware" && !hardwareMixerAvailable);
            return (
              <button
                key={mt}
                type="button"
                role="radio"
                aria-checked={settings.mixerType === mt}
                className={
                  settings.mixerType === mt
                    ? "audio-mixer-type-button audio-mixer-type-current"
                    : "audio-mixer-type-button"
                }
                disabled={optionDisabled}
                title={
                  mt === "hardware" && !hardwareMixerAvailable
                    ? hardwareUnavailableReason()
                    : undefined
                }
                onClick={() => void onPickMixerType(mt)}
              >
                {mixerTypeLabel(mt)}
              </button>
            );
          }
        )}
      </div>
      <p className="audio-stage-note">{t("audioopt.mixerNote")}</p>
      {!hardwareMixerAvailable ? (
        <p className="audio-stage-note">
          {t("audioopt.hwOnlyWhen")} {hardwareUnavailableReason()}
        </p>
      ) : null}
      {setterError !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{setterError}</span>
        </div>
      ) : null}
    </>
  );

  const renderVolumeStage = () => {
    if (volumeOff) {
      return (
        <>
          {stageHeader("volume", t("audioopt.stage.volume"), t("audioopt.intent.volume"))}
          <div className="audio-stage-blocked">
            <span className="audio-stage-blocked-ic" aria-hidden>
              <Volume2 size={26} />
            </span>
            <p>{t("audioopt.volumeOff")}</p>
            <button
              type="button"
              className="audio-stage-blocked-action"
              onClick={() => setActiveStage("mixer")}
            >
              <SlidersHorizontal size={14} />
              <span>{t("audioopt.goToMixer")}</span>
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        {stageHeader("volume", t("audioopt.stage.volume"), t("audioopt.intent.volume"))}
        <label className="settings-label" htmlFor="audio-startup-volume">
          <span>{t("audioopt.startupVolume", { n: settings.startupVolumePercent })}</span>
          <input
            id="audio-startup-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={settings.startupVolumePercent}
            disabled={locked}
            onChange={(ev) =>
              void onCommitStartup(
                Number((ev.currentTarget as HTMLInputElement).value)
              )
            }
          />
        </label>
        <label className="settings-label" htmlFor="audio-max-volume">
          <span>{t("audioopt.maxVolume", { n: settings.maxVolumePercent })}</span>
          <input
            id="audio-max-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={settings.maxVolumePercent}
            disabled={locked}
            onChange={(ev) =>
              void onCommitMax(
                Number((ev.currentTarget as HTMLInputElement).value)
              )
            }
          />
        </label>
        {/* Volume curve: the framework stores this setting but NO
          * code path applies it yet (their admission 2026-07-20,
          * item-1 response). Rule: no silently-inert affordances -
          * disabled with the reason until the wiring lands. */}
        <label className="settings-label" htmlFor="audio-volume-curve">
          <span>{t("audioopt.volumeCurve")}</span>
          <EvoSelect
            ariaLabel={t("audioopt.volumeCurve")}
            value={settings.volumeCurve}
            disabled
            options={(["linear", "log", "natural"] as ReadonlyArray<VolumeCurve>).map(
              (c) => ({ value: c, label: volumeCurveLabel(c) })
            )}
            onChange={(v) => void onPickCurve(v as VolumeCurve)}
          />
        </label>
        <p className="feature-description settings-help">
          {t("audioopt.curveUnwired")}
        </p>
        {canUseSettings ? (
          <label className="settings-label" htmlFor="audio-volume-step">
            <span>{t("audioopt.volumeStep")}</span>
            <EvoSelect
              ariaLabel={t("audioopt.volumeStep")}
              value={String(playbackVolumeStep)}
              options={[1, 2, 3, 5, 10, 15, 20].map((step) => ({
                value: String(step),
                label: String(step)
              }))}
              onChange={(v) => onPlaybackVolumeStepChange(Number(v))}
            />
          </label>
        ) : null}
        <p className="audio-stage-note">{t("audioopt.volumeNote")}</p>
      </>
    );
  };

  const renderProcessingStage = () => (
    <>
      {stageHeader("processing", t("audioopt.stage.processing"), t("audioopt.intent.processing"))}
      <label className="settings-label" htmlFor="audio-exclusive">
        <span>{t("audioopt.exclusive")}</span>
        <input
          id="audio-exclusive"
          type="checkbox"
          className="audio-toggle"
          checked={settings.exclusiveMode}
          disabled={locked}
          onChange={(ev) =>
            void onExclusiveModeChange(
              (ev.currentTarget as HTMLInputElement).checked
            )
          }
        />
      </label>

      <label className="settings-label" htmlFor="audio-resampling">
        <span>{t("audioopt.resample")}</span>
        <input
          id="audio-resampling"
          type="checkbox"
          className="audio-toggle"
          checked={settings.resampling.enabled}
          disabled={locked || settings.exclusiveMode}
          onChange={(ev) =>
            void onResamplingChange({
              ...settings.resampling,
              enabled: (ev.currentTarget as HTMLInputElement).checked
            })
          }
        />
      </label>
      {settings.resampling.enabled ? (
        <>
          <label
            className="settings-label"
            htmlFor="audio-resampling-quality"
          >
            <span>{t("audioopt.resampleQuality")}</span>
            <EvoSelect
              ariaLabel={t("audioopt.resampleQuality")}
              value={settings.resampling.quality}
              disabled={locked || settings.exclusiveMode}
              options={resamplingQualities().map((o) => ({
                value: String(o.value),
                label: o.label
              }))}
              onChange={(v) =>
                void onResamplingChange({ ...settings.resampling, quality: v })
              }
            />
          </label>
          <label
            className="settings-label"
            htmlFor="audio-resampling-bitdepth"
          >
            <span>{t("audioopt.bitDepth")}</span>
            <EvoSelect
              ariaLabel={t("audioopt.bitDepth")}
              value={settings.resampling.targetBitdepth}
              disabled={locked || settings.exclusiveMode}
              options={resamplingBitdepths().map((o) => ({
                value: String(o.value),
                label: o.label
              }))}
              onChange={(v) =>
                void onResamplingChange({
                  ...settings.resampling,
                  targetBitdepth: v
                })
              }
            />
          </label>
          <label
            className="settings-label"
            htmlFor="audio-resampling-samplerate"
          >
            <span>{t("audioopt.sampleRate")}</span>
            <EvoSelect
              ariaLabel={t("audioopt.sampleRate")}
              value={settings.resampling.targetSamplerate}
              disabled={locked || settings.exclusiveMode}
              options={resamplingSamplerates().map((o) => ({
                value: String(o.value),
                label: o.label
              }))}
              onChange={(v) =>
                void onResamplingChange({
                  ...settings.resampling,
                  targetSamplerate: v
                })
              }
            />
          </label>
        </>
      ) : null}

      <label className="settings-label" htmlFor="audio-dop">
        <span>{t("audioopt.dop")}</span>
        <input
          id="audio-dop"
          type="checkbox"
          className="audio-toggle"
          checked={settings.dop}
          disabled={locked}
          onChange={(ev) =>
            void onDopChange((ev.currentTarget as HTMLInputElement).checked)
          }
        />
      </label>

      <label className="settings-label" htmlFor="audio-volume-normalization">
        <span>{t("audioopt.normalization")}</span>
        <input
          id="audio-volume-normalization"
          type="checkbox"
          className="audio-toggle"
          checked={settings.volumeNormalization}
          disabled={locked}
          onChange={(ev) =>
            void onVolumeNormalizationChange(
              (ev.currentTarget as HTMLInputElement).checked
            )
          }
        />
      </label>

      <label className="settings-label" htmlFor="audio-crossfade">
        <span>{t("audioopt.crossfade")}</span>
        <input
          id="audio-crossfade"
          type="number"
          min={0}
          max={CROSSFADE_SECONDS_MAX}
          step={1}
          value={settings.crossfadeSeconds}
          disabled={locked}
          onChange={(ev) =>
            void onCrossfadeChange(
              Number((ev.currentTarget as HTMLInputElement).value)
            )
          }
        />
      </label>

      <label className="settings-label" htmlFor="audio-gapless">
        <span>{t("audioopt.gapless")}</span>
        <input
          id="audio-gapless"
          type="checkbox"
          className="audio-toggle"
          checked={settings.gapless}
          disabled={locked}
          onChange={(ev) =>
            void onGaplessChange(
              (ev.currentTarget as HTMLInputElement).checked
            )
          }
        />
      </label>

      <p className="audio-stage-note">{t("audioopt.processingNote")}</p>

      <div className="audio-eq-section">
        <p className="audio-dsp-title">{t("audioopt.eqTitle")}</p>
        <EqPanel
          bands={settings.eqBands}
          engaged={settings.eqEngaged}
          modeActive={eqModeActive}
          locked={locked}
          setBand={setEqBand}
          setEngaged={setEqEngaged}
          selectMode={selectEqMode}
          listPresets={listEqPresets}
          savePreset={saveEqPreset}
          recallPreset={recallEqPreset}
          deletePreset={deleteEqPreset}
        />
      </div>
    </>
  );

  const renderStage = (id: StageId) => {
    switch (id) {
      case "output":
        return renderOutputStage();
      case "dac":
        return renderDacStage();
      case "mixer":
        return renderMixerStage();
      case "volume":
        return renderVolumeStage();
      case "processing":
        return renderProcessingStage();
    }
  };

  // ----- transition affordance copy ----------------------------

  const applying = transitionPhase.kind === "applying";
  const applyingSublabel =
    transitionPhase.kind === "applying"
      ? t("audioopt.switching", {
          from: mixerTypeLabel(transitionPhase.from),
          to: mixerTypeLabel(transitionPhase.to)
        })
      : undefined;

  return (
    <div className="audio-options-panel">
      {/* Signal-path rail ------------------------------------- */}
      <nav className="audio-rail" aria-label={t("audioopt.railAria")}>
        {railStages.map((id, i) => {
          const isActive = activeStage === id;
          const dim = id === "volume" && volumeOff;
          const cls = [
            "audio-rail-node",
            isActive ? "audio-rail-node-active" : "",
            dim ? "audio-rail-node-dim" : ""
          ]
            .filter((s) => s !== "")
            .join(" ");
          return (
            <Fragment key={id}>
              <button
                type="button"
                className={cls}
                aria-pressed={isActive}
                onClick={() => setActiveStage(id)}
              >
                <span className="audio-rail-ic" aria-hidden>
                  {stageIcon(id, 19)}
                </span>
                <span className="audio-rail-name">
                  {stageRailLabel(id)}
                </span>
                <span className="audio-rail-val">{stageSummary(id)}</span>
              </button>
              {i < railStages.length - 1 ? (
                <span className="audio-rail-conn" aria-hidden>
                  <ChevronRight size={14} />
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </nav>

      {/* applied transient confirmation ----------------------- */}
      {transitionPhase.kind === "applied" ? (
        <div
          className="audio-transition-applied"
          role="status"
          aria-live="polite"
        >
          {t("audioopt.applied", {
            mode: mixerTypeLabel(transitionPhase.to),
            level: transitionPhase.effectiveLevel
          })}
        </div>
      ) : null}

      {/* rolled_back non-modal banner ------------------------- */}
      {transitionPhase.kind === "rolled_back" ? (
        <div className="audio-transition-banner" role="alert">
          <div className="audio-transition-banner-text">
            <strong>{t("audioopt.reverted")}</strong>
            <span>
              {transitionPhase.reason} {t("audioopt.revertedBody")}
            </span>
          </div>
          <button
            type="button"
            className="audio-transition-banner-dismiss"
            onClick={dismissTransition}
            aria-label={t("audioopt.dismiss")}
            title={t("audioopt.dismiss")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Center stage ----------------------------------------- */}
      <section className="audio-stage" aria-live="polite">
        {renderStage(activeStage)}
      </section>

      {/* Advanced - hardware diagnostics ---------------------- */}
      <details className="audio-advanced">
        <summary className="audio-advanced-summary">
          <Wrench size={13} aria-hidden />
          <span>{t("audioopt.advanced")}</span>
        </summary>
        <div className="audio-advanced-body">
          <div className="audio-selftest-row">
            <button
              type="button"
              onClick={() => void runSelfTest()}
              disabled={verifyBusy}
            >
              {verifyBusy
                ? t("audioopt.selftestRunning")
                : t("audioopt.selftestRun")}
            </button>
          </div>
          <p className="audio-stage-note">{t("audioopt.selftestNote")}</p>
          {verifyError !== null ? (
            <p className="audio-options-hint-warning" role="alert">
              {verifyError}
            </p>
          ) : null}

          <div className="audio-testtone">
            <p className="audio-dsp-title">{t("audioopt.toneTitle")}</p>
            <label className="settings-label" htmlFor="tone-freq">
              <span>{t("audioopt.freq")}</span>
              <input
                id="tone-freq"
                type="number"
                min={TEST_TONE_FREQ_MIN}
                max={TEST_TONE_FREQ_MAX}
                step={10}
                value={toneFreq}
                disabled={toneBusy}
                onInput={(ev) =>
                  setToneFreq(
                    Number((ev.currentTarget as HTMLInputElement).value)
                  )
                }
              />
            </label>
            <label className="settings-label" htmlFor="tone-duration">
              <span>{t("audioopt.durationMs")}</span>
              <input
                id="tone-duration"
                type="number"
                min={TEST_TONE_DURATION_MIN_MS}
                max={TEST_TONE_DURATION_MAX_MS}
                step={100}
                value={toneDuration}
                disabled={toneBusy}
                onInput={(ev) =>
                  setToneDuration(
                    Number((ev.currentTarget as HTMLInputElement).value)
                  )
                }
              />
            </label>
            <label className="settings-label" htmlFor="tone-channel">
              <span>{t("audioopt.channel")}</span>
              <EvoSelect
                ariaLabel={t("audioopt.channel")}
                value={toneChannel}
                disabled={toneBusy}
                options={[
                  { value: "both", label: t("audioopt.chBoth") },
                  { value: "left", label: t("audioopt.chLeft") },
                  { value: "right", label: t("audioopt.chRight") }
                ]}
                onChange={(v) => setToneChannel(v as TestToneChannel)}
              />
            </label>
            <div className="audio-selftest-row">
              <button
                type="button"
                onClick={() => void playTestTone()}
                disabled={toneBusy}
              >
                {toneBusy ? t("audioopt.tonePlaying") : t("audioopt.tonePlay")}
              </button>
            </div>
            <p className="audio-stage-note">{t("audioopt.toneNote")}</p>
            {toneOutcome !== null ? (
              <p
                className={
                  toneOutcome.ok
                    ? "audio-modder-ok"
                    : "audio-options-hint-warning"
                }
                role={toneOutcome.ok ? "status" : "alert"}
              >
                {toneOutcome.message}
              </p>
            ) : null}
          </div>

          {verifyReport !== null ? (
            <ul
              className={`audio-verify-checklist audio-verify-${verifyReport.status}`}
            >
              {verifyReport.probes.map((p) => (
                <li
                  key={p.name}
                  className={
                    p.ok ? "audio-verify-ok" : "audio-verify-failed"
                  }
                >
                  <span className="audio-verify-mark" aria-hidden>
                    {p.ok ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <span className="audio-verify-text">
                    <strong>{p.name}</strong>
                    <span>{p.diagnostic}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      {/* "Applying audio mode" - large heartbeat -------------- */}
      <HeartbeatPanel
        visible={applying}
        scrim
        headline={t("audioopt.applying")}
        sublabel={applyingSublabel}
      />

      {/* failed modal (explicit ack) -------------------------- */}
      {transitionPhase.kind === "failed" ? (
        <div
          className="audio-transition-modal-root"
          role="alertdialog"
          aria-modal="true"
          aria-label={t("audioopt.failedTitle")}
        >
          <div className="audio-transition-modal-card">
            <h4>{t("audioopt.failedTitle")}</h4>
            <p>{t("audioopt.failedBody", { reason: transitionPhase.reason })}</p>
            <p>{t("audioopt.failedRecover")}</p>
            <div className="audio-transition-modal-actions">
              <button type="button" onClick={dismissTransition}>
                <RefreshCw size={14} />
                <span>{t("audioopt.ack")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* reboot-required modal -------------------------------- */}
      {hw.pendingReboot && transitionPhase.kind !== "failed" ? (
        <div
          className="audio-reboot-modal-root"
          role="alertdialog"
          aria-modal="true"
          aria-label={t("audioopt.rebootTitle")}
        >
          <div className="audio-reboot-modal-card">
            <span className="audio-reboot-modal-ic" aria-hidden>
              <Power size={22} />
            </span>
            {rebootAccepted ? (
              <>
                <h4>{t("audioopt.restarting")}</h4>
                <p>{t("audioopt.restartingBody")}</p>
              </>
            ) : (
              <>
                <h4>{t("audioopt.rebootTitle")}</h4>
                <p>{t("audioopt.rebootBody")}</p>
                <p className="audio-reboot-count">
                  {power.available
                    ? t("audioopt.rebootCountPower", { s: rebootCountdown })
                    : t("audioopt.rebootCountNoPower", { s: rebootCountdown })}
                </p>
                {rebootError !== null ? (
                  <div
                    className="audio-options-setter-error"
                    role="alert"
                  >
                    <span>{rebootError}</span>
                  </div>
                ) : null}
                <div className="audio-reboot-modal-actions">
                  <button
                    type="button"
                    className="audio-reboot-secondary"
                    disabled={rebootBusy}
                    onClick={() => void hw.confirmReboot()}
                  >
                    {power.available ? t("audioopt.later") : t("audioopt.gotIt")}
                  </button>
                  {power.available ? (
                    <button
                      type="button"
                      disabled={rebootBusy}
                      onClick={() => void onRebootNow()}
                    >
                      <RefreshCw size={14} />
                      <span>
                        {rebootBusy ? t("audioopt.rebooting") : t("audioopt.rebootNow")}
                      </span>
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface DspControlRowProps {
  control: DspControl;
  busy: boolean;
  onSet: (
    control: DspControl,
    value: string | number | boolean
  ) => void | Promise<void>;
}

/** One DSP control, rendered by its value-domain kind, with its
 *  description and catalogue-recommended value surfaced beneath it.
 *
 *  A control amixer could not read (`bound = false`) is disabled.
 *  An enum the framework resolved but did not enumerate (empty
 *  `enumValues`) is disabled too - there are no alternatives to
 *  pick - but it still shows its current value rather than a blank
 *  box. */
function DspControlRow({ control, busy, onSet }: DspControlRowProps) {
  useLocale();
  const disabled = busy || !control.bound;
  const id = `dsp-${control.name}`;

  const widget = () => {
    if (control.kind === "boolean") {
      return (
        <label className="settings-label" htmlFor={id}>
          <span>{control.label}</span>
          <input
            id={id}
            type="checkbox"
            className="audio-toggle"
            checked={control.currentValue === true}
            disabled={disabled}
            onChange={(ev) =>
              void onSet(
                control,
                (ev.currentTarget as HTMLInputElement).checked
              )
            }
          />
        </label>
      );
    }

    if (control.kind === "integer" || control.kind === "db_scale") {
      return (
        <label className="settings-label" htmlFor={id}>
          <span>{control.label}</span>
          <input
            id={id}
            type="number"
            value={
              typeof control.currentValue === "number"
                ? control.currentValue
                : ""
            }
            min={control.rangeMin ?? undefined}
            max={control.rangeMax ?? undefined}
            disabled={disabled}
            onChange={(ev) => {
              const n = Number((ev.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(n)) void onSet(control, n);
            }}
          />
        </label>
      );
    }

    // Enum. Always include the current value among the options so
    // the control shows what it is set to even when the framework
    // returned an empty options list.
    const current =
      typeof control.currentValue === "string" ? control.currentValue : "";
    const options =
      current.length > 0 && !control.enumValues.includes(current)
        ? [current, ...control.enumValues]
        : [...control.enumValues];
    return (
      <label className="settings-label" htmlFor={id}>
        <span>{control.label}</span>
        <EvoSelect
          ariaLabel={control.label}
          value={current}
          disabled={disabled || control.enumValues.length === 0}
          options={options.map((v) => ({ value: v, label: v }))}
          onChange={(v) => void onSet(control, v)}
        />
      </label>
    );
  };

  // An enum the framework resolved but left without options: the
  // current value shows, but it cannot be changed until the
  // framework enumerates the choices.
  const noChoices =
    control.kind === "enum" &&
    control.bound &&
    control.enumValues.length === 0;

  return (
    <div className="audio-dsp-control">
      {widget()}
      {control.description.length > 0 ? (
        <p className="audio-dsp-control-desc">{control.description}</p>
      ) : null}
      {control.recommendedDefault !== null ? (
        <p className="audio-dsp-control-rec">
          {t("audioopt.recommended", { v: String(control.recommendedDefault) })}
        </p>
      ) : null}
      {noChoices ? (
        <p className="audio-dsp-control-desc">{t("audioopt.noSelectable")}</p>
      ) : null}
    </div>
  );
}
