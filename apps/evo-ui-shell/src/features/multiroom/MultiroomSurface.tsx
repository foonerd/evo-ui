// Multi-room device-card surface.
//
// Two card layouts (list: 64x64 thumbnail + 3-line text; tile:
// artwork-background + overlaid text + grid). State-to-visual
// mapping renders the device's transport + group role + audible-time
// honesty signal as a single badge. Theme-placeholder fallback via
// the domain-icon resolver covers per-device thumbnails until the
// content-addressed artwork cache lands at the framework layer.
//
// Operator UI admits via LAN-trust through the UI runtime's
// reverse-proxy. No bearer-token flow in this component — bearer
// credentials are the external-API-consumer surface only.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Check,
  ChevronRight,
  CornerUpRight,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  X
} from "lucide-preact";
import { HeartbeatOverlay } from "../../app/components/HeartbeatOverlay";
import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import {
  useMultiroomState,
  DEVICE_NAME_MAX_CHARS,
  GROUP_NAME_MAX_CHARS,
  MIN_GROUP_MEMBERS,
  type DeviceRole,
  type DiscoveredPeer,
  type GroupActionResult,
  type GroupActionResultWithId,
  type GroupSummary,
  type MoveMemberResult,
  type MultiroomCardEnvelope,
  type PresenceState,
  type RemoveMemberResult,
  type RenameResult,
  type RosterSnap,
  type SnapReason
} from "./useMultiroomState";
import { moveSelfTransition } from "./decoders";
import type { DomainIconResolver } from "../../core/domain-icons";
import type { ComponentChild } from "preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

/** Render a catalog message whose {param} slots must appear BOLD.
 *  Call t(key) WITHOUT params (unknown placeholders stay literal),
 *  then substitute each named param as a <strong> node. Keeps the
 *  full sentence translatable while preserving the emphasis the
 *  confirm dialogs carry on device / group names. */
function strongParams(
  template: string,
  params: Readonly<Record<string, string>>
): ComponentChild[] {
  return template.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m !== null && m[1] in params) {
      return <strong key={m[1]}>{params[m[1]]}</strong>;
    }
    return part;
  });
}

type RenameLocalDevice = (newName: string) => Promise<RenameResult>;
type CreateGroupFn = (
  displayName: string,
  memberDeviceIds: ReadonlyArray<string>
) => Promise<GroupActionResultWithId>;

/** Prefix used in activeSubPage when the operator drills into a
 *  group's management view. Encoding: `group:<group_id>`. */
const SUBPAGE_GROUP_PREFIX = "group:";

function parseGroupSubPage(activeSubPage: string | null): string | null {
  if (activeSubPage === null) return null;
  if (!activeSubPage.startsWith(SUBPAGE_GROUP_PREFIX)) return null;
  return activeSubPage.slice(SUBPAGE_GROUP_PREFIX.length);
}

type CollectionViewMode = "list" | "tile";

interface MultiroomSurfaceProps {
  resolveDomainIcon: DomainIconResolver;
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  /** Optional. When the surface is hosted as a top-level page that
   *  wants to share its drill-down state with the App breadcrumb,
   *  pass these props. When the surface is embedded inside another
   *  surface (e.g. Settings -> Multi-room) and should manage its
   *  own drill-down internally without polluting the outer
   *  sub-page namespace, omit both props - the surface will fall
   *  back to local useState. */
  activeSubPage?: string | null;
  onSubPageChange?: (next: string | null) => void;
}

