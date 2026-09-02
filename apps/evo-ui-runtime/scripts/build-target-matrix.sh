#!/usr/bin/env bash
set -euo pipefail

# Runtime target matrix build helper.
# Usage:
#   ./scripts/build-target-matrix.sh prototype
#   ./scripts/build-target-matrix.sh full

MODE="${1:-prototype}"

prototype_targets=(
  "aarch64-unknown-linux-gnu"
  "x86_64-unknown-linux-gnu"
)

full_targets=(
  "x86_64-unknown-linux-gnu"
  "aarch64-unknown-linux-gnu"
  "armv7-unknown-linux-gnueabihf"
  "arm-unknown-linux-gnueabihf"
  "i686-unknown-linux-gnu"
  "x86_64-unknown-linux-musl"
  "aarch64-unknown-linux-musl"
  "armv7-unknown-linux-musleabihf"
)

case "${MODE}" in
  prototype)
    targets=("${prototype_targets[@]}")
    ;;
  full)
    targets=("${full_targets[@]}")
    ;;
  *)
    echo "unknown mode: ${MODE} (expected: prototype|full)" >&2
    exit 2
    ;;
esac

for target in "${targets[@]}"; do
  echo "==> building target: ${target}"
  rustup target add "${target}"
  cargo build --release --target "${target}"
done
