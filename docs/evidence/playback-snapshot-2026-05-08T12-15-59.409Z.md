# Playback Evidence Snapshot

Generated at: 2026-05-08T12:15:59.517Z  
Run mode: engineering (pass)  
Scope: UI-preparable evidence only

## Automated checks

- command: `node --experimental-strip-types --test tests/contracts/**/*.test.ts`
- pass: 59
- fail: 0
- duration_ms: 85.400028

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
  duration_ms: 0.526706
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly blocks missing-capability surfaces
ok 2 - shouldRefreshFromAnomaly blocks missing-capability surfaces
  ---
  duration_ms: 0.098377
  type: 'test'
  ...
# Subtest: shouldRefreshFromAnomaly allows supported/partial surfaces
ok 3 - shouldRefreshFromAnomaly allows supported/partial surfaces
  ---
  duration_ms: 0.071521
  type: 'test'
  ...
# Subtest: getCapabilityStatus returns missing when payload/key absent
ok 4 - getCapabilityStatus returns missing when payload/key absent
  ---
  duration_ms: 0.421564
  type: 'test'
  ...
# Subtest: runBootstrap returns offline when gateway health is down
ok 5 - runBootstrap returns offline when gateway health is down
  ---
  duration_ms: 0.290041
  type: 'test'
  ...
# Subtest: runBootstrap returns degraded when required capability has gaps
ok 6 - runBootstrap returns degraded when required capability has gaps
  ---
  duration_ms: 0.125539
  type: 'test'
  ...
# Subtest: runBootstrap returns ready when health is ok and required capabilities are supported
ok 7 - runBootstrap returns ready when health is ok and required capabilities are supported
  ---
  duration_ms: 0.127279
  type: 'test'
  ...
# Subtest: runBootstrap returns offline retryable envelope on unexpected errors
ok 8 - runBootstrap returns offline retryable envelope on unexpected errors
  ---
  duration_ms: 0.149638
  type: 'test'
  ...
# Subtest: hasRequiredCapabilityGaps detects partial/missing required keys
ok 9 - hasRequiredCapabilityGaps detects partial/missing required keys
  ---
  duration_ms: 0.068503
  type: 'test'
  ...
# Subtest: resolveBootstrapPhase prioritizes health down and degrades on gaps
ok 10 - resolveBootstrapPhase prioritizes health down and degrades on gaps
  ---
  duration_ms: 0.105743
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns missing when all are missing
ok 11 - combineCapabilityStatuses returns missing when all are missing
  ---
  duration_ms: 0.562112
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns supported when all are supported
ok 12 - combineCapabilityStatuses returns supported when all are supported
  ---
  duration_ms: 0.108525
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses returns partial for mixed statuses
ok 13 - combineCapabilityStatuses returns partial for mixed statuses
  ---
  duration_ms: 0.073628
  type: 'test'
  ...
# Subtest: combineCapabilityStatuses safely defaults to missing for empty list
ok 14 - combineCapabilityStatuses safely defaults to missing for empty list
  ---
  duration_ms: 0.06603
  type: 'test'
  ...
# Subtest: delivery channels expose expected order
ok 15 - delivery channels expose expected order
  ---
  duration_ms: 0.840248
  type: 'test'
  ...
# Subtest: isDeliveryChannel validates allowed values
ok 16 - isDeliveryChannel validates allowed values
  ---
  duration_ms: 0.125394
  type: 'test'
  ...
# Subtest: runCommandAction logs success with custom detail and invokes onFinally
ok 17 - runCommandAction logs success with custom detail and invokes onFinally
  ---
  duration_ms: 0.724393
  type: 'test'
  ...
# Subtest: runCommandAction logs failure and invokes rollback/finally hooks
ok 18 - runCommandAction logs failure and invokes rollback/finally hooks
  ---
  duration_ms: 0.108907
  type: 'test'
  ...
# Subtest: runCommandAction handles thrown execute errors as failure telemetry
ok 19 - runCommandAction handles thrown execute errors as failure telemetry
  ---
  duration_ms: 0.117695
  type: 'test'
  ...
