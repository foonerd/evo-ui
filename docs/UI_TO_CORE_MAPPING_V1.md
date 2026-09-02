# UI to Core Mapping v1

Status: Draft  
Owner: UI Runtime owner

## 1) Purpose

Defines exact mapping from UI API operations to `evo-core` client ops and plugin request surfaces.

## 2) Mapping Table

| UI API operation | Core op(s) | Plugin/request dependency | Notes |
| --- | --- | --- | --- |
| `GET /playback/state` | `list_active_custodies`, `project_subject` | playback warden state + subject projections | Snapshot compose in UI runtime |
| `POST /playback/command` | `request` (where available) and/or custody control path | playback domain surface | Needs ratified command mapping contract |
| `GET /queue` | `project_subject`/state snapshot path | playback domain surface | Missing canonical queue contract in references |
| `POST /queue/*` | `request` | playback domain surface | Requires queue verbs in domain contract |
| `GET /browse` | `project_subject`, `project_rack`, `request` | metadata/artwork/domain browse plugin surfaces | Missing canonical browse contract |
| `GET /search` | `request` or projection index surface | domain search surface | Missing canonical search contract |
| `POST /metadata/query` | `request` | `metadata.query` | Available |
| `POST /artwork/resolve` | `request` | `artwork.resolve` | Available |
| `GET /outputs` | `project_rack` + domain request | output/composition surface | Missing canonical output-selection API |
| `POST /outputs/select` | `request` | output domain request surface | Missing ratified request type |
| `GET /network/status` | `request` | `network.nm.status` | Available |
| `POST /network/request` | `request` | `network.nm.*` | Available |
| WS replay/resume | `subscribe_happenings` (+ `since`) | n/a | Available from core |

## 3) Non-negotiable Mapping Rules

- UI runtime may compose/reshape responses for UI ergonomics.
- UI runtime may not invent domain state transitions.
- Every state-changing UI action must resolve to explicit core/plugin contract operation.
- If no mapping exists, operation is `blocked` (not silently mocked in production).

## 4) Confirmed Gaps

- No ratified playback command-to-domain mapping for full UI transport set.
- No ratified queue CRUD contract.
- No ratified browse/search contract.
- No ratified output selection contract.

## 5) Scale Plan for 20+ Plugins

The table above covers current core domains only. For additional plugins, mappings must be registered in a predictable, auditable way.

### 5.1 Mapping row requirements (per UI action)

Every action must record:

- `ui_operation`
- `runtime_handler`
- `core_ops[]`
- `request_type` (if used)
- `plugin_id`
- `domain`
- `idempotency` (`yes`/`no`)
- `timeout_ms`
- `retry_policy`
- `owner`
- `status` (`proposed`, `ratified`, `deprecated`)

### 5.2 Per-plugin mapping annex

For each plugin surfaced to UI, create:

- `UI_TO_CORE_MAPPING_V1_PLUGIN_<plugin_id>.md`

This avoids one oversized mapping doc and allows independent ratification.

### 5.3 Required invariants for plugin mappings

- UI runtime must not route an action without a ratified mapping row.
- Mapping rows must be traceable to a source contract (`evo-core` op docs or plugin request contract).
- Ambiguous one-to-many mappings require explicit conflict rules (priority, merge, or rejection).
- State-changing actions without rollback strategy must declare failure behavior.

### 5.4 Governance for mapping changes

- Additive mapping rows: minor version update.
- Behavioral mapping changes: explicit review from domain owner and UI runtime owner.
- Mapping removals: deprecation window with capability downgrade before removal.
