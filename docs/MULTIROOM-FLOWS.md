# Multi-Room Operator Flows — Behavioural Specification

Status: Authoritative. The operator UI MUST implement these flows
exactly as specified. Where the framework's wire ops + happenings
already implement a behaviour, the UI consumes them as-is; where
the UI adds operator affordances (pickers, confirmations, badges),
this document names them.

This is a behaviour spec, not an API reference. The wire-op
payload shapes are documented inline; the framework's
`describe_capabilities` op is the live source-of-truth for the
op set.

---

## 1. Concepts

The framework distinguishes three layers. Conflating them is the
most common cause of UI bugs.

### 1.1 Discovery (volatile)

Devices currently reachable on the LAN. The framework does NOT
maintain a continuously-fresh peer set via periodic browse —
the substrate is zero-poll by design. Discovery state is
populated by two event-driven channels and one operator-driven
channel:

- **Event channel** (always on): the framework's
  `daemon.browse()` listener consumes `ServiceResolved` /
  `ServiceRemoved` events as the `mdns-sd` library hears them
  from the wire. Spontaneous announcements (device boot,
  rename re-advert on identity change, hostname change)
  populate `discovered_peers` immediately on receipt.
- **Gaze channel** (operator-driven): when the operator opens
  the Multi-room surface or any roster-dependent gesture's
  precondition fires, the UI issues `roster_snap`. The
  framework captures a baseline of every currently-known
  peer, waits a brief 150 ms grace for any straggling
  `ServiceResolved` event the long-lived browse listener is
  mid-dispatching, reads the substrate (which is the source
  of truth for `presents`), runs the marauder probe against
  any baseline peer that dropped from the substrate in the
  interim, and returns a truthful roster timestamped at
  `snap_completed_at`.
- **Marauder query** (substrate-internal TCP-probe verification):
  triggered by `roster_snap` against any peer in baseline
  that is no longer in the substrate at composition time.
  The framework probes the peer with a unicast TCP connect
  to its baseline-recorded advertised address (typically
  `control_port = 7331`) with a bounded per-probe deadline;
  probes run concurrently so the marauder window bounds the
  slowest single probe, not the sum. The TCP connect-probe
  is authoritative for reachability — unicast, not subject
  to multicast packet loss on the discovery plane. A probe
  that succeeds reclassifies the peer as present (transient
  mDNS blip); a probe that fails reports the peer as
  marauder-confirmed gone. Single packet loss is NOT an
  absence claim. (The marauder mechanism is TCP-probe based:
  the `mdns-sd` library deduplicates `ServiceResolved`
  events on identical-data responses, which rules out a
  multicast `verify()` mechanism; the
  substrate-as-source-of-truth combined with the unicast
  TCP-probe preserves every invariant of the underlying
  presence contract.)

Wire ops: `list_discovered_peers` → `Vec<DiscoveredPeer>` (the
substrate's last-known view, always carries a freshness
timestamp); `roster_snap { reason, deadline_ms }` →
`RosterSnap { snap_id, snap_started_at, snap_completed_at,
deadline_breached, presents, gones }`.
Happenings: `peer_discovered`, `peer_updated`,
`peer_announced` (fresh advert observed via event channel),
`peer_disappeared` (marauder-confirmed absence from a snap),
`roster_snapped` (fan-out for concurrent UIs to converge
on the same snap truth without each issuing their own
`roster_snap`).

### 1.2 Domain (persistent)

The trust unit. A device that the operator has admitted to the
local domain. Persists across reboots, network outages, and
group lifecycle until explicitly revoked. The domain trust
ledger records `(device_id, display_name, admitted_at_ms,
admitted_by_device_id, revoked_at_ms)`. Revoke is soft — the row
is retained so the operator surface can present "previously
admitted" history.

A device admits itself as the local domain seed at first boot
(`admitted_by_device_id = NULL`). Subsequent peers are admitted
via operator gesture from any domain member's UI.

Wire ops: `list_domain_members`, `admit_peer_to_domain`,
`revoke_peer_from_domain`
Happenings: `domain_member_admitted`, `domain_member_revoked`,
`domain_member_display_name_observed`

### 1.3 Group (transient)

A multi-device playback assembly. Operator-administered. A group
is one logical playback target; verbs issued at the group level
dispatch to every member under a single source-host (the
"leader"). Membership is liquid — devices freely added and
removed at any time. Group identity is independent of any
individual device's lifecycle; a device that leaves a group
returns to solo state.

Wire ops: `create_group`, `get_group`, `list_groups`,
`rename_group`, `add_group_member`, `remove_group_member`,
`delete_group`, `pin_source_host`, `unpin_source_host`,
`select_group_leader_successor`,
`cancel_group_leader_successor`
Happenings: `group_created`, `group_renamed`,
`group_membership_changed`, `group_deleted`,
`source_host_elected`, `clock_sync_changed`,
`peer_connected`, `peer_disconnected`,
`group_member_add_refused`,
`group_leader_successor_required`,
`group_leader_successor_cancelled`,
`MultiroomLeaderHandoff`, `SplitBrainDetected`

### 1.4 Liquid membership invariant

A device removed from any group is fresh-and-available
regardless of prior leader/member role. No latent group affinity
persists on the device. Future contributors MUST NOT introduce
per-device group affinity, "preferred group" fields, or
latent-state membership recovery.