# Subtest: summarizeCommandLog returns zeroed counters for empty list
ok 20 - summarizeCommandLog returns zeroed counters for empty list
  ---
  duration_ms: 0.872185
  type: 'test'
  ...
# Subtest: summarizeCommandLog counts successes and failures deterministically
ok 21 - summarizeCommandLog counts successes and failures deterministically
  ---
  duration_ms: 0.158617
  type: 'test'
  ...
# Subtest: parseCommandLogStorage returns empty for null/invalid payloads
ok 22 - parseCommandLogStorage returns empty for null/invalid payloads
  ---
  duration_ms: 0.877346
  type: 'test'
  ...
# Subtest: parseCommandLogStorage keeps only valid entries and respects max
ok 23 - parseCommandLogStorage keeps only valid entries and respects max
  ---
  duration_ms: 0.179586
  type: 'test'
  ...
# Subtest: serializeCommandLogStorage truncates by max entries
ok 24 - serializeCommandLogStorage truncates by max entries
  ---
  duration_ms: 0.111324
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns false at threshold boundary
ok 25 - shouldMarkSnapshotStale returns false at threshold boundary
  ---
  duration_ms: 0.543728
  type: 'test'
  ...
# Subtest: shouldMarkSnapshotStale returns true above threshold
ok 26 - shouldMarkSnapshotStale returns true above threshold
  ---
  duration_ms: 0.107541
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns idle for zero and negative counts
ok 27 - formatInFlightSummary returns idle for zero and negative counts
  ---
  duration_ms: 0.503514
  type: 'test'
  ...
# Subtest: formatInFlightSummary returns count text for positive counts
ok 28 - formatInFlightSummary returns count text for positive counts
  ---
  duration_ms: 0.08545
  type: 'test'
  ...
# Subtest: summarizeLatencyMs returns zero summary for empty input
ok 29 - summarizeLatencyMs returns zero summary for empty input
  ---
  duration_ms: 1.025237
  type: 'test'
  ...
# Subtest: summarizeLatencyMs ignores invalid samples and computes percentiles
ok 30 - summarizeLatencyMs ignores invalid samples and computes percentiles
  ---
  duration_ms: 0.120444
  type: 'test'
  ...
# Subtest: canRunPrivilegedOperation requires non-missing capability and active step-up
ok 31 - canRunPrivilegedOperation requires non-missing capability and active step-up
  ---
  duration_ms: 0.52608
  type: 'test'
  ...
# Subtest: needsStepUpReauth detects privileged-session failures
ok 32 - needsStepUpReauth detects privileged-session failures
  ---
  duration_ms: 0.098221
  type: 'test'
  ...
# Subtest: clampVolume clamps to 0..100 and handles non-finite values
ok 33 - clampVolume clamps to 0..100 and handles non-finite values
  ---
  duration_ms: 0.388466
  type: 'test'
  ...
# Subtest: nextVolumeFromDelta uses fallback baseline and step math
ok 34 - nextVolumeFromDelta uses fallback baseline and step math
  ---
  duration_ms: 0.07074
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume mutes when current volume is active
ok 35 - resolveMuteToggleVolume mutes when current volume is active
  ---
  duration_ms: 0.33059
  type: 'test'
  ...
# Subtest: resolveMuteToggleVolume restores remembered/default level from mute
ok 36 - resolveMuteToggleVolume restores remembered/default level from mute
  ---
  duration_ms: 0.06456
  type: 'test'
  ...
# Subtest: canRemovePlugin blocks bundled and allows admitted plugins
ok 37 - canRemovePlugin blocks bundled and allows admitted plugins
  ---
  duration_ms: 0.532242
  type: 'test'
  ...
# Subtest: pluginPolicyHint explains key policy outcomes
ok 38 - pluginPolicyHint explains key policy outcomes
  ---
  duration_ms: 0.131692
  type: 'test'
  ...
# Subtest: removeCurrentItem removes selected item and keeps valid index
ok 39 - removeCurrentItem removes selected item and keeps valid index
  ---
  duration_ms: 0.685568
  type: 'test'
  ...
