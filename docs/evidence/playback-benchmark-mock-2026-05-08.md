# Playback Benchmark Run (Mock) — 2026-05-08

## Run identity

- run id: `playback-mock-2026-05-08`
- date/time (UTC): `2026-05-08T11:51:51.180Z`
- mode: `mock`
- branch: `main`
- commit: `a71b4a5` (pre-alignment checkpoint)
- operator: `codex`

## Hardware/runtime profile

- device class: development workstation (sandboxed)
- CPU: n/a
- RAM: n/a
- OS/kernel: Linux 6.17.0-23-generic
- browser/runtime: node test runtime (no browser benchmark capture in this run)
- display refresh rate: n/a

## Event profile

- stream source: mock gateway fixtures
- burst rate target (events/sec): n/a (not exercised in this run)
- burst duration: n/a
- total run duration: `78.114898 ms` (contract suite duration)
- event mix notes: contract tests only; no live websocket burst replay

## Playback reflection metrics

- p50 (ms): pending first-device browser capture
- p95 (ms): pending first-device browser capture
- p99 (ms): pending first-device browser capture
- max (ms): pending first-device browser capture
- sample count: pending first-device browser capture

## Reconnect and freshness

- reconnect convergence (ms): pending first-device run
- stale transitions observed: pending first-device run
- reconnecting transitions observed: pending first-device run
- freshness mismatch incidents: none observed in contract run

## Stress behavior

- long-task count (>100ms): pending browser profile capture
- max long-task duration (ms): pending browser profile capture
- dropped/coalesced event count: pending stream replay harness
- memory trend notes: pending first-device run

## SLA verdict (`UI_PERFORMANCE_CONTRACT_V1.md`)

- critical reflection p95 < 50 ms: pending live capture
- critical control feedback p95 < 80 ms: pending live capture
- reconnect convergence < 1000 ms: pending live capture
- freshness semantics visible and correct: partial pass (contract/instrumentation validated; live capture pending)

## Artifacts

- raw benchmark output path: `docs/evidence/playback-snapshot-2026-05-08T11-51-51.078Z.md`
- screenshots path: `docs/evidence/screenshots/playback/` (pending population)
- related evidence report path: `docs/evidence/playback-snapshot-2026-05-08T11-51-51.078Z.md`

## Notes

- blockers: npm/browser runtime unavailable in this environment for screenshot and browser-latency capture.
- follow-up actions: execute first-device cutover runbook and attach live benchmark values.
