# UI API v1

Status: Draft  
Owner: UI Runtime owner  
Depends on: `UI_LAYER_CONTRACT.md`  
Auth admission and credential management surfaces: `UI_AUTH_MODEL_V1.md`

## 1) Scope

Defines the HTTP/WS interface exposed by the UI runtime service to `evo-ui`.

This API is transport-facing only. Domain semantics remain owned by steward + domain plugins.

## 2) Protocol

- HTTP base: `/api/ui/v1`
- WS endpoint: `/api/ui/v1/ws`
- Content type: `application/json`
- Errors: stable machine-readable envelope from `UI_ERROR_MODEL_V1.md`

## 3) Required Domains and Endpoints

## 3.1 Session and capabilities

- `GET /capabilities`
  - anonymous route (no credential required regardless of tier)
  - returns available feature flags for this runtime
- `GET /health`
  - anonymous route
  - basic health/readiness for UI startup
- `GET /runtime/status`
  - planned endpoint for runtime process metadata (`service`, `version`, `active_release`, `ports`, `tls_state`)
- `GET /auth/tier`
  - returns the current auth tier (`open` / `secure` / `secure_industrial`)
  - anonymous route so the UI can render the tier label on the settings screen without credential ceremony

## 3.2 Playback

- `GET /playback/state`
  - now-playing snapshot for initial render
- `POST /playback/command`
  - body `{ command, args? }`
  - commands: `play`, `pause`, `stop`, `next`, `previous`, `seek`, `set_volume`, `set_random`, `set_repeat`

## 3.3 Queue

- `GET /queue`
  - queue snapshot with current index
- `POST /queue/add`
- `POST /queue/remove`
- `POST /queue/move`
- `POST /queue/clear`
- `POST /queue/play-index`

## 3.4 Browse and search

- `GET /browse?shelf=...&uri=...`
- `GET /search?q=...&scope=...`

## 3.5 Metadata and artwork

- `POST /metadata/query`
- `POST /artwork/resolve`

## 3.6 Outputs

- `GET /outputs`
- `POST /outputs/select`

## 3.7 Network

- `GET /network/status`
- `POST /network/request`
  - body `{ request_type, payload }` mapped to `network.nm.*`

## 3.8 Operations/Admin

- `POST /admin/auth/step-up`
  - body `{ process_user, password }`
  - returns `{ token, principal, scope, expires_at }` for short-lived privileged session
  - independent of the tier model; applies on top of any tier when the wire op declares `step_up:<scope>` capability requirement
- `POST /admin/auth/tier`
  - body `{ tier: "open" | "secure" | "secure_industrial", reason }`
  - flips the operator-selected auth tier; takes effect on the next request (no reconnect required); audit-logged
- `POST /admin/auth/create-bearer-token`
  - body `{ name, reason, scopes?: [{kind, scope}], expires_in_seconds? }`
  - mints a named operator-managed credential with operator-set scopes and operator-set expiry; returns `{ token, record }` ONCE
  - `scopes` empty / omitted means "every operator scope"; `expires_in_seconds` null / 0 / omitted means `Never`
- `GET /admin/auth/list-bearer-tokens`
  - returns the credential inventory as metadata (token bytes never returned post-mint)
  - each record carries `{ token_id, name, created_reason, scopes, expiry_policy, created_at_ms, expires_at_ms, revoked_at_ms, revoked_reason }`
- `POST /admin/auth/revoke-bearer-token`
  - body `{ token_id, reason }`
  - revokes the named credential; revocation persists across steward restarts
- `POST /admin/auth/reset-credentials-to-open`
  - body `{ reason }`
  - lockout-recovery gesture: purges every credential record + revocation and admits Open tier on next steward restart
  - capability: `step_up:system_admin`
- `POST /maintenance/log-level`
  - body `{ level }` (immediate effect)
- `POST /diagnostics/bundle`
  - triggers bundle generation/export path
- `GET /updates/status`
  - returns installed versions and pending update metadata
- `POST /updates/channel`
  - body `{ target: "core|plugins", channel: "alpha|test|production" }`
- `POST /updates/apply`
  - body `{ target: "os|core|plugins", scope? }`
- `GET /plugins`
  - plugin inventory including source classification (`oop|community|bundled`)
