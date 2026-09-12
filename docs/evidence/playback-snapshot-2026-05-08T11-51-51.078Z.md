# Playback Evidence Snapshot

Generated at: 2026-05-08T11:51:51.180Z  
Run mode: engineering (pass)  
Scope: UI-preparable evidence only

## Automated checks

- command: `node --experimental-strip-types --test tests/contracts/**/*.test.ts`
- pass: 52
- fail: 0
- duration_ms: 78.114898

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
  duration_ms: 0.562339
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly blocks missing-capability surfaces
ok 2 - shouldRefreshFromAnomaly blocks missing-capability surfaces
  ---
  duration_ms: 0.099805
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly allows supported/partial surfaces
ok 3 - shouldRefreshFromAnomaly allows supported/partial surfaces
  ---
  duration_ms: 0.077416
  type: 'test'
  ...
# Subtest: getCapabilityStatus returns missing when payload/key absent
ok 4 - getCapabilityStatus returns missing when payload/key absent
  ---
  duration_ms: 0.574278
  type: 'test'
  ...
# Subtest: runBootstrap returns offline when gateway health is down
ok 5 - runBootstrap returns offline when gateway health is down
  ---
  duration_ms: 0.392955
  type: 'test'
  ...
# Subtest: runBootstrap returns degraded when required capability has gaps
ok 6 - runBootstrap returns degraded when required capability has gaps
  ---
  duration_ms: 0.166352
  type: 'test'
  ...
# Subtest: runBootstrap returns ready when health is ok and required capabilities are supported
ok 7 - runBootstrap returns ready when health is ok and required capabilities are supported
  ---
  duration_ms: 0.170475
  type: 'test'
  ...
# Subtest: runBootstrap returns offline retryable envelope on unexpected errors
ok 8 - runBootstrap returns offline retryable envelope on unexpected errors
  ---
  duration_ms: 0.199305
  type: 'test'
  ...
# Subtest: hasRequiredCapabilityGaps detects partial/missing required keys
ok 9 - hasRequiredCapabilityGaps detects partial/missing required keys
  ---
  duration_ms: 0.090053
  type: 'test'
  ...
# Subtest: resolveBootstrapPhase prioritizes health down and degrades on gaps
ok 10 - resolveBootstrapPhase prioritizes health down and degrades on gaps
  ---
  duration_ms: 0.145323
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns missing when all are missing
ok 11 - combineCapabilityStatuses returns missing when all are missing
  ---
  duration_ms: 0.529482
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns supported when all are supported
ok 12 - combineCapabilityStatuses returns supported when all are supported
  ---
  duration_ms: 0.099861
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns partial for mixed statuses
ok 13 - combineCapabilityStatuses returns partial for mixed statuses
  ---
  duration_ms: 0.071917
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses safely defaults to missing for empty list
ok 14 - combineCapabilityStatuses safely defaults to missing for empty list
  ---
  duration_ms: 0.061965
  type: 'test'
  ...
# Subtest: delivery channels expose expected order
ok 15 - delivery channels expose expected order
  ---
  duration_ms: 0.612703
  type: 'test'
  ...
# Subtest: isDeliveryChannel validates allowed values
ok 16 - isDeliveryChannel validates allowed values
  ---
  duration_ms: 0.085196
  type: 'test'
  ...
# Subtest: runCommandAction logs success with custom detail and invokes onFinally
ok 17 - runCommandAction logs success with custom detail and invokes onFinally
  ---
  duration_ms: 0.981128
  type: 'test'
  ...
# Subtest: runCommandAction logs failure and invokes rollback/finally hooks
ok 18 - runCommandAction logs failure and invokes rollback/finally hooks
  ---
  duration_ms: 0.173674
  type: 'test'
  ...
# Subtest: runCommandAction handles thrown execute errors as failure telemetry
ok 19 - runCommandAction handles thrown execute errors as failure telemetry
  ---
  duration_ms: 0.178625
  type: 'test'
  ...
# Subtest: summarizeCommandLog returns zeroed counters for empty list
ok 20 - summarizeCommandLog returns zeroed counters for empty list
  ---
  duration_ms: 0.899934
  type: 'test'
  ...
# Subtest: summarizeCommandLog counts successes and failures deterministically
ok 21 - summarizeCommandLog counts successes and failures deterministically
  ---
  duration_ms: 0.168084
  type: 'test'
  ...
# Subtest: parseCommandLogStorage returns empty for null/invalid payloads
ok 22 - parseCommandLogStorage returns empty for null/invalid payloads
  ---
  duration_ms: 0.861573
  type: 'test'
  ...
# Subtest: parseCommandLogStorage keeps only valid entries and respects max
ok 23 - parseCommandLogStorage keeps only valid entries and respects max
  ---
  duration_ms: 0.177461
  type: 'test'
  ...
