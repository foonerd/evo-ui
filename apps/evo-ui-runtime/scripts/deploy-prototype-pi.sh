#!/usr/bin/env bash
set -euo pipefail

# Local build only. Target device receives binary artifact only.
# Usage:
#   ./scripts/deploy-prototype-pi.sh <user>@<host-or-ip>

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <user@host>" >&2
  exit 1
fi

TARGET="$1"
TARGET_TRIPLE="aarch64-unknown-linux-gnu"
BIN_NAME="evo-ui-runtime"
REMOTE_BIN="/tmp/${BIN_NAME}"
REMOTE_ROOT="/tmp/evo-ui"
TARGET_DIR="${CARGO_TARGET_DIR:-target}"

echo "[1/4] local cross-build (${TARGET_TRIPLE})"
cargo build --release --target "${TARGET_TRIPLE}"

LOCAL_BIN="${TARGET_DIR}/${TARGET_TRIPLE}/release/${BIN_NAME}"
if [[ ! -x "${LOCAL_BIN}" ]]; then
  echo "missing binary: ${LOCAL_BIN}" >&2
  exit 1
fi

echo "[2/4] copy binary to target (${TARGET})"
scp "${LOCAL_BIN}" "${TARGET}:${REMOTE_BIN}"

echo "[3/4] execute binary on target (no build on target)"
ssh "${TARGET}" "chmod +x '${REMOTE_BIN}' && mkdir -p '${REMOTE_ROOT}/current' '${REMOTE_ROOT}/data' && EVO_UI_RUNTIME_ROOT='${REMOTE_ROOT}' '${REMOTE_BIN}'"

echo "[4/4] smoke complete"
