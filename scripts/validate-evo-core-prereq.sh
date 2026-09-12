#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVO_UI_ENG_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EVO_CORE_ROOT="${EVO_UI_ENG_ROOT}/../evo-core"

if [[ ! -d "${EVO_CORE_ROOT}" ]]; then
  echo "missing evo-core workspace at ${EVO_CORE_ROOT}" >&2
  exit 1
fi

cd "${EVO_CORE_ROOT}"

cargo clean
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo build --workspace --locked
RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps --locked
