# UI Delivery Playbook v1

Status: Canonical  
Purpose: single source for UI delivery governance, execution order, risk handling, and promotion discipline

## 1) Authority order

When documents conflict, use this order:

1. `UI_LAYER_CONTRACT.md` (architecture and responsibility boundaries)
2. D1-D5 contracts (`UI_API_V1.md`, `UI_TO_CORE_MAPPING_V1.md`, `UI_CAPABILITIES_V1.md`, `UI_ERROR_MODEL_V1.md`, `UI_SECURITY_PROFILE_V1.md`)
3. This playbook (`UI_DELIVERY_PLAYBOOK_V1.md`)
4. Per-surface implementation guides (under `docs/implementation/`)

## 2) Non-negotiable delivery rules

- UI never bypasses UI runtime/steward contracts.
- UI runtime never owns domain semantics.
- No release scope is "Go" with open P0 dependency.
- `CONCEPT/` is authoritative for visual behavior:
  - adopt approved UI composition/components/tokens as-is
  - only adapt framework/runtime wiring (data hooks, API plumbing, typing)
  - any visual delta requires explicit approval and must be documented
- subpage layout policy is governed by `docs/adr/0001-subpage-layout-policy.md`
- UI settings policy is governed by `docs/adr/0002-ui-settings-authoritative-runtime.md`
- Private/public boundary is strict:
  - strategic shaping docs remain private (`*-eng`)
  - public repos receive release-ready code and minimal public docs only

## 3) Current blocker model

Severity:

- `P0`: blocks viability
- `P1`: blocks complete showcase quality
- `P2`: maturity/acceleration

Active P0 classes:

- unresolved core/UI-runtime architectural decisions affecting UI runtime behavior
- unratified critical domain contracts (transport/queue/browse/outputs)
- unresolved deployment security posture
- missing realtime session fanout contract (`settings.updated` over WS)

P0 closure checklist (lifecycle readiness):

- [x] persistent authoritative settings service implemented (device-side, revisioned, file-backed)
- [x] `evo-ui-runtime` binary implemented and used by `evo-ui.service`
- [x] bootstrap endpoints implemented (`GET /health`, `GET /capabilities`)
- [x] explicit WS-not-implemented behavior documented (`/api/ui/v1/ws` => `501`) until realtime fanout is delivered
- [ ] TLS termination implemented on `443` with self-servicing certificate lifecycle
- [x] port `80` always available policy enforced in runtime (serve mode baseline)

## 4) Go/No-Go policy

### No-Go

- any `P0` is open
- critical domains lack ratified schema/mapping
- selected deployment mode lacks ratified security controls

### Conditional Go (slice-level)

- only for slices whose dependencies are closed and evidenced
- unresolved items must not affect the slice's runtime semantics

### Full Go

- all `P0` closed
- all `P1` closed or explicitly waived with owner + expiry
- conformance and acceptance evidence linked

## 5) Execution order

Sequenced bands (each band gates entry to the next):

- Contract lock and ownership
- Runtime-first baseline
- Vertical slices (playback -> queue -> browse/search -> outputs -> network -> operations/admin)
- Multi-plugin scale hardening
- Polish + quality/performance gates

## 6) Performance and freshness requirements

Performance contract source: `UI_PERFORMANCE_CONTRACT_V1.md`.

Mandatory semantics:

- no silent lag
- explicit freshness state (`fresh|stale|reconnecting`)
- reconnect convergence and reflection SLAs enforced per contract

## 7) Promotion discipline (eng-tier -> public tier)

Promotion unit must be coherent and reviewable.

Pre-promotion gate:

1. scope and exclusions written
2. contract alignment verified
3. P0 risk screen passed for promoted surfaces
4. relevant tests/lints pass
5. evidence references updated

No-go promotion cases:

- unresolved P0 dependency for promoted surface
- unmapped behavior against ratified contracts
- missing fallback behavior for partial/missing capabilities

## 8) Update cadence

- weekly review minimum
- mandatory review before release-candidate cuts
- each merged delivery slice updates at least one evidence pointer

## 9) Active implementation queue

- `docs/implementation/GATEWAY_BOOTSTRAP.md` - in progress (scaffold implemented in `apps/evo-ui-shell`; tracks runtime bootstrap semantics)
- `docs/implementation/PLAYBACK_BASELINE.md` - in progress (early command/snapshot baseline implemented)
- `docs/implementation/OPERATIONS_ADMIN.md` - in progress (maintenance, diagnostics, updates/channels, plugin lifecycle, ssh)

Recent parity-delivery note:

- playback controls moved to CONCEPT-style interaction model (icon transport + seek slider + volume slider)
- mobile navigation now includes CONCEPT-style hamburger drawer with overlay/close behavior
- home right-rail composition updated toward CONCEPT structure (`up next` + queue summary + volume + cast)

Current evidence pointer:

- Playback baseline: generate report via `apps/evo-ui-shell` -> `npm run evidence:chunk02` (writes `docs/evidence/playback-*.md`)
- Playback baseline index: `docs/evidence/PLAYBACK_EVIDENCE_INDEX.md`
- Playback screenshot checklist: `docs/evidence/PLAYBACK_SCREENSHOT_CHECKLIST.md`
- Playback benchmark template: `docs/evidence/PLAYBACK_BENCHMARK_TEMPLATE.md`
- Playback cutover runbook: `docs/evidence/FIRST_DEVICE_CUTOVER_RUNBOOK.md`
- Cutover progress demo: `docs/evidence/CUTOVER_STAGE_PROGRESS_DEMO_RUNBOOK.md`

## 10) Change policy

This playbook is concise by design.  
Do not create parallel governance docs unless explicitly needed.  
If new governance content is needed, add it here or replace this file with a higher-version playbook.
