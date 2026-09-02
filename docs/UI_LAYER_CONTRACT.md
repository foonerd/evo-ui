# Evo UI Layer Contract

Status: Draft for ratification  
Scope: `evo-ui` only (all other repositories are read-only references for this document)

## 1) Purpose

Define the non-negotiable contract boundaries for building `evo-ui` as the primary display layer for `evo-core` + `evo-device-audio`.

This document exists to prevent ambiguous ownership and wasted implementation effort.

If the required technology expectations in this document are not satisfied, UI work is blocked by policy.

## 1.1 Terminology lock (CR-board clarity)

- Preferred term: **UI runtime service** (`evo-ui-runtime`).
- Deprecated legacy terms in older drafts: **gateway plugin**, **bridge**.
- All architecture discussions and approvals must use **UI runtime service** terminology.

## 1.2 Integration shape (canonical)

The operator's browser hits `http://<device>/` on port 80
(plain HTTP, no certificate). The UI runtime service
(`evo-ui-runtime`) serves the UI shell at that origin and
reverse-proxies framework HTTP + WebSocket traffic to the
framework's loopback HTTPS substrate on `127.0.0.1:8443`.
The TLS handshake happens entirely on loopback, where the
framework's cert is valid by construction. **The operator
never sees a certificate, a SAN mismatch, or a "your
connection is not private" warning.**

```text
+-------------+   HTTP :80   +-----------------+   HTTPS loopback   +----------+
|  Browser    |  <--------->  | evo-ui-runtime |  <--------------->  | evo     |
|             |  no TLS       |  reverse-proxy |  cert SAN matches   | framework|
|             |  no cert      |  + UI shell    |  loopback host      |          |
+-------------+               +-----------------+                     +----------+
                                                                       (also
                                                                        binds
                                                                        :8443
                                                                        for
                                                                        external
                                                                        API
                                                                        consumers)
```

The UI runtime is the **canonical integration shape**, not an
optional vendor adapter. The single-origin topology is the
guarantee that makes "operator opens browser, just works"
hold across:

- hostname changes
- IP changes (DHCP lease renewal, network switch)
- network changes (different SSID, different subnet)
- airplane-mode toggle and reconnect

None of those events invalidate any TLS state visible to the
operator because the operator's browser never participates
in TLS. The cert lifecycle is internal to the device
(loopback-only).

External API consumers (Home Assistant, ESPHome sensors,
scripts) continue to reach the framework on its HTTPS
listener (port 8443) directly with their own bearer
credentials; they handle their own cert posture per
`docs/engineering/CREDENTIALS.md` in the framework
repository.

## 2) Responsibility Borders

### `evo-core` responsibility

- Owns steward runtime and client-socket protocol.
- Owns core op semantics (`request`, projections, subscriptions, capabilities, error classes).
- Owns protocol compatibility guarantees.
- Does **not** own web/mobile/kiosk framework decisions.
- Does **not** own UI-facing HTTP/WS API shape.

### `evo-device-audio` plugin responsibility

- Owns audio/network domain behavior exposed through plugin contracts.
- Owns request types declared in plugin manifests.
- Owns plugin-internal operational logic and domain outcomes.
- Does **not** own frontend transport protocol or UI state model.
- Does **not** own cross-plugin UX aggregation.

### UI Runtime Service layer responsibility (canonical layer)

The UI runtime service is the **single-origin entry point**
for the operator. It owns:

- The canonical operator-facing HTTP listener on port 80.
- The UI shell static-asset serving (the React/Vite bundle).
- The reverse-proxy for framework HTTP + WebSocket traffic
  to the framework's loopback HTTPS substrate
  (`127.0.0.1:8443` by default).
- `X-Forwarded-For` injection so the framework's trusted-
  proxy classifier sees the operator's real LAN address,
  not the loopback peer.
- Authoritative UI settings service (shared settings
  persistence + multi-session sync).
- Does **not** bypass steward or call plugins directly.
- Does **not** invent backend semantics.

### Canonical integration shape

`evo-ui` (frontend) ─HTTP :80→ `evo-ui-runtime` ─HTTPS loopback→ `evo-core` ─→ domain plugins

