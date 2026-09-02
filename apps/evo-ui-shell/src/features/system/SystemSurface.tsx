import { useEffect, useMemo, useState } from "preact/hooks";
import type { CapabilityStatus, HealthPayload, UiEventFrame } from "../../core/types";
import { GatewayClient } from "../../core/gateway-client";
import { useSystemState } from "./useSystemState";
import { runCommandAction } from "../../core/command-action";
import { useAsyncAction } from "../../core/useAsyncAction";
import type { NewCommandLogEntry } from "../../core/command-log";
import { shouldReconcileFromEvent } from "../../core/reconcile-policy";
import { combineCapabilityStatuses } from "../../core/capability-status";
import { formatRequestDetail } from "../../core/request-id";
import { shouldRefreshFromAnomaly } from "../../core/anomaly-refresh";
import { DomainHistoryView } from "../activity/DomainHistory";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { DispositionPanel } from "../activity/DispositionPanel";
import { MultiroomSurface } from "../multiroom/MultiroomSurface";
import { AudioOptionsPanel } from "../audio/AudioOptionsPanel";
import { PluginLifecyclePanel } from "./PluginLifecyclePanel";
import { CredentialsPanel } from "../credentials/CredentialsPanel";
import { ArtworkSettingsPanel } from "./ArtworkSettingsPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { CreditsPanel } from "./CreditsPanel";
import type { DomainIconResolver } from "../../core/domain-icons";
import { settingsGroupDedicatedViewLabel } from "./settings-group-affordances";
import { readSessionScope } from "../../runtime/session-scope";
import { Fragment } from "preact";
import { NotificationSettingsRows } from "../notifications/NotificationSettingsRows";
import { KioskDisplayPanel } from "../kiosk/KioskDisplayPanel";
import { inKioskBrowser } from "../kiosk/kiosk-bridge";
import { PairingSettingsRow } from "../pairing/PairingSettingsRow";
import { NetworkLanding } from "../network/NetworkLanding";
import { SmbServerSurface } from "../sources/SmbServerSurface";
import {
  Activity,
  Archive,
  Boxes,
  ChevronRight,
  DownloadCloud,
  Lock,
  MonitorSmartphone,
  Power,
  RotateCcw,
  Unlock,
  Wrench
} from "lucide-preact";
import {
  useSystemPowerConfirm,
  SystemPowerConfirmModal
} from "./SystemPowerConfirm";
import {
  DiagnosticsSurface,
  type DiagnosticsSurfaceProps
} from "./DiagnosticsSurface";
import { useNetworkLink } from "../network/useNetworkLink";
import {
  bandLabel,
  collectCaptiveValues
} from "../network/network-nm-decoders";
import type {
  CaptiveField,
  CaptiveForm,
  NetworkIntent
} from "../network/network-nm-decoders";

// Settings hub-of-groups. Twelve groups, each its own sub-page reached
// from a grid landing. Pre-design-review structural skeleton; the UI
// design team's CONCEPT will inform the per-group visual polish at
// review time. Existing implemented surfaces (Appearance, Audio volume
// step, Network status, About) live in their new group homes; new
// groups land as honest placeholders naming the ADRs that will land
// their content.
type SettingsGroupId =
  | "library"
  | "audio"
  | "multi-room"
  | "cast"
  | "sources"
  | "file-sharing"
  | "network"
  | "metadata"
  | "smart-home"
  | "system"
  | "activity"
  | "about";

type GroupAvailability = "available" | "partial" | "coming";

// Group titles + descriptions live in the message catalog under
// settings.group.<id>.title / .description and resolve at render
// time so a locale switch repaints the landing grid live.
const SETTINGS_GROUPS: ReadonlyArray<SettingsGroupId> = [
  "library",
  "audio",
  "multi-room",
  "cast",
  "sources",
  "file-sharing",
  "network",
  "metadata",
  "smart-home",
  "system",
  "activity",
  "about"
] as const;

const groupTitle = (id: SettingsGroupId): string =>
  t(`settings.group.${id}.title` as never);
const groupDescription = (id: SettingsGroupId): string =>
  t(`settings.group.${id}.description` as never);

