# Cutover Stage Progress Demo Runbook

Purpose: provide a deterministic demo script for progress meetings where each UI stream must show visible, operator-meaningful progress.

Scope: `evo-ui-shell` in first-device cutover mode, including mock-backed walkthrough (`?mock=1`) and gateway-ready behavior expectations.

## Demo setup

- Target URL (first device): `http://<device-ip>:8080/?mock=1`
- Build under test: latest cutover deployment symlink (`current`) on device.
- Runtime control plane: `systemd` unit `evo-ui.service` serving `/opt/evo/ui/current`
- Presenter context:
  - `CONCEPT` is the visual/layout source of truth.
  - `apps/evo-ui-shell` is the implementation stream.

Required operator permissions for demo lifecycle:

- sudo rights to manage `/opt/evo/ui` runtime files
- sudo rights for `systemctl` (`restart/status`) on `evo-ui.service`
- sudo rights for `journalctl -u evo-ui.service`

## Stream demo sequence

1. **Bootstrap and stream health**
   - show header state (`phase`, stream status)
   - open `Diagnostics` nav view
   - verify bootstrap metrics render (`health`, `capabilities`, seq counters)
   - expected: no crash on missing/partial capability keys

2. **Playback stream**
   - open `Home` nav view
   - run `play`, `pause`, `next`, `previous`
   - run `vol+`, `vol-`, `mute/unmute`
   - expected: command outcomes appear in command log with request-linked details

3. **Queue stream**
   - open `Library` nav view
   - remove current queue item and move current item next
   - expected: queue state updates coherently (current marker/index stays consistent)

4. **Browse/search stream**
   - open `Explore` nav view
   - run browse refresh and one search query
   - expected: search/browse capability gates and status hints remain explicit

5. **System stream (outputs/network)**
   - open `System` nav view
   - run output selection and network action (if capability allows)
   - expected: partial/missing capabilities remain safely constrained

6. **Operations/admin stream**
   - open `Operations` nav view
   - verify step-up required state
   - execute step-up, then run one privileged action each:
     - log level change
     - diagnostics bundle request
     - update channel change
     - plugin enable/disable (or remove when policy allows)
     - SSH enable/disable
   - expected: policy hints visible; privileged actions blocked without active step-up

7. **Diagnostics stream**
   - return to `Diagnostics` nav view
   - export command log
   - expected: timeline demonstrates all stream actions and outcomes

## Evidence to attach after demo

- Contract test output report:
  - `docs/evidence/playback-snapshot-*.md`
- Playback evidence index:
  - `docs/evidence/PLAYBACK_EVIDENCE_INDEX.md`
- Screenshot checklist:
  - `docs/evidence/PLAYBACK_SCREENSHOT_CHECKLIST.md`
- Benchmark template:
  - `docs/evidence/PLAYBACK_BENCHMARK_TEMPLATE.md`
- First-device cutover checklist:
  - `docs/evidence/FIRST_DEVICE_CUTOVER_RUNBOOK.md`

## Presenter one-liner per stream

- Bootstrap: capability-first startup with explicit degraded semantics.
- Playback: transport + volume/mute controls with command traceability.
- Queue: optimistic queue mutation with coherent current index handling.
- Browse: browse/search gating and deterministic refresh behavior.
- System: output/network controls constrained by capability status.
- Operations: step-up protected admin plane with policy-aware plugin actions.
- Diagnostics: exportable command/outcome evidence for review and audit.

## Cutover stage status framing

- **Demo-ready now**: UI behavior, layout/navigation alignment to `CONCEPT`, mock-backed stream walkthrough, command/evidence traceability.
- **Pending live completion**: live gateway performance benchmarks and first-device screenshot set against non-mock runtime.
