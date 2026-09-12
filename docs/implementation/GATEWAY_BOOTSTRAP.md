# Gateway Bootstrap — Implementation Guide

Status: Ready for implementation  
Priority: P0/P1 boundary slice  
Depends on: `UI_API_V1.md`, `UI_CAPABILITIES_V1.md`, `UI_LAYER_CONTRACT.md`

## 1) Objective

Establish a capability-first UI bootstrap path against the gateway contract so `evo-ui` can:

- connect to gateway deterministically
- read health/capabilities before enabling features
- initialize baseline state without backend assumption leaks

This chunk intentionally avoids deep domain UX and focuses on reliable startup semantics.

## 2) Scope

In scope:

- gateway connection bootstrap flow in UI client
- health check handshake (`GET /health`)
- capabilities fetch (`GET /capabilities`)
- bootstrap state machine in frontend (`idle -> connecting -> ready|degraded|offline`)
- capability-gated rendering switch points for top-level feature areas
- structured error handling for bootstrap failures

Out of scope:

- full transport/queue/browse feature implementation
- domain-specific command mapping logic
- final UI polish and animation refinement

## 3) Required contract usage

Must consume and honor:

- `UI_API_V1.md`:
  - `GET /health`
  - `GET /capabilities`
- `UI_CAPABILITIES_V1.md`:
  - status handling for `supported|partial|missing`
- `UI_ERROR_MODEL_V1.md`:
  - bootstrap-time error categorization

Must not:

- infer unsupported capabilities from generic request failures
- enable controls before capability resolution
- bypass gateway and talk directly to plugin/core internals

## 4) Implementation tasks

1. Add bootstrap service in UI data layer:
   - `checkHealth()`
   - `fetchCapabilities()`
2. Add startup orchestration:
   - app start -> health -> capabilities -> ready/degraded
3. Add app-wide bootstrap state:
   - `isBootstrapping`
   - `isConnected`
   - `bootstrapStatus`
   - `capabilities`
4. Add feature gate helpers:
   - `isFeatureSupported(key)`
   - `isFeaturePartial(key)`
5. Add fallback views:
   - offline state
   - degraded state with explicit explanation
6. Add reconnect trigger:
   - manual retry action
   - capability refresh on reconnect

## 5) Acceptance criteria

Functional:

- UI startup makes no domain calls before capabilities are loaded.
- When health is reachable and capabilities resolve, UI enters `ready`.
- When health resolves but capability payload is partial/incomplete, UI enters `degraded` with safe fallback rendering.
- When health fails, UI enters `offline` and exposes retry.

Contract:

- all enabled feature controls are capability-gated
- unknown capability keys do not crash UI and default to safe-disabled behavior

Quality:

- startup errors are visible and actionable (not silent)
- bootstrap path covered by automated tests for ready/degraded/offline branches

## 6) Evidence to attach after completion

- test outputs for bootstrap state transitions
- screenshot set for `ready`, `degraded`, `offline`
- update to:
  - `UI_DELIVERY_PLAYBOOK_V1.md` (status/evidence notes)
  - `UI_PERFORMANCE_CONTRACT_V1.md` (measurement evidence where relevant)

## 7) Expected follow-on slice

Playback baseline: state + core transport commands + capability-gated controls (see `PLAYBACK_BASELINE.md`).

## 8) Implementation progress

Implemented in `apps/evo-ui-shell`:

- bootstrap state machine (`idle -> connecting -> ready|degraded|offline`)
- contract endpoints wired:
  - `GET /api/ui/v1/health`
  - `GET /api/ui/v1/capabilities`
- required capability key evaluation with safe default (`missing`)
- capability-gated top-level surfaces (`Playback`, `Queue`, `Browse & Search`)
- gateway error envelope parsing for HTTP failures
- websocket stream skeleton at `/api/ui/v1/ws` with unknown-event ignore behavior
- retry path and degraded/offline rendering states

Partially implemented as a playback-baseline headstart:

- `GET /api/ui/v1/playback/state`
- `GET /api/ui/v1/queue`
- command wiring:
  - `POST /api/ui/v1/playback/command`
  - `POST /api/ui/v1/queue/{add|remove|move|clear}`
