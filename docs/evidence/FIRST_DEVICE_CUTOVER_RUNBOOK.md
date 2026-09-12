# First-Device Cutover Runbook — Playback Baseline

Purpose: execute a deterministic first-device playback cutover check with evidence capture.

## Preconditions

- target device is reachable
- UI gateway endpoint available
- build under test identified (branch + commit)
- operator has access to step-up credentials for privileged checks (if included in run)
- UI runtime service is installed and managed as `evo-ui.service`
- operator has required sudo rights for runtime lifecycle (`systemctl`, `/opt/evo/ui` writes, `journalctl`)

## Sequence

1. **Bootstrap**
   - open UI shell
   - verify phase transitions to `ready` or explicit `degraded`
   - verify capability list renders without unknown-key crashes

2. **Playback baseline**
   - trigger `play`, `pause`, `stop`, `next`, `previous`
   - trigger `vol+`, `vol-`, `mute/unmute`
   - verify command log contains request-correlated outcomes

3. **Freshness states**
   - verify `fresh` state after snapshot load
   - simulate stream interruption to observe `reconnecting` and `stale`
   - verify no stale data is presented as fresh

4. **Error and rollback path**
   - induce one command failure
   - verify explicit error hint and coherent playback snapshot after reconcile

5. **Evidence capture**
   - run `node scripts/chunk02-evidence.mjs`
   - capture screenshots per `PLAYBACK_SCREENSHOT_CHECKLIST.md`
   - attach benchmark run using `PLAYBACK_BENCHMARK_TEMPLATE.md`

## Cutover gate

- [ ] contract tests passing
- [ ] playback command outcomes visible and correlated
- [ ] freshness transitions validated
- [ ] rollback/error scenario validated
- [ ] evidence report, screenshot manifest, and benchmark run attached

## Escalation notes

- If capability flags do not match expected surface state, stop cutover and file a contract mismatch.
- If playback reflection misses SLA targets, keep cutover in `degraded showcase` mode until performance investigation lands.
