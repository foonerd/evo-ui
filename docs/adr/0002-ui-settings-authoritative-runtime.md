# ADR 0002 - UI Settings Authoritative Runtime

Status: Accepted  
Date: 2026-05-09  
Scope: UI runtime behavior and persistence

## Context

UI settings such as theme and playback volume-step are currently implemented in frontend-local storage.  
That model is insufficient for industrial-grade operation where multiple active sessions (kiosk, browser, mobile, tablet) must stay in sync and survive reboot/power-loss.

Project direction requires:

- one authoritative settings source for UI behavior knobs
- dynamic propagation of settings changes to all active sessions
- deterministic persistence across reboot/restart/power-loss

## Decision

Adopt a device-side authoritative UI settings runtime under `/opt/evo/ui`:

- Runtime root: `/opt/evo/ui`
- Active release path: `/opt/evo/ui/current`
- Authoritative settings file: `/opt/evo/ui/data/settings.json`
- Backup settings file: `/opt/evo/ui/data/settings.json.bak`

Expose settings through UI API v1:

- `GET /api/ui/v1/settings` -> authoritative snapshot + `revision`
- `PATCH /api/ui/v1/settings` -> `{ revision, patch }` with revision precondition
- WS event `settings.updated` -> `{ revision, changed_keys, updated_at, actor }`

Frontend-local storage remains cache/fallback only and must never be treated as authoritative shared state.

## Consequences

Positive:

- shared settings state is consistent across concurrent sessions
- updates from one session become visible to other sessions immediately
- settings survive reboot and power-loss when runtime durability rules are met
- clear ownership boundary: UI runtime settings service is part of UI platform contract

Constraints:

- settings writes must be atomic (`tmp -> fsync -> rename`) and validated
- corruption recovery path must be defined (`settings.json.bak` fallback + warning)
- capability flags must express availability:
  - `ui.settings`
  - `ui.settings.realtime`
- frontend must handle `missing/partial` capability states explicitly

## Out of Scope

- introducing user identity-specific settings scopes (user/session/device hierarchy)
- replacing existing domain semantics in `evo-core` or domain plugins
- visual redesign of settings screens