interface SystemSurfaceProps {
  networkStatus: CapabilityStatus;
  settingsStatus: CapabilityStatus;
  settingsRealtimeStatus: CapabilityStatus;
  client: GatewayClient;
  lastEvent: UiEventFrame | null;
  runInFlight: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  streamOpen: boolean;
  anomalySignal: number;
  onCommandLog: (entry: NewCommandLogEntry) => void;
  playbackVolumeStep: number;
  onPlaybackVolumeStepChange: (step: number) => void;
  /** Shared collection view mode - consumed by the embedded
   *  Multi-room cockpit. The Appearance ROW retired in slice 3; the
   *  designer Pages control owns the device default. */
  collectionViewMode: "list" | "tile";
  onCollectionViewModeChange: (mode: "list" | "tile") => void;
  health: HealthPayload | null;
  settingsRevision: number | null;
  activeSubPage: string | null;
  onSubPageChange: (subPage: string | null) => void;
  /** Navigate the top-level shell to the Multi-room management
   *  surface. Settings -> Multi-room is a shortcut into that surface
   *  rather than duplicating its content inside Settings. */
  onOpenMultiroom: () => void;
  /** Live diagnostics data for the System surface's Diagnostics
   *  stage - connection, runtime, event-stream and command-log. */
  diagnostics: DiagnosticsSurfaceProps;
  /** Theme-resolved domain icon resolver. Passed through to the
   *  Multi-room cockpit embedded inside Settings -> Multi-room so
   *  device cards render correct artwork placeholders. */
  resolveDomainIcon: DomainIconResolver;
}

export function SystemSurface({
  networkStatus,
  settingsStatus,
  settingsRealtimeStatus,
  client,
  lastEvent,
  runInFlight,
  streamOpen,
  anomalySignal,
  onCommandLog,
  playbackVolumeStep,
  onPlaybackVolumeStepChange,
  collectionViewMode,
  onCollectionViewModeChange,
  health,
  settingsRevision,
  activeSubPage,
  onSubPageChange,
  onOpenMultiroom,
  diagnostics,
  resolveDomainIcon
}: SystemSurfaceProps) {
  useLocale();
  const system = useSystemState(client);
  const action = useAsyncAction();

  const canUseSettings = settingsStatus !== "missing";
  const showRealtimeHint = settingsRealtimeStatus !== "supported";

  // Per-group availability. Reflects what the framework actually
  // serves today. Groups whose backend has not landed are "coming";
  // they remain navigable so the operator (and the UI design team)
  // can see the placement and the ADR that will land their content.
  const availability: Record<SettingsGroupId, GroupAvailability> = useMemo(() => {
    return {
      library: "coming",
      audio: canUseSettings ? "partial" : "coming",
      "multi-room": "available",
      cast: "coming",
      sources: "coming",
      "file-sharing": "available",
      network: networkStatus === "supported" ? "available" : networkStatus === "partial" ? "partial" : "coming",
      // Artwork sources, online providers, and API keys are live
      // (CredentialsPanel + ProvidersPanel + ArtworkSettingsPanel, all
      // on real framework wire ops); scrobbling + anonymisation controls
      // are not built yet - so the group is genuinely partial, not coming.
      metadata: "partial",
      "smart-home": "coming",
      system: "partial",
      activity: "available",
      about: "available"
    };
  }, [canUseSettings, networkStatus]);

  const isKnownGroup = (id: string | null): id is SettingsGroupId =>
    id !== null && SETTINGS_GROUPS.some((g) => g === id);
  const requestedGroup = isKnownGroup(activeSubPage) ? activeSubPage : null;

  // `system` state now covers network status only; the gates below
  // key off networkStatus directly (outputs moved to the framework
  // plugin-request path and no longer flow through this hook).
  useEffect(() => {
    if (!networkStatus || networkStatus === "missing") {
      return;
    }
    void system.refresh();
  }, [networkStatus, system.refresh]);

  useEffect(() => {
    if (networkStatus === "missing") {
      return;
    }
    if (shouldReconcileFromEvent("system", lastEvent)) {
      void system.refresh();
    }
  }, [lastEvent, networkStatus, system.refresh]);

  useEffect(() => {
    if (networkStatus === "missing") {
      return;
    }
    if (shouldRefreshFromAnomaly(anomalySignal, networkStatus)) {
      void system.refresh();
    }
  }, [anomalySignal, networkStatus, system.refresh]);

  return (
    <section className="card feature-surface">
      <div className="feature-head">
        <div>
          <h3>{t("settings.title")}</h3>
          <p className="feature-description">
            {t("settings.description")}
          </p>
        </div>
      </div>

      {requestedGroup === null ? (
        <GroupLanding
          groups={SETTINGS_GROUPS}
          availability={availability}
          onPick={(id) => onSubPageChange(id)}
        />
      ) : (
        <GroupContent
          group={requestedGroup}
          availability={availability}
          networkStatus={networkStatus}
          settingsStatus={settingsStatus}
          settingsRealtimeStatus={settingsRealtimeStatus}
          canUseSettings={canUseSettings}
          showRealtimeHint={showRealtimeHint}
          system={system}
          action={action}
          client={client}
          runInFlight={runInFlight}
          onCommandLog={onCommandLog}
          playbackVolumeStep={playbackVolumeStep}
          onPlaybackVolumeStepChange={onPlaybackVolumeStepChange}
          collectionViewMode={collectionViewMode}
          onCollectionViewModeChange={onCollectionViewModeChange}
          health={health}
          settingsRevision={settingsRevision}
          streamOpen={streamOpen}
          onOpenMultiroom={onOpenMultiroom}
          diagnostics={diagnostics}
          resolveDomainIcon={resolveDomainIcon}
        />
      )}

      {!streamOpen ? (
        <p className="feature-hint">{t("settings.hint.streamClosed")}</p>
      ) : null}
      {system.error ? <p className="feature-hint">{system.error}</p> : null}
      {action.error ? <p className="feature-hint">{action.error}</p> : null}
      {action.successMessage ? <p className="feature-success">{action.successMessage}</p> : null}
    </section>
  );
}