# Subtest: serializeCommandLogStorage truncates by max entries
ok 24 - serializeCommandLogStorage truncates by max entries
  ---
  duration_ms: 0.099849
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns false at threshold boundary
ok 25 - shouldMarkSnapshotStale returns false at threshold boundary
  ---
  duration_ms: 0.542845
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns true above threshold
ok 26 - shouldMarkSnapshotStale returns true above threshold
  ---
  duration_ms: 0.114473
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns idle for zero and negative counts
ok 27 - formatInFlightSummary returns idle for zero and negative counts
  ---
  duration_ms: 0.378953
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns count text for positive counts
ok 28 - formatInFlightSummary returns count text for positive counts
  ---
  duration_ms: 0.064228
  type: 'test'
  ...
# Subtest: summarizeLatencyMs returns zero summary for empty input
ok 29 - summarizeLatencyMs returns zero summary for empty input
  ---
  duration_ms: 0.900634
  type: 'test'
  ...
# Subtest: summarizeLatencyMs ignores invalid samples and computes percentiles
ok 30 - summarizeLatencyMs ignores invalid samples and computes percentiles
  ---
  duration_ms: 0.163754
  type: 'test'
  ...
# Subtest: clampVolume clamps to 0..100 and handles non-finite values
ok 31 - clampVolume clamps to 0..100 and handles non-finite values
  ---
  duration_ms: 0.56824
  type: 'test'
  ...
# Subtest: nextVolumeFromDelta uses fallback baseline and step math
ok 32 - nextVolumeFromDelta uses fallback baseline and step math
  ---
  duration_ms: 0.118808
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume mutes when current volume is active
ok 33 - resolveMuteToggleVolume mutes when current volume is active
  ---
  duration_ms: 0.432116
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume restores remembered/default level from mute
ok 34 - resolveMuteToggleVolume restores remembered/default level from mute
  ---
  duration_ms: 0.088886
  type: 'test'
  ...
# Subtest: removeCurrentItem removes selected item and keeps valid index
ok 35 - removeCurrentItem removes selected item and keeps valid index
  ---
  duration_ms: 0.68791
  type: 'test'
  ...
# Subtest: removeCurrentItem nulls current index when queue becomes empty
ok 36 - removeCurrentItem nulls current index when queue becomes empty
  ---
  duration_ms: 0.075879
  type: 'test'
  ...
# Subtest: moveCurrentItemNext swaps current with next and advances current index
ok 37 - moveCurrentItemNext swaps current with next and advances current index
  ---
  duration_ms: 0.08667
  type: 'test'
  ...
# Subtest: moveCurrentItemNext keeps order stable when already at tail
ok 38 - moveCurrentItemNext keeps order stable when already at tail
  ---
  duration_ms: 0.065492
  type: 'test'
  ...
# Subtest: reconcile policy maps domain events deterministically
ok 39 - reconcile policy maps domain events deterministically
  ---
  duration_ms: 0.400992
  type: 'test'
  ...
# Subtest: appendCommandLogEntry prepends newest and respects max length
ok 40 - appendCommandLogEntry prepends newest and respects max length
  ---
  duration_ms: 0.113326
  type: 'test'
  ...
# Subtest: formatRequestId normalizes nullish values to n/a
ok 41 - formatRequestId normalizes nullish values to n/a
  ---
  duration_ms: 0.382043
  type: 'test'
  ...
# Subtest: formatRequestId preserves scalar values as strings
ok 42 - formatRequestId preserves scalar values as strings
  ---
  duration_ms: 0.063307
  type: 'test'
  ...
# Subtest: formatRequestDetail composes prefix with request id token
ok 43 - formatRequestDetail composes prefix with request id token
  ---
  duration_ms: 0.057185
  type: 'test'
  ...
# Subtest: normalizeSearchQuery trims leading and trailing whitespace
ok 44 - normalizeSearchQuery trims leading and trailing whitespace
  ---
  duration_ms: 0.372647
  type: 'test'
  ...
# Subtest: canRunSearch returns false for blank/whitespace queries
ok 45 - canRunSearch returns false for blank/whitespace queries
  ---
  duration_ms: 0.066122
  type: 'test'
  ...
# Subtest: canRunSearch returns true for non-empty normalized query
ok 46 - canRunSearch returns true for non-empty normalized query
  ---
  duration_ms: 0.053864
  type: 'test'
  ...
# Subtest: isKnownStreamEvent accepts known stream events
ok 47 - isKnownStreamEvent accepts known stream events
  ---
  duration_ms: 0.394808
  type: 'test'
  ...
# Subtest: isKnownStreamEvent rejects unknown/empty frames
ok 48 - isKnownStreamEvent rejects unknown/empty frames
  ---
  duration_ms: 0.070435
  type: 'test'
  ...
# Subtest: buildStreamNextState increments counters and tracks last event
ok 49 - buildStreamNextState increments counters and tracks last event
  ---
  duration_ms: 0.404438
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence gaps
ok 50 - buildStreamNextState counts sequence gaps
  ---
  duration_ms: 0.073269
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence regressions
ok 51 - buildStreamNextState counts sequence regressions
  ---
  duration_ms: 0.057073
  type: 'test'
  ...
# Subtest: buildStreamNextState preserves last seq when incoming frame has no seq
ok 52 - buildStreamNextState preserves last seq when incoming frame has no seq
  ---
  duration_ms: 0.081112
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
# duration_ms 78.114898
```
