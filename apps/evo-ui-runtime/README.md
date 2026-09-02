# evo-ui-runtime

UI runtime service binary that serves the UI release payload and owns the
authoritative UI settings bootstrap.

## Scope (current)

- runtime configuration loading (env + defaults)
- canonical runtime path defaults (`/opt/evo/ui/*`)
- lifecycle guardrails for `80/443` port policy (`80` always-on invariant)
- authoritative settings bootstrap at `/opt/evo/ui/data/settings.json` + `.bak`
- bootstrap endpoints: `GET /api/ui/v1/health` and `GET /api/ui/v1/capabilities`
- settings API: `GET/PATCH /api/ui/v1/settings` with revision conflict guard (`409`)
- explicit `501` response for `/api/ui/v1/ws` until realtime fanout is implemented
- static UI file serving from `/opt/evo/ui/current` (HTTP port policy path)
- explicit TODO hooks for API/WS serving and TLS lifecycle wiring

## Run

```bash
cargo run --bin evo-ui-runtime
```

Bootstrap-only check (exits after settings initialization):

```bash
EVO_UI_BOOTSTRAP_ONLY=1 cargo run --bin evo-ui-runtime
```

## Test

```bash
cargo test
```

## Target matrix

Canonical build matrix:

- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `armv7-unknown-linux-gnueabihf`
- `arm-unknown-linux-gnueabihf`
- `i686-unknown-linux-gnu`
- `x86_64-unknown-linux-musl`
- `aarch64-unknown-linux-musl`
- `armv7-unknown-linux-musleabihf`

Prototype order:

1. `aarch64-unknown-linux-gnu`
2. `x86_64-unknown-linux-gnu`

Build prototype targets:

```bash
cargo build --release --target aarch64-unknown-linux-gnu
cargo build --release --target x86_64-unknown-linux-gnu
```

## Pi prototype smoke (artifact-only deploy)

This flow builds locally and copies only the resulting binary to Pi.
No compile step runs on the target device.

```bash
./scripts/deploy-prototype-pi.sh <service-user>@<device-ip>
```

## Pi runtime service deploy (systemd managed)

This deploys a locally-built runtime artifact, pushes the current UI dist
payload to `/opt/evo/ui/releases/<timestamp>`, repoints `/opt/evo/ui/current`,
and restarts `evo-ui.service`.

```bash
./scripts/device/deploy-runtime-service-pi.sh <service-user>@<device-ip>
```
