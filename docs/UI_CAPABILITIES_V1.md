# UI Capabilities v1

Status: Draft  
Owner: UI Runtime owner

## 1) Purpose

Provides runtime capability flags so `evo-ui` can enable/disable features without guessing backend support.

## 2) Capability Envelope

```json
{
  "version": 1,
  "capabilities": {
    "playback.transport": "supported|partial|missing",
    "queue.crud": "supported|partial|missing",
    "browse.library": "supported|partial|missing",
    "search.global": "supported|partial|missing",
    "metadata.query": "supported|partial|missing",
    "artwork.resolve": "supported|partial|missing",
    "outputs.selection": "supported|partial|missing",
    "network.settings": "supported|partial|missing",
    "maintenance.log_level": "supported|partial|missing",
    "diagnostics.bundle": "supported|partial|missing",
    "updates.channels": "supported|partial|missing",
    "updates.apply.core": "supported|partial|missing",
    "updates.apply.plugins": "supported|partial|missing",
    "plugin.lifecycle": "supported|partial|missing",
    "system.ssh": "supported|partial|missing",
    "ui.settings": "supported|partial|missing",
    "ui.settings.realtime": "supported|partial|missing"
  },
  "notes": []
}
```

## 3) Required Feature Flags

- `playback.transport`
- `queue.crud`
- `browse.library`
- `search.global`
- `metadata.query`
- `artwork.resolve`
- `outputs.selection`
- `network.settings`
- `maintenance.log_level`
- `diagnostics.bundle`
- `updates.channels`
- `updates.apply.core`
- `updates.apply.plugins`
- `plugin.lifecycle`
- `system.ssh`
- `ui.settings`
- `ui.settings.realtime`

## 4) Fallback Rules

- `supported`: UI control visible and interactive.
- `partial`: UI visible with constrained actions + explanatory hint.
- `missing`: UI hidden or replaced by non-interactive informational state.

Settings-specific:

- `ui.settings: missing` => UI must treat all settings as local fallback only and display non-authoritative warning.
- `ui.settings.realtime: missing` => UI may persist to authoritative store but must warn that active sessions will not live-update.

## 5) UI Behavior Contract

- UI must read capabilities before enabling controls.
- UI must re-check capabilities on reconnect.
- UI must not infer support from missing errors alone.

## 6) Initial Expected Status (based on current references)

Runtime baseline (current implementation):

- `ui.settings`: `supported`
- `ui.settings.realtime`: `missing` (poll-based convergence only)
- `playback.transport`: `missing`
- `queue.crud`: `missing`
- `browse.library`: `missing`
- `search.global`: `missing`
- `outputs.selection`: `missing`
- `network.settings`: `partial` (operator network widgets built and wired to the real networking.link verbs; NOT `supported` until the hardware acceptance matrix passes across the supported target triples)

## 7) Scale Plan for 20+ Plugins

### 7.1 Namespaced capability keys

Use namespaced keys to prevent collisions:

- Core keys: `core.<domain>.<feature>`
- Plugin keys: `plugin.<plugin_id>.<feature>`

Examples:

- `core.playback.transport`
- `plugin.org.evoframework.network.scan`
- `plugin.org.evoframework.room.eq.profile.apply`

### 7.2 Capability metadata (required)

Each capability must include metadata, not only status:

```json
{
  "key": "plugin.org.evoframework.network.scan",
  "status": "supported",
  "source_plugin": "org.evoframework.network",
  "since_version": "1.0",
  "stability": "experimental|ratified|deprecated",
  "notes": []
}
```

### 7.3 Capability profiles

Gateway should publish grouped profiles for large plugin sets:

- `profile.core-minimum`
- `profile.audio-full`
- `profile.network-admin`

UIs may use profiles for coarse feature gating, then inspect per-key statuses.

### 7.4 Per-plugin capability annex

For each new plugin domain exposed to UI, create:

- `UI_CAPABILITIES_V1_PLUGIN_<plugin_id>.md`

Minimum annex content:

- Capability key list
- Status rules
- Fallback UI behavior for each key
- Owner and ratification status
