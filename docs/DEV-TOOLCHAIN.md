# Dev-Box Toolchain Reference

Every build tool this repository needs is installed on the shared dev box. This document lists where each tool lives, which version is present, and the canonical commands for the runtime + shell artefacts the repo produces. Follow the commands verbatim; do not wrap them in a container or an alternative sandbox to work around a missing-tool report — the tool is on `PATH` unless a shell rc has been deliberately cleared.

The companion doc [`DEVELOPING.md`](../DEVELOPING.md) covers workflow conventions (branching, PRs, review). This document covers the mechanical toolchain.

## Toolchain inventory

| Tool | Path | Version | Purpose |
| --- | --- | --- | --- |
| `cargo` | `$HOME/.cargo/bin/cargo` | 1.97.1 | Rust build / test / run |
| `rustc` | `$HOME/.cargo/bin/rustc` | 1.97.1 | Rust compiler (invoked by cargo) |
| `rustup` | `$HOME/.cargo/bin/rustup` | 1.29.0 | Toolchain + target manager |
| `cross` | `$HOME/.cargo/bin/cross` | 0.2.5 | Containerised cross-compile — not required for this repo (see note) |
| `docker` | `/usr/bin/docker` | 29.7.2 | Container runtime — daemon running, reachable |
| `aarch64-linux-gnu-gcc` | `/usr/bin/aarch64-linux-gnu-gcc` | — | aarch64 cross-linker (Pi 5, most 64-bit ARM boards) |
| `aarch64-linux-gnu-ld` | `/usr/bin/aarch64-linux-gnu-ld` | — | aarch64 cross-linker for `rust-lld` fallback |
| `arm-linux-gnueabihf-gcc` | `/usr/bin/arm-linux-gnueabihf-gcc` | — | armv7 cross-linker (older 32-bit Pi) |
| `node` (via nvm) | `~/.nvm/versions/node/{v20.18.3,v24.13.0}/bin/node` | 20.18.3 / 24.13.0 | JS runtime for the shell build |

**Rust targets already installed** (verify with `rustup target list --installed`):

- `aarch64-unknown-linux-gnu` (Pi 5, ARM NUCs)
- `armv7-unknown-linux-gnueabihf` (older 32-bit Pi)
- `x86_64-unknown-linux-gnu` (dev-box host + x86 NUCs / VMs)

## Where the tools come from — brief

- **Rust toolchain (`cargo` / `rustc` / `rustup`).** Installed via `rustup` in the user profile at `~/.cargo/bin/`. `~/.cargo/bin/` is on the interactive `PATH` from the shell rc. When invoking from a non-login script (systemd unit, CI runner), source the shell rc or prepend the absolute path.
- **`cross` (containerised cross-compile).** Installed via `cargo install cross`. Wraps `docker` (or `podman`) with a target-specific image so a crate that pulls native cross-arch dependencies can be built without cross-linkers on the host. Not required by this repo — see the runtime section below.
- **`docker`.** Installed via the OS package manager; daemon is up and reachable. Only used when `cross` is invoked.
- **Cross-linkers (`aarch64-linux-gnu-gcc`, `arm-linux-gnueabihf-gcc`).** Installed via the OS package manager. Paired with a `rustup`-added target, these let `cargo build --target <triple>` link a pure-Rust binary for the target arch without a container.
- **Node via nvm.** Installed via `nvm` at `~/.nvm/`. Both v20.18.3 and v24.13.0 are available. `node` is **not on the default `PATH` for non-interactive shells** — activate nvm first (see the shell section below).

## Canonical commands — `apps/evo-ui-runtime` (Rust binary)

The runtime is pure Rust with no native cross-arch dependencies. **It does NOT need `cross` or docker.** Plain `cargo build --target <triple>` works, using the cross-linker blocks already declared in `apps/evo-ui-runtime/.cargo/config.toml`.

```bash
cd apps/evo-ui-runtime

# One-time per fresh box (each target already present on the shared dev box):
rustup target add aarch64-unknown-linux-gnu x86_64-unknown-linux-gnu

# Build for each rig arch:
cargo build --release --target aarch64-unknown-linux-gnu    # Pi 5 rigs
cargo build --release --target x86_64-unknown-linux-gnu     # NUC / VM rigs

# Or run the in-repo matrix helper (does both prototype targets):
./scripts/build-target-matrix.sh prototype

# Full-matrix (all eight documented targets):
./scripts/build-target-matrix.sh full
```

Test + fmt + clippy against the host toolchain:

```bash
cargo test --workspace --locked
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

### Canonical output path — do not relocate

Runtime binaries land at:

```text
apps/evo-ui-runtime/target/<triple>/release/evo-ui-runtime
```

The Framework-side bundle builder reads from this exact path. **Do not set `CARGO_TARGET_DIR` to a personal path**; if the canonical path goes stale, the fleet ships whatever's there. This has caused a stale-runtime deployment before — the trap is real. Leave the target dir at cargo's default.

## Canonical commands — `apps/evo-ui-shell` (SPA)

```bash
cd apps/evo-ui-shell

# node isn't on PATH by default — activate nvm first:
. ~/.nvm/nvm.sh && nvm use 20      # v24 also available

npm ci                              # install pinned deps
npm run build                       # tsc -b && vite build
```

Output lands at `apps/evo-ui-shell/dist/`. The Framework-side bundle build reads from that path.

Local dev / preview:

```bash
npm run dev                         # vite dev server
npm run preview                     # preview production build
```

Contract tests:

```bash
npm run contracts:test              # every contract test
npm run test:display                # display-preset contracts only
```

## When you would need `cross` + docker

Only when a Rust crate you depend on pulls a native library that has to link against the target arch's system libs (ALSA, libudev, libgtk, openssl-sys, etc.). Framework's audio device build and the sibling kiosk build both need `cross` because they reach into ALSA / GTK + WebKit at link time. **This repo's runtime doesn't have any such dependency** — plain cargo + linker block is enough.

If a future runtime dependency ever forces a container build (linker errors that trace to a missing target-arch `.so`), the canonical pattern to copy is the Framework-side `cross-build.sh` wrapper — it sets `CROSS_CONTAINER_OPTS` for the path-dep workspace-root mount workaround `cross`-rs does not handle out of the box. Do not take that path until an actual link error forces it.

## Shell / `PATH` hygiene

- Interactive shells source `~/.bashrc` (or equivalent), which pulls in `~/.cargo/env`. `cargo` / `rustc` / `cross` are on `PATH` in that state.
- Non-login shells (systemd units, cron, CI runners) do NOT source the shell rc. Either source it explicitly at the top of the script or use absolute paths (`$HOME/.cargo/bin/cargo`).
- `nvm` never puts `node` on the default `PATH` — every script that runs a node command must `. ~/.nvm/nvm.sh && nvm use <version>` first.
- If a build command reports a tool "not found", run `which <tool>` first. If `which` also reports missing, the tool genuinely isn't on the current `PATH`. Fix the `PATH` (source the rc, prepend the absolute directory) — do not wrap the command in a container as a workaround.

## Reporting a genuinely missing tool

If a tool is genuinely absent from the shared dev box (every entry in the inventory table above has been verified present), flag it back on the workstream chat and it will be installed. Do not invent an alternative execution surface to work around a missing tool — that fragments the build path and produces the stale-artifact class the canonical-target-dir rule already exists to prevent.