# Subtest: removeCurrentItem nulls current index when queue becomes empty
ok 40 - removeCurrentItem nulls current index when queue becomes empty
  ---
  duration_ms: 0.072166
  type: 'test'
  ...
# Subtest: moveCurrentItemNext swaps current with next and advances current index
ok 41 - moveCurrentItemNext swaps current with next and advances current index
  ---
  duration_ms: 0.09419
  type: 'test'
  ...
# Subtest: moveCurrentItemNext keeps order stable when already at tail
ok 42 - moveCurrentItemNext keeps order stable when already at tail
  ---
  duration_ms: 0.06894
  type: 'test'
  ...
# Subtest: reconcile policy maps domain events deterministically
ok 43 - reconcile policy maps domain events deterministically
  ---
  duration_ms: 0.415513
  type: 'test'
  ...
# Subtest: appendCommandLogEntry prepends newest and respects max length
ok 44 - appendCommandLogEntry prepends newest and respects max length
  ---
  duration_ms: 0.117431
  type: 'test'
  ...
# Subtest: formatRequestId normalizes nullish values to n/a
ok 45 - formatRequestId normalizes nullish values to n/a
  ---
  duration_ms: 0.525524
  type: 'test'
  ...
# Subtest: formatRequestId preserves scalar values as strings
ok 46 - formatRequestId preserves scalar values as strings
  ---
  duration_ms: 0.096436
  type: 'test'
  ...
# Subtest: formatRequestDetail composes prefix with request id token
ok 47 - formatRequestDetail composes prefix with request id token
  ---
  duration_ms: 0.081365
  type: 'test'
  ...
# Subtest: normalizeSearchQuery trims leading and trailing whitespace
ok 48 - normalizeSearchQuery trims leading and trailing whitespace
  ---
  duration_ms: 0.495436
  type: 'test'
  ...
# Subtest: canRunSearch returns false for blank/whitespace queries
ok 49 - canRunSearch returns false for blank/whitespace queries
  ---
  duration_ms: 0.085958
  type: 'test'
  ...
# Subtest: canRunSearch returns true for non-empty normalized query
ok 50 - canRunSearch returns true for non-empty normalized query
  ---
  duration_ms: 0.072219
  type: 'test'
  ...
# Subtest: isStepUpSessionActive returns false for null or malformed sessions
ok 51 - isStepUpSessionActive returns false for null or malformed sessions
  ---
  duration_ms: 0.427135
  type: 'test'
  ...
# Subtest: isStepUpSessionActive returns true only before expiry
ok 52 - isStepUpSessionActive returns true only before expiry
  ---
  duration_ms: 0.075502
  type: 'test'
  ...
# Subtest: getStepUpRemainingSeconds clamps at zero
ok 53 - getStepUpRemainingSeconds clamps at zero
  ---
  duration_ms: 0.075424
  type: 'test'
  ...
# Subtest: isKnownStreamEvent accepts known stream events
ok 54 - isKnownStreamEvent accepts known stream events
  ---
  duration_ms: 0.400008
  type: 'test'
  ...
# Subtest: isKnownStreamEvent rejects unknown/empty frames
ok 55 - isKnownStreamEvent rejects unknown/empty frames
  ---
  duration_ms: 0.078548
  type: 'test'
  ...
# Subtest: buildStreamNextState increments counters and tracks last event
ok 56 - buildStreamNextState increments counters and tracks last event
  ---
  duration_ms: 0.573626
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence gaps
ok 57 - buildStreamNextState counts sequence gaps
  ---
  duration_ms: 0.110851
  type: 'test'
  ...
# Subtest: buildStreamNextState counts sequence regressions
ok 58 - buildStreamNextState counts sequence regressions
  ---
  duration_ms: 0.087798
  type: 'test'
  ...
# Subtest: buildStreamNextState preserves last seq when incoming frame has no seq
ok 59 - buildStreamNextState preserves last seq when incoming frame has no seq
  ---
  duration_ms: 0.115721
  type: 'test'
  ...
1..59
# tests 59
# suites 0
# pass 59
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 85.400028
```