export function MultiroomSurface({
  resolveDomainIcon,
  viewMode,
  onViewModeChange,
  activeSubPage: activeSubPageProp,
  onSubPageChange: onSubPageChangeProp
}: MultiroomSurfaceProps) {
  useLocale();
  // Internal sub-page state for embedded hosting. Used only when
  // the parent did not supply activeSubPage / onSubPageChange.
  const [internalSubPage, setInternalSubPage] = useState<string | null>(null);
  const isControlled =
    activeSubPageProp !== undefined && onSubPageChangeProp !== undefined;
  const activeSubPage = isControlled ? (activeSubPageProp ?? null) : internalSubPage;
  const onSubPageChange = isControlled
    ? (onSubPageChangeProp as (next: string | null) => void)
    : setInternalSubPage;
  const {
    connection,
    envelopes,
    groups,
    discoveredPeers,
    lastSnap,
    snapInFlight,
    snapError,
    dismissSnapError,
    rosterSnap,
    renameLocalDevice,
    admitDevice,
    revokeDevice,
    createGroup,
    renameGroup,
    deleteGroup,
    addGroupMember,
    removeGroupMember,
    moveGroupMember,
    pinSourceHost,
    unpinSourceHost,
    selectGroupLeaderSuccessor,
    cancelGroupLeaderSuccessor,
    setDeviceRole,
    clearDeviceRole,
    setGroupLeaderMs,
    reconnectPeer
  } = useMultiroomState();

  // RoleStore gesture wrapper. Translates the picker's
  // three-state output ("source" / "receiver" / "auto") into the
  // framework's set + clear ops: an "auto" pick clears the row,
  // anything else writes a value. Result + error surfacing flows
  // back to the chip's internal state via the returned promise.
  const handleSetRole = async (deviceId: string, role: DeviceRole): Promise<RenameResult> => {
    if (role === "auto") {
      return clearDeviceRole(deviceId);
    }
    return setDeviceRole(deviceId, role);
  };

  // Reconnect-storm dispatch + progress affordance.
  // `reconnectInFlight` carries the in-flight target so the
  // HeartbeatPanel renders with a meaningful headline; null means
  // no panel. `reconnectOutcome` holds the most-recent result for
  // the brief post-storm banner.
  const [reconnectInFlight, setReconnectInFlight] = useState<{
    deviceId: string;
    displayName: string;
  } | null>(null);
  const [reconnectOutcome, setReconnectOutcome] = useState<{
    kind: "success" | "exhausted" | "failed";
    headline: string;
    detail: string;
  } | null>(null);

  // Auto-dismiss the outcome banner after one heartbeat-tick worth
  // of read time so it doesn't linger past the operator's attention.
  // 4500 ms = three ticks, which is roughly the eye's "read + move
  // on" budget for short status text. Operator can also click X.
  useEffect(() => {
    if (reconnectOutcome === null) return;
    const handle = window.setTimeout(() => setReconnectOutcome(null), 4500);
    return () => window.clearTimeout(handle);
  }, [reconnectOutcome]);

  const handleReconnect = async (deviceId: string, displayName: string): Promise<void> => {
    // Coalesce concurrent gestures: the framework allows only one
    // storm in flight per peer, and two stacked HeartbeatPanels
    // overlap at screen centre per the heartbeat-overlay layout. We
    // refuse a second click while one is running.
    if (reconnectInFlight !== null) return;
    setReconnectInFlight({ deviceId, displayName });
    setReconnectOutcome(null);
    const r = await reconnectPeer(deviceId);
    setReconnectInFlight(null);
    if (!r.ok) {
      setReconnectOutcome({
        kind: "failed",
        headline: t("multiroom.reconnectFailed", { name: displayName }),
        detail: r.message
      });
      return;
    }
    const oc = r.outcome;
    if (oc.reconnected && oc.winningCarrier !== null) {
      setReconnectOutcome({
        kind: "success",
        headline: t("multiroom.reconnected", { name: displayName }),
        detail: t("multiroom.viaCarrier", {
          carrier: oc.winningCarrier,
          ms: oc.elapsedMs
        })
      });
    } else {
      setReconnectOutcome({
        kind: "exhausted",
        headline: t("multiroom.couldNotReach", { name: displayName }),
        detail: t("multiroom.stormEnded", { ms: oc.elapsedMs })
      });
    }
  };

  // Snap-progress affordance is now the HeartbeatOverlay; the
  // overlay itself enforces a one-tick (1500ms) minimum visible
  // time so the operator gets a consistent visual beat on every
  // refresh regardless of how fast the snap returned.

  // Gaze trigger: surface_opened on mount. The Multi-room view is
  // mounted lazily (only when activeView === "multiroom") so a
  // mount here is by definition the operator opening the surface.
  const snapOnMountFired = useRef(false);
  useEffect(() => {
    if (snapOnMountFired.current) return;
    if (connection.kind !== "connected") return;
    snapOnMountFired.current = true;
    void rosterSnap("surface_opened");
  }, [connection.kind, rosterSnap]);

  // Gaze trigger: refocus after >=5s in background.
  const lastVisibleAt = useRef(Date.now());
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = (): void => {
      if (document.hidden) {
        lastVisibleAt.current = Date.now();
      } else {
        const elapsed = Date.now() - lastVisibleAt.current;
        if (elapsed >= 5_000) {
          void rosterSnap("surface_opened");
        }
        lastVisibleAt.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [rosterSnap]);
  const Icon = resolveDomainIcon("multiroom.device");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Drilled-down group id. Encoded in the global activeSubPage so the
  // breadcrumb (Back / Multi-room / Home) works without any further
  // wiring at the App layer.
  const activeGroupId = parseGroupSubPage(activeSubPage);
  const activeGroup = useMemo(
    () => (activeGroupId === null ? null : groups.find((g) => g.groupId === activeGroupId) ?? null),
    [activeGroupId, groups]
  );

  // If the operator drilled into a group that no longer exists (it
  // was dissolved by another device, or membership state hasn't yet
  // propagated), clear the sub-page so the breadcrumb's "Back" stays
  // sensible. Runs after render to avoid setState-in-render.
  useEffect(() => {
    if (activeGroupId !== null && activeGroup === null && connection.kind === "connected") {
      onSubPageChange(null);
    }
  }, [activeGroupId, activeGroup, connection.kind, onSubPageChange]);

  // Solo devices = envelopes whose role is "solo" (the only role
  // that makes a device eligible to be added to a new group per
  // the framework's "exactly one group at a time" invariant).
  const soloDevices = useMemo(
    () => envelopes.filter((e) => e.groupRole === "solo"),
    [envelopes]
  );

  // Default name for the next group: "Group N" where N is one
  // greater than the current group count. The operator can edit
  // before confirming.
  const defaultGroupName = t("multiroom.defaultGroupName", {
    n: groups.length + 1
  });

  return (
    <section className="card feature-surface multiroom-surface">
      <SnapStatusBar
        lastSnap={lastSnap}
        snapInFlight={snapInFlight}
        snapError={snapError}
        onRefresh={() => void rosterSnap("manual_refresh")}
        onDismissError={dismissSnapError}
      />
      {activeGroup === null ? (
        <DomainView
          connection={connection}
          envelopes={envelopes}
          groups={groups}
          discoveredPeers={discoveredPeers}
          soloDevices={soloDevices}
          defaultGroupName={defaultGroupName}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          Icon={Icon}
          renameLocalDevice={renameLocalDevice}
          admitDevice={admitDevice}
          revokeDevice={revokeDevice}
          createGroup={createGroup}
          addGroupMember={addGroupMember}
          removeGroupMember={removeGroupMember}
          moveGroupMember={moveGroupMember}
          creatingGroup={creatingGroup}
          setCreatingGroup={setCreatingGroup}
          onOpenGroup={(groupId) => onSubPageChange(`${SUBPAGE_GROUP_PREFIX}${groupId}`)}
          onSetRole={handleSetRole}
          onReconnect={(deviceId, displayName) => void handleReconnect(deviceId, displayName)}
          reconnectInFlightDeviceId={reconnectInFlight?.deviceId ?? null}
        />
      ) : (
        <GroupDetailView
          group={activeGroup}
          envelopes={envelopes}
          soloDevices={soloDevices}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          Icon={Icon}
          renameLocalDevice={renameLocalDevice}
          renameGroup={renameGroup}
          deleteGroup={deleteGroup}
          addGroupMember={addGroupMember}
          removeGroupMember={removeGroupMember}
          moveGroupMember={moveGroupMember}
          allGroups={groups}
          pinSourceHost={pinSourceHost}
          unpinSourceHost={unpinSourceHost}
          selectGroupLeaderSuccessor={selectGroupLeaderSuccessor}
          cancelGroupLeaderSuccessor={cancelGroupLeaderSuccessor}
          onLeaveGroupView={() => onSubPageChange(null)}
          onSetRole={handleSetRole}
          setGroupLeaderMs={setGroupLeaderMs}
          onReconnect={(deviceId, displayName) => void handleReconnect(deviceId, displayName)}
          reconnectInFlightDeviceId={reconnectInFlight?.deviceId ?? null}
        />
      )}
      {reconnectOutcome !== null ? (
        <div
          className={`multiroom-reconnect-outcome multiroom-reconnect-outcome-${reconnectOutcome.kind}`}
          role="status"
          aria-live="polite"
        >
          <div className="multiroom-reconnect-outcome-text">
            <strong>{reconnectOutcome.headline}</strong>
            <span>{reconnectOutcome.detail}</span>
          </div>
          <button
            type="button"
            className="multiroom-reconnect-outcome-dismiss"
            onClick={() => setReconnectOutcome(null)}
            aria-label={t("collection.dismiss")}
            title={t("collection.dismiss")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <HeartbeatPanel
        visible={reconnectInFlight !== null}
        headline={
          reconnectInFlight !== null
            ? t("multiroom.tryingToReach", {
                name: reconnectInFlight.displayName
              })
            : undefined
        }
        sublabel={t("multiroom.stormingCarriers")}
        scrim
      />
    </section>
  );
}

interface SnapStatusBarProps {
  lastSnap: RosterSnap | null;
  snapInFlight: boolean;
  /** Operator-facing error from the most recent roster_snap, or
   *  null on success / first-time mount. When non-null the bar
   *  renders an inline error chip with a dismiss affordance. */
  snapError: string | null;
  onRefresh: () => void;
  onDismissError: () => void;
}

/** Renders the surface-level snap timestamp + manual-refresh
 *  affordance + the HeartbeatOverlay "Checking who's here..."
 *  progress indicator for the zero-poll roster-snap gesture.
 *
 *  Progress affordance: HeartbeatOverlay (pulsing brand glyph +
 *  ripple rings) with the inline label. The overlay enforces a
 *  one-tick (1500 ms) minimum visible time so the operator sees
 *  one full heartbeat on every snap, regardless of how fast the
 *  framework returned.
 *
 *  Snap timestamp: "Freshly checked HH:MM:SS" rendered as the
 *  HeartbeatOverlay fallback so the slot smoothly returns to the
 *  freshness line once the heartbeat retires. */
function SnapStatusBar({ lastSnap, snapInFlight, snapError, onRefresh, onDismissError }: SnapStatusBarProps) {
  useLocale();
  const renderTimestamp = (ms: number): string => {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };
  const fallback =
    lastSnap !== null ? (
      <span className="multiroom-snap-timestamp">
        {t("multiroom.freshlyChecked", {
          time: renderTimestamp(lastSnap.snapCompletedAtMs)
        })}
        {lastSnap.deadlineBreached ? ` ${t("multiroom.slowCheck")}` : ""}
      </span>
    ) : (
      <span className="multiroom-snap-timestamp multiroom-snap-timestamp-pending">
        {t("multiroom.notYetChecked")}
      </span>
    );
  return (
    <div className="multiroom-snap-bar">
      <div className="multiroom-snap-bar-text">
        <HeartbeatOverlay
          visible={snapInFlight}
          inline
          size="sm"
          label={t("multiroom.checking")}
          fallback={fallback}
        />
      </div>
      <button
        type="button"
        className="multiroom-snap-refresh"
        onClick={onRefresh}
        disabled={snapInFlight}
        aria-label={t("multiroom.refreshRoster")}
        title={t("multiroom.refreshRoster")}
      >
        <RefreshCw size={14} />
      </button>
      {snapError !== null ? (
        <div
          className="multiroom-snap-error"
          role="alert"
          aria-live="polite"
        >
          <span className="multiroom-snap-error-text">{snapError}</span>
          <button
            type="button"
            className="multiroom-snap-error-dismiss"
            onClick={onDismissError}
            aria-label={t("multiroom.dismissSnapError")}
            title={t("collection.dismiss")}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface DomainViewProps {
  connection: { kind: "connecting" | "connected" | "disconnected" | "error"; reason?: string };
  envelopes: ReadonlyArray<MultiroomCardEnvelope>;
  groups: ReadonlyArray<GroupSummary>;
  discoveredPeers: ReadonlyArray<DiscoveredPeer>;
  soloDevices: ReadonlyArray<MultiroomCardEnvelope>;
  defaultGroupName: string;
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  Icon: ReturnType<DomainIconResolver>;
  renameLocalDevice: RenameLocalDevice;
  admitDevice: (deviceId: string, displayName?: string) => Promise<RenameResult>;
  revokeDevice: (deviceId: string) => Promise<RenameResult>;
  createGroup: CreateGroupFn;
  addGroupMember: (groupId: string, deviceId: string) => Promise<GroupActionResult>;
  removeGroupMember: (groupId: string, deviceId: string) => Promise<RemoveMemberResult>;
  moveGroupMember: (
    fromGroupId: string,
    toGroupId: string,
    deviceId: string,
    successorDeviceId?: string
  ) => Promise<MoveMemberResult>;
  creatingGroup: boolean;
  setCreatingGroup: (next: boolean) => void;
  onOpenGroup: (groupId: string) => void;
  /** RoleStore gesture wrapper. Sets or clears the
   *  operator-declared role per device. The chip below the card
   *  badge reads the current `operatorRole` from the envelope and
   *  writes through this callback. */
  onSetRole: (deviceId: string, role: DeviceRole) => Promise<RenameResult>;
  /** Operator-gestured reconnect storm. Surfaces a
   *  "Reconnect" button on stalled / absent / offline cards. The
   *  parent owns the HeartbeatPanel + outcome banner; this callback
   *  only triggers the dispatch and returns void. */
  onReconnect: (deviceId: string, displayName: string) => void;
  /** Device id currently in a reconnect-storm dispatch. Used to
   *  disable the Reconnect button on cards while one is running
   *  (the framework allows one storm per peer at a time). */
  reconnectInFlightDeviceId: string | null;
}

function DomainView({
  connection,
  envelopes,
  groups,
  discoveredPeers,
  soloDevices,
  defaultGroupName,
  viewMode,
  onViewModeChange,
  Icon,
  renameLocalDevice,
  admitDevice,
  revokeDevice,
  createGroup,
  addGroupMember,
  removeGroupMember,
  moveGroupMember,
  creatingGroup,
  setCreatingGroup,
  onOpenGroup,
  onSetRole,
  onReconnect,
  reconnectInFlightDeviceId
}: DomainViewProps) {
  useLocale();
  const [pendingRevoke, setPendingRevoke] = useState<{ deviceId: string; displayName: string } | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const confirmRevoke = async (): Promise<void> => {
    if (pendingRevoke === null) return;
    setRevokeBusy(true);
    setRevokeError(null);
    const r = await revokeDevice(pendingRevoke.deviceId);
    setRevokeBusy(false);
    if (r.ok) {
      setPendingRevoke(null);
    } else {
      setRevokeError(r.message);
    }
  };
  const [joiningDeviceId, setJoiningDeviceId] = useState<string | null>(null);
  const joiningDevice = useMemo(
    () =>
      joiningDeviceId === null
        ? null
        : envelopes.find((e) => e.id === joiningDeviceId) ?? null,
    [joiningDeviceId, envelopes]
  );

  // If the device we were trying to join from got grouped from
  // another seat (or otherwise disappeared from solo), close the
  // picker rather than leaving the operator on a stale view.
  useEffect(() => {
    if (joiningDeviceId !== null) {
      const stillSolo =
        envelopes.find((e) => e.id === joiningDeviceId)?.groupRole === "solo";
      if (!stillSolo) {
        setJoiningDeviceId(null);
      }
    }
  }, [joiningDeviceId, envelopes]);
  // Map each device id to its owning group's display name so the
  // GroupsSummary row can show a member-count + the source-host's
  // display name.
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const env of envelopes) {
      map.set(env.id, env.displayName);
    }
    return map;
  }, [envelopes]);

  // Local device + its current group (or null if solo). Powers the
  // "Move this device" affordance and the orientation hints sprinkled
  // through the surface. The local envelope is the one marked
  // env.isLocal by useMultiroomState.compose.
  const localEnv = useMemo(
    () => envelopes.find((e) => e.isLocal) ?? null,
    [envelopes]
  );
  const localCurrentGroup = useMemo(
    () =>
      localEnv === null
        ? null
        : groups.find((g) => g.memberDeviceIds.includes(localEnv.id)) ?? null,
    [localEnv, groups]
  );
  const [movingSelf, setMovingSelf] = useState(false);
  const [moveSelfBusy, setMoveSelfBusy] = useState(false);
  const [moveSelfError, setMoveSelfError] = useState<string | null>(null);
  // Captured when move-self returns successor_required: the operator
  // is moving the local device (which is the source group's leader)
  // and the framework refused to auto-elect a new leader for the
  // source group. We render an inline SuccessorPicker pre-bound to
  // the destination context; selection re-dispatches move_member
  // with successor_device_id so the move can land. Closed on
  // success / cancel / staleness.
  interface MoveSelfSuccessorState {
    departingDeviceId: string;
    eligibleDeviceIds: ReadonlyArray<string>;
    toGroupId: string;
    toGroupName: string;
  }
  const [moveSelfSuccessor, setMoveSelfSuccessor] =
    useState<MoveSelfSuccessorState | null>(null);
  // Key used to disable the successor picker buttons during the
  // second-dispatch round trip. Mirrors the remove-flow's pattern.
  const [moveSelfSuccessorBusyKey, setMoveSelfSuccessorBusyKey] = useState<string>("");

  // Close the move-self picker if the local device's state changes
  // in a way that makes the open picker stale (e.g. another seat
  // moved this device into a different group).
  useEffect(() => {
    if (!movingSelf) return;
    if (localEnv === null) setMovingSelf(false);
  }, [movingSelf, localEnv]);

  // Drop the pending successor selection if the source group
  // dissolved while we were waiting on the operator (another seat
  // removed enough members to trip auto-dissolve). The framework's
  // second dispatch would refuse with `group_not_found`; closing the
  // picker keeps the operator out of a dead-end.
  useEffect(() => {
    if (moveSelfSuccessor === null) return;
    if (localCurrentGroup === null) {
      setMoveSelfSuccessor(null);
      setMoveSelfSuccessorBusyKey("");
    }
  }, [moveSelfSuccessor, localCurrentGroup]);

  const canMoveSelf =
    localEnv !== null &&
    (localCurrentGroup !== null || groups.length > 0);

  return (
    <>
      <div className="feature-head">
        <div>
          <h3>{t("nav.multiroom")}</h3>
          <p className="feature-description">{t("multiroom.description")}</p>
        </div>
        <div className="multiroom-head-actions">
          <button
            type="button"
            className="multiroom-create-group-button"
            onClick={() => setCreatingGroup(true)}
            disabled={creatingGroup || soloDevices.length < MIN_GROUP_MEMBERS}
            title={
              soloDevices.length < MIN_GROUP_MEMBERS
                ? t("multiroom.needSoloDevices", { n: MIN_GROUP_MEMBERS })
                : t("multiroom.createGroupTitle")
            }
            aria-label={t("multiroom.createGroupTitle")}
          >
            <Plus size={14} />
            <span>{t("multiroom.newGroup")}</span>
          </button>
          {canMoveSelf ? (
            <button
              type="button"
              className="multiroom-create-group-button"
              onClick={() => {
                setMoveSelfError(null);
                setMovingSelf(true);
              }}
              disabled={movingSelf || moveSelfBusy}
              title={t("multiroom.moveSelfTitle")}
              aria-label={t("multiroom.moveSelf")}
            >
              <CornerUpRight size={14} />
              <span>{t("multiroom.moveSelf")}</span>
            </button>
          ) : null}
          <div
            className="collection-view-toggle"
            role="group"
            aria-label={t("multiroom.viewMode")}
          >
            <button
              type="button"
              className={
                viewMode === "list"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("list")}
              aria-pressed={viewMode === "list"}
              aria-label={t("collection.listView")}
              title={t("collection.listView")}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              className={
                viewMode === "tile"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("tile")}
              aria-pressed={viewMode === "tile"}
              aria-label={t("collection.tileView")}
              title={t("collection.tileView")}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {creatingGroup ? (
        <CreateGroupForm
          defaultName={defaultGroupName}
          soloDevices={soloDevices}
          onCreate={createGroup}
          onClose={() => setCreatingGroup(false)}
        />
      ) : null}

      {moveSelfSuccessor !== null && localEnv !== null && localCurrentGroup !== null ? (
        <SuccessorPicker
          group={localCurrentGroup}
          envelopes={envelopes}
          pending={{
            departingDeviceId: moveSelfSuccessor.departingDeviceId,
            eligibleDeviceIds: moveSelfSuccessor.eligibleDeviceIds
          }}
          busyKey={moveSelfSuccessorBusyKey}
          headline={t("multiroom.chooseLeaderMovingSelf", {
            group: localCurrentGroup.displayName,
            target: moveSelfSuccessor.toGroupName
          })}
          onConfirm={async (successorDeviceId) => {
            setMoveSelfSuccessorBusyKey(`successor:${successorDeviceId}`);
            setMoveSelfError(null);
            const r = await moveGroupMember(
              localCurrentGroup.groupId,
              moveSelfSuccessor.toGroupId,
              localEnv.id,
              successorDeviceId
            );
            setMoveSelfSuccessorBusyKey("");
            if (r.kind === "moved") {
              setMoveSelfSuccessor(null);
              setMovingSelf(false);
            } else if (r.kind === "failed") {
              setMoveSelfError(r.message);
              setMoveSelfSuccessor(null);
            } else {
              // Second successor_required from the same gesture
              // is unexpected (framework guarantees no nesting per
              // MULTIROOM-FLOWS.md §6.4) but if it ever happens we
              // keep the picker open with refreshed eligibility.
              setMoveSelfSuccessor({
                departingDeviceId: r.departingDeviceId,
                eligibleDeviceIds: r.eligibleDeviceIds,
                toGroupId: moveSelfSuccessor.toGroupId,
                toGroupName: moveSelfSuccessor.toGroupName
              });
            }
          }}
          onCancel={() => {
            setMoveSelfSuccessor(null);
            setMoveSelfSuccessorBusyKey("");
          }}
        />
      ) : null}

      {movingSelf && moveSelfSuccessor === null && localEnv !== null ? (
        localCurrentGroup !== null ? (
          <MoveDestinationPicker
            device={{
              deviceId: localEnv.id,
              displayName: `${localEnv.displayName} ${t("multiroom.thisDevice")}`
            }}
            currentGroup={localCurrentGroup}
            allGroups={groups}
            busy={moveSelfBusy}
            onMoveToGroup={async (toGroupId) => {
              setMoveSelfBusy(true);
              setMoveSelfError(null);
              const r = await moveGroupMember(localCurrentGroup.groupId, toGroupId, localEnv.id);
              setMoveSelfBusy(false);
              // Route through the pure transition function so the
              // successor_required branch is handled by the
              // SuccessorPicker rendered above instead of silently
              // dropping the response.
              const toGroupName =
                groups.find((g) => g.groupId === toGroupId)?.displayName ??
                t("multiroom.chosenGroupFallback");
              const transition = moveSelfTransition(r, toGroupId, toGroupName);
              if (transition.kind === "completed") {
                setMovingSelf(false);
              } else if (transition.kind === "showError") {
                setMoveSelfError(transition.message);
              } else {
                // successorRequired - capture the eligible list and
                // destination context, then render SuccessorPicker.
                setMoveSelfSuccessor({
                  departingDeviceId: transition.departingDeviceId,
                  eligibleDeviceIds: transition.eligibleDeviceIds,
                  toGroupId: transition.toGroupId,
                  toGroupName: transition.toGroupName
                });
              }
            }}
            onGoSolo={async () => {
              setMoveSelfBusy(true);
              setMoveSelfError(null);
              const r = await removeGroupMember(localCurrentGroup.groupId, localEnv.id);
              setMoveSelfBusy(false);
              if (r.kind === "removed") {
                setMovingSelf(false);
              } else if (r.kind === "failed") {
                setMoveSelfError(r.message);
              }
            }}
            onCancel={() => setMovingSelf(false)}
          />
        ) : (
          <JoinGroupForm
            device={{
              ...localEnv,
              displayName: `${localEnv.displayName} ${t("multiroom.thisDevice")}`
            }}
            groups={groups}
            onJoin={async (groupId) => {
              setMoveSelfBusy(true);
              setMoveSelfError(null);
              const r = await addGroupMember(groupId, localEnv.id);
              setMoveSelfBusy(false);
              if (r.ok) {
                setMovingSelf(false);
              } else {
                setMoveSelfError(r.message);
              }
              return r;
            }}
            onClose={() => setMovingSelf(false)}
          />
        )
      ) : null}
      {moveSelfError !== null ? (
        <p className="feature-hint">{moveSelfError}</p>
      ) : null}

      <div className="multiroom-connection-status">
        <div className="multiroom-connection-status-icon" aria-hidden>
          <Icon size={20} />
        </div>
        <div className="multiroom-connection-status-text">
          <strong>{describeConnection(connection.kind)}</strong>
          <p className="feature-description">
            {connection.kind === "connected"
              ? envelopes.length === 0
                ? t("multiroom.noDevices")
                : t(
                    envelopes.length === 1
                      ? "multiroom.devicesFound.one"
                      : "multiroom.devicesFound.many",
                    { n: envelopes.length }
                  )
              : connection.kind === "connecting"
                ? t("multiroom.connectingBody")
                : connection.kind === "disconnected"
                  ? t("multiroom.connClosed")
                  : t("multiroom.cannotReach")}
          </p>
        </div>
      </div>

      {connection.kind === "error" ? (
        <p className="feature-hint">{t("multiroom.checkNetwork")}</p>
      ) : null}

      {/* Section order per MULTIROOM-FLOWS.md §1.5:
       *   1. Group summary strip (above the roster, when >= 1 group)
       *   2. Domain roster cards
       *   3. Discovered devices (below the roster) */}
      {groups.length > 0 ? (
        <GroupsSummary
          groups={groups}
          memberNameById={memberNameById}
          onOpenGroup={onOpenGroup}
        />
      ) : null}

      {envelopes.length === 0 && connection.kind === "connected" ? (
        <p className="feature-hint">{t("multiroom.emptyDomainHint")}</p>
      ) : null}

      {envelopes.length === 1 &&
      groups.length === 0 &&
      discoveredPeers.length === 0 &&
      connection.kind === "connected" ? (
        <p className="feature-hint">{t("multiroom.onlyThisDevice")}</p>
      ) : null}

      {joiningDevice !== null ? (
        <JoinGroupForm
          device={joiningDevice}
          groups={groups}
          onJoin={async (groupId) => addGroupMember(groupId, joiningDevice.id)}
          onClose={() => setJoiningDeviceId(null)}
        />
      ) : null}

      {envelopes.length > 0 ? (
        viewMode === "list" ? (
          <DeviceCardList
            envelopes={envelopes}
            Icon={Icon}
            onRenameLocalDevice={renameLocalDevice}
            onJoinGroup={
              groups.length > 0 ? (deviceId) => setJoiningDeviceId(deviceId) : undefined
            }
            onRevoke={(deviceId, displayName) =>
              setPendingRevoke({ deviceId, displayName })
            }
            onReadmit={(deviceId, displayName) => void admitDevice(deviceId, displayName)}
            onSetRole={onSetRole}
            onReconnect={onReconnect}
            reconnectInFlightDeviceId={reconnectInFlightDeviceId}
          />
        ) : (
          <DeviceCardTiles
            envelopes={envelopes}
            Icon={Icon}
            onRenameLocalDevice={renameLocalDevice}
            onJoinGroup={
              groups.length > 0 ? (deviceId) => setJoiningDeviceId(deviceId) : undefined
            }
            onRevoke={(deviceId, displayName) =>
              setPendingRevoke({ deviceId, displayName })
            }
            onReadmit={(deviceId, displayName) => void admitDevice(deviceId, displayName)}
            onSetRole={onSetRole}
            onReconnect={onReconnect}
            reconnectInFlightDeviceId={reconnectInFlightDeviceId}
          />
        )
      ) : null}

      {pendingRevoke !== null ? (
        <div className="multiroom-confirm" role="alertdialog">
          <p>
            {strongParams(t("multiroom.revokeQuestion"), {
              name: pendingRevoke.displayName
            })}
          </p>
          <p>{t("multiroom.revokeBody")}</p>
          {revokeError !== null ? (
            <p className="multiroom-create-group-error">{revokeError}</p>
          ) : null}
          <div className="multiroom-confirm-actions">
            <button
              type="button"
              className="multiroom-dissolve-button"
              onClick={() => void confirmRevoke()}
              disabled={revokeBusy}
            >
              {revokeBusy ? t("multiroom.revoking") : t("multiroom.revoke")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingRevoke(null);
                setRevokeError(null);
              }}
              disabled={revokeBusy}
            >
              {t("dialog.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {discoveredPeers.length > 0 ? (
        <DiscoveredDevicesSection
          peers={discoveredPeers}
          onAdmit={admitDevice}
        />
      ) : null}
    </>
  );
}

interface GroupsSummaryProps {
  groups: ReadonlyArray<GroupSummary>;
  memberNameById: ReadonlyMap<string, string>;
  onOpenGroup: (groupId: string) => void;
}

/** Compact list of domain groups above the device cards. Each
 *  row shows the group's name, member count, and the source-host's
 *  display name when known. Tap to drill into the group view. */
function GroupsSummary({ groups, memberNameById, onOpenGroup }: GroupsSummaryProps) {
  useLocale();
  return (
    <div className="multiroom-groups-summary">
      <h4 className="multiroom-groups-summary-title">{t("multiroom.groups")}</h4>
      <ul className="multiroom-groups-summary-list">
        {groups.map((g) => {
          // Chain-projected effective_leader, byte-equal across every
          // seat sharing the same chain head; operator-facing leader
          // label is sourced from here, NOT the legacy per-seat
          // sourceHostByGroup election cache.
          const leaderName =
            g.effectiveLeaderDeviceId !== null
              ? memberNameById.get(g.effectiveLeaderDeviceId)
              : null;
          return (
            <li key={g.groupId}>
              <button
                type="button"
                className="multiroom-groups-summary-row"
                onClick={() => onOpenGroup(g.groupId)}
              >
                <span className="multiroom-groups-summary-name">{g.displayName}</span>
                <span className="multiroom-groups-summary-meta">
                  {t(
                    g.memberDeviceIds.length === 1
                      ? "multiroom.memberCount.one"
                      : "multiroom.memberCount.many",
                    { n: g.memberDeviceIds.length }
                  )}
                  {leaderName !== null && leaderName !== undefined
                    ? ` - ${t("multiroom.leaderLabel", { name: leaderName })}`
                    : ""}
                </span>
                <ChevronRight size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface DiscoveredDevicesSectionProps {
  peers: ReadonlyArray<DiscoveredPeer>;
  onAdmit: (deviceId: string, displayName?: string) => Promise<RenameResult>;
}

/** "Discovered devices" section per MULTIROOM-FLOWS.md §1.5 +
 *  §3.2. Lists every advertising peer not yet in this device's
 *  trust ledger. Operator taps "Admit" to add. Per §3.2 step 4
 *  we omit display_name on the wire op so the framework
 *  auto-resolves from the peer's last-observed mDNS-SD advert
 *  TXT record. */
function DiscoveredDevicesSection({ peers, onAdmit }: DiscoveredDevicesSectionProps) {
  useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const admit = async (peer: DiscoveredPeer): Promise<void> => {
    setBusyId(peer.deviceId);
    setError(null);
    const r = await onAdmit(peer.deviceId);
    setBusyId(null);
    if (!r.ok) {
      setError(r.message);
    }
  };

  return (
    <div className="multiroom-discovered">
      <h4 className="multiroom-groups-summary-title">
        {t("multiroom.discovered")}
      </h4>
      <p className="feature-description multiroom-discovered-hint">
        {t("multiroom.discoveredHint")}
      </p>
      <ul className="multiroom-discovered-list">
        {peers.map((peer) => {
          const busy = busyId === peer.deviceId;
          const firstAddress = peer.addresses.length > 0 ? peer.addresses[0] : null;
          return (
            <li key={peer.deviceId} className="multiroom-discovered-row">
              <div className="multiroom-discovered-text">
                <div className="multiroom-discovered-name">{peer.displayName}</div>
                {firstAddress !== null ? (
                  <div className="multiroom-discovered-meta">{firstAddress}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="multiroom-create-group-button"
                onClick={() => void admit(peer)}
                disabled={busy}
                aria-label={t("multiroom.admitAria", {
                  name: peer.displayName
                })}
                title={t("multiroom.admitTitle")}
              >
                <UserPlus size={14} />
                <span>
                  {busy ? t("multiroom.admitting") : t("multiroom.admit")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error !== null ? <p className="multiroom-create-group-error">{error}</p> : null}
    </div>
  );
}

interface GroupDetailViewProps {
  group: GroupSummary;
  envelopes: ReadonlyArray<MultiroomCardEnvelope>;
  soloDevices: ReadonlyArray<MultiroomCardEnvelope>;
  viewMode: CollectionViewMode;
  onViewModeChange: (mode: CollectionViewMode) => void;
  Icon: ReturnType<DomainIconResolver>;
  renameLocalDevice: RenameLocalDevice;
  renameGroup: (groupId: string, displayName: string) => Promise<GroupActionResult>;
  deleteGroup: (groupId: string) => Promise<GroupActionResult>;
  addGroupMember: (groupId: string, deviceId: string) => Promise<GroupActionResult>;
  removeGroupMember: (groupId: string, deviceId: string) => Promise<RemoveMemberResult>;
  moveGroupMember: (
    fromGroupId: string,
    toGroupId: string,
    deviceId: string,
    successorDeviceId?: string
  ) => Promise<MoveMemberResult>;
  /** All groups in the domain. Drives the move-destination picker:
   *  the operator picks from these minus the current group. */
  allGroups: ReadonlyArray<GroupSummary>;
  pinSourceHost: (groupId: string, deviceId: string) => Promise<GroupActionResult>;
  unpinSourceHost: (groupId: string) => Promise<GroupActionResult>;
  selectGroupLeaderSuccessor: (
    groupId: string,
    departingDeviceId: string,
    successorDeviceId: string
  ) => Promise<GroupActionResult>;
  cancelGroupLeaderSuccessor: (
    groupId: string,
    departingDeviceId: string
  ) => Promise<GroupActionResult>;
  onLeaveGroupView: () => void;
  /** RoleStore gesture wrapper, threaded through to the
   *  card list so member cards in the group drill-down can show
   *  the same Role chip the domain view shows. */
  onSetRole: (deviceId: string, role: DeviceRole) => Promise<RenameResult>;
  /** Per-group latency-budget setter. Operator-mutable
   *  range 10..=5000 ms; multi-room plugin reads it every frame so
   *  changes take effect on the next frame without plugin reload. */
  setGroupLeaderMs: (groupId: string, leaderMs: number) => Promise<GroupActionResult>;
  /** Operator-gestured reconnect-storm trigger. Same shape as the
   *  domain-view callback; the group-detail member cards reuse the
   *  same button. */
  onReconnect: (deviceId: string, displayName: string) => void;
  /** Device currently in a reconnect dispatch (or null). Disables
   *  the per-card button on stacked clicks. */
  reconnectInFlightDeviceId: string | null;
}

interface PendingSuccessor {
  departingDeviceId: string;
  eligibleDeviceIds: ReadonlyArray<string>;
}

/** Drilled-down view of one multi-room group. Shows the group's
 *  name (inline rename), member list with per-member Remove
 *  affordance, an Add-device affordance, and a Dissolve affordance.
 *  Per design §10.4 the framework auto-dissolves the group when its
 *  membership drops below MIN_GROUP_MEMBERS, so removing the
 *  second-to-last member returns to the domain view via the
 *  effect in MultiroomSurface that clears activeSubPage on missing
 *  group. */
function GroupDetailView({
  group,
  envelopes,
  soloDevices,
  viewMode,
  onViewModeChange,
  Icon,
  renameLocalDevice,
  renameGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  moveGroupMember,
  allGroups,
  pinSourceHost,
  unpinSourceHost,
  selectGroupLeaderSuccessor,
  cancelGroupLeaderSuccessor,
  onLeaveGroupView,
  onSetRole,
  setGroupLeaderMs,
  onReconnect,
  reconnectInFlightDeviceId
}: GroupDetailViewProps) {
  useLocale();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.displayName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const [addingMember, setAddingMember] = useState(false);
  const [confirmingDissolve, setConfirmingDissolve] = useState(false);
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Pending leader-successor decision per MULTIROOM-FLOWS.md §7.3.
  // Set when remove_group_member returns SuccessorRequired; cleared
  // on select / cancel / completed group dissolution.
  const [pendingSuccessor, setPendingSuccessor] = useState<PendingSuccessor | null>(null);

  // Pending auto-dissolve confirmation per MULTIROOM-FLOWS.md §7.2:
  // "UI confirms the gesture if it would auto-dissolve the group
  // (post-removal count < 2)." We hold the device id and ask the
  // operator before dispatching remove_group_member, otherwise the
  // framework silently dissolves the group and surprises the
  // operator.
  const [pendingAutoDissolve, setPendingAutoDissolve] = useState<string | null>(null);

  const memberEnvelopes = useMemo(() => {
    const memberSet = new Set(group.memberDeviceIds);
    return envelopes.filter((env) => memberSet.has(env.id));
  }, [envelopes, group.memberDeviceIds]);

  const commitRename = async (): Promise<void> => {
    setRenameBusy(true);
    const r = await renameGroup(group.groupId, renameValue);
    setRenameBusy(false);
    if (r.ok) {
      setRenaming(false);
      setRenameError(null);
    } else {
      setRenameError(r.message);
    }
  };

  /** Dispatch the framework's remove op WITHOUT asking the
   *  operator first. Used after a confirmation path has already
   *  cleared the operator-visible question (auto-dissolve confirm
   *  in §7.2). */
  const dispatchRemove = async (deviceId: string): Promise<void> => {
    setOpBusy(`remove:${deviceId}`);
    setOpError(null);
    const r = await removeGroupMember(group.groupId, deviceId);
    setOpBusy(null);
    switch (r.kind) {
      case "removed":
        // Snapshot refreshed in the hook; if the group itself
        // auto-dissolved, the surface effect bounces us back to
        // the domain overview.
        return;
      case "successor_required":
        setPendingSuccessor({
          departingDeviceId: r.departingDeviceId,
          eligibleDeviceIds: r.eligibleDeviceIds
        });
        return;
      case "failed":
        setOpError(r.message);
        return;
    }
  };

  /** Operator gesture from a card. Intercepts the auto-dissolve
   *  case per MULTIROOM-FLOWS.md §7.2 so the framework does not
   *  silently dissolve the group. The leader-successor protocol
   *  in §7.3 is handled below the auto-dissolve precedence: if the
   *  group will continue to exist AND the target is the leader,
   *  the framework's response drives the SuccessorPicker. */
  const runRemoveMember = async (deviceId: string): Promise<void> => {
    if (group.memberDeviceIds.length - 1 < MIN_GROUP_MEMBERS) {
      // Removing this member would leave the group with < 2
      // members, which triggers the framework auto-dissolve
      // precedence. Confirm with the operator first.
      setPendingAutoDissolve(deviceId);
      return;
    }
    await dispatchRemove(deviceId);
  };

  const confirmAutoDissolve = async (): Promise<void> => {
    if (pendingAutoDissolve === null) return;
    const deviceId = pendingAutoDissolve;
    setPendingAutoDissolve(null);
    await dispatchRemove(deviceId);
  };

  const cancelAutoDissolve = (): void => {
    setPendingAutoDissolve(null);
  };

  // Move-member state per MULTIROOM-FLOWS.md §6.
  // `pendingMove` opens the destination picker; `pendingMoveSuccessor`
  // opens the successor picker when the framework returns
  // SuccessorRequired on a leader-source move (§6.4).
  const [pendingMove, setPendingMove] = useState<
    { deviceId: string; displayName: string } | null
  >(null);
  const [pendingMoveSuccessor, setPendingMoveSuccessor] = useState<
    {
      toGroupId: string;
      toGroupName: string;
      deviceId: string;
      displayName: string;
      successor: PendingSuccessor;
    } | null
  >(null);

  const dispatchMove = async (
    toGroupId: string,
    deviceId: string,
    displayName: string,
    successorDeviceId?: string
  ): Promise<void> => {
    setOpBusy(`move:${deviceId}`);
    setOpError(null);
    const r = await moveGroupMember(group.groupId, toGroupId, deviceId, successorDeviceId);
    setOpBusy(null);
    switch (r.kind) {
      case "moved":
        setPendingMove(null);
        setPendingMoveSuccessor(null);
        return;
      case "successor_required": {
        // First dispatch on a leader returned successor_required.
        // Promote pendingMove to pendingMoveSuccessor with the
        // target group info so the picker can label "moving X to Y".
        const toGroup = allGroups.find((g) => g.groupId === toGroupId);
        setPendingMoveSuccessor({
          toGroupId,
          toGroupName:
            toGroup?.displayName ?? t("multiroom.anotherGroupFallback"),
          deviceId,
          displayName,
          successor: {
            departingDeviceId: r.departingDeviceId,
            eligibleDeviceIds: r.eligibleDeviceIds
          }
        });
        setPendingMove(null);
        return;
      }
      case "failed":
        setOpError(r.message);
        return;
    }
  };

  const confirmMoveSuccessor = async (successorDeviceId: string): Promise<void> => {
    if (pendingMoveSuccessor === null) return;
    await dispatchMove(
      pendingMoveSuccessor.toGroupId,
      pendingMoveSuccessor.deviceId,
      pendingMoveSuccessor.displayName,
      successorDeviceId
    );
  };

  const abortMoveSuccessor = async (): Promise<void> => {
    if (pendingMoveSuccessor === null) return;
    setOpBusy("successor:cancel");
    setOpError(null);
    const r = await cancelGroupLeaderSuccessor(
      group.groupId,
      pendingMoveSuccessor.successor.departingDeviceId
    );
    setOpBusy(null);
    if (r.ok) {
      setPendingMoveSuccessor(null);
    } else {
      setOpError(r.message);
    }
  };

  const goSolo = async (deviceId: string): Promise<void> => {
    // §6.5: "go-solo" gesture in the move picker bypasses
    // move_group_member and dispatches remove_group_member.
    // The remove path handles leader-removal via the standard
    // §7.3 successor protocol; if it triggers here, the
    // operator goes through the normal SuccessorPicker.
    setPendingMove(null);
    await runRemoveMember(deviceId);
  };

  const makeLeader = async (deviceId: string): Promise<void> => {
    setOpBusy(`pin:${deviceId}`);
    setOpError(null);
    const r = await pinSourceHost(group.groupId, deviceId);
    setOpBusy(null);
    if (!r.ok) {
      setOpError(r.message);
    }
  };

  const unpinLeader = async (): Promise<void> => {
    setOpBusy("unpin");
    setOpError(null);
    const r = await unpinSourceHost(group.groupId);
    setOpBusy(null);
    if (!r.ok) {
      setOpError(r.message);
    }
  };

  const confirmSuccessor = async (successorDeviceId: string): Promise<void> => {
    if (pendingSuccessor === null) return;
    setOpBusy(`successor:${successorDeviceId}`);
    setOpError(null);
    const r = await selectGroupLeaderSuccessor(
      group.groupId,
      pendingSuccessor.departingDeviceId,
      successorDeviceId
    );
    setOpBusy(null);
    if (r.ok) {
      setPendingSuccessor(null);
    } else {
      setOpError(r.message);
    }
  };

  const abortSuccessor = async (): Promise<void> => {
    if (pendingSuccessor === null) return;
    setOpBusy("successor:cancel");
    setOpError(null);
    const r = await cancelGroupLeaderSuccessor(
      group.groupId,
      pendingSuccessor.departingDeviceId
    );
    setOpBusy(null);
    if (r.ok) {
      setPendingSuccessor(null);
    } else {
      setOpError(r.message);
    }
  };

  const dissolve = async (): Promise<void> => {
    setOpBusy("dissolve");
    setOpError(null);
    const r = await deleteGroup(group.groupId);
    setOpBusy(null);
    if (r.ok) {
      // Effect in MultiroomSurface clears activeSubPage when the
      // group goes missing, but call onLeaveGroupView eagerly so
      // the transition is instant.
      onLeaveGroupView();
    } else {
      setOpError(r.message);
      setConfirmingDissolve(false);
    }
  };

  return (
    <>
      <div className="feature-head multiroom-group-head">
        <div className="multiroom-group-head-title">
          {!renaming ? (
            <>
              <h3 className="multiroom-group-name">{group.displayName}</h3>
              <button
                type="button"
                className="device-name-edit-button"
                onClick={() => {
                  setRenameError(null);
                  setRenameValue(group.displayName);
                  setRenaming(true);
                }}
                aria-label={t("multiroom.renameGroup")}
                title={t("multiroom.renameGroup")}
              >
                <Pencil size={14} />
              </button>
            </>
          ) : (
            <div className="multiroom-group-rename-row">
              <input
                type="text"
                className="device-name-input"
                value={renameValue}
                maxLength={GROUP_NAME_MAX_CHARS}
                disabled={renameBusy}
                autoFocus
                aria-label={t("multiroom.groupName")}
                onInput={(ev) =>
                  setRenameValue((ev.currentTarget as HTMLInputElement).value)
                }
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    void commitRename();
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    setRenaming(false);
                    setRenameError(null);
                    setRenameValue(group.displayName);
                  }
                }}
              />
              <button
                type="button"
                className="device-name-confirm"
                onClick={() => void commitRename()}
                disabled={renameBusy}
                aria-label={t("multiroom.saveGroupName")}
                title={t("dialog.save")}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className="device-name-cancel"
                onClick={() => {
                  setRenaming(false);
                  setRenameError(null);
                  setRenameValue(group.displayName);
                }}
                disabled={renameBusy}
                aria-label={t("multiroom.cancelRename")}
                title={t("dialog.cancel")}
              >
                <X size={14} />
              </button>
              {renameError !== null ? (
                <div className="device-name-error">{renameError}</div>
              ) : null}
            </div>
          )}
          <p className="feature-description">
            {t(
              group.memberDeviceIds.length === 1
                ? "multiroom.memberCount.one"
                : "multiroom.memberCount.many",
              { n: group.memberDeviceIds.length }
            )}
          </p>
        </div>
        <div className="multiroom-head-actions">
          <button
            type="button"
            className="multiroom-create-group-button"
            onClick={() => setAddingMember(true)}
            disabled={addingMember || soloDevices.length === 0 || opBusy !== null}
            title={
              soloDevices.length === 0
                ? t("multiroom.noSoloToAdd")
                : t("multiroom.addSoloTitle")
            }
            aria-label={t("multiroom.addDeviceAria")}
          >
            <UserPlus size={14} />
            <span>{t("multiroom.addDevice")}</span>
          </button>
          {group.pinnedSourceHostDeviceId !== null ? (
            <button
              type="button"
              className="multiroom-create-group-button"
              onClick={() => void unpinLeader()}
              disabled={opBusy !== null}
              aria-label={t("multiroom.unpinTitle")}
              title={t("multiroom.unpinTitle")}
            >
              <span>
                {opBusy === "unpin"
                  ? t("multiroom.unpinning")
                  : t("multiroom.unpinLeader")}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="multiroom-dissolve-button"
            onClick={() => setConfirmingDissolve(true)}
            disabled={opBusy !== null}
            aria-label={t("multiroom.dissolveGroupTitle")}
            title={t("multiroom.dissolveGroupTitle")}
          >
            <Trash2 size={14} />
            <span>{t("multiroom.dissolve")}</span>
          </button>
          <div
            className="collection-view-toggle"
            role="group"
            aria-label={t("multiroom.viewMode")}
          >
            <button
              type="button"
              className={
                viewMode === "list"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("list")}
              aria-pressed={viewMode === "list"}
              aria-label={t("collection.listView")}
              title={t("collection.listView")}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              className={
                viewMode === "tile"
                  ? "collection-view-toggle-button collection-view-toggle-active"
                  : "collection-view-toggle-button"
              }
              onClick={() => onViewModeChange("tile")}
              aria-pressed={viewMode === "tile"}
              aria-label={t("collection.tileView")}
              title={t("collection.tileView")}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {confirmingDissolve ? (
        <div className="multiroom-confirm" role="alertdialog">
          <p>
            {strongParams(t("multiroom.dissolveQuestion"), {
              name: group.displayName
            })}
          </p>
          <div className="multiroom-confirm-actions">
            <button
              type="button"
              className="multiroom-dissolve-button"
              onClick={() => void dissolve()}
              disabled={opBusy !== null}
            >
              {opBusy === "dissolve"
                ? t("multiroom.dissolving")
                : t("multiroom.dissolve")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDissolve(false)}
              disabled={opBusy === "dissolve"}
            >
              {t("dialog.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {addingMember ? (
        <AddMemberForm
          soloDevices={soloDevices}
          onAdd={async (deviceId) => addGroupMember(group.groupId, deviceId)}
          onClose={() => setAddingMember(false)}
        />
      ) : null}

      {pendingAutoDissolve !== null ? (
        (() => {
          const targetEnv = envelopes.find((e) => e.id === pendingAutoDissolve);
          const targetName =
            targetEnv?.displayName ?? t("multiroom.thisDeviceFallback");
          const otherCount = group.memberDeviceIds.length - 1;
          const otherEnv = envelopes.find(
            (e) => e.id !== pendingAutoDissolve && group.memberDeviceIds.includes(e.id)
          );
          const otherName =
            otherEnv?.displayName ?? t("multiroom.remainingDeviceFallback");
          const remaining =
            otherCount === 1
              ? t("multiroom.oneDevice")
              : t("multiroom.nDevices", { n: otherCount });
          return (
            <div className="multiroom-confirm" role="alertdialog">
              <p>
                {strongParams(
                  t("multiroom.autoDissolveBody", {
                    remaining,
                    other: otherName
                  }),
                  { target: targetName, group: group.displayName }
                )}
              </p>
              <div className="multiroom-confirm-actions">
                <button
                  type="button"
                  className="multiroom-dissolve-button"
                  onClick={() => void confirmAutoDissolve()}
                  disabled={opBusy !== null}
                >
                  {t("multiroom.removeAndDissolve")}
                </button>
                <button
                  type="button"
                  onClick={cancelAutoDissolve}
                  disabled={opBusy !== null}
                >
                  {t("dialog.cancel")}
                </button>
              </div>
            </div>
          );
        })()
      ) : null}

      {pendingSuccessor !== null ? (
        <SuccessorPicker
          group={group}
          envelopes={envelopes}
          pending={pendingSuccessor}
          busyKey={opBusy ?? ""}
          onConfirm={confirmSuccessor}
          onCancel={() => void abortSuccessor()}
        />
      ) : null}

      {pendingMove !== null ? (
        <MoveDestinationPicker
          device={pendingMove}
          currentGroup={group}
          allGroups={allGroups}
          busy={opBusy !== null}
          onMoveToGroup={(toGroupId) =>
            void dispatchMove(toGroupId, pendingMove.deviceId, pendingMove.displayName)
          }
          onGoSolo={() => void goSolo(pendingMove.deviceId)}
          onCancel={() => setPendingMove(null)}
        />
      ) : null}

      {pendingMoveSuccessor !== null ? (
        <SuccessorPicker
          group={group}
          envelopes={envelopes}
          pending={pendingMoveSuccessor.successor}
          busyKey={opBusy ?? ""}
          headline={t("multiroom.chooseLeaderMoving", {
            group: group.displayName,
            name: pendingMoveSuccessor.displayName,
            target: pendingMoveSuccessor.toGroupName
          })}
          onConfirm={confirmMoveSuccessor}
          onCancel={() => void abortMoveSuccessor()}
        />
      ) : null}

      {opError !== null ? (
        <p className="multiroom-create-group-error">{opError}</p>
      ) : null}

      <LeaderMsControl
        groupId={group.groupId}
        groupName={group.displayName}
        leaderMs={group.leaderMs}
        setGroupLeaderMs={setGroupLeaderMs}
      />

      {memberEnvelopes.length === 0 ? (
        <p className="feature-hint">{t("multiroom.noMembersYet")}</p>
      ) : viewMode === "list" ? (
        <DeviceCardList
          envelopes={memberEnvelopes}
          Icon={Icon}
          onRenameLocalDevice={renameLocalDevice}
          onRemoveFromGroup={(deviceId) => void runRemoveMember(deviceId)}
          onMakeLeader={(deviceId) => void makeLeader(deviceId)}
          onMove={(deviceId, displayName) => setPendingMove({ deviceId, displayName })}
          removeBusyKey={opBusy ?? ""}
          onSetRole={onSetRole}
          onReconnect={onReconnect}
          reconnectInFlightDeviceId={reconnectInFlightDeviceId}
        />
      ) : (
        <DeviceCardTiles
          envelopes={memberEnvelopes}
          Icon={Icon}
          onRenameLocalDevice={renameLocalDevice}
          onRemoveFromGroup={(deviceId) => void runRemoveMember(deviceId)}
          onMakeLeader={(deviceId) => void makeLeader(deviceId)}
          onMove={(deviceId, displayName) => setPendingMove({ deviceId, displayName })}
          removeBusyKey={opBusy ?? ""}
          onSetRole={onSetRole}
          onReconnect={onReconnect}
          reconnectInFlightDeviceId={reconnectInFlightDeviceId}
        />
      )}
    </>
  );
}

interface JoinGroupFormProps {
  device: MultiroomCardEnvelope;
  groups: ReadonlyArray<GroupSummary>;
  onJoin: (groupId: string) => Promise<GroupActionResult>;
  onClose: () => void;
}

/** Inline picker that adds the given solo device to an existing
 *  group. Per design §10.4: same `add_group_member` verb as the
 *  add-from-group affordance, different entry point. The framework's
 *  source-host election decides which device leads playback after
 *  the join. */
function JoinGroupForm({ device, groups, onJoin, onClose }: JoinGroupFormProps) {
  useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async (groupId: string): Promise<void> => {
    setBusyId(groupId);
    setError(null);
    const r = await onJoin(groupId);
    setBusyId(null);
    if (r.ok) {
      onClose();
    } else {
      setError(r.message);
    }
  };

  return (
    <div
      className="multiroom-create-group"
      role="dialog"
      aria-label={t("multiroom.addSelfAria")}
    >
      <span className="multiroom-create-group-label">
        {strongParams(t("multiroom.addToWhichGroup"), {
          name: device.displayName
        })}
      </span>
      {groups.length === 0 ? (
        <p className="feature-hint">{t("multiroom.noGroupsYet")}</p>
      ) : (
        <ul className="multiroom-create-group-picker">
          {groups.map((g) => (
            <li key={g.groupId}>
              <button
                type="button"
                className="multiroom-create-group-pick"
                onClick={() => void join(g.groupId)}
                disabled={busyId !== null}
              >
                <UserPlus size={14} />
                <span>{g.displayName}</span>
                <span className="multiroom-create-group-local-hint">
                  {t(
                    g.memberDeviceIds.length === 1
                      ? "multiroom.memberCount.one"
                      : "multiroom.memberCount.many",
                    { n: g.memberDeviceIds.length }
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null ? <p className="multiroom-create-group-error">{error}</p> : null}
      <div className="multiroom-create-group-actions">
        <button type="button" onClick={onClose} disabled={busyId !== null}>
          {t("dialog.cancel")}
        </button>
      </div>
    </div>
  );
}

interface AddMemberFormProps {
  soloDevices: ReadonlyArray<MultiroomCardEnvelope>;
  onAdd: (deviceId: string) => Promise<GroupActionResult>;
  onClose: () => void;
}

/** Inline picker that adds one solo device at a time. Per §10.4
 *  "Add member" flow. Stays open after each successful add so the
 *  operator can chain multiple additions; closes on Cancel or when
 *  no solo devices remain. */
function AddMemberForm({ soloDevices, onAdd, onClose }: AddMemberFormProps) {
  useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (deviceId: string): Promise<void> => {
    setBusyId(deviceId);
    setError(null);
    const r = await onAdd(deviceId);
    setBusyId(null);
    if (!r.ok) {
      setError(r.message);
    }
  };

  return (
    <div
      className="multiroom-create-group"
      role="dialog"
      aria-label={t("multiroom.addDeviceAria")}
    >
      <span className="multiroom-create-group-label">
        {t("multiroom.soloInDomain")}
      </span>
      {soloDevices.length === 0 ? (
        <p className="feature-hint">{t("multiroom.noSoloAvailable")}</p>
      ) : (
        <ul className="multiroom-create-group-picker">
          {soloDevices.map((env) => (
            <li key={env.id}>
              <button
                type="button"
                className="multiroom-create-group-pick"
                onClick={() => void add(env.id)}
                disabled={busyId !== null}
              >
                <UserPlus size={14} />
                <span>{env.displayName}</span>
                {env.isLocal ? (
                  <span className="multiroom-create-group-local-hint">
                    {t("multiroom.thisDevice")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null ? <p className="multiroom-create-group-error">{error}</p> : null}
      <div className="multiroom-create-group-actions">
        <button type="button" onClick={onClose} disabled={busyId !== null}>
          {t("dialog.close")}
        </button>
      </div>
    </div>
  );
}

interface SuccessorPickerProps {
  group: GroupSummary;
  envelopes: ReadonlyArray<MultiroomCardEnvelope>;
  pending: PendingSuccessor;
  busyKey: string;
  /** Headline shown above the eligible list. Defaults to the
   *  remove-flow phrasing per §7.3.2; the move-flow caller
   *  overrides with §6.4.2 phrasing ("moving X to Y"). */
  headline?: string;
  onConfirm: (successorDeviceId: string) => Promise<void>;
  onCancel: () => void;
}

/** Inline picker rendered when the framework refuses to auto-elect
 *  a successor on leader removal (the explicit-successor protocol). Lists the eligible
 *  group members; tapping "Make leader" calls
 *  `select_group_leader_successor`, which atomically pins the new
 *  source-host AND removes the departing leader. Cancel keeps the
 *  leader in place and clears the pending decision. */
function SuccessorPicker({
  group,
  envelopes,
  pending,
  busyKey,
  headline,
  onConfirm,
  onCancel
}: SuccessorPickerProps) {
  useLocale();
  const departingName =
    envelopes.find((e) => e.id === pending.departingDeviceId)?.displayName ??
    t("multiroom.thisDeviceFallback");
  const eligible = pending.eligibleDeviceIds
    .map((id) => envelopes.find((e) => e.id === id))
    .filter((env): env is MultiroomCardEnvelope => env !== undefined);
  const cancelling = busyKey === "successor:cancel";

  return (
    <div className="multiroom-confirm multiroom-successor" role="alertdialog">
      <p>
        {headline !== undefined ? (
          headline
        ) : (
          <>
            {strongParams(t("multiroom.pickNewLeader"), {
              group: group.displayName,
              name: departingName
            })}
          </>
        )}
      </p>
      {eligible.length === 0 ? (
        <p className="feature-hint">{t("multiroom.noEligible")}</p>
      ) : (
        <ul className="multiroom-create-group-picker">
          {eligible.map((env) => {
            const busy = busyKey === `successor:${env.id}`;
            return (
              <li key={env.id}>
                <button
                  type="button"
                  className="multiroom-create-group-pick"
                  onClick={() => void onConfirm(env.id)}
                  disabled={busyKey.length > 0}
                >
                  <UserPlus size={14} />
                  <span>{env.displayName}</span>
                  <span className="multiroom-create-group-local-hint">
                    {busy ? t("multiroom.promoting") : t("multiroom.makeLeader")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="multiroom-confirm-actions">
        <button
          type="button"
          onClick={onCancel}
          disabled={busyKey.length > 0 && !cancelling}
        >
          {cancelling ? t("multiroom.cancelling") : t("multiroom.cancelRemoval")}
        </button>
      </div>
    </div>
  );
}

interface MoveDestinationPickerProps {
  device: { deviceId: string; displayName: string };
  currentGroup: GroupSummary;
  allGroups: ReadonlyArray<GroupSummary>;
  busy: boolean;
  onMoveToGroup: (toGroupId: string) => void;
  onGoSolo: () => void;
  onCancel: () => void;
}

/** Destination picker for the move-member flow per
 *  MULTIROOM-FLOWS.md §6.1. Shows every domain group EXCEPT the
 *  current one, plus a "Go solo" option per §6.5 that bypasses
 *  the move verb and dispatches the standard remove path. */
function MoveDestinationPicker({
  device,
  currentGroup,
  allGroups,
  busy,
  onMoveToGroup,
  onGoSolo,
  onCancel
}: MoveDestinationPickerProps) {
  useLocale();
  const others = allGroups.filter((g) => g.groupId !== currentGroup.groupId);
  return (
    <div
      className="multiroom-create-group"
      role="dialog"
      aria-label={t("multiroom.moveDevice")}
    >
      <span className="multiroom-create-group-label">
        {strongParams(t("multiroom.moveFromTo"), {
          name: device.displayName,
          group: currentGroup.displayName
        })}
      </span>
      <ul className="multiroom-create-group-picker">
        {others.map((g) => (
          <li key={g.groupId}>
            <button
              type="button"
              className="multiroom-create-group-pick"
              onClick={() => onMoveToGroup(g.groupId)}
              disabled={busy}
            >
              <UserPlus size={14} />
              <span>{g.displayName}</span>
              <span className="multiroom-create-group-local-hint">
                {t(
                  g.memberDeviceIds.length === 1
                    ? "multiroom.memberCount.one"
                    : "multiroom.memberCount.many",
                  { n: g.memberDeviceIds.length }
                )}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="multiroom-create-group-pick"
            onClick={onGoSolo}
            disabled={busy}
          >
            <UserMinus size={14} />
            <span>{t("multiroom.goSolo")}</span>
          </button>
        </li>
      </ul>
      <div className="multiroom-create-group-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("dialog.cancel")}
        </button>
      </div>
    </div>
  );
}

/** Per-group latency-budget control.
 *
 *  Range 10..=5000 ms (framework-enforced; mirrored client-side
 *  for immediate feedback). Default 200. The multi-room plugin
 *  re-reads the value every frame, so changes take effect on the
 *  next frame without plugin reload.
 *
 *  Interaction shape:
 *    - Slider drags update local state only (cheap; no dispatch).
 *    - "Apply" button commits the change via setGroupLeaderMs.
 *    - Sliding back to the persisted value clears the dirty flag.
 *  Decoupling the slider from the dispatch keeps the wire quiet
 *  (operators commonly drag-explore values before committing) and
 *  matches the framework contract that the gesture commits only
 *  on explicit confirmation. The numeric input mirrors the slider
 *  so an operator wanting an exact value can type it.
 *
 *  Error surfacing follows the rename pattern: inline below the
 *  control, role="alert" so screen readers announce. */
const LEADER_MS_MIN = 10;
const LEADER_MS_MAX = 5000;

interface LeaderMsControlProps {
  groupId: string;
  groupName: string;
  leaderMs: number;
  setGroupLeaderMs: (groupId: string, leaderMs: number) => Promise<GroupActionResult>;
}

function LeaderMsControl({
  groupId,
  groupName,
  leaderMs,
  setGroupLeaderMs
}: LeaderMsControlProps) {
  useLocale();
  const [draft, setDraft] = useState(leaderMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the persisted value changes from elsewhere (another seat,
  // happening-driven refresh), pull the new value into the draft
  // unless the operator is mid-edit (draft already diverges).
  const lastPersistedRef = useRef(leaderMs);
  useEffect(() => {
    if (draft === lastPersistedRef.current) {
      setDraft(leaderMs);
    }
    lastPersistedRef.current = leaderMs;
  }, [leaderMs, draft]);

  const dirty = draft !== leaderMs;

  const clamp = (n: number): number => {
    if (Number.isNaN(n)) return leaderMs;
    if (n < LEADER_MS_MIN) return LEADER_MS_MIN;
    if (n > LEADER_MS_MAX) return LEADER_MS_MAX;
    return Math.round(n);
  };

  const apply = async (): Promise<void> => {
    if (!dirty) return;
    const value = clamp(draft);
    setBusy(true);
    setError(null);
    const r = await setGroupLeaderMs(groupId, value);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
    }
    // On success the happening-driven refresh updates `leaderMs`
    // prop; the useEffect above syncs the draft.
  };

  return (
    <div
      className="multiroom-leader-ms"
      aria-label={t("multiroom.latencyFor", { name: groupName })}
    >
      <label className="multiroom-leader-ms-label" htmlFor={`leader-ms-${groupId}`}>
        {t("multiroom.latency")}
      </label>
      <input
        id={`leader-ms-${groupId}`}
        type="range"
        min={LEADER_MS_MIN}
        max={LEADER_MS_MAX}
        step={10}
        value={draft}
        disabled={busy}
        onInput={(ev) => setDraft(clamp(Number((ev.currentTarget as HTMLInputElement).value)))}
        className="multiroom-leader-ms-slider"
        aria-valuemin={LEADER_MS_MIN}
        aria-valuemax={LEADER_MS_MAX}
        aria-valuenow={draft}
        aria-valuetext={t("multiroom.msValue", { n: draft })}
      />
      <input
        type="number"
        min={LEADER_MS_MIN}
        max={LEADER_MS_MAX}
        step={10}
        value={draft}
        disabled={busy}
        onInput={(ev) => setDraft(clamp(Number((ev.currentTarget as HTMLInputElement).value)))}
        className="multiroom-leader-ms-number"
        aria-label={t("multiroom.latencyMs")}
      />
      <span className="multiroom-leader-ms-unit">ms</span>
      <button
        type="button"
        className="multiroom-leader-ms-apply"
        onClick={() => void apply()}
        disabled={!dirty || busy}
        aria-label={t("multiroom.applyLatencyAria", { n: draft })}
        title={t("builder.set.apply")}
      >
        <Check size={14} />
        <span>{t("builder.set.apply")}</span>
      </button>
      {dirty && !busy ? (
        <button
          type="button"
          className="multiroom-leader-ms-reset"
          onClick={() => {
            setDraft(leaderMs);
            setError(null);
          }}
          aria-label={t("multiroom.discardPending")}
          title={t("multiroom.reset")}
        >
          <X size={14} />
        </button>
      ) : null}
      {error !== null ? (
        <span className="multiroom-leader-ms-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Human-readable label for the operator-declared role. Mirrors
 *  the picker option order ("Auto" first as the framework default,
 *  then explicit intent) so the chip and the picker read in the
 *  same direction. */
function roleLabel(role: DeviceRole): string {
  if (role === "source") return t("multiroom.role.source");
  if (role === "receiver") return t("multiroom.role.receiver");
  return t("multiroom.role.auto");
}

interface RoleChipProps {
  env: MultiroomCardEnvelope;
  onSetRole: (deviceId: string, role: DeviceRole) => Promise<RenameResult>;
}

/** Per-device Role affordance backed by the RoleStore. Shows the
 *  current operator-declared role as a chip; clicking opens a
 *  three-option picker (Source / Receiver / Auto) that dispatches
 *  through onSetRole. "Auto" routes through clearDeviceRole upstream
 *  (the substrate-empty default); the other two route through
 *  setDeviceRole.
 *
 *  Disabled when the device is revoked-from-this-seat: a revoked
 *  peer has no business carrying a role declaration in this seat's
 *  RoleStore. The chip still renders the last-known role (or "Auto")
 *  so the operator sees what would apply on re-admit.
 *
 *  Error surfacing is inline below the chip on the failure path;
 *  success closes the picker silently (the role_changed happening
 *  refreshes the envelope's operatorRole on the next snapshot tick). */
function RoleChip({ env, onSetRole }: RoleChipProps) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (role: DeviceRole): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await onSetRole(env.id, role);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
    } else {
      setError(r.message);
    }
  };

  // Disabled state: revoked devices have no role row in this seat's
  // RoleStore and the framework refuses the gesture. Display the
  // current value but don't open the picker.
  if (env.isRevoked) {
    return (
      <span
        className="multiroom-role-chip multiroom-role-chip-disabled"
        aria-label={t("multiroom.roleRevokedAria", {
          role: roleLabel(env.operatorRole)
        })}
        title={t("multiroom.roleRevokedTitle")}
      >
        {roleLabel(env.operatorRole)}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`multiroom-role-chip multiroom-role-chip-${env.operatorRole}`}
        onClick={() => setOpen(true)}
        aria-label={t("multiroom.changeRoleAria", {
          name: env.displayName,
          role: roleLabel(env.operatorRole)
        })}
        title={t("multiroom.changeRole")}
        disabled={busy}
      >
        {roleLabel(env.operatorRole)}
      </button>
    );
  }

  // Open picker. Three exclusive options arranged "Source / Receiver
  // / Auto"; the currently-selected one carries an aria-pressed flag
  // for assistive tech. Picking the already-current role is a no-op
  // by short-circuit; we still close the picker so the operator's
  // gesture lands.
  return (
    <div className="multiroom-role-picker" role="radiogroup" aria-label={t("multiroom.role")}>
      {(["source", "receiver", "auto"] as ReadonlyArray<DeviceRole>).map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={opt === env.operatorRole}
          className={`multiroom-role-pick ${opt === env.operatorRole ? "multiroom-role-pick-current" : ""}`}
          onClick={() => {
            if (opt === env.operatorRole) {
              setOpen(false);
              return;
            }
            void apply(opt);
          }}
          disabled={busy}
        >
          {roleLabel(opt)}
        </button>
      ))}
      <button
        type="button"
        className="multiroom-role-cancel"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        disabled={busy}
        aria-label={t("multiroom.cancelRoleChange")}
        title={t("dialog.cancel")}
      >
        <X size={12} />
      </button>
      {error !== null ? (
        <span className="multiroom-role-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface CardListProps {
  envelopes: ReadonlyArray<MultiroomCardEnvelope>;
  Icon: ReturnType<DomainIconResolver>;
  onRenameLocalDevice: RenameLocalDevice;
  /** When set, each card renders a "Remove from group" affordance
   *  that calls onRemoveFromGroup(env.id). Used inside the group
   *  drill-down view. Omit for the domain overview. */
  onRemoveFromGroup?: (deviceId: string) => void;
  /** When set, each non-leader card renders a "Make leader"
   *  affordance per MULTIROOM-FLOWS.md §8.1. Used inside the
   *  group drill-down view. */
  onMakeLeader?: (deviceId: string) => void;
  /** Busy key for op-in-flight. Format `"remove:<deviceId>"` or
   *  `"pin:<deviceId>"`. */
  removeBusyKey?: string;
  /** When set, each SOLO card renders a "Join group" affordance
   *  that calls onJoinGroup(env.id). The domain view passes this
   *  iff at least one group exists; the group drill-down omits it. */
  onJoinGroup?: (deviceId: string) => void;
  /** When set, each non-local card renders a "Revoke" affordance.
   *  Revoke is per-device-local: removing the peer from THIS
   *  device's trust ledger only. Reversible via re-admit; the card
   *  stays in the roster with a Revoked badge so the operator can
   *  re-admit later. */
  onRevoke?: (deviceId: string, displayName: string) => void;
  /** When set, each REVOKED card renders a "Re-admit" affordance.
   *  Admit is idempotent on already-admitted ids and clears the
   *  revoked flag. The card passes the previously-known
   *  display_name so the framework's `peer_not_discovered`
   *  refusal path is bypassed when the peer is offline. */
  onReadmit?: (deviceId: string, displayName: string) => void;
  /** When set, each card renders a "Move to" affordance per
   *  MULTIROOM-FLOWS.md §6. Used inside the group drill-down view. */
  onMove?: (deviceId: string, displayName: string) => void;
  /** Operator-declared role gesture. Each card renders a
   *  Role chip ("Source" / "Receiver" / "Auto") that opens a picker
   *  on click. Passing "auto" clears the row; passing "source" or
   *  "receiver" writes it. The chip stays disabled for the local
   *  device's revoked-from-this-seat state. */
  onSetRole?: (deviceId: string, role: DeviceRole) => Promise<RenameResult>;
  /** Operator-gestured reconnect storm. Each non-local
   *  card whose presence is uncertain (offline / gone-since-check)
   *  renders a "Reconnect" button that fires this callback. The
   *  surface-level HeartbeatPanel renders during the dispatch. */
  onReconnect?: (deviceId: string, displayName: string) => void;
  /** Device currently in a reconnect-storm dispatch (or null).
   *  Disables the per-card Reconnect button when one is already in
   *  flight so a click-storm doesn't queue dispatches the framework
   *  will reject. */
  reconnectInFlightDeviceId?: string | null;
}

/* ---------- Per-device five-state presence badge ---------- */

const presenceLabel = (state: PresenceState): string =>
  t(`multiroom.presence.${state}` as never);

/** Coarse "in this state for X" duration from the last-transition
 *  timestamp - glanceable, not a stopwatch. */
function formatPresenceSince(sinceMs: number | null): string {
  if (sinceMs === null) return "";
  const deltaS = Math.max(0, Math.round((Date.now() - sinceMs) / 1000));
  if (deltaS < 60) return `${deltaS}s`;
  if (deltaS < 3600) return `${Math.round(deltaS / 60)}m`;
  if (deltaS < 86400) return `${Math.round(deltaS / 3600)}h`;
  return `${Math.round(deltaS / 86400)}d`;
}

interface PresenceBadgeProps {
  state: PresenceState | null;
  sinceMs: number | null;
  network: string | null;
}

/** The per-device five-state presence badge for the LAN
 *  multi-room surface. A null state renders as "Unknown" — the
 *  framework has not classified the peer yet. */
function PresenceBadge({ state, sinceMs, network }: PresenceBadgeProps) {
  useLocale();
  const cls = state ?? "unknown";
  const label = state !== null ? presenceLabel(state) : t("multiroom.presence.unknown");
  const since = state !== null ? formatPresenceSince(sinceMs) : "";
  return (
    <div className="multiroom-presence">
      <span className={`multiroom-presence-pill multiroom-presence-${cls}`}>
        {label}
      </span>
      {since.length > 0 ? (
        <span className="multiroom-presence-meta">
          {t("multiroom.presenceFor", { duration: since })}
        </span>
      ) : null}
      {network !== null ? (
        <span className="multiroom-presence-meta">{network}</span>
      ) : null}
    </div>
  );
}

function DeviceCardList({
  envelopes,
  Icon,
  onRenameLocalDevice,
  onRemoveFromGroup,
  onMakeLeader,
  removeBusyKey,
  onJoinGroup,
  onRevoke,
  onReadmit,
  onMove,
  onSetRole,
  onReconnect,
  reconnectInFlightDeviceId
}: CardListProps) {
  useLocale();
  return (
    <ul className="collection-list multiroom-card-list">
      {envelopes.map((env) => {
        const isCurrent = env.groupRole === "leader" || env.groupRole === "master";
        const stateClass =
          env.transportState === "offline" || env.transportState === "revoked"
            ? "multiroom-card-list-item-dimmed"
            : "";
        const busy = removeBusyKey === `remove:${env.id}`;
        return (
          <li
            key={env.id}
            className={`collection-list-item ${isCurrent ? "collection-list-item-current" : ""} ${stateClass}`}
            aria-current={isCurrent ? "true" : undefined}
          >
            <span
              className={
                isCurrent
                  ? "collection-list-art collection-list-art-current"
                  : "collection-list-art"
              }
              aria-hidden
            >
              <Icon size={20} />
            </span>
            <div className="collection-list-text">
              <DeviceNameLine
                env={env}
                className="collection-list-primary"
                onRenameLocalDevice={onRenameLocalDevice}
              />
              {env.currentTrack ? (
                <div className="collection-list-secondary">
                  {env.currentTrack.title}
                  {env.currentTrack.artist ? ` - ${env.currentTrack.artist}` : ""}
                </div>
              ) : null}
              <div className="collection-list-secondary multiroom-card-badge">
                {env.stateBadge}
                {env.masterGroupContext
                  ? ` - ${env.masterGroupContext.delayMs >= 0 ? "+" : ""}${env.masterGroupContext.delayMs} ms`
                  : ""}
              </div>
              {!env.isLocal ? (
                <PresenceBadge
                  state={env.presenceState}
                  sinceMs={env.presenceSinceMs}
                  network={env.network}
                />
              ) : null}
              {onSetRole !== undefined ? (
                <div className="collection-list-secondary multiroom-card-role">
                  <RoleChip env={env} onSetRole={onSetRole} />
                </div>
              ) : null}
            </div>
            {onMakeLeader !== undefined && env.groupRole === "member" && env.isSessionConnected ? (
              <button
                type="button"
                className="multiroom-join-button"
                onClick={() => onMakeLeader(env.id)}
                disabled={removeBusyKey === `pin:${env.id}`}
                aria-label={t("multiroom.makeLeaderAria", { name: env.displayName })}
                title={t("multiroom.makeLeader")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.makeLeader")}</span>
              </button>
            ) : null}
            {onMove !== undefined && (env.groupRole === "member" || env.groupRole === "leader") ? (
              <button
                type="button"
                className="multiroom-join-button"
                onClick={() => onMove(env.id, env.displayName)}
                disabled={removeBusyKey === `move:${env.id}`}
                aria-label={t("multiroom.moveToAria", { name: env.displayName })}
                title={t("multiroom.moveToTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.moveTo")}</span>
              </button>
            ) : null}
            {onReconnect !== undefined
              && !env.isLocal
              && !env.isRevoked
              && (env.isGone || !env.isPresent || env.transportState === "offline") ? (
              <button
                type="button"
                className="multiroom-reconnect-button"
                onClick={() => onReconnect(env.id, env.displayName)}
                disabled={reconnectInFlightDeviceId !== null}
                aria-label={t("multiroom.reconnectAria", { name: env.displayName })}
                title={t("multiroom.reconnectTitle")}
              >
                <RefreshCw size={14} />
                <span>{t("multiroom.reconnect")}</span>
              </button>
            ) : null}
            {onRemoveFromGroup !== undefined ? (
              <button
                type="button"
                className="multiroom-remove-button"
                onClick={() => onRemoveFromGroup(env.id)}
                disabled={busy}
                aria-label={t("multiroom.removeFromGroupAria", { name: env.displayName })}
                title={t("multiroom.removeFromGroup")}
              >
                <UserMinus size={14} />
              </button>
            ) : null}
            {onJoinGroup !== undefined && env.groupRole === "solo" && !env.isRevoked ? (
              <button
                type="button"
                className="multiroom-join-button"
                onClick={() => onJoinGroup(env.id)}
                aria-label={t("multiroom.joinGroupAria", { name: env.displayName })}
                title={t("multiroom.joinGroupTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.joinGroup")}</span>
              </button>
            ) : null}
            {onRevoke !== undefined && !env.isLocal && !env.isRevoked ? (
              <button
                type="button"
                className="multiroom-remove-button"
                onClick={() => onRevoke(env.id, env.displayName)}
                aria-label={t("multiroom.revokeAria", { name: env.displayName })}
                title={t("multiroom.revokeFromDomain")}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
            {onReadmit !== undefined && !env.isLocal && env.isRevoked ? (
              <button
                type="button"
                className="multiroom-join-button"
                onClick={() => onReadmit(env.id, env.displayName)}
                aria-label={t("multiroom.readmitAria", { name: env.displayName })}
                title={t("multiroom.readmitTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.readmit")}</span>
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DeviceCardTiles({
  envelopes,
  Icon,
  onRenameLocalDevice,
  onRemoveFromGroup,
  onMakeLeader,
  removeBusyKey,
  onJoinGroup,
  onRevoke,
  onReadmit,
  onMove,
  onSetRole,
  onReconnect,
  reconnectInFlightDeviceId
}: CardListProps) {
  useLocale();
  return (
    <div className="collection-tile-grid multiroom-card-tiles">
      {envelopes.map((env) => {
        const isCurrent = env.groupRole === "leader" || env.groupRole === "master";
        const busy = removeBusyKey === `remove:${env.id}`;
        return (
          <div
            key={env.id}
            className={
              isCurrent ? "collection-tile collection-tile-current" : "collection-tile"
            }
            aria-current={isCurrent ? "true" : undefined}
          >
            <div
              className={
                isCurrent
                  ? "collection-tile-art collection-tile-art-current"
                  : "collection-tile-art"
              }
              aria-hidden
            >
              {/* Artwork-shaped placeholder. CSS scales the icon down
               *  to ~40% of the tile's art slot so the glyph reads as
               *  "no artwork yet" rather than postage-stamp. Replaced
               *  by per-member track or album artwork when the
               *  framework's content-addressed artwork cache lands. */}
              <Icon size={72} aria-hidden />
            </div>
            <div className="collection-tile-text">
              <DeviceNameLine
                env={env}
                className="collection-tile-primary"
                onRenameLocalDevice={onRenameLocalDevice}
              />
              {env.currentTrack ? (
                <div className="collection-tile-secondary">
                  {env.currentTrack.title}
                </div>
              ) : null}
              <div className="collection-tile-secondary multiroom-card-badge">
                {env.stateBadge}
              </div>
              {!env.isLocal ? (
                <PresenceBadge
                  state={env.presenceState}
                  sinceMs={env.presenceSinceMs}
                  network={env.network}
                />
              ) : null}
              {onSetRole !== undefined ? (
                <div className="collection-tile-secondary multiroom-card-role">
                  <RoleChip env={env} onSetRole={onSetRole} />
                </div>
              ) : null}
            </div>
            {onRemoveFromGroup !== undefined ? (
              <button
                type="button"
                className="multiroom-remove-button multiroom-remove-button-tile"
                onClick={() => onRemoveFromGroup(env.id)}
                disabled={busy}
                aria-label={t("multiroom.removeFromGroupAria", { name: env.displayName })}
                title={t("multiroom.removeFromGroup")}
              >
                <UserMinus size={14} />
              </button>
            ) : null}
            {onJoinGroup !== undefined && env.groupRole === "solo" && !env.isRevoked ? (
              <button
                type="button"
                className="multiroom-join-button multiroom-join-button-tile"
                onClick={() => onJoinGroup(env.id)}
                aria-label={t("multiroom.joinGroupAria", { name: env.displayName })}
                title={t("multiroom.joinGroupTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.join")}</span>
              </button>
            ) : null}
            {onMakeLeader !== undefined && env.groupRole === "member" && env.isSessionConnected ? (
              <button
                type="button"
                className="multiroom-join-button multiroom-join-button-tile"
                onClick={() => onMakeLeader(env.id)}
                disabled={removeBusyKey === `pin:${env.id}`}
                aria-label={t("multiroom.makeLeaderAria", { name: env.displayName })}
                title={t("multiroom.makeLeader")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.leaderShort")}</span>
              </button>
            ) : null}
            {onMove !== undefined && (env.groupRole === "member" || env.groupRole === "leader") ? (
              <button
                type="button"
                className="multiroom-join-button multiroom-join-button-tile"
                onClick={() => onMove(env.id, env.displayName)}
                disabled={removeBusyKey === `move:${env.id}`}
                aria-label={t("multiroom.moveToAria", { name: env.displayName })}
                title={t("multiroom.moveToTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.moveTo")}</span>
              </button>
            ) : null}
            {onReconnect !== undefined
              && !env.isLocal
              && !env.isRevoked
              && (env.isGone || !env.isPresent || env.transportState === "offline") ? (
              <button
                type="button"
                className="multiroom-reconnect-button multiroom-reconnect-button-tile"
                onClick={() => onReconnect(env.id, env.displayName)}
                disabled={reconnectInFlightDeviceId !== null}
                aria-label={t("multiroom.reconnectAria", { name: env.displayName })}
                title={t("multiroom.reconnectTitle")}
              >
                <RefreshCw size={14} />
                <span>{t("multiroom.reconnect")}</span>
              </button>
            ) : null}
            {onRevoke !== undefined && !env.isLocal && !env.isRevoked ? (
              <button
                type="button"
                className="multiroom-remove-button multiroom-remove-button-tile"
                onClick={() => onRevoke(env.id, env.displayName)}
                aria-label={t("multiroom.revokeAria", { name: env.displayName })}
                title={t("multiroom.revokeFromDomain")}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
            {onReadmit !== undefined && !env.isLocal && env.isRevoked ? (
              <button
                type="button"
                className="multiroom-join-button multiroom-join-button-tile"
                onClick={() => onReadmit(env.id, env.displayName)}
                aria-label={t("multiroom.readmitAria", { name: env.displayName })}
                title={t("multiroom.readmitTitle")}
              >
                <UserPlus size={14} />
                <span>{t("multiroom.readmit")}</span>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface DeviceNameLineProps {
  env: MultiroomCardEnvelope;
  className: string;
  onRenameLocalDevice: RenameLocalDevice;
}

/** Display-name line with an inline edit affordance.
 *
 *  The pencil only appears for the LOCAL device (the one the
 *  operator's browser is connected through). The framework's
 *  rename op operates against the singleton local identity, so
 *  peers must be renamed from their own UI. */
function DeviceNameLine({ env, className, onRenameLocalDevice }: DeviceNameLineProps) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(env.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!env.isLocal) {
    return <div className={className}>{env.displayName}</div>;
  }

  if (!editing) {
    return (
      <div className={`${className} device-name-line`}>
        <span className="device-name-text">{env.displayName}</span>
        <span className="device-name-this-hint" aria-label={t("multiroom.thisDeviceAria")}>
          {t("multiroom.thisDevice")}
        </span>
        <button
          type="button"
          className="device-name-edit-button"
          onClick={() => {
            setError(null);
            setValue(env.displayName);
            setEditing(true);
          }}
          aria-label={t("multiroom.renameThisDevice")}
          title={t("multiroom.renameThisDevice")}
        >
          <Pencil size={12} />
        </button>
      </div>
    );
  }

  const commit = async (): Promise<void> => {
    setBusy(true);
    const r = await onRenameLocalDevice(value);
    setBusy(false);
    if (r.ok) {
      setEditing(false);
      setError(null);
    } else {
      setError(r.message);
    }
  };

  const cancel = (): void => {
    setEditing(false);
    setError(null);
    setValue(env.displayName);
  };

  return (
    <div className={`${className} device-name-edit-row`}>
      <input
        type="text"
        className="device-name-input"
        value={value}
        maxLength={DEVICE_NAME_MAX_CHARS}
        disabled={busy}
        autoFocus
        aria-label={t("multiroom.deviceName")}
        onInput={(ev) => setValue((ev.currentTarget as HTMLInputElement).value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void commit();
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            cancel();
          }
        }}
      />
      <button
        type="button"
        className="device-name-confirm"
        onClick={() => void commit()}
        disabled={busy}
        aria-label={t("multiroom.saveName")}
        title={t("dialog.save")}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        className="device-name-cancel"
        onClick={cancel}
        disabled={busy}
        aria-label={t("multiroom.cancelRename")}
        title={t("dialog.cancel")}
      >
        <X size={14} />
      </button>
      {error !== null ? <div className="device-name-error">{error}</div> : null}
    </div>
  );
}

interface CreateGroupFormProps {
  defaultName: string;
  soloDevices: ReadonlyArray<MultiroomCardEnvelope>;
  onCreate: CreateGroupFn;
  onClose: () => void;
}

/** Inline create-group affordance. Renders below the section
 *  header when the operator taps "New group". Multi-select picker
 *  of solo devices with a name field; commits via the createGroup
 *  callback. Stays open on error so the operator can retry. */
function CreateGroupForm({
  defaultName,
  soloDevices,
  onCreate,
  onClose
}: CreateGroupFormProps) {
  useLocale();
  const [name, setName] = useState(defaultName);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (deviceId: string): void => {
    setSelected((current) =>
      current.includes(deviceId)
        ? current.filter((id) => id !== deviceId)
        : [...current, deviceId]
    );
  };

  const canSubmit = selected.length >= MIN_GROUP_MEMBERS && !busy;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const r = await onCreate(name, selected);
    setBusy(false);
    if (r.ok) {
      onClose();
    } else {
      setError(r.message);
    }
  };

  return (
    <div className="multiroom-create-group" role="dialog" aria-label={t("multiroom.createGroupTitle")}>
      <div className="multiroom-create-group-field">
        <label htmlFor="multiroom-create-group-name">{t("multiroom.groupName")}</label>
        <input
          id="multiroom-create-group-name"
          type="text"
          value={name}
          maxLength={GROUP_NAME_MAX_CHARS}
          disabled={busy}
          autoFocus
          onInput={(ev) => setName((ev.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div className="multiroom-create-group-field">
        <span className="multiroom-create-group-label">
          {t("multiroom.pickAtLeast", { n: MIN_GROUP_MEMBERS, selected: selected.length })}
        </span>
        {soloDevices.length === 0 ? (
          <p className="feature-hint">{t("multiroom.noSoloCreateHint")}</p>
        ) : (
          <ul className="multiroom-create-group-picker">
            {soloDevices.map((env) => {
              const isSelected = selected.includes(env.id);
              return (
                <li key={env.id}>
                  <label className="multiroom-create-group-pick">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={busy}
                      onChange={() => toggle(env.id)}
                    />
                    <span>{env.displayName}</span>
                    {env.isLocal ? (
                      <span className="multiroom-create-group-local-hint">
                        {t("multiroom.thisDevice")}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error !== null ? <p className="multiroom-create-group-error">{error}</p> : null}
      <div className="multiroom-create-group-actions">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {t("multiroom.create")}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          {t("dialog.cancel")}
        </button>
      </div>
    </div>
  );
}

function describeConnection(kind: "connecting" | "connected" | "disconnected" | "error"): string {
  switch (kind) {
    case "connecting":
      return t("multiroom.conn.connecting");
    case "connected":
      return t("multiroom.conn.connected");
    case "disconnected":
      return t("multiroom.conn.disconnected");
    case "error":
      return t("multiroom.conn.error");
  }
}

// HistoryView moved to features/activity/DomainHistory.tsx and
// rendered from Settings -> Activity. The chain audit log is
// retrospective and belongs with admin / observability surfaces,
// not with the operational multi-room management surface.