### 1.5 Roster freshness — gaze, snap, marauder

The substrate's truth model for the roster is this: there is no
"current presence" cached state. There is the
last-known-presence view (populated by the event channel) and
the gaze-triggered snap (which produces a truthful roster at a
stated instant). The UI's job is to make the operator's view
truthful at the moment they look, not to pretend the cache is
fresh between snaps.

**Snap triggers (the UI MUST issue `roster_snap` on):**

1. Multi-room surface opened (the apex case).
2. Surface refocused after the tab/app regained foreground after
   any backgrounded duration that exceeds the framework's
   `freshness_budget_ms` (default 5 s; configurable per shell).
3. Any roster-dependent gesture's precondition (e.g. "Move
   member" picker open, "Pick successor" picker open).
4. Operator manual-refresh gesture (pull-to-refresh on a card
   surface, or an explicit refresh affordance).

The UI does NOT issue `roster_snap` on a timer. The substrate
explicitly retires periodic browse cadence.

**Snap response shape and freshness commitment:**

`roster_snap` returns `RosterSnap { snap_id,
snap_started_at, snap_completed_at, deadline_ms,
deadline_breached, presents, gones }`. The rendered roster MUST
carry `snap_completed_at` visibly available — typically as a
"Freshly checked HH:MM:SS" line under the Multi-room surface
header, or on hover for compact card grids. The operator's
mental model is "the substrate confirmed this view at HH:MM:SS,
and `peer_announced` / `peer_disappeared` happenings since
then have updated specific rows."

**Snap-progress affordance contract (substrate-level, not
cosmetic):**

If `roster_snap` has not returned within 200 ms of dispatch the
shell MUST surface a non-modal, non-blocking progress
affordance with copy template "Checking who's here…" (or
equivalent operator wording the shell carries). The affordance
MUST be retired the instant the snap returns. The affordance
MAY include the elapsed-ms readout; it MAY include a manual
cancel that aborts the snap and accepts the partial roster
collected so far. The affordance MUST NOT block other UI
interaction. Vendor UI shells that re-skin the framework are
bound by this contract; it is enforced by a UI shell component
test (`MultiroomSurface.snap-progress-affordance.test.tsx`)
that mocks a slow `roster_snap` and asserts the affordance
renders before 250 ms.

**Marauder-confirmed "gone since check" — the only way the UI
reports absence:**

A device that the most recent snap reports in `gones` (carrying
the device's `last_seen_ms` from the prior roster) is rendered
with a "gone since check" label and the truthful `last_seen_ms`
("last seen N minutes ago"). The marauder query has already run
inside the substrate before the snap composed its response, so
the UI is rendering a verified absence, not a single-packet-loss
guess. There is no "Offline" pill in this UI. There is the
truthful Solo/Leader/Member badge for present devices, and the
"gone since check" badge for marauder-confirmed absences.

**Gesture-as-probe deadline (every operator action is a
liveness check):**

Every operator gesture that targets a remote device dispatches
directly to that device with a confirm-or-fail deadline (default
2 s; configurable per gesture class). Three outcomes:

- **Confirmed** — target responded; the gesture succeeded. UI
  proceeds.
- **Refused** — target responded with a structured refusal
  (e.g. `LeaderSuccessorRequired`, `DeviceNotInDomain`). UI
  surfaces the refusal with the appropriate operator-friendly
  copy (see §13 error catalogue).
- **Did-not-confirm** — deadline elapsed with no response. The
  substrate returns `DeviceNotResponding { target_device_id,
  deadline_ms, attempted_paths }`. UI MUST surface this as a
  property of the gesture, NOT as a state mutation of the
  device card. The same device card stays at whatever truthful
  badge the most recent snap put on it. The operator chooses
  whether to retry, target another device, or trigger a manual
  `roster_snap` to re-check the device's presence. The shell
  MUST NOT short-circuit any future gesture on the basis of
  this DidNotConfirm outcome — every gesture stands on its own.

### 1.6 The Multi-room surface composition

The Multi-room shelf shows three sections, in order:

1. **Domain roster** — every admitted device, rendered as a
   card. Solo devices and group leaders / members are all here;
   the card's badge distinguishes the role.
2. **Group summary strip** (above the roster, when ≥1 group
   exists) — one chip per group with member count + current
   leader name; tap drills into the group view.
3. **Discovered devices** (below the roster, when discovery
   sees peers not in the domain) — each row carries an
   "Admit to domain" affordance.

The Multi-room view is symmetric across every domain member's
UI: any seat shows the same composition.

---

## 2. State Badges (operator-visible vocabulary)

Per-device badges:

| Badge | Meaning |
|---|---|
| `Solo` | Device is in the domain, not in any group, currently advertising. |
| `Leader of <group>` | Device is the elected source-host for `<group>`. |
| `Member of <group>` | Device is in `<group>` but not the source-host. |
| `Gone since check` | Device is in the domain but the most recent gaze-triggered `roster_snap` plus marauder query confirmed it absent from the LAN. Renders with `last_seen_ms` from the prior roster ("last seen N minutes ago"). NOT a periodically-aged-out cache — this badge appears only after a marauder-confirmed absence. |
| `Unpaired (admit?)` | Device is in discovered_peers but NOT in the domain. Tap to admit. |
| `Revoked` | Device's domain admission was rescinded; row retained for re-admit. |

Per-group chip:

| Field | Source |
|---|---|
| Display name | `Group.display_name` |
| Member count | `Group.members.len()` |
| Leader name | The elected source-host's `display_name`. |
| Current track | Leader's `audio.playback.current.title`. |

State badges are reactive. The UI MUST NOT poll. Subscribe to
the happenings stream and re-derive on every transition.

---

## 3. Discovery + Admission Flow

This is the prerequisite for every other multi-room operation.
A device cannot participate in a group until it is in the
domain. A device cannot be admitted to the domain until it has
been observed via mDNS-SD discovery (the framework refuses to
admit an id it has never seen, on the grounds that the operator
cannot meaningfully consent to admit a phantom).

### 3.1 First-time bring-up

1. New device powers on; framework runs `init_or_load` on
   `DeviceIdentityStore`. The local identity is generated
   (UUIDv4) and `display_name` is seeded from the OS hostname
   (sane fallback: `evo-<short>`).
2. Framework runs the domain-seed admission: the local device
   admits itself into the local domain. The row carries
   `admitted_by_device_id = NULL` (seed marker).
3. Framework starts the mDNS-SD discovery daemon. The local
   device's advert is registered with the TXT record carrying
   `display_name`, `device_id`, `version`, capability flags,
   public-key fingerprint.
4. Other domain devices on the LAN observe the advert. Their
   `discovered_peers` row populates; `peer_discovered` happening
   fires on each of them.

### 3.2 Operator admit gesture

1. Operator opens the Multi-room view on any existing domain
   member's UI.
2. UI calls `list_discovered_peers` + `list_domain_members`.
   Devices in discovered but NOT in domain surface in the
   "Discovered devices" section with `Unpaired (admit?)` badge.
3. Operator taps "Admit to domain" on a discovered card.
4. UI dispatches `admit_peer_to_domain { device_id }` — no
   `display_name`, no `public_key_bytes`. The framework
   auto-resolves the display name from the peer's last-observed
   advert TXT record.
5. Framework persists the trust-ledger row, emits
   `domain_member_admitted { device_id, display_name,
   admitted_at_ms, admitted_by_device_id }`.
6. UI receives the happening, calls `list_domain_members` to
   refresh the roster, the new device card moves from the
   "Discovered devices" section to the domain roster with
   `Solo` badge (assuming it's not in any group yet).

### 3.3 Refusal: device never observed

When the operator types an explicit `device_id` (e.g. via a
"manual admit" form) and the framework has no
`discovered_peers` row for it:

- Wire-op response: `{ error: { class: "NotFound", subclass:
  "peer_not_discovered", message: "admit_peer_to_domain: device
  <id> has not been observed via discovery; pass an explicit
  display_name to admit anyway" } }`.
- UI surfaces: "This device has not been observed on the LAN.
  Wait for it to come online, or supply a display name to admit
  it sight-unseen."

### 3.4 Override: explicit display_name

For sight-unseen admissions (e.g. importing a device from
another operator's records), the UI MAY pass `display_name`
explicitly:

```
admit_peer_to_domain {
  device_id: "<uuid>",
  display_name: "Bedroom Speaker",
  public_key_bytes: null
}
```

The framework persists the supplied name; the discovery layer
will subsequently refresh it via `observe_display_name` once an
advert is seen.

### 3.5 Re-admission of a previously-revoked device

The admit op is idempotent on already-admitted ids; re-admitting
a revoked device clears `revoked_at_ms`, refreshes
`display_name` from the supplied or auto-resolved source, and
emits a fresh `domain_member_admitted` happening.

### 3.6 Revoke gesture

1. Operator opens the revoked device's card (or the active
   device's "manage" affordance).
2. Tap "Revoke from domain" → confirm.
3. UI dispatches `revoke_peer_from_domain { device_id }`.
4. Framework sets `revoked_at_ms = now()`, emits
   `domain_member_revoked`.
5. UI receives happening, re-renders. The card stays in the
   roster with `Revoked` badge so the operator can re-admit
   without rebuilding state.

Note: revoke does NOT auto-remove the device from any groups it
is in. Active group memberships are dissolved as a separate side
effect when the framework processes the revoke (
`group_membership_changed` fires).

---

## 4. Group Create Flow

### 4.1 Operator path

1. Operator on any domain member's UI navigates to Multi-room
   shelf.
2. Tap "+ New group" in the section header.
3. UI shows the group-create modal:
   - Display name field (default: `Group <N>` where N is
     `groups.len() + 1`; operator can edit; required, ≤128
     chars).
   - Multi-select picker of solo domain members (role = Solo).
   - "Create" button (disabled until ≥1 member selected).
4. Operator selects members + edits name if desired, taps
   Create.
5. UI dispatches `create_group { display_name, member_device_ids,
   step_up_token: null }`.

Note: the framework permits a degenerate 1-member group (a
group of one is valid; the single member becomes its own
source-host). The UI MAY enforce a 2-member minimum for usability
but the framework does not. Document the chosen UI policy
explicitly in the picker copy.

### 4.2 Framework state transitions

1. `GroupStore::create` validates display_name (non-empty
   after trim, ≤128 chars), de-dupes the member list.
2. Generates a fresh UUIDv4 group_id.
3. Persists the group row (`pinned_source_host = None`).
4. Persists each member row (joined_at_ms = now()).
5. Emits `group_created { group_id, display_name, members,
   created_at_ms, at }`.
6. The source-host election runtime observes the new group on
   its next tick (or via `evaluate()` if invoked synchronously),
   computes `candidates = members ∩ live_peers`, elects the
   lexicographically-lowest canonical id, persists the election
   row, emits `source_host_elected { group_id, display_name,
   source_host_device_id, prior_source_host_device_id: None,
   candidate_count, at }`.

### 4.3 UI updates

1. UI receives `group_created` → calls `list_groups` +
   `list_source_hosts` to refresh.
2. The group's chip appears in the group summary strip.
3. Each member device's card flips from `Solo` to either
   `Leader of <group>` or `Member of <group>` (driven by the
   `source_host_elected` happening).
4. The leader's playback subject starts driving the group's
   transport/track display.

### 4.4 Refusals

- `display_name_invalid`: name was empty or >128 chars. UI
  shows inline validation; operator corrects.
- `empty_membership`: `member_device_ids` was empty. UI
  blocks the Create button so this shouldn't fire; if it does,
  show error and re-open picker.

---

## 5. Add Member Flow

### 5.1 Operator path — from group view

1. Operator drills into a group from the summary chip.
2. Tap "+ Add member" in the group's members section.
3. UI shows a picker of solo domain members.
4. Operator selects one (or more, looped).
5. UI dispatches `add_group_member { group_id, device_id,
   step_up_token: null }` for each.

### 5.2 Operator path — from a solo device's card

1. Operator on a solo device's card taps "Join group".
2. UI shows a picker of existing groups.
3. Operator picks a group.
4. UI dispatches the SAME `add_group_member` op with the same
   parameters. The framework does not distinguish gesture
   origin; the verb is the same.

### 5.3 Framework state transitions

1. Handler checks `plugins_admin` capability.
2. Handler validates the device is in the local domain (trust
   ledger has an unrevoked row for `device_id`). On failure
   returns `DeviceNotInDomain` error + emits
   `group_member_add_refused { group_id, device_id, reason:
   "device_not_in_domain", at }`.
3. `GroupStore::add_member` is idempotent: if the device is
   already in the group, no happening fires, no error returns.
4. On a real addition, persists the member row, emits
   `group_membership_changed { group_id, display_name,
   members, added: [device_id], removed: [], at }`.
5. Source-host election re-evaluates. If the new member has a
   lower canonical id than the current leader AND the group is
   not pinned, the leader may change — `source_host_elected`
   fires with `prior_source_host_device_id` set.

### 5.4 UI updates

- Member's card flips from `Solo` to `Member of <group>` (or
  `Leader of <group>` if it just won election).
- Group's member count increments.
- Group's current track display starts mirroring the leader.

### 5.5 Refusals

- `device_not_in_domain` (subclass): the device id is not an
  admitted domain member. UI shows:
  "<device_name> is not in this domain yet. Admit it first
  from the Discovered devices section."
  Followed by the Admit affordance (the UI MAY auto-resolve
  the discovered_peers entry to offer one-tap admit + retry).

---

## 6. Move Member Flow (atomic between groups)

### 6.1 Operator path

1. Operator on a member device's card sees current group
   badge (`Member of <group>` or `Leader of <group>`).
2. Tap "Move to" → picker of OTHER existing groups (excluding
   the current one).
3. Operator selects target group, confirms.
4. UI dispatches `move_group_member { from_group_id,
   to_group_id, device_id, successor_device_id: null,
   step_up_token: null }`.

### 6.2 Decision tree

The move verb composes the leader-successor protocol inline
when the moved device is the source group's current
source-host. The UI MUST handle three return shapes:

```
move_group_member(from, to, device_id)
│
├─ is device the current source-host of from_group?
│  │
│  ├─ NO  ──→ §6.3 direct atomic move
│  │
│  └─ YES ──→ would post-move source count be ≥2?
│             │
│             ├─ NO  ──→ §6.3 direct atomic move
│             │         (source auto-dissolves)
│             │
│             └─ YES ──→ §6.4 successor-required, two
│                        round-trips
```

### 6.3 Direct atomic move (non-leader OR auto-dissolve)

1. Framework executes the transaction:
   - Delete `device_id` from `from_group_id`.
   - If the moved device was the source's pinned source-host,
     clear the pin (the pin no longer applies).
   - Insert `device_id` into `to_group_id`.
   - Bump `modified_at_ms` on both groups.
2. If post-move source count < 2, the source group
   auto-dissolves (cascade FK removes the residual membership
   row); residual member returns to solo.
3. Response: `MoveOutcome { move_outcome: true, record: {
   from_group_id, to_group_id, device_id, from_members_after,
   to_members_after, source_dissolved } }`.
4. Happenings: one `MultiroomMemberMoved` covering both sides;
   if auto-dissolve fired, one `group_deleted` alongside.
   Source-host elections re-evaluate on both groups; emits
   `source_host_elected` only if the elected source-host
   actually changed.

### 6.4 Leader-source case (two round-trips, successor inline)

#### 6.4.1 First dispatch (no successor)

1. Operator dispatches as in §6.1 with
   `successor_device_id: null`.
2. Framework detects: `device_id ==
   from_group.elected_source_host` AND `post_move_source_count
   ≥ 2`. Returns
   `LeaderSuccessorRequired { successor_required: true,
   departing_device_id, eligible_member_ids }` — same response
   shape as the remove-leader flow.
3. Framework emits
   `group_leader_successor_required {
   group_id: from_group_id, departing_device_id,
   eligible_member_ids, at }` on the fan-out channel so other
   seats see the pending decision.

#### 6.4.2 UI surface

Same modal pattern as §7.3.2 — successor picker on the
initiating seat, banner on other seats. Modal title clarifies
the move target: "Choose a new leader for `<from_group>`;
moving `<departing>` to `<to_group>`".

#### 6.4.3 Second dispatch (with successor)

1. Operator picks a successor + confirms.
2. UI dispatches `move_group_member { from_group_id,
   to_group_id, device_id, successor_device_id: <picked>,
   step_up_token: null }`.
3. Framework executes atomically:
   - `pin_source_host(from_group_id, successor_device_id)` —
     persists the pin.
   - `move_member(from_group_id, to_group_id, device_id)` —
     the atomic transaction.
   - Emits `MultiroomMemberMoved` + `MultiroomLeaderHandoff`.
4. Response: `MoveOutcome { ... }` as in §6.3.
5. UI: dismiss modal on initiating seat; dismiss banner on
   other seats; re-render both groups' cards.

#### 6.4.4 Cancellation

The operator cancels mid-protocol by dispatching
`cancel_group_leader_successor { group_id: from_group_id,
departing_device_id }` (same op as the remove flow's cancel).
No state changed; the moved device stays in `from_group_id`;
no group state changes anywhere. Framework emits
`group_leader_successor_cancelled`.

The protocol is stateless on the framework side — the operator
may dispatch the move repeatedly without state pollution.

### 6.5 Operator's "go-solo" gesture

If the operator wants the device out of its current group with
no destination — i.e. "leave this group, return to solo" — the
UI dispatches `remove_group_member`, NOT `move_group_member`.
The Move picker MUST surface a clearly-labeled "Go solo" /
"Leave group" option that bypasses the destination picker and
dispatches the remove op directly. From the operator's
perspective this is "move to no group"; from the framework's
perspective it is the standard remove path (see §7).

### 6.6 Refusals

- `not_found` (subclass): either `from_group_id` or
  `to_group_id` does not exist (likely stale id from a
  parallel dissolve).
- `member_id_invalid` (subclass): `device_id` is not in
  `from_group_id` OR is already in `to_group_id`. UI message:
  "`<device>` is not in `<from>` anymore" or "`<device>` is
  already in `<to>`"; trigger refreshAll.
- `successor_not_eligible` (subclass): the supplied
  `successor_device_id` equals `device_id` or is not a
  current member of `from_group_id`. UI: re-render picker
  against fresh eligible list.

---

## 7. Remove Member Flow

This is the most complex flow because of the leader-removal
gate. Treat it as a state machine.

### 7.1 Decision tree

```
remove_group_member(group_id, device_id)
│
├─ is device the current source-host (leader)?
│  │
│  ├─ NO  ──→ §7.2 direct removal
│  │
│  └─ YES ──→ would post-removal count be ≥2?
│             │
│             ├─ NO  ──→ §7.2 direct removal
│             │         (auto-dissolve takes over)
│             │
│             └─ YES ──→ §7.3 successor-required protocol
```

### 7.2 Direct removal (non-leader OR auto-dissolve precedence)

1. Operator on the member's card OR the group's leader card
   taps "Remove from group".
2. UI confirms the gesture if it would auto-dissolve the
   group (post-removal count < 2): "Removing <member> from
   <group> will dissolve the group. The remaining device will
   return to solo. Continue?"
3. UI dispatches `remove_group_member { group_id, device_id,
   step_up_token: null }`.
4. Framework executes the removal directly. Emits
   `group_membership_changed { group_id, display_name, members,
   added: [], removed: [device_id], at }`.
5. If the post-removal count drops below 2, the framework
   auto-dissolves: removes the group + every remaining
   membership row, emits `group_deleted { group_id,
   display_name, at }`. The residual single member returns to
   solo.
6. The removed device's card flips to `Solo` (or to `Gone since
   check` if the next `roster_snap` + marauder query confirms
   it absent from the LAN — the substrate does not age out
   cached presence; absence is reported only after marauder
   confirmation).
7. If the leader was removed (with count post-removal ≥2 this
   would have entered §7.3; with post-removal <2, auto-dissolve
   above is the structural rule — no leader role to transfer
   because the group ends), the residual member transitions to
   `Solo`.

The auto-dissolve precedence is invariant: the leader role is a
property of a live group. When the group ends — by
`delete_group`, by auto-dissolve below 2, or by revoke
side-effect — the leader role evaporates with it. No residual
leader state persists on any device after dissolution.

### 7.3 Successor-required protocol (leader AND post-removal ≥2)

The framework refuses to auto-elect a successor when the
operator removes the current leader from a group that will
continue to exist. The operator picks the successor explicitly.

#### 7.3.1 Entry

1. Operator on the leader's card taps "Remove from group" (or
   "Leave group" from the leader's own UI).
2. UI dispatches `remove_group_member { group_id, device_id:
   leader_id, step_up_token: null }`.
3. Framework computes `post_count = members \ {leader_id}`. If
   `post_count.len() ≥ 2` AND `leader_id == current_source_host`
   AND the post-removal would NOT auto-dissolve, the framework
   returns `LeaderSuccessorRequired { successor_required: true,
   departing_device_id, eligible_member_ids }` instead of
   executing the removal. No group state has changed.
4. Framework emits `group_leader_successor_required {
   group_id, departing_device_id, eligible_member_ids, at }`
   on the fan-out channel so EVERY domain member's UI sees the
   pending decision (not just the seat that initiated).

#### 7.3.2 UI surface

1. The UI seat that dispatched the remove receives the
   `LeaderSuccessorRequired` response synchronously. It opens a
   modal:
   - Title: "Choose a new leader for <group>"
   - Body: "Removing <leader_name> from <group>. Pick a
     remaining member to become the new leader, or cancel."
   - List: one row per eligible member id, showing the
     member's display name + canonical id.
   - Buttons: "Confirm" (disabled until a row is selected),
     "Cancel".
2. Every OTHER domain member's UI receives the
   `group_leader_successor_required` happening. Those seats
   show a non-blocking banner:
   - "<operator-display>'s seat is choosing a new leader for
     <group>" (where "<operator-display>" is the
     `admitted_by_device_id` resolved against the domain
     roster).
   - The banner persists until either
     `MultiroomLeaderHandoff` or
     `group_leader_successor_cancelled` fires.

#### 7.3.3 Operator selects successor

1. Operator picks a row in the modal, taps "Confirm".
2. UI dispatches `select_group_leader_successor {
   group_id, departing_device_id, successor_device_id,
   step_up_token: null }`.
3. Framework validates:
   - `successor_device_id != departing_device_id`
   - `successor_device_id` is currently a group member
   - If either check fails, returns
     `successor_not_eligible` error.
4. On valid input, framework executes atomically:
   - `GroupStore::pin_source_host(group_id,
     successor_device_id)` — persists the pin, sets
     `group.pinned_source_host = successor_device_id`.
   - `GroupStore::remove_member(group_id,
     departing_device_id)` — removes the membership row,
     emits `group_membership_changed`.
   - Emits `MultiroomLeaderHandoff { group_id,
     departing_device_id, successor_device_id, at }`.
5. The next source-host election tick respects the pin:
   `pinned_source_host` is in the live member set → election
   picks the pinned device as source-host. Emits
   `source_host_elected` with `prior_source_host_device_id =
   departing_device_id`.

#### 7.3.4 UI updates after handoff

1. The initiating seat's modal closes.
2. Every seat's banner dismisses.
3. The departing device's card flips from `Leader of <group>`
   to `Solo` (and may transition to `Gone since check` if a
   subsequent `roster_snap` + marauder query confirms it absent
   from the LAN — under the marauder-absence contract; never
   as a cache-age-out artefact).
4. The successor's card flips from `Member of <group>` to
   `Leader of <group>`.
5. The group's leader chip updates to the successor's name.

#### 7.3.5 Operator cancels

1. Operator taps "Cancel" in the modal.
2. UI dispatches `cancel_group_leader_successor {
   group_id, departing_device_id }`. No step-up token; this is
   a UI-only cancel of an unconfirmed action.
3. Framework emits `group_leader_successor_cancelled {
   group_id, departing_device_id, at }`. No state change — the
   leader stays in place, the group is unchanged.
4. The initiating seat's modal closes. Every other seat's
   banner dismisses.

#### 7.3.6 Failure modes

- The operator selects a successor that has since been removed
  from the group (race with another seat): framework returns
  `successor_not_eligible`. UI shows "The chosen successor is
  no longer in the group. Pick another." + re-renders the
  picker against the current member list.
- The operator cancels and immediately re-initiates: each
  cycle is independent. No persistent pending-decision state
  on the framework side; the protocol is stateless.
- Network drops mid-protocol: the protocol is stateless on
  the framework side. The operator can re-initiate.
  `select_group_leader_successor` validates against the
  current group state at dispatch time, not against the
  pending decision.

---

## 8. Pin / Unpin Source-Host (operator override of election)

This flow is INDEPENDENT of the leader-successor protocol. The
operator uses pin/unpin when they want to override the framework's
canonical-min election rule for a group whose current leader
they want to KEEP in the group (not remove).

### 8.1 Pin gesture

1. Operator on a member device's card taps "Make leader".
2. UI dispatches `pin_source_host { group_id, device_id,
   step_up_token: null }`.
3. Framework:
   - Validates device is a group member (else
     `successor_not_eligible` shape — the operator is naming
     a non-member as leader).
   - Persists `group.pinned_source_host = device_id`,
     `modified_at_ms = now()`.
   - Next election tick respects the pin → emits
     `source_host_elected` if the elected source-host
     actually changed.
4. UI receives the happening, re-renders. The newly-pinned
   device's card flips to `Leader of <group>`; the prior leader's
   card flips to `Member of <group>`.

### 8.2 Unpin gesture

1. Operator on a group's view taps "Unpin leader" (visible only
   when `group.pinned_source_host` is `Some`).
2. UI dispatches `unpin_source_host { group_id, step_up_token:
   null }`.
3. Framework clears `pinned_source_host = None`, election
   re-evaluates with canonical-min rule, emits
   `source_host_elected` if the elected source-host actually
   changed.
4. UI re-renders. The leader badge may or may not move.

### 8.3 Operator-visible state

The UI MAY indicate that the current leader is pinned (vs.
elected automatically) — e.g., a pin icon in the leader badge.
This is informational; the operator's mental model is "I chose
this leader."

### 8.4 Pin interaction with leader-successor protocol

If the operator runs `pin_source_host(X)` followed by
`remove_group_member(X)` (X is the current leader because of the
pin), the leader-successor protocol fires per §7.3. The pin is
NOT a shortcut around the protocol — it just sets who the
current leader is.

---

## 9. Dissolve Group Flow

### 9.1 Operator path

1. Operator on a group's drill-down view taps "Dissolve group".
2. UI confirms: "Dissolve <group>? Every member returns to
   solo and resumes its own queue. The group cannot be
   recovered."
3. UI dispatches `delete_group { group_id, step_up_token:
   null }`.

### 9.2 Framework state transitions

1. `GroupStore::delete` removes the group row. The SQLite FK
   on `multiroom_group_members` cascades; every membership row
   for this group is removed.
2. The source-host election row is dropped (FK cascade).
3. Emits `group_deleted { group_id, display_name, at }`.

### 9.3 UI updates

1. Group chip disappears from the group summary strip.
2. Every former member's card flips to `Solo`.
3. The dissolve confirmation dismisses.

### 9.4 Auto-dissolve (separate from operator dissolve)

The framework auto-dissolves a group when membership drops
below 2 via a `remove_group_member` call (see §7.2). The
operator does not invoke this — it is structural. The same
`group_deleted` happening fires.

---

## 10. Rename Group Flow

### 10.1 Operator path

1. Operator on a group's drill-down view taps the group name
   (inline edit affordance).
2. UI shows an inline text field with current name; operator
   edits; presses Enter or taps Confirm.
3. UI dispatches `rename_group { group_id, display_name,
   step_up_token: null }`.

### 10.2 Framework state transitions

1. Validates `display_name` (non-empty, ≤128 chars).
2. `GroupStore::rename` persists the new name + bumps
   `modified_at_ms`.
3. Emits `group_renamed { group_id, prior_display_name,
   display_name, at }`.

### 10.3 UI updates

- Group chip + drill-down header reflect the new name.
- Other seats receive the happening, re-render.

---

## 11. Rename Local Device Flow

This is a device-identity gesture, not a group gesture, but the
UI surfaces it alongside the Multi-room flows.

### 11.1 Operator path

1. Operator on the local device's card taps the rename
   affordance (pencil icon next to display_name).
2. UI shows an inline text field; operator edits, confirms.
3. UI dispatches `set_device_display_name { display_name,
   step_up_token: null }`.

### 11.2 Framework state transitions

1. Validates display_name.
2. `DeviceIdentityStore::set_display_name` persists the new
   name, sets `name_source = Operator` (sticky — the collision
   resolver will NOT rewrite it).
3. Calls `DiscoveryRuntime::re_advertise` — unregisters the
   prior mDNS-SD advert, re-registers with the new TXT record.
4. Emits `device_display_name_changed { device_id,
   display_name, at }`.

### 11.3 UI updates

- Local card's display_name updates immediately.
- Other domain seats receive the happening within a normal
  discovery roundtrip (seconds), their cached
  `domain_members[local_id].display_name` updates via
  `observe_display_name`, their cards re-render.

### 11.4 Reset gesture

1. Operator on the local device's card taps "Reset name to
   default" (under an "advanced" affordance — not the primary
   path).
2. UI confirms: "Reset name to the OS hostname?"
3. UI dispatches `reset_device_display_name { step_up_token:
   null }`.
4. Framework re-seeds from the OS hostname (or `evo-<short>`
   fallback), sets `name_source = Auto`, re-advertises, emits
   the rename happening.

The reset path is for operators who set a custom name and want
to go back to the framework default. It is rare; do not make it
the primary affordance.

---

## 12. Cross-Cutting: Happenings the UI MUST Subscribe To

The operator UI maintains a single subscription to the
framework's happenings stream (`subscribe_happenings`). The
subscription filter SHOULD cover every variant that affects
the Multi-room composition.

### 12.1 Reconciling set (drives `refreshAll` re-fetch)

These happenings invalidate the UI's snapshot. On any of them,
re-fetch `list_domain_members + list_groups +
list_source_hosts` and re-derive the envelope list.

- `domain_member_admitted`
- `domain_member_revoked`
- `domain_member_display_name_observed`
- `group_created`
- `group_renamed`
- `group_deleted`
- `group_membership_changed`
- `source_host_elected`
- `clock_sync_changed`
- `peer_connected`
- `peer_disconnected`
- `peer_discovered`
- `peer_updated`
- `peer_lost`
- `device_display_name_changed`
- `MultiroomLeaderHandoff`

### 12.2 Protocol-state happenings (drive UI banner / modal)

These do NOT change persisted state but signal a pending
operator decision or a refusal. The UI surfaces banners or
modals.

- `group_leader_successor_required` — show successor picker
  banner (modal on initiating seat, banner on others).
- `group_leader_successor_cancelled` — dismiss the banner.
- `group_member_add_refused` — show a transient toast on the
  initiating seat: "Couldn't add <device>: not in this domain."

### 12.3 Coalescing

The framework's happening bus supports label-based coalescing
within a window. The UI MAY supply a coalesce filter on
subscribe so rapid bursts (e.g. many peer adverts on boot) do
not flood the reducer. The default is no coalescing —
correctness over efficiency for the operator path. Only
introduce coalesce when measured flooding is causing UI lag.

---

## 13. Error Response Catalogue

Every wire op may return a structured error in the shape:

```
{
  "error": {
    "class": "PermissionDenied" | "ContractViolation" |
             "NotFound" | "Internal",
    "subclass": "<token>",
    "message": "<human-readable>"
  }
}
```

The UI MUST translate subclasses into operator-friendly copy.
Catalog below; the framework's source is authoritative if any
entry drifts.

| Subclass | When | Operator copy template |
|---|---|---|
| `plugins_admin_not_granted` | Operator's connection lacks the capability | "Your session does not have permission to manage multi-room. Refresh the page or check that you are connected from a domain device." |
| `display_name_invalid` | Empty / whitespace-only / >128 chars | "Name must be 1–128 characters." |
| `empty_membership` | `create_group` with no members | "Pick at least one device before creating the group." |
| `last_member` | `remove_group_member` on the only remaining device | "Can't remove the last member. Use 'Dissolve group' instead." |
| `member_id_invalid` | Empty device id | (Internal bug. Log + surface generic.) |
| `group_not_found` | Stale group_id (group was dissolved by another seat) | "This group no longer exists. Refreshing." (+ trigger refreshAll) |
| `group_store_not_configured` | Framework configuration error | (Internal bug. Surface generic.) |
| `device_not_in_domain` | `add_group_member` on non-admitted device | "<device> is not in this domain yet. Admit it from Discovered devices first." (+ link/affordance) |
| `successor_not_eligible` | Successor pick is not in the group OR is the departing leader | "Pick another successor — that device is not eligible." (+ re-open picker with current eligible list) |
| `peer_not_discovered` | `admit_peer_to_domain` for an id never seen | "Wait for that device to come online, or supply its display name to admit it sight-unseen." |
| `trust_ledger_read_failed` | Persistence error | (Internal bug. Surface generic + retry affordance.) |
| `trust_ledger_write_failed` | Persistence error | (Internal bug. Surface generic + retry affordance.) |
| `device_identity_store_not_configured` | Framework configuration error | (Internal bug. Surface generic.) |
| `display_name_invalid` on `admit_peer_to_domain` | Explicit display_name failed validation | "Name must be 1–128 characters." |

---

## 14. Composition Invariants

A few invariants the UI MUST respect; violating them is the
fastest way to lose the plot.

### 14.1 The domain roster is the single source of truth for
"which devices does this domain have?"

Do NOT reconstruct a roster client-side from the union of
`get_device_identity` + `list_groups` + `list_discovered_peers`.
The framework projects the domain roster server-side via
`list_domain_members`; consume that op.

### 14.2 Discovery is NOT membership

A device in `list_discovered_peers` but NOT in
`list_domain_members` is unpaired. It MUST surface in the
"Discovered devices" section, not in the domain roster.

### 14.3 A device's group state is ONE of:
- Solo (in domain, not in any group)
- Leader of exactly one group
- Member of exactly one group
(Multi-group membership is forbidden by the framework. The
exclusivity invariant holds.)

### 14.4 The leader role is a property of a live group

When the group ends (explicit dissolve, auto-dissolve below 2,
revoke side-effect), the leader role evaporates. Every former
member returns to Solo. There is no "leader of nothing" state.

### 14.5 Liquid membership

A device removed from any group is fresh-and-available. No
latent group affinity. The next `create_group` or
`add_group_member` call sees it as Solo regardless of prior
role.

### 14.6 Operator names override

A device with `name_source = Operator` is sticky. The collision
resolver will NOT rewrite it. The UI shows the operator-set
name; the framework guarantees it persists.

### 14.7 Symmetric UI authority

Any domain member's UI can drive any multi-room operation. No
seat is privileged. The framework routes verbs through stewards
atomically; the UI MUST NOT impose seat-side restrictions.

---

## 15. Open UI Surfaces (the UI implementer's checklist)

When the UI implementer says "I've lost the plot," walk through
this checklist. Each item is a discrete operator-visible
surface that this spec assumes is implemented:

1. Multi-room shelf header with "+ New group" affordance.
2. Group summary strip (chips, drill-in).
3. Domain roster cards (one per admitted device).
4. Discovered devices section (one per unpaired-but-advertising
   peer, with "Admit to domain" affordance).
5. Group drill-down view: members list, leader badge, member
   add affordance, member move affordance, member remove
   affordance per row, group rename, group dissolve.
6. Successor picker modal (with eligible member list + cancel).
7. Banner for other-seat-pending-successor decision.
8. Rename-local-device affordance on the local card.
9. Reset-display-name affordance (advanced).
10. Admit-explicit-display-name fallback for sight-unseen
    admit.
11. Inline error toasts for every error subclass in §13.
12. State badges per §2 on every card.

If any of these is missing, the operator experience has a gap.

---

This spec is authoritative. If a wire-op-level detail conflicts
with what the framework actually does, the framework wins;
update this spec.