The operator's browser never participates in TLS. The
framework's auth substrate (`UI_AUTH_MODEL_V1.md`) admits the
shell via LAN-trust against the operator's real address,
which the runtime injects into `X-Forwarded-For` on every
proxied request.

### What the runtime is NOT

- Not a bridge per plugin. One runtime binary covers every
  plugin surface.
- Not part of `evo-ui` frontend code; it is a separate
  process on the device.
- Not a domain owner; semantics belong to `evo-core` and
  the domain plugins.
- Not a place to fork protocol truth from `evo-core` docs.

### Direct-to-framework path (external API consumers only)

External automation systems (Home Assistant, ESPHome sensors,
scripts on other machines) reach the framework's HTTPS
listener (`https://<device>:8443/`) directly with their own
bearer credentials. They handle their own cert posture; the
operator's browser session never participates in that path.
This is the *external API consumer* path, not the operator
path.

### Single source of truth rule (non-negotiable)

- `evo-core` contracts are the only source of truth for runtime semantics.
- The UI runtime service is an adapter layer only; it may reshape transport, but it may not invent backend semantics.
- Domain behavior remains in domain plugins (`evo-device-*`), not in the UI runtime service.

### `evo-ui` responsibility

- Owns presentation, interaction logic, and theme system.
- Owns UI state composition based on runtime-service contract only.
- Must treat unknown fields/events as forward-compatible.
- Must not embed backend assumptions not declared in the UI API contract.

## 3) Required Technology Expectations (Gate Conditions)

The following must be explicitly defined and versioned before feature implementation:

1. **UI API contract v1**
   - Canonical endpoint/event list.
   - Request/response schemas.
   - Versioning strategy and deprecation policy.
2. **Runtime mapping contract**
   - Exact mapping from each UI API operation to one or more `evo-core` ops.
3. **Streaming/reconcile contract**
   - Cursor/resume behavior.
   - Snapshot + delta application rules.
4. **Error contract**
   - Stable machine-readable error mapping to UI states.
5. **Capability contract**
   - Feature probing and fallback behavior when missing.
6. **Security contract**
   - Three-tier auth model per `UI_AUTH_MODEL_V1.md` (`Open` /
     `Secure` / `Secure-industrial`) with LAN-origin admission
     for operator UI and bearer-credentialled access for
     external API consumers.
   - Step-up auth posture for privileged operations layered on
     top of tier admission.

If any of the above is undefined, implementation is "No-Go".

## 4) Current Exposure Audit (Reference-Based)

This section records what is currently available from references and what is missing for a complete UI contract.

### 4.1 Available now (clear, usable primitives)

- `evo-core` client protocol operations are defined and documented.
- `evo-core` subscription and projection semantics are documented.
- `evo-device-audio` respondent request surfaces exist for:
  - `metadata.query`
  - `artwork.resolve`
  - `alsa.pipeline.compose`
  - `network.nm.*` request family

### 4.2 Missing now (blocking for complete UI contract)

- No ratified UI-facing runtime API spec (HTTP/WS contract) for `evo-ui`.
- No canonical UI transport-control API surface as respondent verbs.
- No canonical queue API surface (list/add/remove/reorder/play-index).
- No canonical browse/search/library API surface for UI.
- No canonical output-selection API contract for end-user UX.
- No canonical settings API grouping for UI domains.
- No published owner map for each missing API surface.

Conclusion: current primitives are necessary but not sufficient.

## 5) Capability Matrix (Definitive)

| UI Domain | Current State | Owner to Close Gap | Blocker Severity |
| --- | --- | --- | --- |
| Now playing metadata | Partially available via projections + metadata/artwork requests | UI Runtime + UI | Medium |
| Transport controls | Not contract-complete for UI API | Core/Plugin + UI Runtime | Critical |
| Queue management | Not contract-complete for UI API | Core/Plugin + UI Runtime | Critical |
| Browse/search/library | Not contract-complete for UI API | Core/Plugin + UI Runtime | Critical |
| Output selection | Not contract-complete for UI API | Core/Plugin + UI Runtime | High |
| Network settings UX | Plugin request primitives exist, UI contract not unified | UI Runtime + UI | Medium |
| UI settings sync/persistence | Frontend-local fallback exists; authoritative runtime store missing | UI Runtime + UI | Critical |
| Themes/layouts | UI-owned and feasible | UI | None |
| Realtime sync/reconnect | Core primitives exist, runtime policy undefined | UI Runtime | High |
| Remote security posture | Defined by `UI_AUTH_MODEL_V1.md` three-tier substrate (Open / Secure / Secure-industrial) with LAN-origin admission | Framework + UI | Resolved |

