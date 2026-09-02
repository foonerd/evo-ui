# UI auth model

The framework's auth model is shaped around two invariants:

1. **The operator on a trusted LAN never sees credential
   machinery.** Open the browser. The UI loads. The device
   responds. No pairing flow, no QR scan, no typing of bearer
   tokens, no `?bearer=` URLs, no copy-paste from another window.
2. **The operator's browser never sees a TLS certificate.** No
   "your connection is not private" warning. No cert acceptance.
   No SAN mismatch surfaces when the device's IP, hostname, or
   network changes. The operator hits `http://<device>/` (relative
   URLs throughout the UI shell) and the runtime reverse-proxies
   to the framework's loopback HTTPS substrate. The certificate
   handshake happens entirely between the runtime and the
   framework on the same host, where the framework's
   `SAN=localhost` is correct by construction.

The UI runtime treats the bearer substrate as an
*external-consumer* surface — present in the framework, used by
automation systems via direct HTTPS to the framework's port 8443,
but not in the operator's path.

This document is the source-of-truth for what that means at the UI
layer: how to connect, how to handle each auth tier, what wire
operations the UI consumes, what screens the operator expects, and
how the UI behaves under each tier flip.

## The three tiers

| Tier | Operator UI on the LAN | External API consumer | Default? |
| ---- | ---------------------- | --------------------- | -------- |
| **Open** | Admitted, no credential | Admitted, no credential | Yes |
| **Secure** | Admitted, no credential | Bearer required (never-expiring by default) | No |
| **Secure-industrial** | Admitted, no credential | Bearer required with operator-set expiry policy + expiry warnings | No |

The tier is operator-selectable via a settings screen the UI owns.
The framework reads the current tier on every request; the UI does
not need to refresh, restart, or reconnect on a tier flip — the
admission decision is recomputed per request.

**The operator UI's contract is identical across all three tiers.**
The UI runtime never mints, holds, attaches, refreshes, or rotates a
bearer token for the operator's own session. It opens a WebSocket
upgrade with no `Authorization` header, no `Sec-WebSocket-Protocol:
bearer.<token>` subprotocol, and no `?bearer=...` query parameter.
The framework admits the upgrade via LAN-trust on the operator's LAN
origin and stamps the connection with a synthetic operator
`Principal` carrying every operator scope. Every subsequent message
on the connection is treated as the operator.

## How LAN-trust works at the framework

The framework classifies a request's TCP peer address. A peer is
LAN-origin when the IP falls in any of:

- IPv4 RFC1918 ranges: `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`.
- IPv4 loopback: `127.0.0.0/8`.
- IPv4 link-local: `169.254.0.0/16`.
- IPv6 loopback: `::1`.
- IPv6 link-local: `fe80::/10`.
- IPv6 unique-local: `fc00::/7`.
- IPv4-mapped IPv6 (`::ffff:0:0/96`) classified by the embedded
  IPv4 address.

Anything else is WAN-origin. Under Open tier the origin is not
consulted (every origin is admitted without a credential). Under
Secure / Secure-industrial tier, LAN-origin is admitted without a
credential and WAN-origin requires a bearer.

The classification is deterministic and pure — no DNS lookup, no
external service. The UI runtime can rely on it.

## What the UI runtime should NOT do

These were patterns from an earlier auth shape that have been
removed. None of them are needed under the current model.

- **Do not fetch a bearer token at startup.** No request to
  `/api/v1/auth/bootstrap` or any equivalent. The UI opens its
  WebSocket directly.
- **Do not attach `Authorization: Bearer <token>` to operator-UI
  requests.** The framework admits them via LAN-trust.
- **Do not attach `Sec-WebSocket-Protocol: bearer.<token>` to the
  operator-UI WebSocket upgrade.** Open the upgrade with no
  bearer subprotocol.
- **Do not parse `?bearer=...` from the URL and stash it in
  `localStorage`.** That URL pattern is gone from the operator
  flow.
