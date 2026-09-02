# UI Error Model v1

Status: Draft  
Owner: UI Runtime owner

## 1) Purpose

Defines stable error semantics returned by UI runtime HTTP/WS APIs.

## 2) Standard Error Envelope

```json
{
  "error": {
    "code": "EVO_UI_XXXX",
    "category": "validation|capability|routing|upstream|auth|rate_limit|internal|timeout",
    "message": "Human-readable summary",
    "retryable": false,
    "details": {}
  },
  "request_id": "optional-correlation-id"
}
```

## 3) HTTP Mapping

- `400` validation
- `401` unauthenticated
- `403` unauthorized
- `404` unknown resource/action
- `409` state conflict
- `422` known but unsupported action in current capability/state
- `429` rate limited
- `502` upstream/domain error
- `504` upstream timeout
- `500` internal unexpected

## 4) Required Stable Codes

- `EVO_UI_VALIDATION`
- `EVO_UI_UNAUTHENTICATED`
- `EVO_UI_UNAUTHORIZED`
- `EVO_UI_UNSUPPORTED`
- `EVO_UI_RATE_LIMITED`
- `EVO_UI_UPSTREAM_FAILURE`
- `EVO_UI_UPSTREAM_TIMEOUT`
- `EVO_UI_INTERNAL`

## 5) Translation Rules

- Preserve upstream diagnostics in `details` where safe.
- Never leak secrets or file paths in `message`.
- Unsupported-by-contract should map to `EVO_UI_UNSUPPORTED` (not internal error).
- Unknown upstream failures map to `EVO_UI_UPSTREAM_FAILURE`.

## 6) WS Error Event

Error events on stream:

```json
{
  "event": "error",
  "payload": {
    "code": "EVO_UI_UPSTREAM_FAILURE",
    "category": "upstream",
    "message": "Domain request failed",
    "retryable": true
  }
}
```

## 7) Scale Plan for 20+ Plugins

### 7.1 Plugin-aware error fields

When errors originate from domain plugins, include origin metadata:

```json
{
  "error": {
    "code": "EVO_UI_UPSTREAM_FAILURE",
    "category": "upstream",
    "message": "Domain request failed",
    "retryable": true,
    "details": {
      "plugin_id": "org.evoframework.network",
      "domain": "network",
      "request_type": "network.nm.scan",
      "upstream_code": "optional-domain-code"
    }
  }
}
```

### 7.2 Extended categories for plugin scale

Add and use these categories when appropriate:

- `not_implemented` (contract known but not implemented in current plugin build)
- `dependency_unavailable` (plugin disabled/not loaded/downstream missing)

### 7.3 Stable code policy for large plugin sets

- Base UI codes stay global and stable (`EVO_UI_*`).
- Plugin-specific error details remain in `details` (not in top-level code), to avoid exploding the global code list.
- Unknown plugin failure must still map to stable UI code + include origin metadata when available.

### 7.4 Per-plugin error annex

For each plugin surfaced to UI, create:

- `UI_ERROR_MODEL_V1_PLUGIN_<plugin_id>.md`

Minimum annex content:

- Known plugin-origin failure scenarios
- Retry guidance
- User-facing severity guidance