- `POST /plugins/{plugin_id}/enable`
- `POST /plugins/{plugin_id}/disable`
- `POST /plugins/{plugin_id}/remove`
- `GET /ssh/status`
- `POST /ssh/enable`
- `POST /ssh/disable`

## 3.9 UI settings runtime

- `GET /settings`
  - returns authoritative UI settings snapshot and revision metadata
- `PATCH /settings`
  - body `{ baseRevision?, changes }`
  - applies partial update only when `baseRevision` matches current runtime revision
  - response returns next authoritative snapshot revision

Required runtime settings keys:

- `network.http.always_on` (immutable true)
- `network.http.mode` (`serve|redirect|limited`)
- `network.https.enabled` (`true|false`)
- `network.https.cert.mode` (`device-ca|acme|manual`)
- `security.auth.tier` (`open|secure|secure_industrial`, default `open`)

## 4) WS Event Stream

Events are pushed as:

```json
{
  "event": "playback.state",
  "seq": 1234,
  "payload": {}
}
```

Required events:

- `playback.state`
- `queue.changed`
- `browse.changed` (optional if event-driven source exists)
- `network.changed`
- `settings.updated`
- `system.notice`
- `sync.lagged`
- `auth.tier.changed` (operator flipped tier; payload `{ tier }`)
- `auth.credentials.changed` (credential inventory mutated; payload `{ token_id, change: "created" | "revoked" | "expired" }`)

Current runtime baseline:

- WS endpoint path exists (`/api/ui/v1/ws`) but currently returns `501 Not Implemented`.
- Realtime fanout is pending implementation.

`settings.updated` payload shape:

```json
{
  "revision": 42,
  "changed_keys": ["playback.volume.step", "ui.theme"],
  "updated_at": "2026-05-09T06:15:00Z",
  "actor": "session:ui-abc123"
}
```

## 5) Compatibility Rules

- Additive fields are allowed.
- Unknown event names must be ignored by clients.
- API-breaking changes require new version path (`/v2`).

## 6) Open Items (Blockers)

- Final payload schemas for queue and browse.
- Output-selection canonical shape.
- Whether `browse.changed` is emitted or poll-only.
- Admin/ops payload schemas and step-up auth model are ratified at framework level; the credential-management surface (`create_bearer_token` / `list_bearer_tokens` / `revoke_bearer_token` / `reset_credentials_to_open`) is the operator-facing complement.
- Settings patch schema currently implemented as `{ baseRevision?, changes }`; ratified at internal-architecture level under the authoritative-runtime settings policy.
- Runtime status schema and lifecycle fields for `GET /runtime/status`.
- Runtime implementation gap: TLS termination (`443`) and cert lifecycle are not yet implemented.

## 7) Scale Plan for 20+ Plugins

The sections above define the core API baseline only. For a multi-plugin runtime, the API must be extensible without changing core semantics.

### 7.1 Namespaced extension contract

- Core domains remain under stable top-level routes (for example `/playback`, `/queue`).
- Plugin domains use namespaced routes:
  - `GET /domains/{domain}/capabilities`
  - `POST /domains/{domain}/request`
  - `GET /domains/{domain}/state`
- Domain names must be globally unique and stable (recommended: reverse-DNS style).

### 7.2 Plugin registry endpoints

- `GET /plugins`
  - returns all loaded plugins exposed to UI, including domain ownership and capability keys
- `GET /plugins/{plugin_id}`
  - returns one plugin descriptor (versions, domains, actions, event names)

Each plugin descriptor must include:

- `plugin_id`
- `plugin_version`
- `domains[]`
- `capability_keys[]`
- `request_types[]`
- `events[]`

### 7.3 Event naming for plugin scale

- Core events keep existing names.
- Plugin events must be namespaced:
  - `plugin.{plugin_id}.{topic}`
  - Example: `plugin.org.evoframework.network.scan.changed`

### 7.4 Backward compatibility for plugin growth

- New plugin domains must be additive.
- Unknown plugin endpoints/events/capabilities must be ignored safely by old UIs.
- Removing or renaming a published plugin domain requires version bump (`/v2`).

## 8) Required Per-Plugin Annex

For each new plugin domain exposed to UI, add an annex file in this folder:

- `UI_API_V1_PLUGIN_<plugin_id>.md`

Minimum annex content:

- Exposed routes and schemas
- Event list
- Capability keys
- Owner
- Stability status (`experimental`, `ratified`, `deprecated`)
