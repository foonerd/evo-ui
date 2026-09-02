# UI Security Profile v1

Status: Draft  
Owner: UI Runtime owner  
Source of truth for auth admission: `UI_AUTH_MODEL_V1.md`

## 1) Purpose

Defines the security posture for the UI runtime service. Admission
decisions (who reaches the UI without a credential, who needs one,
what scopes a credential carries) live in `UI_AUTH_MODEL_V1.md` —
this profile composes on top.

## 2) Deployment Modes

The framework's auth substrate exposes a tier toggle the operator
controls. The three tiers replace the older "local-only vs
remote-exposed" framing because the substrate now classifies
requests by origin (LAN vs WAN) on every request and admits or
refuses accordingly.

## 2.1 Open tier (default)

- Operator UI admitted on every origin; no credential, no pairing.
- External API consumers admitted on every origin; no credential.
- Appropriate when the operator owns the network the device is on
  and trusts every device on it.

## 2.2 Secure tier

- Operator UI admitted on LAN-origin without a credential
  (RFC1918 / loopback / link-local / IPv6 unique-local).
- External API consumers (Home Assistant, ESPHome sensors,
  scripts) reach the device with a bearer credential the operator
  minted with a name and explicit scopes.
- WAN-origin requests refused with `401` unless they present a
  bearer.
- TLS terminates on `443` (or the bound listener port) for HTTP /
  WS / REST / artwork traffic.
- Bearer credentials default to `Never` expiry. Operator revokes
  explicitly via the credential management UI.

## 2.3 Secure-industrial tier

- Identical admission shape to Secure tier.
- Per-credential expiry policy operator-set at creation time.
- Expiry-warning surface in the UI 7 days ahead of expiry.

## 3) Mandatory Controls

- LAN-origin classification on every request under Secure /
  Secure-industrial tiers.
- Bearer-token verification for explicit-credential requests
  regardless of tier (a presented but malformed / revoked /
  expired bearer is refused `401` even from LAN origin).
- Authorization checks per action domain.
- Step-up auth for privileged operations (`system.admin`) using
  running process user + password. Step-up is a separate
  mechanism from the per-credential primitive; both apply
  independently on the same wire op when both are required.
- Input validation on all HTTP and WS payloads.
- Request throttling and connection caps.
- Structured audit logs (action, principal, outcome, timestamp).
  The `lan-trust-operator` principal id surfaces in audit
  entries for requests admitted via LAN-trust so reviewers
  correlate admissions across surfaces.
- Safe error responses (no secrets).
- Self-servicing certificate lifecycle (issue, renew, rotate,
  rollback-safe reload).

## 4) WS Security

- WS upgrade admission follows the same tier × origin rules as
  HTTP: Open admits everywhere; Secure / Secure-industrial admit
  LAN-origin without a bearer and require a bearer on WAN-origin.
- Two bearer-presentation paths on the upgrade are accepted:
  `Authorization: Bearer <token>` (server-to-server clients) and
  `Sec-WebSocket-Protocol: bearer.<token>` (browser-JS clients
  that cannot set headers on the upgrade).
- The connection's authenticated principal applies to every
  frame on the connection; per-frame capability gates take effect
  inside the loop.
- Idle timeout and heartbeat policy.
- Sequence number replay controls for reconnect behavior.

## 5) Data Handling

- No credential / plain-secret persistence in UI runtime logs.
- Sensitive network settings redacted in UI responses unless
  explicitly required.
- Bearer token bytes are returned ONCE at mint time and never
  persisted by the framework. The credential record (metadata
  only) is persisted on disk; the token bytes flow through the
  mint response one time. UI shows the bytes once with a clear
  "copy now, will not be shown again" panel.
- Per-credential expiry policy is operator-set, not framework-
  imposed. `Never` is the default for IoT-platform consumers
  that cannot maintain a refresh loop (an ESP8266 firing a
  sensor trigger).

## 5.1 UI settings runtime storage (device)

- UI runtime root: `/opt/evo/ui`
- Active release root: `/opt/evo/ui/current`
- Authoritative settings store: `/opt/evo/ui/data/settings.json`
- Backup store: `/opt/evo/ui/data/settings.json.bak`
- Settings writes must be atomic (`tmp -> fsync -> rename`) and validated before commit.
- File ownership/permissions must prevent non-privileged mutation.

## 6) Threat Boundaries

- UI runtime service is adapter only, not trust anchor for domain semantics.
- Domain plugins enforce their own invariants; UI runtime service enforces transport security and access control.
- UI runtime service must not bypass steward routes.
- UI settings runtime is authoritative for UI behavior knobs; frontend storage is cache-only and non-authoritative.

## 7) Ratified posture

- Step-up model for privileged operations is ratified at framework level (process-bound credential challenge with short-lived session token issued for the elevated dispatch window).
- Operations/admin control-plane and lifecycle/channel governance are ratified at framework level (typed wire ops with capability gates + audit emission).
- Runtime deployment default posture (local-only vs remote-exposed) remains an explicit product/runtime choice and must be declared per release profile.

Current implementation gaps (must close for lifecycle-ready claim):

- persistent authoritative settings service not implemented yet
- `evo-ui-runtime` binary not implemented yet
- TLS termination on `443` and certificate lifecycle not implemented yet

## 8) Scale Plan for 20+ Plugins

### 8.1 Default-deny posture for new plugin surfaces

- New plugin routes/events are denied for remote exposure by default.
- Exposure is enabled only after plugin annex security review is ratified.
- Local-only mode may allow broader exposure under device trust policy.

### 8.2 Permission scopes

Every plugin capability exposed to UI must map to one or more scopes:

- `scope.playback.read`
- `scope.playback.write`
- `scope.network.read`
- `scope.network.write`
- `scope.system.admin`

Privileged operations that require `scope.system.admin` include:

- update channel changes
- update/apply execution (`os`, `core`, `plugins`)
- plugin enable/disable/remove
- SSH enable/disable
- runtime maintenance controls (for example log-level mutation)

Per-plugin scopes should follow:

- `scope.plugin.<plugin_id>.<action>`

### 8.3 Plugin onboarding checklist (mandatory)

Before exposing a plugin to remote UI clients:

1. Input schema validation defined and enforced.
2. Abuse/rate profile defined.
3. Sensitive fields redaction rules defined.
4. AuthZ scope mapping reviewed.
5. Audit events defined.
6. Error leakage review completed.

### 8.4 Per-plugin security annex

For each plugin surfaced to UI, create:

- `UI_SECURITY_PROFILE_V1_PLUGIN_<plugin_id>.md`

Minimum annex content:

- Threat model deltas
- Required scopes
- Redaction policy
- Rate limits
- Owner sign-off
