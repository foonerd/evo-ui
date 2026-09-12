# Playback Benchmark Template

Fill this template for each playback benchmark run.
Use one file per run and link it from the corresponding `playback-snapshot-*.md` evidence report.

## Run identity

- run id:
- date/time (UTC):
- mode: `mock` | `live`
- branch:
- commit:
- operator:

## Hardware/runtime profile

- device class:
- CPU:
- RAM:
- OS/kernel:
- browser/runtime:
- display refresh rate:

## Event profile

- stream source:
- burst rate target (events/sec):
- burst duration:
- total run duration:
- event mix notes:

## Playback reflection metrics

- p50 (ms):
- p95 (ms):
- p99 (ms):
- max (ms):
- sample count:

## Reconnect and freshness

- reconnect convergence (ms):
- stale transitions observed:
- reconnecting transitions observed:
- freshness mismatch incidents:

## Stress behavior

- long-task count (>100ms):
- max long-task duration (ms):
- dropped/coalesced event count:
- memory trend notes:

## SLA verdict (`UI_PERFORMANCE_CONTRACT_V1.md`)

- critical reflection p95 < 50 ms: pass/fail
- critical control feedback p95 < 80 ms: pass/fail
- reconnect convergence < 1000 ms: pass/fail
- freshness semantics visible and correct: pass/fail

## Artifacts

- raw benchmark output path:
- screenshots path:
- related evidence report path:

## Notes

- blockers:
- follow-up actions:
