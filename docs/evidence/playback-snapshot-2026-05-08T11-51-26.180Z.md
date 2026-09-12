# Playback Evidence Snapshot

Generated at: 2026-05-08T11:51:26.280Z  
Run mode: engineering (pass)  
Scope: UI-preparable evidence only

## Automated checks

- command: `node --experimental-strip-types --test tests/contracts/**/*.test.ts`
- pass: 52
- fail: 0
- duration_ms: 77.741561

## SLA note

This report validates UI-owned instrumentation and contract behavior.
It does not claim production SLA conformance until real gateway/core/plugin runs are attached.

## Attach manually

- [ ] screenshots (supported, partial, rollback error, stale/reconnecting)
- [ ] playback reflection benchmark output against live gateway profile
- [ ] hardware/runtime profile metadata
- [ ] pass/fail verdict mapped to `UI_PERFORMANCE_CONTRACT_V1.md`

## Raw test output

```text
TAP version 13
# Subtest: shouldRefreshFromAnomaly requires positive anomaly signal
ok 1 - shouldRefreshFromAnomaly requires positive anomaly signal
  ---
  duration_ms: 0.524236
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly blocks missing-capability surfaces
ok 2 - shouldRefreshFromAnomaly blocks missing-capability surfaces
  ---
  duration_ms: 0.095294
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly allows supported/partial surfaces
ok 3 - shouldRefreshFromAnomaly allows supported/partial surfaces
  ---
  duration_ms: 0.071787
  type: 'test'
  ...
# Subtest: getCapabilityStatus returns missing when payload/key absent
ok 4 - getCapabilityStatus returns missing when payload/key absent
  ---
  duration_ms: 0.418439
  type: 'test'
  ...
# Subtest: runBootstrap returns offline when gateway health is down
ok 5 - runBootstrap returns offline when gateway health is down
  ---
  duration_ms: 0.292178
  type: 'test'
  ...
# Subtest: runBootstrap returns degraded when required capability has gaps
ok 6 - runBootstrap returns degraded when required capability has gaps
  ---
  duration_ms: 0.12168
  type: 'test'
  ...
# Subtest: runBootstrap returns ready when health is ok and required capabilities are supported
ok 7 - runBootstrap returns ready when health is ok and required capabilities are supported
  ---
  duration_ms: 0.127387
  type: 'test'
  ...
# Subtest: runBootstrap returns offline retryable envelope on unexpected errors
ok 8 - runBootstrap returns offline retryable envelope on unexpected errors
  ---
  duration_ms: 0.143617
  type: 'test'
  ...
# Subtest: hasRequiredCapabilityGaps detects partial/missing required keys
ok 9 - hasRequiredCapabilityGaps detects partial/missing required keys
  ---
  duration_ms: 0.062212
  type: 'test'
  ...
# Subtest: resolveBootstrapPhase prioritizes health down and degrades on gaps
ok 10 - resolveBootstrapPhase prioritizes health down and degrades on gaps
  ---
  duration_ms: 0.101207
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns missing when all are missing
ok 11 - combineCapabilityStatuses returns missing when all are missing
  ---
  duration_ms: 0.538117
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns supported when all are supported
ok 12 - combineCapabilityStatuses returns supported when all are supported
  ---
  duration_ms: 0.092315
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns partial for mixed statuses
ok 13 - combineCapabilityStatuses returns partial for mixed statuses
  ---
  duration_ms: 0.162514
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses safely defaults to missing for empty list
ok 14 - combineCapabilityStatuses safely defaults to missing for empty list
  ---
  duration_ms: 0.067654
  type: 'test'
  ...
# Subtest: delivery channels expose expected order
ok 15 - delivery channels expose expected order
  ---
  duration_ms: 0.618876
  type: 'test'
  ...
# Subtest: isDeliveryChannel validates allowed values
ok 16 - isDeliveryChannel validates allowed values
  ---
  duration_ms: 0.088181
  type: 'test'
  ...
# Subtest: runCommandAction logs success with custom detail and invokes onFinally
ok 17 - runCommandAction logs success with custom detail and invokes onFinally
  ---
  duration_ms: 0.762006
  type: 'test'
  ...
# Subtest: runCommandAction logs failure and invokes rollback/finally hooks
ok 18 - runCommandAction logs failure and invokes rollback/finally hooks
  ---
  duration_ms: 0.11115
  type: 'test'
  ...
# Subtest: runCommandAction handles thrown execute errors as failure telemetry
ok 19 - runCommandAction handles thrown execute errors as failure telemetry
  ---
  duration_ms: 0.12085
  type: 'test'
  ...
# Subtest: summarizeCommandLog returns zeroed counters for empty list
ok 20 - summarizeCommandLog returns zeroed counters for empty list
  ---
  duration_ms: 0.648675
  type: 'test'
  ...
# Subtest: summarizeCommandLog counts successes and failures deterministically
ok 21 - summarizeCommandLog counts successes and failures deterministically
  ---
  duration_ms: 0.105276
  type: 'test'
  ...
# Subtest: parseCommandLogStorage returns empty for null/invalid payloads
ok 22 - parseCommandLogStorage returns empty for null/invalid payloads
  ---
  duration_ms: 0.866278
  type: 'test'
  ...
# Subtest: parseCommandLogStorage keeps only valid entries and respects max
ok 23 - parseCommandLogStorage keeps only valid entries and respects max
  ---
  duration_ms: 0.168758
  type: 'test'
  ...
# Subtest: serializeCommandLogStorage truncates by max entries
ok 24 - serializeCommandLogStorage truncates by max entries
  ---
  duration_ms: 0.100631
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns false at threshold boundary
ok 25 - shouldMarkSnapshotStale returns false at threshold boundary
  ---
  duration_ms: 0.548618
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns true above threshold
ok 26 - shouldMarkSnapshotStale returns true above threshold
  ---
  duration_ms: 0.113926
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns idle for zero and negative counts
ok 27 - formatInFlightSummary returns idle for zero and negative counts
  ---
  duration_ms: 0.532823
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns count text for positive counts
ok 28 - formatInFlightSummary returns count text for positive counts
  ---
  duration_ms: 0.096223
  type: 'test'
  ...
# Subtest: summarizeLatencyMs returns zero summary for empty input
ok 29 - summarizeLatencyMs returns zero summary for empty input
  ---
  duration_ms: 0.679551
  type: 'test'
  ...
# Subtest: summarizeLatencyMs ignores invalid samples and computes percentiles
ok 30 - summarizeLatencyMs ignores invalid samples and computes percentiles
  ---
  duration_ms: 0.11002
  type: 'test'
  ...
# Subtest: clampVolume clamps to 0..100 and handles non-finite values
ok 31 - clampVolume clamps to 0..100 and handles non-finite values
  ---
  duration_ms: 0.563895
  type: 'test'
  ...
# Subtest: nextVolumeFromDelta uses fallback baseline and step math
ok 32 - nextVolumeFromDelta uses fallback baseline and step math
  ---
  duration_ms: 0.105387
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume mutes when current volume is active
ok 33 - resolveMuteToggleVolume mutes when current volume is active
  ---
  duration_ms: 0.471242
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume restores remembered/default level from mute
ok 34 - resolveMuteToggleVolume restores remembered/default level from mute
  ---
  duration_ms: 0.099959
  type: 'test'
  ...
# Subtest: removeCurrentItem removes selected item and keeps valid index
ok 35 - removeCurrentItem removes selected item and keeps valid index
  ---
  duration_ms: 0.920105
  type: 'test'
  ...
# Subtest: removeCurrentItem nulls current index when queue becomes empty
ok 36 - removeCurrentItem nulls current index when queue becomes empty
  ---
  duration_ms: 0.10553
  type: 'test'
  ...
# Subtest: moveCurrentItemNext swaps current with next and advances current index
ok 37 - moveCurrentItemNext swaps current with next and advances current index
  ---
  duration_ms: 0.120272
  type: 'test'
  ...
# Subtest: moveCurrentItemNext keeps order stable when already at tail
ok 38 - moveCurrentItemNext keeps order stable when already at tail
  ---
  duration_ms: 0.092582
  type: 'test'
  ...
# Subtest: reconcile policy maps domain events deterministically
ok 39 - reconcile policy maps domain events deterministically
  ---
  duration_ms: 0.403085
  type: 'test'
  ...
# Subtest: appendCommandLogEntry prepends newest and respects max length
ok 40 - appendCommandLogEntry prepends newest and respects max length
  ---
  duration_ms: 0.11036
  type: 'test'
  ...
# Subtest: formatRequestId normalizes nullish values to n/a
ok 41 - formatRequestId normalizes nullish values to n/a
  ---
  duration_ms: 0.378978
  type: 'test'
  ...
# Subtest: formatRequestId preserves scalar values as strings
ok 42 - formatRequestId preserves scalar values as strings
  ---
  duration_ms: 0.06346
  type: 'test'
  ...
# Subtest: formatRequestDetail composes prefix with request id token
ok 43 - formatRequestDetail composes prefix with request id token
  ---
  duration_ms: 0.066111
  type: 'test'
  ...
# Subtest: normalizeSearchQuery trims leading and trailing whitespace
ok 44 - normalizeSearchQuery trims leading and trailing whitespace
  ---
  duration_ms: 0.525072
  type: 'test'
  ...
# Subtest: canRunSearch returns false for blank/whitespace queries
ok 45 - canRunSearch returns false for blank/whitespace queries
  ---
  duration_ms: 0.100854
  type: 'test'
  ...
# Subtest: canRunSearch returns true for non-empty normalized query
ok 46 - canRunSearch returns true for non-empty normalized query
  ---
  duration_ms: 0.067895
  type: 'test'
  ...
# Subtest: isKnownStreamEvent accepts known stream events
ok 47 - isKnownStreamEvent accepts known stream events
  ---
  duration_ms: 0.394541
  type: 'test'
  ...
# Subtest: isKnownStreamEvent rejects unknown/empty frames
ok 48 - isKnownStreamEvent rejects unknown/empty frames
  ---
  duration_ms: 0.075375
  type: 'test'
  ...
# Subtest: buildStreamNextState increments counters and tracks last event
ok 49 - buildStreamNextState increments counters and tracks last event
  ---
  duration_ms: 0.422283
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence gaps
ok 50 - buildStreamNextState counts sequence gaps
  ---
  duration_ms: 0.071499
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence regressions
ok 51 - buildStreamNextState counts sequence regressions
  ---
  duration_ms: 0.058622
  type: 'test'
  ...
# Subtest: buildStreamNextState preserves last seq when incoming frame has no seq
ok 52 - buildStreamNextState preserves last seq when incoming frame has no seq
  ---
  duration_ms: 0.083245
  type: 'test'
  ...
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 77.741561
```
