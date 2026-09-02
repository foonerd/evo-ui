# Multi-Room Device Card — Design Source

Status: Authoritative for the multi-room device card rendering surface.
Audience: UI shell + widget-pack authors implementing the
`multiroom.device.card.list` / `multiroom.device.card.tile` widget
kinds against the framework's `audio.multiroom.device_card` subject.

The card is one operator-facing view per device or group in the
domain — a complete state read at a glance. Two presentation modes
(list, tile) toggle from the multi-room shelf header. The card
surface is the first concrete realisation of the universal
collection presentation pattern (list/tile dual presentation,
artwork-first-or-icon, per-device view-mode persistence, three-
affordance breadcrumb, theme-contributes-domain-icons); its quality
bar sets the template every later collection surface — library
browse, network shares, artwork picker — inherits.

Wire-protocol source-of-truth: the `audio.multiroom.device_card`
subject declared in the framework schema shelf
(`schemas/org.evoframework/audio/multiroom.v1.toml`). The
`MultiroomDeviceCardEnvelope` payload shape is what subjects carry;
the design notes below cover state-to-visual mapping, data binding,
view-mode geometry, theme placeholder rules, widget kinds, and
subgroup recursion.

## 1. Card content by transport state

State drives content deterministically. No "playing but no artwork"
ambiguity; no silent fallback.

| Transport state | Artwork | Title | State badge | Overlays |
|---|---|---|---|---|
| Playing | live track artwork from current source | live track title (smaller case) | Solo / Leader-of-group / Member-of-group | optional master-group delay readback (e.g. `+87 ms`) when in master group; live audible-time per the honest-degradation telemetry |
| Paused | live track artwork | live track title | Solo / Leader-of-group / Member-of-group | pause indicator on artwork |
| Stopped | device-theme placeholder | (no title) | role badge + `Stopped` | |
| Idle (no source loaded) | device-theme placeholder | (no title) | role badge + `Idle` | |
| Offline | dimmed device-theme placeholder | (no title) | `Offline` | |
| Unpaired | "+" icon over device-theme placeholder | (no title) | `Unpaired (admit?)` | tap → admit confirmation flow |
| Revoked | dimmed device-theme placeholder | (no title) | `Revoked` | non-interactive until re-admitted |

Playing and Paused share the same visual model (artwork + title);
the transport state is communicated via the badge + the pause overlay.
This matches operator expectation — what's currently loaded is visible
at a glance regardless of play/pause.

## 2. Data binding per card

Per-card content is fed from the durable subject substrate. The UI
does not poll; state changes propagate within sub-second via the
subject-state subscription primitive.

| Card type | Envelope source |
|---|---|
| Solo device | the device's own `audio.multiroom.device_card` instance |
| Group leader (= source-host) | the leader's `audio.multiroom.device_card` instance |
| Group member (non-leader) | the source-host's `audio.multiroom.device_card` instance for the member device (the source-host is the authoritative publisher for every member it cares for) |
| Subgroup card (master-group view; the recursive subgroup case) | the subgroup's source-host's `audio.multiroom.device_card` instance for the subgroup-as-entity |
| Master group card (top-level view; the recursive subgroup case) | the master's source-host's `audio.multiroom.device_card` instance for the master-as-entity |

Every card subscribes once at mount; receives every subsequent
transition reactively until unmount. The envelope's
`device_or_group_id` field is the subject-instance key.

## 3. View modes

### List view

- Artwork: thumbnail, left-aligned, 64×64 dp (responsive: 48×48 on
  dense viewports).
- Right of artwork: device name (line 1, larger), track title (line
  2, smaller case, italic-or-similar) when in play/pause states,
  state badge (line 3, smallest, with delay readback for master-group
  members).
- Single row per card; vertical scroll for large domains.
- Information density: high text density per row; lower visual
  emphasis on artwork.

### Tile view

- Artwork: full-card background, edge-to-edge.
- Overlaid: device name (top or bottom anchor, larger), track title
  (smaller, semi-transparent backing for readability) when in
  play/pause, state badge (corner overlay).
- Grid layout — typically 2 columns on phone, 3-4 on tablet, 4-6 on
  desktop / wall display per viewport breakpoint.
- Information density: higher visual emphasis on artwork; lower text
  density per card.

Toggle persists per-user (UI preference subject; the universal
collection pattern's view-mode key).

## 4. Theme placeholder

Each device declares an active theme. The theme contributes a default
placeholder artwork that appears in the Stopped / Idle / Offline /
Unpaired / Revoked states. Placeholders are intentionally
device-themed (not framework-universal) so the operator's chosen
aesthetic propagates to the multi-room view.

When a device's theme is not loaded (initial discovery, theme broken,
etc.), the framework default placeholder is used (a neutral evo
glyph). Telemetry records placeholder-fallback events so the operator
can debug a missing theme.

## 5. Widget kinds

Two new widget kinds rendering the `MultiroomDeviceCardEnvelope`:

