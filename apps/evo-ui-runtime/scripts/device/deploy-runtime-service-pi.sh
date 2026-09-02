#!/usr/bin/env bash
set -euo pipefail

# Local build + artifact deploy only. No compile step on target device.
# Deploys runtime binary and ui-shell dist, installs evo-ui.service, and restarts it.
#
# Usage:
#   ./scripts/device/deploy-runtime-service-pi.sh <user>@<host-or-ip>
#
# Optional env var:
#   SERVICE_USER  name of the dedicated system user on the target
#                 that owns runtime files and runs the service unit.
#                 Defaults to the SSH username portion of the first
#                 argument so a typical operator deploy works without
#                 extra configuration; override to install under a
#                 different account.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <user@host>" >&2
  exit 1
fi

TARGET="$1"
TARGET_TRIPLE="aarch64-unknown-linux-gnu"
BIN_NAME="evo-ui-runtime"
SERVICE_USER="${SERVICE_USER:-${TARGET%@*}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${RUNTIME_DIR}/../.." && pwd)"
UI_SHELL_DIST="${REPO_ROOT}/apps/evo-ui-shell/dist"
SERVICE_TEMPLATE="${SCRIPT_DIR}/evo-ui.service.in"

if [[ ! -d "${UI_SHELL_DIST}" ]]; then
  echo "missing UI shell dist at ${UI_SHELL_DIST}" >&2
  echo "build it first on dev host with Node.js 22 LTS+: (cd apps/evo-ui-shell && npm run build)" >&2
  exit 2
fi

echo "[1/7] build runtime binary locally (${TARGET_TRIPLE})"
cargo build --release --target "${TARGET_TRIPLE}"

TARGET_DIR="${CARGO_TARGET_DIR:-target}"
LOCAL_BIN="${TARGET_DIR}/${TARGET_TRIPLE}/release/${BIN_NAME}"
if [[ ! -x "${LOCAL_BIN}" ]]; then
  echo "missing runtime binary: ${LOCAL_BIN}" >&2
  exit 3
fi

echo "[2/7] ensure runtime directories on target"
ssh "${TARGET}" "sudo install -d -m 0755 /opt/evo/bin && sudo install -d -m 0755 -o ${SERVICE_USER} -g ${SERVICE_USER} /opt/evo/ui /opt/evo/ui/releases /opt/evo/ui/data /opt/evo/ui/logs"

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="/opt/evo/ui/releases/${RELEASE_ID}"

echo "[3/7] upload UI dist release payload"
ssh "${TARGET}" "sudo install -d -m 0755 '${RELEASE_DIR}'"
rsync -av --delete --rsync-path="sudo rsync" "${UI_SHELL_DIST}/" "${TARGET}:${RELEASE_DIR}/"
ssh "${TARGET}" "sudo ln -sfn '${RELEASE_DIR}' /opt/evo/ui/current"
ssh "${TARGET}" "sudo chown -R ${SERVICE_USER}:${SERVICE_USER} /opt/evo/ui"

echo "[4/7] upload runtime binary"
scp "${LOCAL_BIN}" "${TARGET}:/tmp/${BIN_NAME}"
ssh "${TARGET}" "sudo install -m 0755 /tmp/${BIN_NAME} /opt/evo/bin/${BIN_NAME}"

echo "[5/7] render + install systemd unit"
RENDERED_UNIT="$(mktemp)"
trap 'rm -f "${RENDERED_UNIT}"' EXIT
sed -e "s|@SERVICE_USER@|${SERVICE_USER}|g" "${SERVICE_TEMPLATE}" > "${RENDERED_UNIT}"
if grep -qE '@[A-Z_]+@' "${RENDERED_UNIT}"; then
  echo "rendered systemd unit still carries unresolved @TOKEN@ placeholders; refusing to install" >&2
  exit 4
fi
scp "${RENDERED_UNIT}" "${TARGET}:/tmp/evo-ui.service"
ssh "${TARGET}" "sudo install -m 0644 /tmp/evo-ui.service /etc/systemd/system/evo-ui.service"

echo "[6/7] enable/restart service"
ssh "${TARGET}" "sudo systemctl daemon-reload && sudo systemctl enable evo-ui.service && sudo systemctl restart evo-ui.service"

echo "[7/7] status and smoke"
ssh "${TARGET}" "sudo systemctl --no-pager --full status evo-ui.service | sed -n '1,25p' && curl -I http://127.0.0.1:80/ | sed -n '1,5p'"

echo "deployed runtime+ui release=${RELEASE_ID} to ${TARGET}"
