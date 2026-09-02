# UI Operations Surfaces v1

Status: Draft  
Owner: UI Runtime owner + UI shell owner  
Composes with: `UI_AUTH_MODEL_V1.md` (network-access control)

## 1) Purpose

Define maintenance/admin pages that are required for device operation readiness, not only playback UX.

## 2) Required Operations Surfaces

1. **Maintenance & Debug**
   - runtime log-level control with immediate effect
   - service restart controls (where contract allows)
   - guarded dangerous actions with explicit confirmation
2. **Diagnostics**
   - live health overview (core, UI runtime, plugin runtime)
   - diagnostics bundle generation/download
   - recent failure/events panel for operator triage
3. **Update & Channels**
   - current installed versions
   - delivery channel selector:
     - `alpha`
     - `test`
     - `production`
   - separate channel control for core and plugin update streams
4. **Plugin Lifecycle**
   - list installed plugins and source (`oop`, `community`, bundled)
   - enable plugin
   - disable plugin
   - install/upgrade plugin
   - remove plugin (where policy permits)
5. **Remote Access Controls**
   - SSH enable/disable
   - surface current SSH state and policy constraints
6. **Network Access Control** (per `UI_AUTH_MODEL_V1.md`)
   - auth tier toggle: `Open` / `Secure` / `Secure-industrial`
     with locked plain-English explanatory copy per tier
   - connected API consumers list:
     - per-consumer friendly name, scope summary, status
       (active / expiring (Xd) / expired / revoked), expiry,
       last-used (when surfaced)
     - 7-day expiring-soon aggregate WARN banner
     - actions: `Revoke`, `Regenerate`
   - add-system wizard:
     - platform picker (Home Assistant / ESPHome / Node-RED /
       Tasmota / Arduino / Custom HTTP / Custom WebSocket)
     - scope picker (categorised: "Trigger playback" /
       "Read playback state" / "Schedule playlists" /
       "Read everything" / "Full access" / "Custom")
     - expiry policy picker (Never / 30 days / 90 days /
       1 year / Custom seconds)
   - one-time token reveal panel after mint:
     - bearer bytes shown ONCE with copy-to-clipboard
     - platform-specific snippet pre-rendered with the
       freshly-minted token substituted in

## 3) Access Protection Requirement

Two independent auth mechanisms apply:

1. **Per-credential admission** (tier substrate per
   `UI_AUTH_MODEL_V1.md`). Operator UI admits via LAN-trust;
   wire ops on these surfaces gate on `read:auth` / `write:auth`
   / capability scopes per surface.
2. **Step-up auth** for privileged operations (`system.admin`
   class):
   - running process user identifier
   - password verification

The two mechanisms compose. The tier toggle and credential
inventory list require admitted session only; the
`reset-credentials-to-open` recovery gesture requires both
admitted session AND step-up. The same applies to update /
plugin lifecycle / SSH actions.

## 4) Capability Gates (minimum)

- `maintenance.log_level`
- `diagnostics.bundle`
- `updates.channels`
- `updates.apply.core`
- `updates.apply.plugins`
- `plugin.lifecycle`
- `system.ssh`
- `auth.tier.read` / `auth.tier.write`
- `auth.credentials.read` / `auth.credentials.write`
- `auth.credentials.reset` (step-up required)

## 5) Notes

- These surfaces are operational, not cosmetic.
- If backend contracts are not ratified, UI must show explicit blocked state instead of fake controls.
- The Network Access Control surface (§2.6) is the operator's UX entry point for the framework's auth-tier substrate; the framework's `docs/engineering/CREDENTIALS.md` is the source for platform copy-paste examples consumed by the add-system wizard.
