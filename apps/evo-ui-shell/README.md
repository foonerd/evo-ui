# evo-ui-shell

Reference delivery scaffold for the UI implementation.

## Scope

- capability-first bootstrap (`/health`, `/capabilities`)
- capability-gated feature surfaces
- baseline command and snapshot wiring for playback/queue/browse
- websocket event ingestion skeleton

## Running

Prerequisite: Node.js 22 LTS or newer on the development host.

```bash
npm install
npm run dev
```

Mock gateway mode:

```text
http://localhost:5173/?mock=1
```

## Contract Tests

Pure logic contracts can run without npm dependencies:

```bash
node --experimental-strip-types --experimental-specifier-resolution=node --test tests/contracts/**/*.test.ts
```

## Test-device lifecycle (systemd)

Runtime target policy:

- serve active UI from `/opt/evo/ui/current`
- persist UI settings in `/opt/evo/ui/data/settings.json`
- control runtime with `evo-ui.service`

Scripts:

```bash
# one-time install on device class
./scripts/device/install-ui-runtime.sh

# build + deploy + activate release + restart service
./scripts/device/deploy-ui-release.sh <service-user>@<device-ip> [release_id]
```