## 6) Contract Deliverables (Must Exist)

### D1: `UI_API_V1.md`

- Endpoint/event surface grouped by domain.
- Request/response payload schemas.
- Compatibility guarantees.

### D2: `UI_TO_CORE_MAPPING_V1.md`

- Per operation:
  - UI API operation
  - Runtime handling
  - `evo-core` op(s)
  - plugin request type(s), if any

### D3: `UI_CAPABILITIES_V1.md`

- Capability names.
- Required/optional flags.
- Fallback behavior.

### D4: `UI_ERROR_MODEL_V1.md`

- Error code classes.
- Retryability and fatality guidance.
- Required UI behavior per class.

### D5: `UI_SECURITY_PROFILE_V1.md`

- Local mode profile.
- Remote mode profile.
- Required controls and defaults.

### D6: `UI_SETTINGS_RUNTIME_V1` (captured in ADR + API/capability docs)

- Device runtime path and persistence semantics.
- Settings snapshot/update contract and revision policy.
- Multi-session propagation guarantees.

## 7) Go/No-Go Policy

### No-Go (implementation blocked)

- D1 is missing.
- Transport/queue/browse domains lack ratified schema.
- Security profile is undefined for chosen deployment shape.

### Go (implementation allowed)

- D1 + D2 + D3 ratified.
- Critical domains (transport, queue, browse) are fully specified.
- Security posture for the selected mode is ratified.

## 8) Non-Negotiable Rules

- UI never talks to plugins directly.
- UI runtime service never bypasses steward for plugin interactions.
- UI must tolerate unknown additive fields and event variants.
- "Reference behavior" from other repos does not become contract unless explicitly ratified here.

## 9) Immediate Next Steps

1. Draft D1 with only critical domains first: transport, queue, browse, now playing.
2. Draft D2 mappings and identify exact core/plugin additions needed.
3. Mark each required addition with owner and due phase.
4. Re-run Go/No-Go gate before writing feature code in `evo-ui`.
5. Ratify UI runtime settings architecture (authoritative-runtime settings shape: the runtime service is the source of truth; the shell reads over the API and never persists locally) before claiming cross-session reliability.

## 10) Runtime Component: UI Runtime Service

This section defines the canonical runtime component on every
device. The reference-device default ships this binary and
relies on it as the single-origin entry point for the
operator's browser.

### 10.1 Runtime identity and ownership

- **Role:** UI shell host + framework reverse-proxy +
  authoritative settings store. NOT a domain owner.
- **Placement:** device UI runtime layer (distribution-side
  UI runtime package).
- **Build basis:** `evo-core` SDK/contracts only.
- **Single source of truth:** steward contracts and domain
  plugins.
- **Runtime binary:** `/opt/evo/bin/evo-ui-runtime`.

### 10.2 What this runtime service does

- Binds `http://0.0.0.0:80/` and serves the UI shell static
  bundle at `/`.
- Reverse-proxies every framework HTTP wire-op route
  (`/api/v1/*`) to the framework's loopback HTTPS substrate
  (`https://127.0.0.1:8443/api/v1/*`).
- Reverse-proxies the WebSocket upgrade (`/api/v1/ws`) to
  the framework's loopback WSS endpoint
  (`wss://127.0.0.1:8443/api/v1/ws`).
- Injects `X-Forwarded-For: <operator-ip>` on every proxied
  request so the framework's trusted-proxy classifier sees
  the operator's real LAN address.
