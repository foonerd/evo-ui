# evo UI engineering workspace

Implementation workspace for the `evo` next-generation UI: the operator-facing shell, its runtime service, and the contracts they land against.

## Purpose

High-velocity workspace for:

- UI prototyping and exploration
- contract-first integration with the framework
- showcase UX shaping for the reference device
- readiness and risk governance

This workspace evolves quickly and may contain unstable work-in-progress.

## Scope

- Build the complete, intuitive, appealing human layer for the evo showcase device.
- Preserve strict separation between:
  - runtime semantics (the framework core + device plugins)
  - UI transport adapter (the runtime service)
  - presentation and theming (the shell)
- Keep ecosystem extensibility first-class (vendors, community plugins, diverse hardware targets).

## Delivery layout

- `CONCEPT/`: reference-only material (do not use for delivery code)
- `apps/`: active implementation scaffolds and feature delivery
- `docs/`: contracts, playbook, and per-surface implementation guidance

See `DEVELOPING.md` for local workflow. See `docs/DEV-TOOLCHAIN.md` for the dev-box toolchain reference.

## Community quickstart

If you are evaluating this workspace and want a working flow quickly:

Prerequisites:

- development host uses Node.js 22 LTS or newer for `apps/evo-ui-shell`
- supported target devices run a current Debian / Raspberry Pi OS release; no Node install required on target for artifact deploy
- mandatory full framework validation gate before merge/deploy:

```bash
cargo clean
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo build --workspace --locked
```

or run:

```bash
./scripts/validate-evo-core-prereq.sh
```

1. Build shell:

```bash
cd apps/evo-ui-shell
npm install
npm run build
```

1. Build runtime:

```bash
cd ../evo-ui-runtime
cargo build --release --target aarch64-unknown-linux-gnu
```

1. Deploy artifact-only to a device:

```bash
./scripts/device/deploy-runtime-service-pi.sh <user>@<device-host-or-ip>
```

1. Verify:

```bash
curl -i http://<device-host-or-ip>/api/ui/v1/health
curl -i http://<device-host-or-ip>/api/ui/v1/capabilities
curl -i http://<device-host-or-ip>/api/ui/v1/settings
```

## Key docs

- `docs/UI_DELIVERY_PLAYBOOK_V1.md`
- `docs/implementation/GATEWAY_BOOTSTRAP.md`
- `docs/implementation/PLAYBACK_BASELINE.md`
- `docs/implementation/OPERATIONS_ADMIN.md`
- `docs/UI_PERFORMANCE_CONTRACT_V1.md`
- `docs/UI_LAYER_CONTRACT.md`
- `docs/UI_API_V1.md`
- `docs/UI_TO_CORE_MAPPING_V1.md`
- `docs/UI_CAPABILITIES_V1.md`
- `docs/UI_ERROR_MODEL_V1.md`
- `docs/UI_SECURITY_PROFILE_V1.md`

## Ownership and marks

`evo` and `evoframework` names/marks are controlled by the project owner.  
See `TRADEMARK.md` for usage guidance.

## License

Licensed under Apache License 2.0 unless stated otherwise.  
See `LICENSE` and `NOTICE`.
