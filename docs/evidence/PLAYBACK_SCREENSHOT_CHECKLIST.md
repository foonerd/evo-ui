# Playback Screenshot Checklist

Use this checklist for repeatable playback evidence capture.
Run against `?mock=1` for UI-preparable proof, then re-run against live gateway when available.

## Capture metadata (required per screenshot set)

- capture date/time (UTC)
- runtime mode (`mock` or `live`)
- build/ref (`branch`, commit hash if available)
- operator name/initials

## Required scenes

- `PB-SS-001 ready-supported`
  - playback surface visible
  - stream open
  - freshness = `fresh`
  - at least one successful transport action visible in command log

- `PB-SS-002 partial-support`
  - capability state reflects partial constraints
  - constrained controls visible as disabled with explanatory hint

- `PB-SS-003 rollback-error`
  - failed playback command visible (error hint and command-log fail entry)
  - snapshot remains coherent after rollback/reconcile

- `PB-SS-004 stale-reconnecting`
  - stale or reconnecting freshness state visible
  - stream not open (or explicit reconnect reason shown)

## Naming convention

Use filenames:

- `playback-<scene-id>-<mode>-<yyyyMMdd-HHmmss>.png`

Examples:

- `playback-PB-SS-001-mock-20260508-125700.png`
- `playback-PB-SS-004-live-20260509-091530.png`

## Storage

- store files under `docs/evidence/screenshots/playback/`
- append captured filenames to the latest `playback-snapshot-*.md` report