| Widget kind | Purpose |
|---|---|
| `multiroom.device.card.list` | List-view device card (single device or subgroup) |
| `multiroom.device.card.tile` | Tile-view device card (single device or subgroup) |

Both widget kinds consume the envelope as declared in the schema
(`audio.multiroom.device_card`):

```text
MultiroomDeviceCardEnvelope {
    device_or_group_id            : string                          // subject-instance key
    display_name                  : string                          // operator-visible name
    state_badge                   : state_badge enum                // role badge (solo / leader / member / subgroup / master)
    transport_state               : transport_state enum            // playing / paused / stopped / idle / offline / unpaired / revoked
    current_track                 : option<track_summary>           // Some(...) iff playing / paused
    theme_placeholder_artwork_url : string                          // theme-contributed default
    master_group_context          : option<master_group_context>    // Some(...) iff member of a master group (the recursive subgroup case)
    last_update_at                : system_time
}

track_summary {
    artwork_url : option<string>   // None falls back to theme placeholder
    title       : string
    artist      : option<string>   // richer overlay variants may render
    album       : option<string>
}

master_group_context {
    master_group_id   : string
    master_group_name : string
    delay_ms          : i32        // operator-configured per-member delay (the recursive subgroup case)
    audible_time_ms   : i32        // computed per the honest-degradation contract
}
```

Hosted on the new `multiroom.devices` shelf admitted by the
multi-room plugin's manifest. Cardinality `AnyToMany`; accepts both
card widget kinds; layout depends on the operator's view-mode toggle
per Section 3.

## 6. Subgroup cards in master-group view (the recursive subgroup case)

When the operator opens a master group's view, each member subgroup
is rendered as a card on the same `multiroom.devices` shelf using the
same widget kinds. The card's data binding follows Section 2
(subgroup card source = the subgroup's source-host's
`audio.multiroom.device_card` instance for the subgroup-as-entity).
Recursive subgroup-of-subgroup composition extends naturally; the
current release ships flat groups; master-group recursion composes
on top of the same envelope without schema or renderer changes.

## 7. Acceptance invariants

These invariants are also encoded in the schema's `[[acceptance]]`
entries; the renderer side honours them:

1. **Unified envelope shape across cases.** Solo device, group
   leader, group member, subgroup, master-group — the envelope shape
   is identical. Discrimination by `transport_state` +
   `state_badge` + `master_group_context` only; no per-case envelope
   variants.
2. **Reactive subject binding.** Cards subscribe once at mount and
   receive every transition reactively until unmount. Polling for
   refresh is non-conformant.
3. **One instance per entity.** Exactly one
   `audio.multiroom.device_card` subject instance per device-or-group
   entity in the domain. The publishing admission is the single
   authoritative source.
4. **Theme placeholder fallback.** When the active theme contributes
   no placeholder artwork, the publisher falls back to the
   framework-default neutral evo glyph. Telemetry records
   placeholder-fallback events.
5. **Honest-degradation contract.** When data hasn't arrived
   (cold-start, transient disconnect, source-host migration in
   flight), the card surfaces that state honestly via the
   `transport_state` enum (`offline` / `idle`) rather than masking
   it with stale data.

## 8. Breadcrumb behaviour on card drill-down

Card drill-down (Group landing → Device card → per-device detail
view) honours the universal three-affordance breadcrumb:

- **Back**: pops one level.
- **Section-home**: returns to the multi-room shelf's root view
  (Group landing).
- **Home**: returns to the application's main menu.

Each non-root depth shows all three; the root view shows Section-home
and Home (Back is implicit since there's nowhere to pop).

## 9. Composition with other collection surfaces

The multi-room card surface is the first realisation of the
universal collection pattern. Other collection surfaces
(library browse, network shares list, artwork picker) inherit
the same pattern — same list/tile presentation, same view-mode
persistence, same breadcrumb affordances, same theme-icon fallback
rule. Renderer authors implementing those later surfaces use the
multi-room card surface as the worked example.

## 10. Cross-references

- `audio.multiroom.device_card` subject declared in
  `schemas/org.evoframework/audio/multiroom.v1.toml` (framework schema shelf)
  — wire-protocol source-of-truth for the envelope shape.
- Universal collection presentation pattern — list / tile / breadcrumb
  / per-device view-mode persistence — covered by the framework's
  UI architecture documentation; this card surface is the first
  realisation.
- Three-affordance breadcrumb model (Back / Section-home / Home)
  — covered by the framework's breadcrumb documentation; applied per
  Section 8 above.
- Honest-degradation contract — referenced in the framework's
  reliability documentation; cards surface degradation honestly per
  Section 7 invariant 5.
- AssetCache (artwork delivery) — landing in the framework's HTTPS
  artwork endpoint. Cards consume artwork via the URL form
  `https://<host>/api/v1/artwork/<size>/<content_hash>`; the
  framework's substrate handles cache-first lookup with leader-fetch
  fallback for multi-room artwork propagation.
