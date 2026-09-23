# Developing

Status: developer workflow for the UI implementation workspace.  
Scope: implementation work only (outside `CONCEPT`).

## 1. Repository layout rules

- `CONCEPT/` is reference-only and must stay untouched during delivery work.
- `apps/` contains active implementation scaffolds and feature code.
- `docs/` remains the contract and delivery source of truth.

## 2. Current implementation workspace

- `apps/evo-ui-shell` is the active scaffold for the runtime-bootstrap surface.
- `apps/evo-ui-runtime` is the runtime binary implementation for `evo-ui-runtime`.

## 2.1 Community quickstart (what to do with the code)

Use this when starting from zero and wanting a working local+device flow.

Node/runtime policy:

- development host must run Node.js 22 LTS or newer for `apps/evo-ui-shell`
- target device OS is Raspberry Pi OS Trixie; UI artifacts are built on the development host and deployed artifact-only

Mandatory full validation prerequisite (run exactly, from `evo-core` workspace root). rustdoc is part of the gate:

```bash
cargo clean
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo build --workspace --locked
RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps --locked
```

For the UI runtime crate itself, the compulsory commit entry gate is:

```bash
./scripts/check-cargo-workout.sh
```

or run:

```bash
./scripts/validate-evo-core-prereq.sh
```

1. Build and type-check UI shell:

```bash
cd apps/evo-ui-shell
npm install
npm run build
```

1. Build runtime binary:

```bash
cd ../evo-ui-runtime
cargo build --release --target aarch64-unknown-linux-gnu
```

1. Deploy to device (artifact-only, no on-device compile):

```bash
cd apps/evo-ui-runtime
./scripts/device/deploy-runtime-service-pi.sh <user>@<device-host-or-ip>
```

1. Verify runtime endpoints:

```bash
curl -i http://<device-host-or-ip>/api/ui/v1/health
curl -i http://<device-host-or-ip>/api/ui/v1/capabilities
curl -i http://<device-host-or-ip>/api/ui/v1/settings
```

## 3. Local commands (`apps/evo-ui-shell`)

```bash
npm install
npm run dev
```

Mock gateway mode (no backend needed):

```bash
# open:
http://localhost:5173/?mock=1
```

What this means:

- `localhost:5173` is the Vite dev server running on your own machine.
- `?mock=1` tells `evo-ui-shell` to use mocked capability/domain responses for frontend work when backend domains are unavailable.
- Use this for UI iteration and interaction testing; use your device host/IP for runtime integration testing.

Build:

```bash
npm run build
```

Contract tests (no npm install required if `node` is present):

```bash
cd apps/evo-ui-shell
node --experimental-strip-types --experimental-specifier-resolution=node --test tests/contracts/**/*.test.ts
```

Playback evidence snapshot generator:

```bash
cd apps/evo-ui-shell
# preferred when npm is available:
npm run evidence:chunk02
# node-only fallback:
node scripts/chunk02-evidence.mjs
```

(The script id is the historical name retained for tooling
compatibility; the generated evidence covers the playback
surface's current contract.)

Generated outputs:

- report files: `docs/evidence/playback-snapshot-*.md`
- index file: `docs/evidence/PLAYBACK_EVIDENCE_INDEX.md`

## 4. Coding policy for this repo

- Do not add implementation code under `CONCEPT`.
- Keep bootstrap logic contract-first:
  - `GET /health`
  - `GET /capabilities`
- Gate feature surfaces by resolved capabilities.
- Treat `CONCEPT` UI as visual source-of-truth:
  - adopt layout/components/tokens as delivered
  - change only runtime/framework plumbing required for shell integration
  - do not redesign controls or visual hierarchy without explicit approval

## 5. Runtime path policy (device)

- Device UI runtime root is `/opt/evo/ui`.
- Active served release must resolve from `/opt/evo/ui/current`.
- Authoritative UI settings persistence path is `/opt/evo/ui/data/settings.json`.
- `localStorage` may be used as local cache/fallback only; it is not source-of-truth for shared UI settings.
- Test-device lifecycle is systemd-managed (`evo-ui.service`).
- Device install/deploy scripts:
  - `apps/evo-ui-runtime/scripts/device/deploy-runtime-service-pi.sh`
  - `apps/evo-ui-runtime/scripts/device/evo-ui.service.in` (template; deploy script substitutes `@SERVICE_USER@` before install)

Runtime lifecycle commands:

```bash
sudo systemctl start evo-ui.service
sudo systemctl stop evo-ui.service
sudo systemctl restart evo-ui.service
sudo systemctl status evo-ui.service --no-pager --full
sudo journalctl -u evo-ui.service -n 200 --no-pager
```

Required operator permissions:

- sudo rights for `/opt/evo/ui` runtime files
- sudo rights for `/etc/systemd/system/evo-ui.service`
- sudo rights for `systemctl` and `journalctl -u evo-ui.service`

## 5.1 Runtime implementation status (must close before lifecycle-ready claim)

- [x] Persistent authoritative settings service (device-side, revisioned, file-backed)
- [x] `evo-ui-runtime` binary as service executable (`/opt/evo/bin/evo-ui-runtime`)
- [x] Bootstrap endpoints implemented (`GET /health`, `GET /capabilities`)
- [x] Explicit WS-not-implemented response (`GET /api/ui/v1/ws` => `501`) until realtime fanout lands
- [ ] TLS termination on port `443` with self-servicing cert lifecycle
- [x] Port `80` lifecycle policy and service control flow implemented

## 6. Commit policy (semantic model)

- Commit subjects must follow `docs/COMMIT_SEMANTIC_MODEL.md`.
- Required format: `<type>(<scope>): <result> — <why>`.
- Prefer scoped commits (`playback`, `queue`, `browse`, `system`, `stream`, `bootstrap`, `contracts`).
- Avoid generic subjects (`update`, `cleanup`, `misc`).

## 7. Progress meeting cutover demo

Use the meeting runbook for deterministic cross-stream walkthrough:

- `docs/evidence/CUTOVER_STAGE_PROGRESS_DEMO_RUNBOOK.md`

First-device cutover checklist remains:

- `docs/evidence/FIRST_DEVICE_CUTOVER_RUNBOOK.md`