- **Do not refresh / rotate / re-issue a bearer for the operator's
  own session.** There is no expiry, no rotation, no dead-man
  switch on the operator's session.

The `bearer.<TOKEN>` subprotocol path remains correct for **external
API consumers** that connect with a bearer. The shell carries the
code path; the operator UI just does not exercise it.

## What the UI runtime SHOULD do

For the operator UI flow:

1. Open the WebSocket at the **relative** canonical path,
   resolved against the page origin the operator's browser
   already loaded the UI shell from:

   ```js
   const wsUrl = new URL("/api/v1/ws", window.location.href);
   wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
   const ws = new WebSocket(wsUrl);
   ```

   The page origin is `http://<device>/` (port 80, plain HTTP)
   by the time the shell is running, so this resolves to
   `ws://<device>/api/v1/ws`. The UI runtime reverse-proxies
   the upgrade to the framework's loopback HTTPS substrate;
   the operator's browser never participates in TLS.

   No subprotocol, no `Authorization` header.

   Hard-coding `wss://<host>:8443/...` is **wrong**. The
   browser would attempt a direct TLS handshake against the
   framework's cert, hit the SAN-mismatch refusal, and the
   operator would face a cert-acceptance ceremony that the
   topology was built to eliminate.

2. On `403 Forbidden` for a wire op: the operator's session carries
   the full operator scope set, so a 403 indicates a wire op
   requiring step-up auth. Surface the step-up prompt per the
   existing step-up flow; the bearer substrate is not the right
   tool here.

3. On `401 Unauthorized` on the WebSocket upgrade itself: the
   device is in Secure / Secure-industrial tier AND the browser
   is on a WAN origin. The UI should show the "you are off-LAN —
   connect from a device on the same network as the device" copy.
   This is a network-topology condition the UI surfaces, not an
   auth flow it resolves.

4. On `tier_change` happening between requests: no action needed.
   The next request goes through the framework's admission path
   afresh. If the new tier is more restrictive AND the browser is
   on a WAN origin, requests start returning 401 — handle as in
   step 3.

## What the UI runtime SHOULD build

The framework's wire-op surface is complete. The UI side splits
into the screens below; each is independently shippable.

### Screen 1 — Tier toggle (Settings)

A settings entry with three radio buttons. Plain-English copy per
tier; no "bearer token" / "JWT" / "session cookie" / "TLS" jargon
in the operator-visible strings.

The labels and explanations the operator sees:

> ### Network access
>
> **Open access** (default, simplest)
> Anyone on this network can reach the device. No permission slip
> required. Best for a home network you own and trust.
>
> **Secured access**
> Your browser on this network still reaches the device freely.
> Other things on the network — automation systems, sensors,
> scripts — need a permission slip from you before they can talk
> to the device. The permission slip is something you create for
> each one and decide whether it expires.
>
> **Secured access with rotation reminders**
> Same as Secured access, but the device reminds you ahead of time
> when a permission slip is about to expire so you can replace it
> before the automation system goes dark.

The UI dispatches the tier change to the framework. The settings
key (or equivalent runtime setter) is the canonical sink; the
framework reads it on every request.

### Screen 2 — Connected systems (the credential management page)

Lists every active and revoked credential. Per row:

- **Friendly name** the operator gave it ("ESP8266 doorbell",
  "Home Assistant").
- **Permissions summary** (read what / write what / step up to
  what). Render as natural language, not `read:audio`.
- **Status badge**: `active`, `expiring soon (N days left)`,
  `expired`, `revoked`.
- **Created**, **last used** (if surfaced by the framework),
  **expires** (or "never").
- Actions: `Revoke`, `Regenerate` (revoke + create with the
  same name + scopes + expiry policy in one operator gesture).

Sort the list by created-at descending. A `+ Add a system`
button opens the create wizard (screen 3). A WARN banner appears
above the list when one or more credentials enter the seven-day
expiry window, with a one-click `Manage` link per row.

