# Operations & Admin Surfaces — Implementation Guide

Status: In progress  
Priority: P1 delivery slice  
Depends on: `UI_API_V1.md`, `UI_CAPABILITIES_V1.md`, `UI_SECURITY_PROFILE_V1.md`, `UI_OPERATIONS_SURFACES_V1.md`, `UI_AUTH_MODEL_V1.md`

## 1) Objective

Deliver protected maintenance/admin UI surfaces required for real device operation:

- log-level control (immediate effect)
- diagnostics and support bundle actions
- update/upgrade controls for OS, core, and plugins
- delivery channel control (`alpha|test|production`) for core and plugin streams
- plugin lifecycle actions (enable/disable/install/remove)
- SSH enable/disable
- network-access control: auth tier toggle + connected API consumers management (`UI_AUTH_MODEL_V1.md`)

## 2) Scope

In scope:

- capability-gated operations page set
- privileged action workflow with step-up auth
- command traceability + clear operator feedback for admin actions
- auth tier toggle settings screen with locked plain-English copy
- connected API consumers list (create / revoke / regenerate per consumer)
- one-time bearer-token reveal panel on create

Out of scope:

- backend contract invention in UI
- bypassing gateway authz or steward/plugin policy

## 3) Security requirement

Two independent auth mechanisms apply on the operations surfaces:

1. **Per-credential admission** (the tier substrate). The operator
   UI itself admits via LAN-trust on every tier; the wire ops on
   this surface gate on `read:auth` / `write:auth` /
   `step_up:system_admin` per `UI_AUTH_MODEL_V1.md`.
2. **Step-up auth** for privileged operations (`system.admin`
   class — updates, plugin lifecycle, SSH, reset-credentials-to-
   open). Requires process-bound credential challenge:
   - running user
   - password

The two mechanisms compose: a wire op may require both an
admitted session (per tier) AND a step-up token (for the
privileged step). No privileged action execution without
successful step-up session.

## 4) Acceptance criteria

- all admin actions are capability-gated and explicit when blocked
- all privileged actions require step-up auth before execution
- action outcomes are logged and operator-visible
- no silent failure for update/channel/plugin/ssh operations
- tier toggle screen renders the locked plain-English copy from `UI_AUTH_MODEL_V1.md` verbatim
- connected API consumers list shows status (active / expiring (Xd) / expired / revoked) with a 7-day expiring-soon aggregate banner
- the create-credential wizard reveals the token bytes ONCE in a copy-to-clipboard panel with the "shown ONCE" caption
- a credential `Regenerate` flow revokes the old + creates a new one with the same name + scopes + expiry policy in a single operator gesture

## 5) Implementation progress

Completed:

- scaffolded `OperationsSurface` with capability-gated controls for step-up, log-level, diagnostics, update channel/apply, plugin lifecycle, and SSH
- added `useOperationsState` for refresh-deduplicated snapshots of maintenance, updates, plugins, and SSH status
- extended `GatewayClient` with admin/ops endpoint methods aligned to `UI_API_V1.md`
- extended mock gateway with admin/ops capability flags plus stateful endpoints to exercise the new surface under `?mock=1`
- added contract test coverage for delivery channel policy parsing (`channel-policy.test.ts`)

In progress:

- network-access control surface (tier toggle screen + connected API consumers list + add-system wizard + one-time bearer reveal panel) per `UI_AUTH_MODEL_V1.md`
- `auth.tier.changed` and `auth.credentials.changed` WS event subscriptions for live inventory updates

Ratification alignment:

- Step-up and operations/admin governance ratified at framework level; implementation targets tokenized step-up sessions and policy-aware plugin lifecycle behavior.
- Per-credential management substrate (create / list / revoke / reset) is the operator-facing complement to the step-up flow; both compose on top of the framework's tier-aware admission path.
- privileged actions are UI-gated behind active step-up session with re-auth prompt on `step_up_required` failures.

## 6) Cutover demo readiness

For progress review and first-device walkthrough, use:

- `docs/evidence/CUTOVER_STAGE_PROGRESS_DEMO_RUNBOOK.md`

Operations-and-admin stream demo checkpoints are covered there under:

- operations/admin stream (step-up, log level, diagnostics, updates, plugin lifecycle, SSH)
- diagnostics stream (command outcome export and traceability)
