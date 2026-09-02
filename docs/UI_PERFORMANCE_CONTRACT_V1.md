# UI Performance Contract v1

Status: Draft  
Scope: this workspace's implementation and validation  
Purpose: ensure UI performance class matches evo framework responsiveness expectations

## 1) Performance intent

The UI is not a passive dashboard. It is a real-time consumer of high-frequency state updates and must remain responsive across hardware tiers (from constrained devices to server-class systems).

## 2) Hardware-tier rule

Behavioral semantics are invariant across tiers:

- no silent lag
- no stale state presented as fresh
- no control-path lockups under event burst

Visual fidelity may degrade by profile, but interaction correctness and freshness semantics must not.

## 3) SLA targets

## 3.1 Ingestion and reconcile

- Burst ingestion survivability: `>= 10,000 events/sec` equivalent burst without UI deadlock.
- Stream reconnect to stable live state: `< 1,000 ms` after transport recovery.

## 3.2 State-to-UI reflection

- Critical surface reflection p95 (transport state, active item, volume/status): `< 50 ms`
- Non-critical surface reflection p95 (queue/browse panels): `< 150 ms`
- Critical control action feedback p95 (button press to visible state transition): `< 80 ms`

## 3.3 Runtime behavior under stress

- No main-thread freeze longer than `100 ms` during burst processing.
- No unbounded memory growth during sustained event streams.

## 4) Freshness semantics (mandatory)

Every real-time view must expose freshness state:

- `fresh` (within SLA)
- `stale` (SLA breached or source lag detected)
- `reconnecting` (stream unavailable/recovering)

UI must never show stale data without stale signaling.

## 5) Engineering constraints

- Use snapshot + delta reconcile (no polling-only correctness model).
- Apply event coalescing and view-priority update policy.
- Avoid full-tree rerenders for event bursts (selector-based updates).
- Keep control paths independent from heavy non-critical rendering.

## 6) Measurement method

For each benchmark run, capture:

- hardware profile and runtime mode
- event rate, burst shape, duration
- p50/p95/p99 for reflection latency
- reconnect convergence time
- dropped/coalesced event counts
- main-thread long-task count and max duration

Artifacts required:

- raw benchmark output
- summarized report
- pass/fail verdict per SLA line

Interim engineering mode (before full core/plugin implementation is available):

- UI may capture local control-feedback samples (button interaction to visible command outcome) as preparatory evidence.
- Such interim samples are for instrumentation validation only and do not replace final SLA conformance runs.

## 7) Release gate usage

No release candidate for reference UI may be marked "Go" if:

- any critical p95 SLA is not met, or
- freshness semantics are missing on critical surfaces, or
- reconnect convergence exceeds SLA for target profile.

## 8) Follow-on

This contract is v1 baseline and should be revised with measured data from first implementation slices (bootstrap, playback, queue).