The framework's `list_bearer_tokens` wire op returns the full
inventory; the UI computes status client-side from
`expires_at_ms` and `revoked_at_ms` (see wire-op reference
below).

### Screen 3 — Add a system (the create wizard)

A short three-step flow:

1. **Pick the type of system.** Platform list: Home Assistant /
   ESPHome / Node-RED / Tasmota / Arduino / Custom (HTTP) / Custom
   (WebSocket). The pick is a hint for screen 4 (the copy-paste
   examples) — it does not change what the framework returns.

2. **Pick permissions.** A categorised picker:
   - "Trigger playback" (`write:multiroom` plus `read:audio`)
   - "Read playback state" (`read:audio` plus `read:multiroom`)
   - "Schedule playlists" (`write:plans`)
   - "Read everything" (every `read:*` scope)
   - "Full access" (every scope the operator carries)
   - "Custom" (pick individual `kind:scope` pairs)

   The picker keeps the wire shape as a `Vec<{kind, scope}>` —
   the UI maps category buttons to scope sets.

3. **Pick expiry policy.** A radio set:
   - "Never expires" (the default; right for sensors and IoT
     systems that cannot maintain a refresh loop)
   - "Expires in 30 days"
   - "Expires in 90 days"
   - "Expires in 1 year"
   - "Custom" (operator enters number of seconds)

   The UI maps to `expires_in_seconds` on the wire (omit /
   `0` for `Never`; positive integer for `Seconds`).

After the operator confirms, the UI dispatches `create_bearer_token`
and renders **screen 4**.

### Screen 4 — Copy the permission slip (one-time view)

The framework returns the encoded token ONCE, at create time, and
NEVER persists it. The UI shows the token bytes in a copy-to-
clipboard panel with these characteristics:

- The token bytes are visible in a monospace box with a "Copy" button.
- A prominent caption: "This permission slip is shown ONCE. Copy
  it now and paste it into your system. The device will not show
  it again."
- The platform-specific example from screen 3's pick is rendered
  inline with the token already substituted. The operator copies
  the entire snippet, not the bare bytes.
- A `Done` button closes the panel and returns to screen 2 with
  the new row inserted at the top.

If the operator dismisses screen 4 without copying the token, the
UI surfaces a "lost the slip — regenerate" action on screen 2 that
revokes the old + creates a new one with the same name + scopes +
expiry. The regenerated token surfaces in another screen-4 view.

### Recovery flow — Lockout

The operator UI does not normally hit a lockout state (LAN-trust on
the operator's own browser is the invariant). The UI surfaces the
recovery copy when:

- The browser is on a WAN origin under Secure / Secure-industrial
  tier. Copy: "You are reaching the device from outside the home
  network. Move to a device on the same network as the player, or
  install a permission slip you can paste into the URL."

- The device's HTTPS listener is unreachable (network failure;
  device down). Copy: standard "cannot reach the device" page;
  not an auth concern.

The framework's lockout-recovery primitive is the reset gesture —
`evo-plugin-tool admin auth reset-credentials-to-open` followed by
`systemctl restart evo` from an operator SSH session. This is an
out-of-band recovery; the UI does not surface it directly.

## Wire-op reference

