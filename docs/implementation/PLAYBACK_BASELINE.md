# Playback Baseline — Implementation Guide

Status: In progress  
Priority: P1 delivery slice  
Depends on: `GATEWAY_BOOTSTRAP.md`, `UI_API_V1.md`, `UI_TO_CORE_MAPPING_V1.md`, `UI_CAPABILITIES_V1.md`, `UI_PERFORMANCE_CONTRACT_V1.md`

## 1) Objective

Deliver a deterministic, capability-gated playback baseline for the reference UI shell:

- now-playing state rendering
- primary transport controls aligned to CONCEPT interaction style
- volume/mute baseline behavior aligned to CONCEPT interaction style
- freshness-aware playback status feedback

## 2) Scope

In scope:

- playback state subscription/render path
- controls for play/pause/next/previous/seek/set_volume using approved UI composition
- capability-aware control enable/disable rules
- optimistic control feedback with rollback on failure
- playback freshness state (`fresh|stale|reconnecting`) rendering

Out of scope:

- advanced queue operations beyond now-playing coupling
- browse/search behavior
- outputs/network configuration screens

## 3) Required contract usage

Must consume and honor:

- `UI_API_V1.md`:
  - `GET /playback/state`
  - `POST /playback/command`
  - playback-related WS events
- `UI_TO_CORE_MAPPING_V1.md`:
  - playback operation mapping rows
- `UI_CAPABILITIES_V1.md`:
  - `playback.transport` and related gating
- `UI_ERROR_MODEL_V1.md`:
  - stable error classification for user feedback

Must not:

- issue playback commands before capability resolution
- hide command failures without explicit UI feedback
- infer playback support from ad hoc behavior

## 4) Implementation tasks

1. Add playback data adapter:
   - `getPlaybackState()`
   - `sendPlaybackCommand(command, args?)`
2. Add playback state store:
   - `playbackSnapshot`
   - `lastPlaybackUpdateAt`
   - `playbackFreshness`
3. Add control-action layer:
   - centralized command dispatch with in-flight tracking
   - rollback/reconcile path on error
4. Add capability gates:
   - disable unsupported controls
   - explanatory degraded-state messages for partial support
5. Add freshness handling:
   - stale-state timeout logic
   - reconnect transition behavior

## 5) Acceptance criteria

Functional:

- now-playing view loads from gateway snapshot and updates from stream.
- supported controls dispatch correctly and update UI deterministically.
- unsupported/partial controls are correctly gated with explicit UX cues.
- command failure surfaces visible, actionable feedback.

Performance/freshness:

- playback-critical reflection p95 aligns with `UI_PERFORMANCE_CONTRACT_V1.md`.
- stale/reconnecting states appear when freshness SLA is breached.
- no silent lag on playback-critical surfaces.

Quality:

- automated tests cover:
  - supported command path
  - partial/missing capability gating
  - optimistic update + rollback
  - reconnect/freshness transitions

## 6) Evidence to attach after completion

- playback slice test outputs
- benchmark output for playback reflection latency
- benchmark template: `docs/evidence/PLAYBACK_BENCHMARK_TEMPLATE.md`
- screenshot set for:
  - ready/supported
  - partial support
  - error rollback
  - stale/reconnecting
- screenshot checklist: `docs/evidence/PLAYBACK_SCREENSHOT_CHECKLIST.md`
- update:
  - `UI_DELIVERY_PLAYBOOK_V1.md` evidence notes
  - `UI_PERFORMANCE_CONTRACT_V1.md` measured results

## 7) Expected follow-on work

Follow-on remains:

- tighten queue list/card-level visual parity against CONCEPT assets while preserving queue mutation behavior
- complete evidence bundle closure for playback and update linked benchmark/screenshot references

Note:

- `OPERATIONS_ADMIN.md` is a parallel in-progress slice and is not blocked by this playback parity work.

## 8) Early implementation notes

Initial baseline pieces already scaffolded in `apps/evo-ui-shell`:

- playback state snapshot read (`GET /api/ui/v1/playback/state`)
- queue snapshot read (`GET /api/ui/v1/queue`)
- transport command dispatch surface via `POST /api/ui/v1/playback/command`
- queue mutation dispatch surface via:
  - `POST /api/ui/v1/queue/add`
  - `POST /api/ui/v1/queue/remove`
  - `POST /api/ui/v1/queue/move`
  - `POST /api/ui/v1/queue/clear`
- event-driven refresh triggers for:
  - `playback.state`
  - `queue.changed`