- Trusts the device CA at `/var/lib/evo/https/https/ca.crt`
  as the loopback upstream TLS root. SNI pinned to
  `localhost` because the framework's leaf cert SAN
  matches.
- Exposes UI-runtime-owned endpoints under `/api/ui/v1/*`:
  `health`, `capabilities`, `settings` (GET + PATCH),
  `ws` (long-poll event stream for settings changes).
- Owns the authoritative UI settings store with atomic
  file persistence + revisioned mutation.

### 10.3 What this runtime service must never do

- Must not own playback/library/network business semantics.
- Must not bypass steward and call domain plugins directly.
- Must not mutate plugin-private files or OS state outside
  declared API calls.
- Must not fork protocol truth from `evo-core` docs.
- Must not weaken the framework's tier admission policy
  (the runtime may add restrictions on top; it cannot
  remove framework-enforced auth checks).
- Must not terminate browser-facing TLS (the topology
  guarantee is that the operator's browser only ever
  speaks plain HTTP to this runtime).

### 10.4 Contract boundary by domain

| Domain | Domain owner | Runtime responsibility |
| --- | --- | --- |
| Transport state/control | Domain plugins + steward | Route command + stream state |
| Queue model | Domain plugins + steward | Expose UI queue API + reconcile |
| Browse/search/library | Domain plugins + steward | Expose UI browse API + map projections/requests |
| Metadata/artwork | `metadata.local` / `artwork.local` | Forward request/shape response |
| Network settings | `network.nm` | Forward request/shape response |
| UI settings/layout policy | UI frontend + UI runtime settings service | Persist shared UI settings, fan out updates, expose revisioned contract |

### 10.5 Required runtime contract outputs

Before implementation starts, the UI runtime service must have:

1. `UI_API_V1.md` (UI-facing HTTP/WS contract)
2. `UI_TO_CORE_MAPPING_V1.md` (operation mapping to core ops)
3. `UI_CAPABILITIES_V1.md` (feature flags + fallback)
4. `UI_ERROR_MODEL_V1.md` (stable error mapping)
5. `UI_SECURITY_PROFILE_V1.md` (local/remote posture)

### 10.6 Open items

- Ratified UI API schema for transport / queue / browse /
  output domains exposed via this runtime's
  `/api/ui/v1/*` surface (the reverse-proxy path
  `/api/v1/*` is settled and tracks the framework's
  canonical wire-op surface as-is).
- Acceptance tests proving the proxy preserves framework
  protocol semantics on every proxied op (REST + WS).
- Cert lifecycle on the loopback upstream: rotation of the
  framework's device-CA must not break the runtime's
  trust root. The runtime reloads `ca.crt` at process
  restart; live-reload is open for a future iteration.

The framework-tier auth substrate is settled.
`UI_AUTH_MODEL_V1.md` locks the three-tier admission model,
the per-credential primitive, LAN-origin classification with
trusted-proxy support, and recovery gestures.

## 11) Multi-Plugin Scaling Rule (20+ plugin target)

The D1-D5 files are the baseline contract pack. They are not sufficient alone for a runtime that plans many additional plugin surfaces.

### 11.1 Mandatory extension model

For each plugin/domain exposed to UI, an annex set is required:

- `UI_API_V1_PLUGIN_<plugin_id>.md`
- `UI_TO_CORE_MAPPING_V1_PLUGIN_<plugin_id>.md`
- `UI_CAPABILITIES_V1_PLUGIN_<plugin_id>.md`
- `UI_ERROR_MODEL_V1_PLUGIN_<plugin_id>.md`
- `UI_SECURITY_PROFILE_V1_PLUGIN_<plugin_id>.md`

No plugin UI surface is considered ratified without the full annex set.

### 11.2 Ownership and ratification

Each annex set must declare:

- Domain owner
- UI runtime owner
- Security reviewer
- Ratification status (`proposed`, `ratified`, `deprecated`)

### 11.3 Go/No-Go addendum for plugin onboarding

No-Go for a plugin if any condition is true:

- Missing mapping annex
- Missing capability/fallback definition
- Missing security annex for selected deployment mode
- No explicit owner assignment

Go for a plugin only when all annexes are present and ratified.
