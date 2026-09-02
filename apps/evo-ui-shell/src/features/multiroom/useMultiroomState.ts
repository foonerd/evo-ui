// Multi-room state hook.
//
// Connects to the framework via a relative URL (/api/v1/ws on the
// page origin). The UI runtime reverse-proxies the path to the
// framework's HTTPS substrate over loopback so the operator's
// browser never touches the framework's TLS surface directly.
//
// Open-tier LAN admit is the default; no bearer presented. The
// bearer-subprotocol code path in WsTransport remains for external
// API-consumer flows (Home Assistant, ESPHome, scripts) under
// Secure / Secure-industrial tiers but is not engaged here.
//
// Canonical roster source (the canonical-roster invariant + invariant):
//   `list_domain_members` is the framework's single source of truth
//   for which devices are in this domain. The hook MUST consume that
//   op rather than rebuilding the union of `get_device_identity` +
//   `list_groups` + `list_discovered_peers` client-side. Group
//   composition + leader election ride alongside via `list_groups`
//   and `list_source_hosts`.
//
// Composition rules per the multi-room design's state-badge contract:
//
//   - Each device's display name comes from its DomainMemberEntry's
//     `display_name` (framework-resolved, honouring the hostname-seed
//     + collision-resolver + `NameSource` flag from the multi-room domain contract
//     Decision 4). Fallback to `evo-<id-prefix>` only when the
//     framework has never observed an advert for that peer.
//   - Each device's role is solo / leader / member, derived from
//     the domain's group membership map and per-group source-host
//     election state.
//   - The state badge composes the role and the group's display name
//     ("Solo" / "Leader of <group>" / "Member of <group>").
//   - Devices currently revoked (`is_revoked == true`) are surfaced
//     so the operator can re-admit; cards mark them via the
//     transport-state badge.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import { t } from "../../runtime/i18n";

/** Maximum display-name length the framework accepts. Mirrors
 *  the server-side validator in DeviceIdentityStore. Surfaced as a
 *  client-side check so the operator gets immediate feedback. */
export const DEVICE_NAME_MAX_CHARS = 128;

/** Framework-enforced upper bound on group display-name length.
 *  Mirrors the validator in `GroupStore::create / rename`. */
export const GROUP_NAME_MAX_CHARS = 128;

/** Framework-enforced minimum member count for a flat-group. Below
 *  this threshold the group auto-dissolves. */
export const MIN_GROUP_MEMBERS = 2;

/** Result of an attempted mutation (rename, group create / rename /
 *  delete, member add / remove). `ok: true` after the framework
 *  persisted the change and the snapshot refreshed; `ok: false`
 *  carries an operator-facing reason string. */
export type RenameResult = { ok: true } | { ok: false; message: string };
export type GroupActionResult = RenameResult;
export type GroupActionResultWithId =
  | { ok: true; groupId: string }
  | { ok: false; message: string };

/** Discriminated outcome of `remove_group_member` honouring the
 *  the explicit-successor protocol explicit-successor protocol.
 *
 *  - `kind: "removed"` - the member left the group; group state
 *    refreshed. The normal happy path for non-leader removals,
 *    and for leader removals where the auto-dissolve precedence
 *    fires (post-removal count would drop below 2).
 *  - `kind: "successor_required"` - the target is the current
 *    leader AND removal would leave the group with >= 2 members.
 *    The framework refuses to auto-elect; the operator must call
 *    `selectGroupLeaderSuccessor` from `eligibleDeviceIds` (or
 *    `cancelGroupLeaderSuccessor` to abort) before the removal
 *    can land.
 *  - `kind: "failed"` - the dispatch failed (permission, not
 *    found, transport, ...); `message` is operator-facing. */
export type RemoveMemberResult =
  | { kind: "removed" }
  | {
      kind: "successor_required";
      departingDeviceId: string;
      eligibleDeviceIds: ReadonlyArray<string>;
    }
  | { kind: "failed"; message: string };

/** Discriminated outcome of `move_group_member` honouring the
 *  MULTIROOM-FLOWS.md §6.2 decision tree. Same shape as the
 *  remove flow's successor-required path because §6.4 composes
 *  the explicit-successor protocol inline when the moved device
 *  is the source group's current source-host.
 *
 *  - `kind: "moved"` - direct atomic move completed (non-leader,
 *    or leader where the source auto-dissolves on post-move
 *    count < 2).
 *  - `kind: "successor_required"` - the moved device is the
 *    source's source-host AND post-move count would be >= 2.
 *    Operator must pick a successor; second dispatch carries
 *    `successor_device_id`.
 *  - `kind: "failed"` - dispatch error. */
export type MoveMemberResult =
  | { kind: "moved" }
  | {
      kind: "successor_required";
      departingDeviceId: string;
      eligibleDeviceIds: ReadonlyArray<string>;
    }
  | { kind: "failed"; message: string };

// Chain-substrate types (ChainWitness, ChainHead, ChainEntry, ChainOp)
// are not exposed on the operator hook. The canonical trust ledger
// and group store surfaces own reads + writes; chain-substrate
// internals stay behind the framework boundary.

// Operator-declared role + reconnect result types live in
// `./decoders.ts` so unit tests can import them without dragging the
// Preact runtime through the module graph. Re-exported here so all
// existing hook consumers continue to import from the same surface.
import {
  classifyRosterSnapResult,
  decodeReconnectOutcome,
  decodePeerPresence,
  type DeviceRole,
  type PeerPresence,
  type PresenceState,
  type ReconnectOutcome,
  type ReconnectResult,
  type SnapDispatchOutcome
} from "./decoders";
export { classifyRosterSnapResult, decodeReconnectOutcome };
export type {
  DeviceRole,
  PresenceState,
  ReconnectOutcome,
  ReconnectResult,
  SnapDispatchOutcome
};

/** Summary of one multi-room group for surface-level rendering and
 *  management. Source-host id resolves the "Leader" badge; member
 *  ids drive the picker filters (a device in any group is not a
 *  candidate for joining another). */
export interface GroupSummary {
  groupId: string;
  displayName: string;
  memberDeviceIds: ReadonlyArray<string>;
  /** Framework-published deterministic leader, computed from
   *  chain-projection data alone (per the chain-projection contract).
   *  Byte-equal across every seat sharing the same chain head;
   *  resolution rule (operator-pinned > SetGroupLeader > canonical-min
   *  device_id) is enforced server-side. UI MUST drive every operator-
   *  facing "Leader" label off this field; the legacy per-seat
   *  `sourceHostByGroup` cache only populates on the originator seat
   *  and would render divergent leaders across rigs.
   *
   *  Null only when the group has zero members (transient mid-removal
   *  state). */
  effectiveLeaderDeviceId: string | null;
  /** Legacy per-seat election cache. Kept for the playback-pipeline
   *  routing path which still needs to know which seat ran the local
   *  election. NEVER drive operator-facing "Leader" labels from this -
   *  use `effectiveLeaderDeviceId` (chain-projected, cross-seat
   *  consistent) instead.
   *
   *  @deprecated for display purposes; use effectiveLeaderDeviceId. */
  sourceHostDeviceId: string | null;
  /** Operator-pinned source host per MULTIROOM-FLOWS.md §8. When
   *  set, the framework's election rule respects it; the UI shows
   *  an "Unpin leader" affordance. `null` means election runs by
   *  canonical-min rule. */
  pinnedSourceHostDeviceId: string | null;
  /** Per-group latency budget in milliseconds. Range 10..=5000,
   *  default 200. Operator-mutable via set_group_leader_ms. The
   *  multi-room plugin reads it every frame; changes take effect
   *  on the next frame without plugin reload. */
  leaderMs: number;
}

export type ConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface ConnectionState {
  kind: ConnectionKind;
  reason?: string;
}

export type TransportState =
  | "playing"
  | "paused"
  | "stopped"
  | "idle"
  | "offline"
  /** Peer is mDNS-advertising but the audio-plane heartbeat has
   *  not yet connected. Cold-start state in the framework's
   *  four-state liveness contract; leader actions stay gated until
   *  the session is up. */
  | "no_session"
  | "unpaired"
  | "revoked";

export interface TrackSummary {
  artworkUrl: string | null;
  title: string;
  artist: string | null;
  album: string | null;
}

export interface MasterGroupContext {
  masterGroupId: string;
  masterGroupName: string;
  delayMs: number;
  audibleTimeMs: number | null;
}

/** Position of a device within the multi-room group lattice.
 *  Composed from group membership and source-host election state;
 *  not operator-mutable. Distinct from `DeviceRole` (declared above)
 *  which is the operator-declared source/receiver/auto designation
 *  in the RoleStore. The two concepts are orthogonal: a "source"-declared
 *  device can still be a "member" of a group if the elected leader
 *  is elsewhere; a "receiver"-declared device cannot be elected
 *  leader. The compose pass below populates both fields on every
 *  envelope. */