- optimistic UI update + rollback/reconcile pattern for playback and queue command paths
- freshness semantics wired for playback and queue (`fresh|stale|reconnecting`)
- websocket reconnect backoff scaffold added for runtime resilience
- request-id correlation surfaced in command success feedback where available
- command log surface added for action/result traceability during engineering runs
- reconnect path triggers bootstrap reconciliation when stream recovers from offline/degraded states
- snapshot refresh calls are de-duplicated per domain to prevent overlapping fetch storms under bursty event/anomaly conditions
- outputs/network baseline adapters and mock endpoints are scaffolded for the next vertical slice
- command log persistence/export is available for engineering evidence capture across reloads
- browse/search actions now feed the same command telemetry trail (in-flight + outcome log) as other domains
- command-action helper now supports all UI domains (`playback|queue|browse|system`) with customizable success detail formatting
- pure contract tests are now runnable via Node built-in test runner (`contracts:test`) for bootstrap/capability/reconcile/command-log behaviors
- browse search actions now use operator-provided query input (not hardcoded test term) while preserving telemetry logging
- queue optimistic mutations now keep `current_index` coherent (remove/move adjust index and selection markers stay aligned)
- `runCommandAction` helper now has direct contract tests for success/failure logging and rollback/finally hook behavior
- feature surfaces now consume a shared `NewCommandLogEntry` contract for telemetry callbacks (no per-surface domain type drift)
- system refresh reconciliation now goes through shared domain event policy (`network.changed|sync.lagged`) and is contract-tested
- queue optimistic remove/move math is extracted into pure helpers with contract tests to protect `current_index` behavior
- stream telemetry state transition math is extracted and contract-tested (event counts + seq gap/regression detection)
- command log summary metrics are computed via a shared pure helper with contract tests (dashboard counters remain deterministic)
- command log storage parse/serialize behavior is extracted and contract-tested (malformed local data cannot poison runtime state)
- bootstrap phase decision logic is extracted into a pure policy helper and contract-tested (health/capability degradation rules explicit)
- stream event allowlist filtering is extracted and contract-tested (unknown events safely ignored by clients)
- combined capability gating for multi-feature surfaces is centralized and contract-tested (mixed statuses resolve to partial)
- persisted command log entries are domain-validated on load (`playback|queue|browse|system`) to prevent invalid telemetry state restore
- `runCommandAction` now treats unexpected thrown execute errors as logged failures and always executes finalize hooks
- in-flight summary text generation is centralized and contract-tested for deterministic operator status messaging
- snapshot stale-threshold policy is centralized and contract-tested so playback/queue freshness timing cannot drift
- request-id message formatting is centralized and contract-tested to keep command feedback wording consistent across surfaces
- anomaly-triggered refresh gating is centralized and contract-tested to prevent capability-missing surfaces from unnecessary reconcile fetches
- browse search query normalization/validation is centralized and contract-tested for consistent dispatch gating
- playback surface now includes explicit volume up/down and mute/unmute controls with request-id correlated command outcomes
- playback volume/mute target resolution is centralized in `playback-volume.ts` and contract-tested for clamp/step/toggle determinism
- playback surface now captures local control-feedback latency samples and reports p95 (`latency-summary.ts`) to prepare SLA evidence collection
- playback controls now use icon transport composition plus seek/volume sliders (CONCEPT parity direction) while keeping gateway command plumbing unchanged
- mobile small-screen nav now includes CONCEPT-style hamburger drawer (slide-out + overlay + close)
- home right-rail now reflects CONCEPT composition direction (`up next`, queue summary row, volume row, cast list)

## 9) Remaining completion gaps (before chunk close)

- attach playback evidence bundle in this doc:
  - run `npm run evidence:chunk02` in `apps/evo-ui-shell` to generate timestamped baseline report in `docs/evidence/`
  - update/check index at `docs/evidence/PLAYBACK_EVIDENCE_INDEX.md`
  - capture screenshots using `docs/evidence/PLAYBACK_SCREENSHOT_CHECKLIST.md`
  - fill benchmark run using `docs/evidence/PLAYBACK_BENCHMARK_TEMPLATE.md`
  - attach benchmark output aligned to `UI_PERFORMANCE_CONTRACT_V1.md` playback reflection target
- finalize chunk status transition to "completed" only after evidence pointers are linked in playbook/performance docs

Current attached drafts:

- mock benchmark draft: `docs/evidence/playback-benchmark-mock-2026-05-08.md`
- screenshot manifest draft: `docs/evidence/playback-screenshot-manifest-mock-2026-05-08.md`
- first-device cutover runbook: `docs/evidence/FIRST_DEVICE_CUTOVER_RUNBOOK.md`

## 10) Ready-now vs upstream-blocked split

Ready now (UI-owned, continue implementation):

- deterministic playback controls and capability gating (transport + volume/mute) with rollback-safe command outcomes
- local control-feedback latency sampling and percentile summary for engineering runs
- contract tests for playback pure policies and helper logic

Upstream-blocked (cannot close without core/plugin support):

- production-valid reflection latency benchmark against real gateway/event burst profiles
- final screenshots/evidence for ratified partial-support behavior where backend advertises constrained transport semantics