/* ---------- Landing: grid of group cards ---------- */

interface GroupLandingProps {
  groups: ReadonlyArray<SettingsGroupId>;
  availability: Record<SettingsGroupId, GroupAvailability>;
  onPick: (id: SettingsGroupId) => void;
}

/** The Design launcher - the designer is the appearance AUTHORITY
 *  (consolidation ruling 2026-07-14). Remote sessions open it in a
 *  new tab; native sessions get an informed-consent dialog: the
 *  browser URL for the full experience, or continue on this glass. */
function DesignLaunchCard() {
  useLocale();
  const [confirm, setConfirm] = useState(false);
  const designerUrl = `${window.location.origin}/?designer=1`;
  const launch = () => {
    if (readSessionScope() === "remote") {
      window.open("/?designer=1", "_blank", "noopener");
      return;
    }
    setConfirm(true);
  };
  return (
    <>
      <button
        type="button"
        role="listitem"
        className="settings-group-card settings-design-card"
        onClick={launch}
        aria-label={t("settings.group.cardAria", {
          title: t("settings.design.title"),
          description: t("settings.design.description")
        })}
      >
        <span className="settings-group-card-title">{t("settings.design.title")}</span>
        <span className="settings-group-card-description">
          {t("settings.design.description")}
        </span>
        <span className="settings-group-card-status status-available">
          {t("settings.status.available")}
        </span>
      </button>
      {confirm ? (
        <div
          className="sys-confirm-root"
          role="alertdialog"
          aria-modal="true"
          aria-label={t("settings.design.nativeTitle")}
        >
          <div className="sys-confirm-card">
            <span className="sys-confirm-ic" aria-hidden>
              <Wrench size={22} />
            </span>
            <h4>{t("settings.design.nativeTitle")}</h4>
            <p>{t("settings.design.nativeBody", { url: designerUrl })}</p>
            <div className="sys-confirm-actions">
              <button
                type="button"
                className="sys-confirm-go"
                onClick={() => {
                  window.location.href = "/?designer=1";
                }}
              >
                {t("settings.design.continue")}
              </button>
              <button type="button" onClick={() => setConfirm(false)}>
                {t("settings.design.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function GroupLanding({ groups, availability, onPick }: GroupLandingProps) {
  useLocale();
  return (
    <div className="settings-group-grid" role="list" aria-label={t("settings.groupsAria")}>
      <DesignLaunchCard />
      {groups.map((group) => {
        const status = availability[group];
        return (
          <button
            key={group}
            type="button"
            role="listitem"
            className="settings-group-card"
            onClick={() => onPick(group)}
            aria-label={t("settings.group.cardAria", {
              title: groupTitle(group),
              description: groupDescription(group)
            })}
          >
            <span className="settings-group-card-title">{groupTitle(group)}</span>
            <span className="settings-group-card-description">{groupDescription(group)}</span>
            <span className={`settings-group-card-status status-${status}`}>
              {t(`settings.status.${status}` as never)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Content: per-group sub-pages ---------- */

interface GroupContentProps {
  group: SettingsGroupId;
  availability: Record<SettingsGroupId, GroupAvailability>;
  networkStatus: CapabilityStatus;
  settingsStatus: CapabilityStatus;
  settingsRealtimeStatus: CapabilityStatus;
  canUseSettings: boolean;
  showRealtimeHint: boolean;
  system: ReturnType<typeof useSystemState>;
  action: ReturnType<typeof useAsyncAction>;
  client: GatewayClient;
  runInFlight: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  onCommandLog: (entry: NewCommandLogEntry) => void;
  playbackVolumeStep: number;
  onPlaybackVolumeStepChange: (step: number) => void;
  /** Shared collection view mode - consumed by the embedded
   *  Multi-room cockpit. The Appearance ROW retired in slice 3; the
   *  designer Pages control owns the device default. */
  collectionViewMode: "list" | "tile";
  onCollectionViewModeChange: (mode: "list" | "tile") => void;
  health: HealthPayload | null;
  settingsRevision: number | null;
  streamOpen: boolean;
  onOpenMultiroom: () => void;
  diagnostics: DiagnosticsSurfaceProps;
  resolveDomainIcon: DomainIconResolver;
}

function GroupContent(props: GroupContentProps) {
  useLocale();

  // Dedicated-view affordance: a small button next to the title for
  // groups whose content is also reachable as a top-level nav page.
  // multi-room is the first opter-in (the embedded surface here is
  // the same as the top-level surface; the button gives operators
  // who prefer the full-page chrome a one-click path there).
  // The affordance map stays the presence authority; the visible
  // label resolves from the message catalog.
  const dedicatedLabel =
    settingsGroupDedicatedViewLabel(props.group) !== null
      ? t("settings.group.openDedicated")
      : null;
  return (
    <div className="settings-section">
      <div className="settings-group-header">
        <h4>{groupTitle(props.group)}</h4>
        <span className={`settings-group-card-status status-${props.availability[props.group]}`}>
          {t(`settings.status.${props.availability[props.group]}` as never)}
        </span>
        {dedicatedLabel !== null && props.group === "multi-room" ? (
          <button
            type="button"
            className="settings-group-open-dedicated"
            onClick={props.onOpenMultiroom}
            aria-label={dedicatedLabel}
            title={dedicatedLabel}
          >
            <span>{dedicatedLabel}</span>
          </button>
        ) : null}
      </div>

      {props.group === "audio" ? <AudioGroup {...props} /> : null}
      {props.group === "file-sharing" ? <SmbServerSurface /> : null}
      {props.group === "network" ? <NetworkGroup {...props} /> : null}
      {props.group === "about" ? <AboutGroup {...props} /> : null}
      {props.group === "library" ? (
        // "Connect to NAS shares" left this listing - it SHIPPED as
        // the Sources page (ruled S1-A). Placeholders only promise
        // what is not yet delivered elsewhere.
        <PlaceholderGroup
          summary={t("settings.library.summary")}
          listing={[
            t("settings.library.item.scan"),
            t("settings.library.item.cue"),
            t("settings.library.item.playlists"),
            t("settings.library.item.tags"),
            t("settings.library.item.routing")
          ]}
        />
      ) : null}
      {props.group === "multi-room" ? (
        <MultiroomSurface
          resolveDomainIcon={props.resolveDomainIcon}
          viewMode={props.collectionViewMode}
          onViewModeChange={props.onCollectionViewModeChange}
        />
      ) : null}
      {props.group === "cast" ? (
        <PlaceholderGroup
          summary={t("settings.cast.summary")}
          listing={[
            t("settings.cast.item.airplay"),
            t("settings.cast.item.roon"),
            t("settings.cast.item.spotify"),
            t("settings.cast.item.musiccast"),
            t("settings.cast.item.dlna"),
            t("settings.cast.item.chromecast")
          ]}
        />
      ) : null}
      {props.group === "sources" ? (
        <PlaceholderGroup
          summary={t("settings.sources.summary")}
          listing={[
            t("settings.sources.item.bluetooth"),
            t("settings.sources.item.radio"),
            t("settings.sources.item.podcasts")
          ]}
        />
      ) : null}
      {props.group === "metadata" ? (
        <>
          <CredentialsPanel />
          <ProvidersPanel />
          <ArtworkSettingsPanel />
        </>
      ) : null}
      {props.group === "smart-home" ? (
        <PlaceholderGroup
          summary={t("settings.smartHome.summary")}
          listing={[
            t("settings.smartHome.item.mqtt"),
            t("settings.smartHome.item.homeAssistant"),
            t("settings.smartHome.item.matter"),
            t("settings.smartHome.item.assistants")
          ]}
        />
      ) : null}
      {props.group === "system" ? (
        <SystemGroup diagnostics={props.diagnostics} />
      ) : null}
      {props.group === "activity" ? (
        <>
          <DomainHistoryView />
          <DispositionPanel />
        </>
      ) : null}
    </div>
  );
}

/* ---------- Group bodies that wire to real backend ---------- */

/** Settings > System > Power: reboot / power off with the shared
 *  guarded confirm. Touch-friendly tiles (the pivot Device pattern);
 *  never a silent no-op - unavailable verbs disable with the reason. */
function SettingsPowerStage() {
  useLocale();
  const power = useSystemPowerConfirm();
  return (
    <div className="pivot-tile-grid settings-power-grid">
      <button
        type="button"
        className="pivot-tile"
        disabled={!power.available}
        title={power.available ? t("app.reboot") : t("pivot.rebootUnavailable")}
        onClick={() => power.setConfirm("reboot")}
      >
        <RotateCcw size={18} />
        <span>{t("app.reboot")}</span>
      </button>
      <button
        type="button"
        className="pivot-tile pivot-tile-danger"
        disabled={!power.available}
        title={power.available ? t("app.powerOff") : t("pivot.powerOffUnavailable")}
        onClick={() => power.setConfirm("power_off")}
      >
        <Power size={18} />
        <span>{t("app.powerOff")}</span>
      </button>
      <SystemPowerConfirmModal
        confirm={power.confirm}
        busy={power.busy}
        accepted={power.accepted}
        error={power.error}
        onCancel={power.closeConfirm}
        onConfirm={() => void power.onConfirmAction()}
      />
    </div>
  );
}

function AudioGroup({
  canUseSettings,
  playbackVolumeStep,
  onPlaybackVolumeStepChange
}: GroupContentProps) {
  useLocale();
  return (
    <>
      {/* The audio chain as a signal-path rail: Output, Hardware
          DAC, Mixer, Volume and Processing, each as a center-stage
          editing surface. Hosts the mixer-transition lifecycle
          affordances and the DAC reboot prompt. Consumes the
          playback.options + hardware.audio contracts via its own
          useAudioOptions / useHardwareAudio hooks. Resampling, DoP
          and volume normalization are served by the Processing
          stage of the panel. */}
      <AudioOptionsPanel
        canUseSettings={canUseSettings}
        playbackVolumeStep={playbackVolumeStep}
        onPlaybackVolumeStepChange={onPlaybackVolumeStepChange}
      />

      <PlaceholderRow
        title={t("settings.audio.chainPlanned")}
        items={[t("settings.audio.chain.crossfade"), t("settings.audio.chain.dsp")]}
      />
    </>
  );
}

// Turn a raw framework refusal into an operator-readable notice. The
// device gates network changes (and, today, scan) behind a step-up
// scope; surfacing the raw "principal does not hold the write scope"
// string is meaningless on glass. Map any step-up / scope / permission
// refusal to a plain sentence; pass anything else through unchanged.
// A capability/scope/step-up refusal from a network shelf verb means
// this session's bearer does not carry network_admin - the framework
// gates shelf verbs on the bearer alone, so the remedy is pairing (to
// obtain an operator bearer), NOT an inline password. See
// step-up-dispatch.ts for the code-truth on why the password card was
// a dead-end here.
function isNetworkAuthError(msg: string): boolean {
  return /step.?up|scope|permission|denied|unauthori|not.hold/i.test(msg);
}

function humaniseNetworkError(msg: string): string {
  if (isNetworkAuthError(msg)) {
    return t("settings.network.authNeeded");
  }
  return msg;
}

// A scan row is an open network when it advertises no security. The
// device reports open APs as "open" (or an empty / "--" / "none"
// token); those must join with NO Wi-Fi password field - asking for a
// password to join an open network is nonsense.
function isOpenNetwork(security: string | null): boolean {
  if (security === null) return true;
  const s = security.trim().toLowerCase();
  return s === "" || s === "open" || s === "--" || s === "none";
}

type NetworkLink = ReturnType<typeof useNetworkLink>;

function NetworkGroup(_props: GroupContentProps) {
  return <NetworkLanding />;
}

function AboutGroup({
  health,
  streamOpen
}: GroupContentProps) {
  useLocale();
  return (
    <>
      <dl className="settings-info">
        <dt>{t("settings.about.version")}</dt>
        <dd>{health?.version ?? t("settings.unknown")}</dd>
        <dt>{t("settings.about.status")}</dt>
        <dd>{health?.status ?? t("settings.unknown")}</dd>
        <dt>{t("settings.about.updated")}</dt>
        <dd>{formatTimestamp(health?.timestamp)}</dd>
        <dt>{t("settings.about.live")}</dt>
        <dd>{streamOpen ? t("settings.about.active") : t("settings.about.offline")}</dd>
      </dl>
      <CreditsPanel />
    </>
  );
}

/* ---------- System group: audio-style stage rail ---------- */

// The System group mirrors the audio panel's signal-path rail: a row
// of stage nodes plus one active-stage detail body. It reuses the
// audio-rail / audio-stage CSS classes so the two surfaces stay
// visually identical without a parallel stylesheet.
type SystemStageId =
  | "display"
  | "diagnostics"
  | "plugins"
  | "updates"
  | "backup"
  | "power"
  | "maintenance";

// "display" (kiosk display + touch) is device-local; it is filtered out of
// the rail unless inKioskBrowser() (a paired browser never sees it).
const SYSTEM_STAGE_ORDER: ReadonlyArray<SystemStageId> = [
  "display",
  "diagnostics",
  "plugins",
  "updates",
  "backup",
  "power",
  "maintenance"
];

// Stage names + intents live in the message catalog under
// settings.system.stage.<id> / settings.system.intent.<id>.
const systemStageLabel = (id: SystemStageId): string =>
  t(`settings.system.stage.${id}` as never);
const systemStageIntent = (id: SystemStageId): string =>
  t(`settings.system.intent.${id}` as never);

function systemStageIcon(id: SystemStageId, size: number) {
  switch (id) {
    case "display":
      return <MonitorSmartphone size={size} />;
    case "diagnostics":
      return <Activity size={size} />;
    case "plugins":
      return <Boxes size={size} />;
    case "updates":
      return <DownloadCloud size={size} />;
    case "backup":
      return <Archive size={size} />;
    case "power":
      return <Power size={size} />;
    case "maintenance":
      return <Wrench size={size} />;
  }
}

function systemStageSummary(
  id: SystemStageId,
  diagnostics: DiagnosticsSurfaceProps
): string {
  if (id === "display") return t("kiosk.summary");
  if (id === "diagnostics") return diagnostics.health?.status ?? t("settings.unknown");
  if (id === "plugins") return t("settings.system.summary.lifecycle");
  if (id === "power") return t("settings.system.summary.power");
  return t("settings.system.summary.planned");
}

function SystemGroup({
  diagnostics
}: {
  diagnostics: DiagnosticsSurfaceProps;
}) {
  useLocale();
  const [activeStage, setActiveStage] =
    useState<SystemStageId>("diagnostics");

  const renderStage = (id: SystemStageId) => {
    const header = (
      <header className="audio-stage-head">
        <span className="audio-stage-ic" aria-hidden>
          {systemStageIcon(id, 20)}
        </span>
        <div>
          <p className="audio-stage-title">{systemStageLabel(id)}</p>
          <p className="audio-stage-intent">{systemStageIntent(id)}</p>
        </div>
      </header>
    );
    if (id === "display") {
      return (
        <>
          {header}
          <KioskDisplayPanel />
        </>
      );
    }
    if (id === "diagnostics") {
      return (
        <>
          {header}
          <DiagnosticsSurface {...diagnostics} />
        </>
      );
    }
    if (id === "plugins") {
      return (
        <>
          {header}
          <PluginLifecyclePanel />
        </>
      );
    }
    if (id === "power") {
      // REAL power verbs - the menu-chrome help promises power stays
      // reachable in Settings when the sidebar cluster is hidden;
      // this stage honours that promise (was a placeholder). Same
      // shared guarded-confirm machinery as the sidebar cluster and
      // the pivot Device tiles; disabled with the reason when the
      // system.power plugin is not admitted.
      return (
        <>
          {header}
          <SettingsPowerStage />
        </>
      );
    }
    return (
      <>
        {header}
        <p className="audio-stage-note">
          {t("settings.system.stagePlaceholder")}
        </p>
      </>
    );
  };

  // Kiosk display + touch is device-local; drop it off-device.
  const visibleStages = SYSTEM_STAGE_ORDER.filter(
    (id) => id !== "display" || inKioskBrowser()
  );

  return (
    <div className="system-stage-surface">
      {/* Visualiser on/off + all tuning now live solely in the
        * designer's Visualizer studio: the preset's "off" IS the
        * disable. The old Settings kill switch was a second on/off
        * that could contradict the preset, so it was retired -
        * single source of truth. Open the studio from the Design
        * card. */}
      {/* Notification behaviour rows (Phase 2c, ruled N2-A): mode,
        * quiet hours, downgrade. Behaviour, not appearance - so
        * they live here, not in the designer. */}
      <NotificationSettingsRows />
      {/* Session-trust pairing: pair THIS browser with the player -
        * code ceremony for screened devices, bootstrap preseed for
        * headless. */}
      <PairingSettingsRow />
      <nav className="audio-rail" aria-label={t("settings.system.operationsAria")}>
        {visibleStages.map((id, i) => {
          const isActive = activeStage === id;
          return (
            <Fragment key={id}>
              <button
                type="button"
                className={
                  isActive
                    ? "audio-rail-node audio-rail-node-active"
                    : "audio-rail-node"
                }
                aria-pressed={isActive}
                onClick={() => setActiveStage(id)}
              >
                <span className="audio-rail-ic" aria-hidden>
                  {systemStageIcon(id, 19)}
                </span>
                <span className="audio-rail-name">
                  {systemStageLabel(id)}
                </span>
                <span className="audio-rail-val">
                  {systemStageSummary(id, diagnostics)}
                </span>
              </button>
              {i < visibleStages.length - 1 ? (
                <span className="audio-rail-conn" aria-hidden>
                  <ChevronRight size={14} />
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </nav>
      <section className="audio-stage" aria-live="polite">
        {renderStage(activeStage)}
      </section>
    </div>
  );
}

/* ---------- Placeholder bodies ---------- */

interface PlaceholderGroupProps {
  summary: string;
  listing: ReadonlyArray<string>;
}

function PlaceholderGroup({ summary, listing }: PlaceholderGroupProps) {
  useLocale();
  return (
    <>
      <p className="feature-description settings-placeholder-lede">{summary}</p>
      <p className="feature-hint settings-placeholder-hint">
        {t("settings.placeholder.reserved")}
      </p>
      <ul className="settings-placeholder-listing">
        {listing.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

interface PlaceholderRowProps {
  title: string;
  items: ReadonlyArray<string>;
}

function PlaceholderRow({ title, items }: PlaceholderRowProps) {
  return (
    <div className="settings-row">
      <span className="settings-label-text">{title}</span>
      <ul className="settings-placeholder-listing">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatTimestamp(raw: string | undefined): string {
  if (!raw) {
    return t("settings.about.na");
  }
  const isoMs = Date.parse(raw);
  if (!Number.isNaN(isoMs)) {
    return new Date(isoMs).toLocaleString();
  }
  const numericSec = Number(raw);
  if (Number.isFinite(numericSec) && numericSec > 0) {
    return new Date(numericSec * 1000).toLocaleString();
  }
  return raw;
}