export type GroupRole = "solo" | "leader" | "member" | "subgroup" | "master";

export type NameSource = "auto" | "operator";

export interface MultiroomCardEnvelope {
  /** Stable per-device identifier. Used as React key only - never
   *  rendered in user-visible text. */
  id: string;
  /** Operator-readable name. Sourced from the framework's
   *  DomainMemberEntry; honours the hostname-seed + collision-resolver
   *  + `NameSource` machinery per the hostname-seed + NameSource model. */
  displayName: string;
  /** Provenance of the display name. `auto` means framework-managed
   *  (collision resolver may rewrite); `operator` means the operator
   *  has set it explicitly and the framework MUST NOT rewrite. */
  nameSource: NameSource;
  /** Position of this device in the multi-room group lattice -
   *  composed from group membership + source-host election. Drives
   *  the state badge ("Solo" / "Leader of X" / "Member of X"). */
  groupRole: GroupRole;
  /** Operator-declared role from the RoleStore. Defaults to
   *  "auto" for devices the operator has never explicitly tagged.
   *  Distinct from `groupRole`: this is the operator's intent
   *  ("source" = should host group output, "receiver" = should
   *  never be elected leader, "auto" = framework decides). The
   *  multi-room plugin enforces it on election; the UI surfaces it
   *  as a per-device chip + selector. */
  operatorRole: DeviceRole;
  stateBadge: string;
  transportState: TransportState;
  currentTrack: TrackSummary | null;
  themePlaceholderArtworkUrl: string | null;
  masterGroupContext: MasterGroupContext | null;
  /** Whether this card is the local device (the one the operator's
   *  browser is connected through). Used for a subtle visual cue
   *  and to decide which card carries the rename affordance. */
  isLocal: boolean;
  /** Whether the framework's mDNS-SD discovery is currently
   *  observing an advert for this device. Offline paired members
   *  remain visible per the canonical-roster invariant; cards dim them. */
  isCurrentlyAdvertising: boolean;
  /** Whether the framework's audio-plane heartbeat is currently
   *  alive for this device. Source of truth for "can the election
   *  elect this device right now" - leader actions (Make-leader,
   *  successor pick) gate on this rather than on
   *  `isCurrentlyAdvertising` per the framework's election
   *  contract. Local always reads true.
   *
   *  Note: under the zero-poll liveness substrate this field is
   *  informational at the trust-ledger level; the snap's
   *  `isPresent` is the authoritative liveness signal for actions. */
  isSessionConnected: boolean;
  /** Whether the most recent `roster_snap` reported this device in
   *  `presents`. The framework-truthful liveness claim at the
   *  `snapCompletedAt` timestamp. Local always reads true. When no
   *  snap has run yet the value falls back to
   *  `isCurrentlyAdvertising || isSessionConnected`. */
  isPresent: boolean;
  /** Whether the most recent `roster_snap` reported this device in
   *  `gones[]` with marauder-confirmed absence. Renders the
   *  "Gone since check" badge with `lastSeenMs`. Cannot coexist
   *  with `isPresent: true`. */
  isGone: boolean;
  /** Wall-clock ms of the last advert observed for this peer
   *  (carried from `gones[].last_seen_ms` when absent, or
   *  `domain_members.last_seen_ms` otherwise). Used by the
   *  "last seen N min ago" copy on Gone cards. */
  lastSeenMs: number;
  /** True when the trust-ledger row's `revoked_at` is set. The
   *  device is no longer admitted; the card stays surfaced so the
   *  operator can re-admit. */
  isRevoked: boolean;
  /** Five-state LAN presence projected from the PresenceCorrelator
   *  via list_discovered_peers. null when not yet classified
   *  (rendered "unknown"); always null for the local card. */
  presenceState: PresenceState | null;
  /** Wall-clock ms of the last presence transition, or null. Drives
   *  the "in this state for X" copy on the presence badge. */
  presenceSinceMs: number | null;
  /** Network id of the peer's most recent chain-recorded endpoint
   *  (e.g. "enp0s3"), or null. */
  network: string | null;
}

/** Reason carried on every `roster_snap` dispatch. Recorded in
 *  the snap response + the `roster_snapped` happening for audit
 *  visibility. Each reason corresponds to a specific gaze trigger
 *  the UI honours per the zero-poll substrate contract. */
export type SnapReason =
  | "surface_opened"
  | "manual_refresh"
  | "gesture_precondition"
  | "happening_subscription_warm";

/** One device reported present by a `roster_snap`. The snap
 *  populates this from the targeted mDNS-SD query + marauder
 *  rounds; presence is a truthful claim at the snap's timestamp,
 *  NOT a cached liveness flag. */
export interface RosterEntry {
  deviceId: string;
  displayName: string;
  addresses: ReadonlyArray<string>;
  /** True when the framework's internal prior-known-roster did
   *  not include this device — i.e. it just joined / rejoined
   *  the LAN since the previous snap. */
  newToSnap: boolean;
  lastSeenMs: number;
}

/** One device reported `gone` by a `roster_snap`. The framework
 *  has marauder-confirmed absence — single packet loss is NOT an
 *  absence claim per the substrate contract; gones[] entries are
 *  always confirmed via a targeted second-stage probe. */
export interface RosterDeparture {
  deviceId: string;
  displayName: string;
  lastSeenMs: number;
}

/** Result of the `roster_snap` wire op. The snap is the framework's
 *  authoritative answer to "who is reachable right now" at the
 *  `snap_completed_at` timestamp. The UI renders cards as either
 *  present (with the timestamp visible) or gone (with last_seen +
 *  marauder confirmation). There is no "Offline" pill in this
 *  contract. */
export interface RosterSnap {
  snapId: string;
  reason: SnapReason;
  snapStartedAtMs: number;
  snapCompletedAtMs: number;
  deadlineMs: number;
  deadlineBreached: boolean;
  presents: ReadonlyArray<RosterEntry>;
  gones: ReadonlyArray<RosterDeparture>;
}

/** Summary of one peer the framework's mDNS-SD discovery has
 *  observed but which is NOT (yet) in the local trust ledger. Drives
 *  the "Discovered devices" section operator gesture: tap "Admit" to
 *  add the peer to this device's domain via the peer-admission flow. */
export interface DiscoveredPeer {
  deviceId: string;
  displayName: string;
  addresses: ReadonlyArray<string>;
  frameworkVersion: string | null;
  vendorId: string | null;
  publicKeyFingerprint: string | null;
  lastSeenMs: number;
}