The framework exposes four credential-management operations on the
HTTPS canonical schema. All require operator-grade admission (which
the UI's LAN-trust session already carries). Request and response
JSON shapes follow.

### `create_bearer_token`

Capability required: `write:auth`.
Audit timing: `always` (every dispatch outcome lands in the audit
ledger).

Request:

```json
{
  "op": "create_bearer_token",
  "name": "esp8266-doorbell",
  "reason": "doorbell-trigger-2026",
  "scopes": [
    { "kind": "read", "scope": "audio" },
    { "kind": "write", "scope": "multiroom" }
  ],
  "expires_in_seconds": null
}
```

- `name` — non-empty after trim; operator-friendly label.
- `reason` — non-empty after trim; recorded in the audit
  observation.
- `scopes` — empty array means "every operator scope"; non-empty
  array is the explicit set. Each entry is `{kind, scope}` with
  `kind` one of `read` / `write` / `step_up`.
- `expires_in_seconds` — `null` / omitted / `0` for `Never`; any
  positive integer for a finite TTL in seconds.

Response (success):

```json
{
  "bearer_token_created": true,
  "token": "eyJpZCI6IjFiM2g...",
  "record": {
    "token_id": "1b3h…",
    "name": "esp8266-doorbell",
    "created_reason": "doorbell-trigger-2026",
    "scopes": [
      { "kind": "read", "scope": "audio" },
      { "kind": "write", "scope": "multiroom" }
    ],
    "expiry_policy": { "kind": "never" },
    "created_at_ms": 1700000000000,
    "expires_at_ms": null,
    "revoked_at_ms": null,
    "revoked_reason": null
  }
}
```

The `token` field is the bearer string. **Show once. Never persist
in the UI runtime.** The `record` field is the persisted metadata
that subsequently shows up in `list_bearer_tokens`.

Response (error):

```json
{
  "error": {
    "class": "contract_violation",
    "subclass": "blank_input",
    "message": "create_bearer_token: name and reason must each be non-empty after trim"
  }
}
```

Error subclasses the UI may see:

| Subclass | Meaning | UI handling |
| -------- | ------- | ----------- |
| `blank_input` | `name` or `reason` empty after trim | Inline form validation; refuse submit |
| `unknown_scope_kind` | A `kind` other than `read` / `write` / `step_up` | Bug; should not happen if UI uses the picker |
| `auth_write_required` | Connection lacks `write:auth` | Should not happen on operator-UI session; surface generic "session needs to refresh" |
| `issuer_unavailable` | HTTPS substrate did not boot | Surface device-error state |
| `persistence_failed` | Disk write failed | Surface device-error state; operator may need to check device |

### `list_bearer_tokens`

Capability required: `read:auth`.
Audit timing: `none` (read-only).

Request:

```json
{ "op": "list_bearer_tokens" }
```

Response (success):

```json
{
  "bearer_tokens_listed": true,
  "records": [
    {
      "token_id": "...",
      "name": "bootstrap",
      "created_reason": "first-boot bootstrap credential",
      "scopes": [{"kind": "step_up", "scope": "plugins_admin"}, ...],
      "expiry_policy": {
        "kind": "seconds",
        "value": 86400
      },
      "created_at_ms": 1700000000000,
      "expires_at_ms": 1700086400000,
      "revoked_at_ms": null,
      "revoked_reason": null
    },
    {
      "token_id": "...",
      "name": "esp8266-doorbell",
      ...
    }
  ]
}
```

Records are sorted by `created_at_ms` ascending. The UI re-sorts
for display.

The UI computes status from each record:

```text
status = revoked_at_ms is not null  -> "revoked"
       | expires_at_ms is null     -> "active"
       | now >= expires_at_ms      -> "expired"
       | now+7d >= expires_at_ms   -> "expiring soon"
       | else                      -> "active"
```

Aggregate the WARN banner when one or more records fall in
"expiring soon".

### `revoke_bearer_token`

Capability required: `write:auth`.
Audit timing: `always`.

Request:

```json
{
  "op": "revoke_bearer_token",
  "token_id": "1b3h…",
  "reason": "rotated by operator"
}
```

Response (success):

```json
{
  "bearer_token_revoked": true,
  "record": {
    "token_id": "1b3h…",
    "name": "...",
    "...": "...",
    "revoked_at_ms": 1700000005000,
    "revoked_reason": "rotated by operator"
  }
}
```

The framework writes the revocation through to its in-memory
revocation list AND to a persistent file under the device's HTTPS
state directory, so the revocation survives a steward restart.
Subsequent requests carrying the revoked token are refused 401
immediately.

Error subclasses:

| Subclass | Meaning | UI handling |
| -------- | ------- | ----------- |
| `not_found` | No record for that `token_id` | Stale list view; refresh and retry |
| `already_revoked` | Record exists but is already revoked | Surface as benign; refresh the list |
| `blank_reason` | `reason` empty after trim | Inline form validation |
| `persistence_failed` | Disk write failed | The in-memory revocation took effect; surface a warning that the operator should restart the device once to ensure persistence |

### `reset_credentials_to_open`

Capability required: `step_up:system_admin`.
Audit timing: `always`.

This is the lockout-recovery gesture. **The operator UI normally
never invokes this op** — operator UI sessions on the LAN are
admitted without credentials, so a recovery flow is rarely
needed. The op is exposed for completeness; the canonical
invocation is the SSH + `evo-plugin-tool` path.

Request:

```json
{
  "op": "reset_credentials_to_open",
  "reason": "operator lockout recovery"
}
```

Response (success):

```json
{
  "credentials_reset_to_open": true,
  "records_purged": 4,
  "revocations_cleared": 3
}
```

After this op succeeds, the operator restarts the steward to admit
Open tier on the next boot. The UI's role is informational only;
the framework persists the reset state.

## Tier-flip semantics

The framework reads the current tier on every request. Flipping
Open → Secure (or back) takes effect on the *next* request. There
is no quiesce period, no restart, no certificate rotation. The
UI's existing WebSocket connection is not invalidated by a tier
flip — the per-request admission decision is re-evaluated and the
UI's connection persists.

**One subtlety the UI should handle:** if the operator flips Open
→ Secure while connected from a WAN origin, the next request on the
connection will be refused. The framework refuses *the request*,
not the connection — the WebSocket stays open, but the operator
sees a 401 on the next operation. The UI runtime should treat this
as a "you are off-network" condition (see the Recovery flow
section above).

## Origin classification — what the UI can assume

The UI runtime cannot directly inspect the TCP peer address; that
is the framework's view. But the UI can rely on this invariant:

> If the operator is reaching the UI shell over the same network
> the device is on, the framework classifies the connection as
> LAN-origin and admits it.

The corollary: if the operator types the device's IP into a
browser on a phone connected to the same Wi-Fi, that is LAN-origin.
If the operator opens the URL through a VPN that terminates at the
home router, that is LAN-origin (the device sees the router-side
IP). If the operator opens the URL through a cloud reverse-proxy
that terminates elsewhere, that is WAN-origin and the framework
refuses without a credential.

The UI should design its connect flow on the LAN-origin assumption
and surface the WAN-origin path as an explicit fallback.

## Settings keys the UI consumes / writes

| Key | Type | Meaning | Default |
| --- | ---- | ------- | ------- |
| `EVO_AUTH_TIER` (env) | enum: `open` / `secure` / `secure_industrial` | The framework reads this at boot (and via the operator-runtime-settable provider when wired through the settings substrate). | `open` |

The settings substrate exposes the tier as a regular setting; the
UI's tier-toggle screen writes through the standard per-device
atomic-sync settings primitive the rest of the UI uses for
per-device state.

## Cross-references

- The framework's operator-facing guide `docs/engineering/CREDENTIALS.md`
  carries the platform copy-paste examples (Arduino / ESPHome /
  Tasmota / Home Assistant / Node-RED / Python / shell curl /
  WebSocket clients). The UI's screen 4 renders the same snippets
  with the freshly-minted token substituted in; the framework doc
  is the source of truth for the example shapes.

- The framework primitive lives in the `evo-auth-bearer` crate
  (`BearerToken`, `CapabilitySet`, `RevocationList`,
  `CredentialRecord`, `CredentialStore`, `ExpiryPolicy`,
  `CapabilityRef`). The UI does not link this crate directly; the
  on-the-wire JSON shapes documented above are the contract.

- The HTTPS / WebSocket transport lives in `evo-runtime-http`. The
  UI relies on its `AuthLayer` + `ws_handler` admission rules
  (LAN-trust under Open and Secure/Secure-industrial-on-LAN; bearer
  required for WAN under Secure tiers). The on-the-wire status
  codes (`200`, `401`) are the contract.