export interface MultiroomState {
  connection: ConnectionState;
  envelopes: ReadonlyArray<MultiroomCardEnvelope>;
  /** Every known group in the domain (flat groups in the current
   *  release; recursive subgroup support lands later). Drives the
   *  group drill-down view and the group pickers (create / join /
   *  add member). */
  groups: ReadonlyArray<GroupSummary>;
  /** Devices on the LAN advertising via mDNS-SD but NOT yet
   *  admitted into this domain's trust ledger. Drives the
   *  "Discovered devices" section operator gesture. Empty in the
   *  steady state where every advertised peer is already admitted. */
  discoveredPeers: ReadonlyArray<DiscoveredPeer>;
  /** Last completed `roster_snap` outcome, or null when no snap
   *  has run since the surface mounted. The surface renders the
   *  `snapCompletedAt` timestamp + the "Checking who's here..."
   *  affordance against this value. */
  lastSnap: RosterSnap | null;
  /** True while a `roster_snap` dispatch is in flight. The
   *  surface uses this with the 200 ms threshold to decide
   *  whether to surface the progress affordance. */
  snapInFlight: boolean;
  /** Operator-facing error from the most recent `roster_snap`
   *  dispatch, or null when the last attempt succeeded or none
   *  has run yet. Covers three failure classes:
   *
   *  - "Not connected to the audio system." when the transport
   *    layer was unavailable at dispatch time.
   *  - Framework-returned error envelope (typed-error subclass or
   *    raw message) when the dispatch was refused / timed out.
   *  - "Roster snap response was unparsable." when the decoder
   *    rejected the response shape.
   *
   *  Cleared on the next successful snap, on a manual refresh,
   *  or when the operator dismisses via `dismissSnapError`. */
  snapError: string | null;
  /** Clear the surfaced `snapError`. Called by the SnapStatusBar's
   *  dismiss affordance; the next failure-class snap will repopulate. */
  dismissSnapError: () => void;
  /** Trigger a fresh `roster_snap`. Reason recorded for audit. */
  rosterSnap: (reason: SnapReason, deadlineMs?: number) => Promise<RosterSnap | null>;
  /** Rename the LOCAL device only. Peers must be renamed from
   *  their own UI; the framework's `set_device_display_name` op
   *  operates on the singleton local identity. Server-side this
   *  flips `NameSource` from `auto` to `operator` (sticky). */
  renameLocalDevice: (newName: string) => Promise<RenameResult>;
  /** Admit a discovered peer into this device's domain trust
   *  ledger per MULTIROOM-FLOWS.md §3. Standard discovery-driven
   *  admission omits `displayName` so the framework auto-resolves
   *  from the peer's last-observed mDNS-SD advert TXT record.
   *  Sight-unseen admit (§3.4) passes `displayName` explicitly. */
  admitDevice: (deviceId: string, displayName?: string) => Promise<RenameResult>;
  /** Revoke a previously-admitted device from THIS device's trust
   *  ledger. Per-device-local: the operator must repeat the gesture
   *  on each seat for cross-device agreement. The card stays in the
   *  roster with a Revoked badge so the operator can re-admit;
   *  chain-substrate cross-device propagation is future architecture. */
  revokeDevice: (deviceId: string) => Promise<RenameResult>;
  /** Create a new flat-group with at least two member devices
   *  (the framework auto-dissolves any group that drops below
   *  the two-member threshold). */
  createGroup: (
    displayName: string,
    memberDeviceIds: ReadonlyArray<string>
  ) => Promise<GroupActionResultWithId>;
  /** Rename an existing group. */
  renameGroup: (groupId: string, displayName: string) => Promise<GroupActionResult>;
  /** Dissolve a group; every member returns to solo. */
  deleteGroup: (groupId: string) => Promise<GroupActionResult>;
  /** Add a domain-member device to a group. The framework refuses
   *  device ids that are not in the trust ledger (the framework's trust-ledger validation). */
  addGroupMember: (groupId: string, deviceId: string) => Promise<GroupActionResult>;
  /** Remove a device from a group. The framework auto-dissolves
   *  the group when fewer than two members remain (§10.4). Leader
   *  removal when post-removal count >= 2 surfaces as
   *  `successor_required` per the explicit-successor protocol; the caller is expected
   *  to render a picker and then call `selectGroupLeaderSuccessor`. */
  removeGroupMember: (groupId: string, deviceId: string) => Promise<RemoveMemberResult>;
  /** Atomically move a member between groups per MULTIROOM-FLOWS.md
   *  §6. When moving a leader with post-move count >= 2 in the
   *  source group, the operator must supply `successorDeviceId`
   *  on the second dispatch; the first returns successor_required. */
  moveGroupMember: (
    fromGroupId: string,
    toGroupId: string,
    deviceId: string,
    successorDeviceId?: string
  ) => Promise<MoveMemberResult>;
  /** Pin a group member as the source-host per MULTIROOM-FLOWS.md
   *  §8.1. Overrides the framework's canonical-min election. */
  pinSourceHost: (groupId: string, deviceId: string) => Promise<GroupActionResult>;
  /** Clear the operator-pinned source-host per MULTIROOM-FLOWS.md
   *  §8.2. Election resumes the canonical-min rule. */
  unpinSourceHost: (groupId: string) => Promise<GroupActionResult>;
  /** Atomically pin a successor as the group's source-host and
   *  remove the departing leader. Per the explicit-successor protocol the framework
   *  composes both operations and emits one `MultiroomLeaderHandoff`
   *  happening. */
  selectGroupLeaderSuccessor: (
    groupId: string,
    departingDeviceId: string,
    successorDeviceId: string
  ) => Promise<GroupActionResult>;
  /** Abort the pending leader-successor decision. The departing
   *  leader stays in place; the group is unchanged. */
  cancelGroupLeaderSuccessor: (
    groupId: string,
    departingDeviceId: string
  ) => Promise<GroupActionResult>;
  /** Map of device_id -> operator-declared role from the RoleStore.
   *  Devices absent from the map are at the substrate-empty "auto"
   *  default. UI consumers should treat lookup-miss as "auto". */
  deviceRoles: ReadonlyMap<string, DeviceRole>;
  /** Set the operator-declared role for a device. Idempotent on
   *  unchanged value (framework emits device_role_changed only on
   *  real transitions per A-ROLE-LIFECYCLE). */
  setDeviceRole: (deviceId: string, role: DeviceRole) => Promise<RenameResult>;
  /** Clear the operator-declared role for a device. Returns the
   *  device to the substrate-empty "auto" default. */
  clearDeviceRole: (deviceId: string) => Promise<RenameResult>;
  /** Set the per-group latency budget in milliseconds. Range
   *  10..=5000. Multi-room plugin reads it every frame. */
  setGroupLeaderMs: (groupId: string, leaderMs: number) => Promise<GroupActionResult>;
  /** Operator-gestured 5-carrier reconnect storm. 30 s blocking;
   *  resolves on first-carrier success or exhaustion. UI should
   *  wrap with a HeartbeatPanel progress affordance. */
  reconnectPeer: (deviceId: string) => Promise<ReconnectResult>;
}

export function useMultiroomState(): MultiroomState {
  const frameworkUrl = useFrameworkUrl();
  const [connection, setConnection] = useState<ConnectionState>({ kind: "connecting" });
  const [envelopes, setEnvelopes] = useState<ReadonlyArray<MultiroomCardEnvelope>>([]);
  const [groups, setGroups] = useState<ReadonlyArray<GroupSummary>>([]);
  const [discoveredPeers, setDiscoveredPeers] = useState<ReadonlyArray<DiscoveredPeer>>([]);
  const [lastSnap, setLastSnap] = useState<RosterSnap | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const dismissSnapError = useCallback(() => setSnapError(null), []);
  const [snapInFlight, setSnapInFlight] = useState(false);
  const [deviceRoles, setDeviceRoles] = useState<ReadonlyMap<string, DeviceRole>>(new Map());
  const transportRef = useRef<WsTransport | null>(null);
  // Latest snap kept in a ref so compose() can join without
  // becoming a function of changing react state shape (snapshot
  // is a structural artefact, not a render trigger).
  const snapRef = useRef<RosterSnap | null>(null);
  // Mirror of snapInFlight kept in a ref so the rosterSnap and
  // happening-driven auto-snap paths can coalesce without
  // needing to be regenerated on every render.
  const snapInFlightRef = useRef(false);
  // Forward declaration ref for rosterSnap. The happening
  // handler is registered before the rosterSnap useCallback is
  // declared in source order, so we capture a ref the
  // dedicated effect below keeps current.
  const rosterSnapRef = useRef<
    ((reason: SnapReason, deadlineMs?: number) => Promise<RosterSnap | null>) | null
  >(null);

  const applySnapshot = (snapshot: Snapshot): void => {
    setEnvelopes(compose(snapshot, snapRef.current));
    setGroups(toGroupSummaries(snapshot));
    setDiscoveredPeers(filterUnadmittedPeers(snapshot));
    setDeviceRoles(snapshot.deviceRoles);
  };

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      setConnection({ kind: "error", reason: t("collection.wsUnavailable") });
      return;
    }

    let cancelled = false;
    const transport = new WsTransport({ url: frameworkUrl });
    transportRef.current = transport;
    setConnection({ kind: "connecting" });

    const seedState = async (): Promise<void> => {
      try {
        await transport.connect();
        if (cancelled) return;
        setConnection({ kind: "connected" });
        const refreshed = await refreshAll(transport);
        if (cancelled) return;
        applySnapshot(refreshed);

        // Refresh debouncer: collapse a burst of state-mutation
        // happenings (e.g. a leader handoff cascade emitting
        // multiple variants) into a single refreshAll. 100 ms
        // window matches the operator perception clock and pulls
        // the subsequent reads off the audio-plane hot path.
        let refreshDebounceHandle: number | null = null;
        const scheduleRefresh = (): void => {
          if (refreshDebounceHandle !== null) return;
          refreshDebounceHandle = window.setTimeout(() => {
            refreshDebounceHandle = null;
            if (cancelled) return;
            void refreshAll(transport).then((again) => {
              if (cancelled) return;
              applySnapshot(again);
            });
          }, 100);
        };

        // Open the explicit subscribe_happenings stream alongside
        // the fan-out listener. Some happenings (notably the
        // device_role_changed and group_leader_ms_changed happenings)
        // are emitted only via the subscription channel once that
        // side of the framework binds; the fan-out path is a
        // pre-subscription buffer.
        const subscriptionAbort = new AbortController();
        const consumeSubscription = async (): Promise<void> => {
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
            // Subscription terminated; transport reconnect will
            // re-establish on its own loop.
          }
        };

        const handleHappening = (raw: unknown): void => {
          const happening = isObject(raw) && isObject(raw["happening"])
            ? raw["happening"]
            : raw;
          const variant = readVariant(happening);
          if (variant === null) return;
          if (REFRESH_TRIGGERS.has(variant)) {
            scheduleRefresh();
          }
        };

        void consumeSubscription();

        transport.onHappening((frame) => {
          if (cancelled) return;
          handleHappening(frame.happening);
        });
      } catch (err) {
        if (cancelled) return;
        setConnection({
          kind: "error",
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    };

    void seedState();

    return () => {
      cancelled = true;
      void transport.close();
      transportRef.current = null;
    };
  }, [frameworkUrl]);

  const renameLocalDevice = useCallback(
    async (newName: string): Promise<RenameResult> => {
      const trimmed = newName.trim();
      if (trimmed.length === 0) {
        return { ok: false, message: t("multiroom.err.enterName") };
      }
      if (Array.from(trimmed).length > DEVICE_NAME_MAX_CHARS) {
        return {
          ok: false,
          message: t("multiroom.err.nameTooLong", { n: DEVICE_NAME_MAX_CHARS })
        };
      }
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      const result = await transport.dispatch("set_device_display_name", {
        display_name: trimmed
      });
      if (result.error !== undefined) {
        return { ok: false, message: humaniseRenameError(result.error) };
      }
      try {
        const refreshed = await refreshAll(transport);
        applySnapshot(refreshed);
      } catch {
        // Refresh failure is non-fatal; the rename itself succeeded
        // and the next snapshot refresh will reconcile.
      }
      return { ok: true };
    },
    []
  );

  const rosterSnap = useCallback(
    async (reason: SnapReason, deadlineMs?: number): Promise<RosterSnap | null> => {
      const transport = transportRef.current;
      if (transport === null) {
        // Transport unavailable at dispatch time. Surface so the
        // operator sees an actionable error rather than a silent
        // no-op refresh.
        setSnapError(t("multiroom.err.notConnected"));
        return null;
      }
      // Coalesce: a snap is already in flight, return the
      // pending one's eventual completion via setLastSnap. We
      // don't dispatch a second wire op. This guards both
      // operator-initiated rapid clicks and happening bursts
      // that race with manual refresh. This is NOT an error
      // state - leave snapError as-is.
      if (snapInFlightRef.current) return null;
      snapInFlightRef.current = true;
      setSnapInFlight(true);
      try {
        const payload: Record<string, unknown> = { reason };
        if (deadlineMs !== undefined) {
          payload["deadline_ms"] = deadlineMs;
        }
        const result = await transport.dispatch("roster_snap", payload);
        // Classify dispatch-level + decode-level failures into a
        // single discriminated outcome so the operator banner can
        // distinguish "framework refused" from "framework returned
        // an unparsable shape".
        const outcome: SnapDispatchOutcome<RosterSnap> = classifyRosterSnapResult(
          result,
          decodeRosterSnap
        );
        if (!outcome.ok) {
          setSnapError(outcome.message);
          return null;
        }
        const snap = outcome.snap;
        snapRef.current = snap;
        setLastSnap(snap);
        setSnapError(null);
        // Re-compose envelopes against the new snap. The
        // domain roster (trust ledger) hasn't changed but the
        // per-device presence facts have.
        try {
          const refreshed = await refreshAll(transport);
          setEnvelopes(compose(refreshed, snap));
          setGroups(toGroupSummaries(refreshed));
          setDiscoveredPeers(filterUnadmittedPeers(refreshed));
        } catch {
          // refresh failure is non-fatal; the snap timestamp
          // already updated through setLastSnap above.
        }
        return snap;
      } finally {
        snapInFlightRef.current = false;
        setSnapInFlight(false);
      }
    },
    []
  );

  // Keep rosterSnapRef pointed at the latest rosterSnap so the
  // happening handler (registered once at connect time) can
  // invoke the current implementation without re-registering on
  // every render.
  useEffect(() => {
    rosterSnapRef.current = rosterSnap;
  }, [rosterSnap]);


  const admitDevice = useCallback(
    async (deviceId: string, displayName?: string): Promise<RenameResult> => {
      if (deviceId.length === 0) {
        return { ok: false, message: t("multiroom.err.noDeviceId") };
      }
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      // Per MULTIROOM-FLOWS.md §3.2 step 4: when admitting from
      // discovery, dispatch device_id ONLY. The framework
      // auto-resolves display_name from the peer's last-observed
      // mDNS-SD advert TXT record. Caller passes display_name only
      // for sight-unseen admit (§3.4) which is not yet wired here.
      const payload: Record<string, unknown> = { device_id: deviceId };
      if (displayName !== undefined) {
        const trimmedName = displayName.trim();
        if (trimmedName.length === 0) {
          return { ok: false, message: t("multiroom.err.emptyDeviceName") };
        }
        payload["display_name"] = trimmedName;
      }
      const result = await transport.dispatch("admit_peer_to_domain", payload);
      if (result.error !== undefined) {
        return { ok: false, message: humaniseAdmitError(result.error) };
      }
      try {
        const refreshed = await refreshAll(transport);
        applySnapshot(refreshed);
      } catch {
        // Refresh failure is non-fatal; the admit itself succeeded
        // and the next happening or snapshot refresh will reconcile.
      }
      return { ok: true };
    },
    []
  );

  const revokeDevice = useCallback(
    async (deviceId: string): Promise<RenameResult> => {
      if (deviceId.length === 0) {
        return { ok: false, message: t("multiroom.err.noDeviceId") };
      }
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      // Revoke removes the peer from THIS device's trust ledger.
      // The ledger is canonical and revocation is per-device-local
      // (operator must repeat the gesture on each seat for
      // cross-device agreement). Re-admit by issuing
      // admit_peer_to_domain against the same id; the card stays
      // visible with a Revoked badge until admitted again.
      const result = await transport.dispatch("revoke_peer_from_domain", {
        device_id: deviceId
      });
      if (result.error !== undefined) {
        return { ok: false, message: humaniseAdmitError(result.error) };
      }
      try {
        const refreshed = await refreshAll(transport);
        applySnapshot(refreshed);
      } catch {
        // Refresh failure is non-fatal; the next happening or snap
        // will reconcile.
      }
      return { ok: true };
    },
    []
  );

  const runGroupOp = async (
    op: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> => {
    const transport = transportRef.current;
    if (transport === null) {
      return { ok: false, message: t("multiroom.err.notConnected") };
    }
    const result = await transport.dispatch(op, payload);
    if (result.error !== undefined) {
      return { ok: false, message: humaniseGroupError(op, result.error) };
    }
    try {
      const refreshed = await refreshAll(transport);
      applySnapshot(refreshed);
    } catch {
      // Refresh failure is non-fatal; the mutation succeeded and the
      // next happening or snapshot refresh will reconcile state.
    }
    return { ok: true, value: result.value ?? null };
  };

  const createGroup = useCallback(
    async (
      displayName: string,
      memberDeviceIds: ReadonlyArray<string>
    ): Promise<GroupActionResultWithId> => {
      const trimmed = displayName.trim();
      if (trimmed.length === 0) {
        return { ok: false, message: t("multiroom.err.enterGroupName") };
      }
      if (Array.from(trimmed).length > GROUP_NAME_MAX_CHARS) {
        return {
          ok: false,
          message: t("multiroom.err.groupNameTooLong", { n: GROUP_NAME_MAX_CHARS })
        };
      }
      const unique = Array.from(new Set(memberDeviceIds));
      if (unique.length < MIN_GROUP_MEMBERS) {
        return {
          ok: false,
          message: t("multiroom.err.pickAtLeastToForm", { n: MIN_GROUP_MEMBERS })
        };
      }
      const result = await runGroupOp("create_group", {
        display_name: trimmed,
        members: unique
      });
      if (!result.ok) {
        return result;
      }
      const groupId = readGroupId(result.value);
      if (groupId === null) {
        return { ok: false, message: t("multiroom.err.groupIdMissing") };
      }
      return { ok: true, groupId };
    },
    []
  );

  const renameGroup = useCallback(
    async (groupId: string, displayName: string): Promise<GroupActionResult> => {
      const trimmed = displayName.trim();
      if (trimmed.length === 0) {
        return { ok: false, message: t("multiroom.err.enterGroupName") };
      }
      if (Array.from(trimmed).length > GROUP_NAME_MAX_CHARS) {
        return {
          ok: false,
          message: t("multiroom.err.groupNameTooLong", { n: GROUP_NAME_MAX_CHARS })
        };
      }
      const result = await runGroupOp("rename_group", {
        group_id: groupId,
        display_name: trimmed
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const deleteGroup = useCallback(
    async (groupId: string): Promise<GroupActionResult> => {
      const result = await runGroupOp("delete_group", { group_id: groupId });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const addGroupMember = useCallback(
    async (groupId: string, deviceId: string): Promise<GroupActionResult> => {
      const result = await runGroupOp("add_group_member", {
        group_id: groupId,
        device_id: deviceId
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const removeGroupMember = useCallback(
    async (groupId: string, deviceId: string): Promise<RemoveMemberResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { kind: "failed", message: t("multiroom.err.notConnected") };
      }
      const result = await transport.dispatch("remove_group_member", {
        group_id: groupId,
        device_id: deviceId
      });
      if (result.error !== undefined) {
        return { kind: "failed", message: humaniseGroupError("remove_group_member", result.error) };
      }
      // Detect the SuccessorRequired discriminator before treating
      // the response as success. Per server.rs::LeaderSuccessorRequired
      // the success payload carries `successor_required: true` plus
      // the departing-leader id and an eligible-member-id list.
      const successor = decodeSuccessorRequired(result.value);
      if (successor !== null) {
        return successor;
      }
      try {
        const refreshed = await refreshAll(transport);
        applySnapshot(refreshed);
      } catch {
        // Refresh failure is non-fatal; the removal itself
        // succeeded and the next happening or snapshot refresh
        // will reconcile state.
      }
      return { kind: "removed" };
    },
    []
  );

  const moveGroupMember = useCallback(
    async (
      fromGroupId: string,
      toGroupId: string,
      deviceId: string,
      successorDeviceId?: string
    ): Promise<MoveMemberResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { kind: "failed", message: t("multiroom.err.notConnected") };
      }
      // Trust-ledger canonical path: atomic between-group move
      // dispatches to the legacy move_group_member verb. The
      // chain-aware move_member op is future substrate.
      const payload: Record<string, unknown> = {
        from_group_id: fromGroupId,
        to_group_id: toGroupId,
        device_id: deviceId
      };
      if (successorDeviceId !== undefined) {
        payload["successor_device_id"] = successorDeviceId;
      }
      const result = await transport.dispatch("move_group_member", payload);
      if (result.error !== undefined) {
        return { kind: "failed", message: humaniseGroupError("move_group_member", result.error) };
      }
      // §6.4: same SuccessorRequired discriminator as the remove
      // flow. First-dispatch on a leader returns this shape; the
      // operator picks a successor and re-dispatches.
      const successor = decodeSuccessorRequired(result.value);
      if (successor !== null) {
        return successor;
      }
      try {
        const refreshed = await refreshAll(transport);
        applySnapshot(refreshed);
      } catch {
        // Refresh failure is non-fatal.
      }
      return { kind: "moved" };
    },
    []
  );

  const pinSourceHost = useCallback(
    async (groupId: string, deviceId: string): Promise<GroupActionResult> => {
      // Pin the source-host of a group to a specific member. The
      // substrate enforces "must be a current member". Chain-aware
      // set_group_leader is a future substrate.
      const result = await runGroupOp("pin_source_host", {
        group_id: groupId,
        device_id: deviceId
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const unpinSourceHost = useCallback(
    async (groupId: string): Promise<GroupActionResult> => {
      // The chain substrate has no symmetric "auto" mode yet -
      // set_group_leader is a direct gesture and there is no
      // "release leader to auto-election" wire op in the
      // initial substrate surface. Retain the legacy
      // unpin_source_host call for now; it will return an
      // error if the framework has retired the legacy op and
      // the UI will surface that to the operator.
      const result = await runGroupOp("unpin_source_host", { group_id: groupId });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const selectGroupLeaderSuccessor = useCallback(
    async (
      groupId: string,
      departingDeviceId: string,
      successorDeviceId: string
    ): Promise<GroupActionResult> => {
      const result = await runGroupOp("select_group_leader_successor", {
        group_id: groupId,
        departing_device_id: departingDeviceId,
        successor_device_id: successorDeviceId
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const cancelGroupLeaderSuccessor = useCallback(
    async (
      groupId: string,
      departingDeviceId: string
    ): Promise<GroupActionResult> => {
      const result = await runGroupOp("cancel_group_leader_successor", {
        group_id: groupId,
        departing_device_id: departingDeviceId
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  // === RoleStore + GroupStore substrate gestures ==============
  //
  // Per-device role (source / receiver / auto), per-group
  // leader_ms, operator-gestured reconnect storm, plugin
  // lifecycle. All step-up-aware; Open tier accepts any
  // non-empty string.

  const setDeviceRole = useCallback(
    async (deviceId: string, role: DeviceRole): Promise<RenameResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      const result = await transport.dispatch("set_device_role", {
        device_id: deviceId,
        role,
        step_up_token: "open-tier-stub"
      });
      if (result.error !== undefined) {
        return { ok: false, message: humaniseAdmitError(result.error) };
      }
      // Refresh happens via device_role_changed -> REFRESH_TRIGGERS.
      return { ok: true };
    },
    []
  );

  const clearDeviceRole = useCallback(
    async (deviceId: string): Promise<RenameResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      const result = await transport.dispatch("clear_device_role", {
        device_id: deviceId,
        step_up_token: "open-tier-stub"
      });
      if (result.error !== undefined) {
        return { ok: false, message: humaniseAdmitError(result.error) };
      }
      return { ok: true };
    },
    []
  );

  const setGroupLeaderMs = useCallback(
    async (groupId: string, leaderMs: number): Promise<GroupActionResult> => {
      const result = await runGroupOp("set_group_leader_ms", {
        group_id: groupId,
        leader_ms: leaderMs,
        step_up_token: "open-tier-stub"
      });
      return result.ok ? { ok: true } : result;
    },
    []
  );

  const reconnectPeer = useCallback(
    async (deviceId: string): Promise<ReconnectResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: t("multiroom.err.notConnected") };
      }
      // 30s blocking on the framework side. WS transport tolerates
      // the long dispatch per A-RECONNECT-TIMEOUT.
      const result = await transport.dispatch("reconnect_peer", {
        device_id: deviceId,
        step_up_token: "open-tier-stub"
      });
      if (result.error !== undefined) {
        return { ok: false, message: humaniseAdmitError(result.error) };
      }
      return decodeReconnectOutcome(result.value);
    },
    []
  );

  return {
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
    deviceRoles,
    setDeviceRole,
    clearDeviceRole,
    setGroupLeaderMs,
    reconnectPeer
  };
}

/** Decode the framework's `LeaderSuccessorRequired` response shape
 *  (server.rs:3987). The wire uses the `successor_required: true`
 *  discriminator plus `departing_device_id` + `eligible_member_ids`.
 *  Returns null when the response is a normal completed outcome
 *  rather than the successor-required path. The returned variant
 *  is structurally compatible with both `RemoveMemberResult` and
 *  `MoveMemberResult` since the §7.3 + §6.4 protocols share shape. */
type SuccessorRequiredVariant = {
  kind: "successor_required";
  departingDeviceId: string;
  eligibleDeviceIds: ReadonlyArray<string>;
};

function decodeSuccessorRequired(raw: unknown): SuccessorRequiredVariant | null {
  if (!isObject(raw)) return null;
  if (raw["successor_required"] !== true) return null;
  const departingDeviceId = stringField(raw, "departing_device_id");
  if (departingDeviceId === null) return null;
  const eligibleRaw = raw["eligible_member_ids"];
  const eligible: string[] = [];
  if (Array.isArray(eligibleRaw)) {
    for (const id of eligibleRaw) {
      if (typeof id === "string") eligible.push(id);
    }
  }
  return {
    kind: "successor_required",
    departingDeviceId,
    eligibleDeviceIds: eligible
  };
}

/** Translate a framework admit/revoke error into operator-friendly
 *  text. Shares the rename error shape but with admit-specific
 *  fallbacks. */
function humaniseAdmitError(error: { code?: string; message?: string; subclass?: string }): string {
  // Subclasses per MULTIROOM-FLOWS.md §13 catalogue.
  const code = (error.code ?? "").toLowerCase();
  const subclass = (error.subclass ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  const tag = subclass.length > 0 ? subclass : msg;

  if (subclass === "plugins_admin_not_granted" || code.includes("permission") || msg.includes("not granted")) {
    return t("multiroom.err.noPermission");
  }
  if (
    subclass === "device_not_responding" ||
    tag.includes("device_not_responding") ||
    tag.includes("did not respond") ||
    tag.includes("deadline elapsed")
  ) {
    return t("multiroom.err.notResponding");
  }
  if (subclass === "peer_not_discovered" || tag.includes("not been observed") || tag.includes("peer_not_discovered")) {
    return t("multiroom.err.notDiscovered");
  }
  if (subclass === "display_name_invalid" || (tag.includes("display_name") && (tag.includes("invalid") || tag.includes("empty")))) {
    return t("multiroom.err.nameLength");
  }
  if (tag.includes("already") && (tag.includes("admitted") || tag.includes("member"))) {
    return t("multiroom.err.alreadyInDomain");
  }
  if (
    subclass === "device_not_in_domain" ||
    tag.includes("device_not_in_domain") ||
    tag.includes("not a domain member")
  ) {
    return t("multiroom.err.notInDomain");
  }
  if (subclass === "trust_ledger_write_failed" || subclass === "trust_ledger_read_failed") {
    return t("multiroom.err.deviceFault");
  }
  return t("multiroom.err.actionFailed");
}

/** Happenings that mean "the operator-visible state may have
 *  changed; refresh the projection". Trust-ledger + group store
 *  are canonical. When the LAN presence substrate binds we add
 *  peer_presence_changed (drives the 5-state badge); when the
 *  admin.multiroom wire ops bind we add device_role_changed +
 *  group_leader_ms_changed. The chain variants (chain_head_changed,
 *  gesture_applied) are future substrate. */
const REFRESH_TRIGGERS: ReadonlySet<string> = new Set<string>([
  // Domain (trust ledger) mutations.
  "domain_member_admitted",
  "domain_member_revoked",
  "domain_member_display_name_observed",
  "device_display_name_changed",
  // Group lifecycle.
  "group_created",
  "group_renamed",
  "group_deleted",
  "group_membership_changed",
  "source_host_elected",
  "multiroom_leader_handoff",
  "group_member_add_refused",
  "group_leader_successor_required",
  "group_leader_successor_cancelled",
  "multiroom_member_moved",
  // Discovery (volatile peer cache).
  "peer_connected",
  "peer_disconnected",
  "peer_discovered",
  "peer_updated",
  "peer_lost",
  // LAN presence substrate: a peer's five-state presence changed
  // - re-read so the per-device badge tracks the transition.
  "peer_presence_changed",
  // Zero-poll substrate - peer presence transitions observed via
  // roster_snap. The marauder-confirmed gone path emits
  // peer_disappeared; the polite-probe + heartbeat path emits
  // peer_announced.
  "peer_announced",
  "peer_disappeared",
  "roster_snapped",
  // RoleStore + GroupStore substrate - bind when the framework
  // binary ships these happenings. Listed defensively so the UI
  // reconciles correctly once the framework binds.
  "device_role_changed",
  "group_leader_ms_changed"
]);

function toGroupSummaries(snapshot: Snapshot): GroupSummary[] {
  return snapshot.groups.map((g) => ({
    groupId: g.groupId,
    displayName: g.displayName,
    memberDeviceIds: g.memberDeviceIds,
    // Chain-projected leader from list_groups. This is the canonical
    // source for the operator-facing "Leader" badge — byte-equal
    // across every seat sharing the same chain head.
    effectiveLeaderDeviceId: g.effectiveLeaderDeviceId,
    // Legacy per-seat election cache. Retained for the playback-
    // pipeline routing path (which still needs the local-election
    // value); NOT used for operator-facing labels anymore.
    sourceHostDeviceId: snapshot.sourceHostByGroup.get(g.groupId) ?? null,
    pinnedSourceHostDeviceId: g.pinnedSourceHostDeviceId,
    leaderMs: g.leaderMs
  }));
}

function readGroupId(raw: unknown): string | null {
  if (!isObject(raw)) return null;
  const record = isObject(raw["record"]) ? raw["record"] : raw;
  return stringField(record, "group_id");
}

/** Translate a framework group-op error into operator-friendly text.
 *  Detects the well-known failure shapes from `GroupError` and
 *  substitutes plain language; falls back to a generic message. */
function humaniseGroupError(
  op: string,
  error: { code?: string; message?: string; subclass?: string }
): string {
  // Subclass strings per MULTIROOM-FLOWS.md §13 catalogue.
  const code = (error.code ?? "").toLowerCase();
  const subclass = (error.subclass ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  const tag = subclass.length > 0 ? subclass : msg;

  if (subclass === "plugins_admin_not_granted" || code.includes("permission") || msg.includes("not granted")) {
    return t("multiroom.err.noPermissionRefresh");
  }
  if (
    subclass === "device_not_responding" ||
    tag.includes("device_not_responding") ||
    tag.includes("did not respond") ||
    tag.includes("deadline elapsed")
  ) {
    // DeviceNotResponding is a property of the gesture, not a state
    // mutation. The card keeps its prior badge; the operator sees
    // the gesture didn't land.
    return t("multiroom.err.notRespondingRoster");
  }
  if (subclass === "device_not_in_domain" || tag.includes("not in domain") || tag.includes("device_not_in_domain")) {
    return t("multiroom.err.notInDomainYet");
  }
  if (subclass === "group_not_found" || (msg.includes("group") && msg.includes("not found"))) {
    return t("multiroom.err.groupGone");
  }
  if (subclass === "last_member" || (op === "remove_group_member" && msg.includes("last"))) {
    return t("multiroom.err.lastMember");
  }
  if (subclass === "successor_not_eligible" || tag.includes("successor must differ") || tag.includes("not eligible")) {
    return t("multiroom.err.successorNotEligible");
  }
  if (subclass === "display_name_invalid" || tag.includes("empty") || tag.includes("whitespace")) {
    return t("multiroom.err.nameLength");
  }
  if (tag.includes("128") || tag.includes("too long")) {
    return t("multiroom.err.nameTooLong", { n: GROUP_NAME_MAX_CHARS });
  }
  if (subclass === "empty_membership" || tag.includes("empty") && tag.includes("member")) {
    return t("multiroom.err.emptyMembership");
  }
  if (tag.includes("already") && tag.includes("member")) {
    return t("multiroom.err.alreadyMember");
  }
  if (tag.includes("not a member") || tag.includes("not in")) {
    return t("multiroom.err.notAMember");
  }
  if (subclass === "member_id_invalid" || subclass === "group_store_not_configured") {
    return t("multiroom.err.deviceFault");
  }
  return t("multiroom.err.opFailed", { op: labelForOp(op) });
}

function labelForOp(op: string): string {
  switch (op) {
    case "create_group":
      return t("multiroom.op.create");
    case "rename_group":
      return t("multiroom.op.rename");
    case "delete_group":
      return t("multiroom.op.dissolve");
    case "add_group_member":
      return t("multiroom.op.add");
    case "remove_group_member":
      return t("multiroom.op.remove");
    default:
      return t("multiroom.op.action");
  }
}

/** Translate a framework rename error into operator-friendly text.
 *  Server-side messages may include internal operation names; we
 *  detect the well-known failure shapes and substitute plain
 *  language, falling back to a generic message otherwise. */
function humaniseRenameError(error: { code?: string; message?: string }): string {
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  if (code.includes("permission") || msg.includes("not granted")) {
    return t("multiroom.err.renameNotPermitted");
  }
  if (msg.includes("empty") || msg.includes("whitespace")) {
    return t("multiroom.err.enterName");
  }
  if (msg.includes("128") || msg.includes("too long")) {
    return t("multiroom.err.nameTooLong", { n: DEVICE_NAME_MAX_CHARS });
  }
  return t("multiroom.err.renameFailed");
}

/* ---------------------------------------------------------------- *
 *  Wire snapshot + composition
 * ---------------------------------------------------------------- */

interface Snapshot {
  /** Domain roster from `list_domain_members`. The canonical
   *  source of truth for "who is in this domain" (trust ledger).
   *  Per-device-local at present; cross-device agreement is a
   *  future-architecture concern. */
  domainMembers: DomainMember[];
  groups: GroupEntry[];
  sourceHostByGroup: Map<string, string>;
  /** Live mDNS-SD adverts. Used only to surface UNADMITTED peers
   *  in the "Discovered devices" section; the domain roster is
   *  sourced exclusively from `list_domain_members`. */
  discoveredPeers: DiscoveredPeerWire[];
  /** Per-device operator-declared role from the RoleStore. Map of
   *  device_id -> role. Devices ABSENT from the map are at the
   *  substrate-empty default ("auto"); the UI folds that in at
   *  render time. */
  deviceRoles: Map<string, DeviceRole>;
}

interface DiscoveredPeerWire {
  deviceId: string;
  displayName: string;
  addresses: string[];
  frameworkVersion: string | null;
  vendorId: string | null;
  publicKeyFingerprint: string | null;
  lastSeenMs: number;
  /** Five-state presence facts the framework projects onto each
   *  list_discovered_peers entry. */
  presence: PeerPresence;
}

interface DomainMember {
  deviceId: string;
  displayName: string;
  nameSource: NameSource;
  admittedAtMs: number;
  admittedByDeviceId: string | null;
  isLocal: boolean;
  isCurrentlyAdvertising: boolean;
  isSessionConnected: boolean;
  lastSeenMs: number;
  isRevoked: boolean;
}

interface GroupEntry {
  groupId: string;
  displayName: string;
  memberDeviceIds: string[];
  pinnedSourceHostDeviceId: string | null;
  /** Chain-projected effective leader, byte-equal across every
   *  seat sharing the same chain head; the canonical source for
   *  the "Leader" badge. Null only when the group has zero
   *  members. */
  effectiveLeaderDeviceId: string | null;
  /** Per-group latency budget in ms; defaults to 200 if the
   *  framework substrate has not yet stamped the field. */
  leaderMs: number;
}

async function refreshAll(transport: WsTransport): Promise<Snapshot> {
  const [members, groups, sourceHosts, discovered, deviceRoles] = await Promise.all([
    transport.dispatch("list_domain_members", {}),
    transport.dispatch("list_groups", {}),
    transport.dispatch("list_source_hosts", {}),
    transport.dispatch("list_discovered_peers", {}),
    transport.dispatch("list_device_roles", {})
  ]);

  return {
    domainMembers: decodeDomainMembers(members.value),
    groups: decodeGroups(groups.value),
    sourceHostByGroup: decodeSourceHosts(sourceHosts.value),
    discoveredPeers: decodeDiscoveredPeers(discovered.value),
    // list_device_roles returns ONLY devices with an explicit
    // operator-gestured role. Devices missing from the
    // map fold to "auto" at compose time. If the framework does
    // not have the op registered yet (older binary), the empty
    // map keeps everyone at the auto default.
    deviceRoles: deviceRoles.error !== undefined ? new Map() : decodeDeviceRoles(deviceRoles.value)
  };
}

function decodeDeviceRoles(raw: unknown): Map<string, DeviceRole> {
  const out = new Map<string, DeviceRole>();
  if (!isObject(raw)) return out;
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!isObject(e)) continue;
    const deviceId = stringField(e, "device_id");
    const roleRaw = stringField(e, "role");
    if (deviceId === null || roleRaw === null) continue;
    if (roleRaw === "source" || roleRaw === "receiver" || roleRaw === "auto") {
      out.set(deviceId, roleRaw);
    }
  }
  return out;
}

function decodeDiscoveredPeers(raw: unknown): DiscoveredPeerWire[] {
  if (!isObject(raw)) return [];
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return [];
  const out: DiscoveredPeerWire[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const deviceId = stringField(entry, "device_id");
    if (deviceId === null) continue;
    const displayName = stringField(entry, "display_name") ?? defaultDisplayName(deviceId);
    const addresses: string[] = [];
    const addrRaw = entry["addresses"];
    if (Array.isArray(addrRaw)) {
      for (const a of addrRaw) {
        if (typeof a === "string") addresses.push(a);
      }
    }
    out.push({
      deviceId,
      displayName,
      addresses,
      frameworkVersion: stringField(entry, "framework_version"),
      vendorId: stringField(entry, "vendor_id"),
      publicKeyFingerprint: stringField(entry, "public_key_fingerprint"),
      lastSeenMs: numberField(entry, "last_seen_ms") ?? 0,
      presence: decodePeerPresence(entry)
    });
  }
  return out;
}

/** Project the discovered-peers list down to only those NOT already
 *  in the domain trust ledger. Discovered peers that ARE in the
 *  ledger surface through `list_domain_members` and the roster
 *  rendering; the "Discovered devices" section is exclusively for
 *  the admit-to-domain gesture (the peer-admission flow). */
function filterUnadmittedPeers(snapshot: Snapshot): DiscoveredPeer[] {
  const admitted = new Set<string>(snapshot.domainMembers.map((m) => m.deviceId));
  return snapshot.discoveredPeers
    .filter((p) => !admitted.has(p.deviceId))
    .map((p) => ({
      deviceId: p.deviceId,
      displayName: p.displayName,
      addresses: p.addresses,
      frameworkVersion: p.frameworkVersion,
      vendorId: p.vendorId,
      publicKeyFingerprint: p.publicKeyFingerprint,
      lastSeenMs: p.lastSeenMs
    }));
}

function decodeDomainMembers(raw: unknown): DomainMember[] {
  if (!isObject(raw)) return [];
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return [];
  const out: DomainMember[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const deviceId = stringField(entry, "device_id");
    if (deviceId === null) continue;
    const displayName = stringField(entry, "display_name") ?? defaultDisplayName(deviceId);
    const nameSourceRaw = stringField(entry, "name_source");
    const nameSource: NameSource = nameSourceRaw === "operator" ? "operator" : "auto";
    out.push({
      deviceId,
      displayName,
      nameSource,
      admittedAtMs: numberField(entry, "admitted_at_ms") ?? 0,
      admittedByDeviceId: stringField(entry, "admitted_by_device_id"),
      isLocal: boolField(entry, "is_local") ?? false,
      isCurrentlyAdvertising: boolField(entry, "is_currently_advertising") ?? false,
      isSessionConnected: boolField(entry, "is_session_connected") ?? false,
      lastSeenMs: numberField(entry, "last_seen_ms") ?? 0,
      isRevoked: boolField(entry, "is_revoked") ?? false
    });
  }
  return out;
}

function decodeGroups(raw: unknown): GroupEntry[] {
  if (!isObject(raw)) return [];
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return [];
  const out: GroupEntry[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const groupId = stringField(entry, "group_id");
    if (groupId === null) continue;
    const displayName =
      stringField(entry, "display_name") ?? stringField(entry, "name") ?? t("multiroom.groupUnnamed");
    const members = entry["members"];
    if (!Array.isArray(members)) continue;
    const memberDeviceIds: string[] = [];
    for (const m of members) {
      if (typeof m === "string") {
        memberDeviceIds.push(m);
      } else if (isObject(m)) {
        const id = stringField(m, "device_id") ?? stringField(m, "id");
        if (id !== null) memberDeviceIds.push(id);
      }
    }
    const pinnedSourceHostDeviceId = stringField(entry, "pinned_source_host");
    // Chain-projection effective leader (per the chain-projection contract).
    // Byte-equal across every seat sharing the same chain head; this is
    // the field the UI renders for the "Leader of <group>" badge.
    // Null only when the group has zero members.
    const effectiveLeaderDeviceId = stringField(entry, "effective_leader");
    out.push({
      groupId,
      displayName,
      memberDeviceIds,
      pinnedSourceHostDeviceId,
      effectiveLeaderDeviceId,
      // GroupStore leader_ms: a u32 stamped
      // by the framework. Default 200 if the field is missing
      // (older binary without the schema extension).
      leaderMs: numberField(entry, "leader_ms") ?? 200
    });
  }
  return out;
}

function decodeSourceHosts(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!isObject(raw)) return out;
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const groupId = stringField(entry, "group_id");
    const hostId =
      stringField(entry, "source_host_device_id") ?? stringField(entry, "device_id");
    if (groupId !== null && hostId !== null) {
      out.set(groupId, hostId);
    }
  }
  return out;
}

/** Decode the framework's `roster_snap` response shape. The wire
 *  envelope is `{ roster_snap: true, result: { ... } }` and inner
 *  timestamps use SystemTime ({secs_since_epoch, nanos_since_epoch})
 *  which we collapse to wall-clock ms. */
function decodeRosterSnap(raw: unknown): RosterSnap | null {
  if (!isObject(raw)) return null;
  const result = isObject(raw["result"]) ? raw["result"] : raw;
  const snapId = stringField(result, "snap_id");
  const reasonRaw = stringField(result, "reason");
  if (snapId === null || reasonRaw === null) return null;
  const reason = (reasonRaw as SnapReason);
  return {
    snapId,
    reason,
    snapStartedAtMs: decodeSystemTimeMs(result["snap_started_at"]),
    snapCompletedAtMs: decodeSystemTimeMs(result["snap_completed_at"]),
    deadlineMs: numberField(result, "deadline_ms") ?? 800,
    deadlineBreached: boolField(result, "deadline_breached") ?? false,
    presents: decodePresents(result["presents"]),
    gones: decodeGones(result["gones"])
  };
}

function decodeSystemTimeMs(raw: unknown): number {
  if (!isObject(raw)) {
    return typeof raw === "number" ? raw : 0;
  }
  const secs = numberField(raw, "secs_since_epoch") ?? 0;
  const nanos = numberField(raw, "nanos_since_epoch") ?? 0;
  return Math.floor(secs * 1000 + nanos / 1_000_000);
}

function decodePresents(raw: unknown): RosterEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterEntry[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const deviceId = stringField(entry, "device_id");
    if (deviceId === null) continue;
    const addressesRaw = entry["addresses"];
    const addresses: string[] = [];
    if (Array.isArray(addressesRaw)) {
      for (const a of addressesRaw) {
        if (typeof a === "string") addresses.push(a);
      }
    }
    out.push({
      deviceId,
      displayName: stringField(entry, "display_name") ?? defaultDisplayName(deviceId),
      addresses,
      newToSnap: boolField(entry, "new_to_snap") ?? false,
      lastSeenMs: numberField(entry, "last_seen_ms") ?? 0
    });
  }
  return out;
}

function decodeGones(raw: unknown): RosterDeparture[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterDeparture[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const deviceId = stringField(entry, "device_id");
    if (deviceId === null) continue;
    out.push({
      deviceId,
      displayName: stringField(entry, "display_name") ?? defaultDisplayName(deviceId),
      lastSeenMs: numberField(entry, "last_seen_ms") ?? 0
    });
  }
  return out;
}

function compose(snapshot: Snapshot, snap: RosterSnap | null): MultiroomCardEnvelope[] {
  // Index group membership per device so we can resolve role +
  // state badge against the domain roster.
  const groupByDevice = new Map<string, GroupEntry>();
  for (const g of snapshot.groups) {
    for (const id of g.memberDeviceIds) {
      groupByDevice.set(id, g);
    }
  }
  // Index snap presence + departure by device id so the join
  // against domain_members runs in O(N) regardless of snap size.
  const presentById = new Map<string, RosterEntry>();
  const goneById = new Map<string, RosterDeparture>();
  if (snap !== null) {
    for (const e of snap.presents) presentById.set(e.deviceId, e);
    for (const e of snap.gones) goneById.set(e.deviceId, e);
  }
  // Five-state presence joined onto the roster cards by device id.
  // The framework projects it onto list_discovered_peers entries;
  // joining here lets the badge resolve on first render, before
  // any transition is observed.
  const presenceByDevice = new Map<string, PeerPresence>();
  for (const p of snapshot.discoveredPeers) {
    presenceByDevice.set(p.deviceId, p.presence);
  }

  // Defensive fall-through: a group's `members[]` could carry a
  // device id that the roster does not (yet) include. We trust the
  // roster as the source of truth per the multi-room domain contract; any straggler is
  // dropped from the rendered card list (the framework's the multi-room domain contract
  // §Decision 2a trust-ledger validation prevents this in the
  // happy path, but we tolerate transient inconsistency during
  // happening propagation).
  const envelopes: MultiroomCardEnvelope[] = [];
  for (const member of snapshot.domainMembers) {
    const group = groupByDevice.get(member.deviceId) ?? null;
    // Operator-facing role classification drives off the chain-
    // projected effective_leader field (per the chain-projection contract).
    // The legacy per-seat sourceHostByGroup cache is still useful for
    // playback-pipeline routing but would render divergent "Leader"
    // labels across rigs if used here.
    const effectiveLeaderId = group?.effectiveLeaderDeviceId ?? null;
    const groupRole: GroupRole = !group
      ? "solo"
      : effectiveLeaderId === member.deviceId
        ? "leader"
        : "member";
    // RoleStore projection. Devices absent from the
    // map default to "auto" - the framework's election runs
    // unconstrained for them.
    const operatorRole: DeviceRole = snapshot.deviceRoles.get(member.deviceId) ?? "auto";

    // Liveness under the zero-poll substrate:
    //   roster_snap is the authoritative source of "is this
    //   device reachable right now?" — answered as either
    //   `presents[]` (truthful at snap_completed_at) or
    //   `gones[]` (marauder-confirmed absent).
    //
    // Pre-snap fallback (no snap has run yet): trust the
    // domain-roster's `isSessionConnected` / `isCurrentlyAdvertising`
    // hints from the trust-ledger projection, so the very first
    // render before the mount-snap completes isn't blank.
    const snapPresent = presentById.get(member.deviceId);
    const snapGone = goneById.get(member.deviceId);
    const isPresent = member.isLocal
      ? true
      : snapPresent !== undefined
        ? true
        : snapGone !== undefined
          ? false
          : member.isSessionConnected || member.isCurrentlyAdvertising;
    const isGone = !member.isLocal && (snapGone !== undefined);
    const lastSeenMs = snapGone?.lastSeenMs
      ?? snapPresent?.lastSeenMs
      ?? member.lastSeenMs;

    const transportState: TransportState = (() => {
      if (member.isRevoked) return "revoked";
      if (member.isLocal) return "idle";
      if (isGone) return "offline";
      if (isPresent) return "idle";
      // Snap data exists but didn't classify this device, and
      // trust-ledger hints don't say it's session-connected.
      // Treat as offline by precedence (the substrate would not
      // say silent on a known peer).
      return "offline";
    })();

    // Badge text per the zero-poll substrate's "no Offline pill" rule:
    //   Revoked > Gone-since-check > role-derived.
    // No "Offline" pill in this contract. Devices the snap put in
    // `gones[]` render with marauder-confirmed absence; devices in
    // `presents[]` render with their role; revoked supersedes
    // everything.
    const roleText =
      groupRole === "solo"
        ? t("multiroom.badge.solo")
        : groupRole === "leader"
          ? t("multiroom.badge.leaderOf", { group: group?.displayName ?? t("multiroom.badge.groupFallback") })
          : t("multiroom.badge.memberOf", { group: group?.displayName ?? t("multiroom.badge.groupFallback") });

    // Revoked supersedes other states. Trust-ledger canonical:
    // revocation is per-device-local and reversible via re-admit.
    const stateBadge =
      transportState === "revoked"
        ? t("multiroom.badge.revoked")
        : isGone
          ? t("multiroom.badge.gone")
          : roleText;

    // Presence-of-self is not meaningful; the local card carries no
    // presence badge. Peers join their five-state presence from the
    // list_discovered_peers projection by device id.
    const presence = member.isLocal
      ? null
      : presenceByDevice.get(member.deviceId) ?? null;

    envelopes.push({
      id: member.deviceId,
      displayName: member.displayName,
      nameSource: member.nameSource,
      groupRole,
      operatorRole,
      stateBadge,
      transportState,
      currentTrack: null,
      themePlaceholderArtworkUrl: null,
      masterGroupContext: null,
      isLocal: member.isLocal,
      isCurrentlyAdvertising: member.isCurrentlyAdvertising,
      isSessionConnected: member.isSessionConnected || member.isLocal,
      isPresent,
      isGone,
      lastSeenMs,
      isRevoked: member.isRevoked,
      presenceState: presence?.presenceState ?? null,
      presenceSinceMs: presence?.lastTransitionAtMs ?? null,
      network: presence?.network ?? null
    });
  }

  // Stable ordering matches the framework's roster order
  // (the canonical-roster invariant): local first, then live peers ordered by
  // recency, then offline paired peers, then revoked. We layer role
  // (leader > member > solo) within the "live" bucket for surface
  // affordance; display-name comparison breaks remaining ties.
  const roleOrder: Record<GroupRole, number> = {
    leader: 1,
    master: 1,
    member: 2,
    subgroup: 2,
    solo: 3
  };
  const bucket = (env: MultiroomCardEnvelope): number => {
    if (env.isLocal) return 0;
    if (env.isRevoked) return 3;
    // Present per the most recent snap (or trust-ledger fallback
    // pre-snap) → "live" bucket.
    if (env.isPresent && !env.isGone) return 1;
    return 2;
  };
  envelopes.sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    const ra = roleOrder[a.groupRole];
    const rb = roleOrder[b.groupRole];
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });

  return envelopes;
}

/* ---------------------------------------------------------------- *
 *  Helpers
 * ---------------------------------------------------------------- */

/** Framework default display-name pattern when no operator-set name
 *  is known AND the framework has not observed any advert for the
 *  device. Rarely hit since the multi-room domain contract hostname-seeded auto-names land
 *  at first boot, but kept as a tolerant fallback. */
function defaultDisplayName(deviceId: string): string {
  const cleaned = deviceId.replace(/-/g, "");
  const prefix = cleaned.slice(0, 8);
  return `evo-${prefix}`;
}

function readVariant(happening: unknown): string | null {
  if (!isObject(happening)) return null;
  const v = stringField(happening, "variant") ?? stringField(happening, "kind");
  if (v === null) return null;
  return v
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolField(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function useFrameworkUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) {
    return override;
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}
