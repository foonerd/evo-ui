#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Just a Nerd
#
# overlay-staged-ui.sh — put the already-built evo-ui-shell dist
# onto one box, in one invocation.
#
# This is NOT a runtime rebuild and not a distribution deploy.
# It does not touch evo-ui-runtime, kiosk, or plugins. It ships
# apps/evo-ui-shell/dist into /opt/evo/ui/releases/<utc>, points
# /opt/evo/ui/current at it, mirrors the flat /opt/evo/ui copy
# the steward serves, and restarts evo-ui when that unit exists.
#
# Usage:
#
#   scripts/overlay-staged-ui.sh <ipv4> [ssh-user]
#
#   The login comes from the second argument or $EVO_SSH_USER.
#   Addresses only.
#
# Exit codes:
#   0  overlay landed
#   1  bad invocation / local dist missing
#   2  target unreachable or not an evo box
#   3  transfer or install failed
#   4  no terminal for the sudo prompt

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "usage: $0 <ipv4> [ssh-user]" >&2
    echo "       ssh-user may instead come from \$EVO_SSH_USER." >&2
    exit 1
fi
TARGET_IP="$1"
if [[ ! "${TARGET_IP}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "FAIL: '${TARGET_IP}' is not an IPv4 address." >&2
    echo "      This script takes addresses, not hostnames." >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${REPO_ROOT}/apps/evo-ui-shell/dist"
SSH_USER="${2:-${EVO_SSH_USER:-}}"
if [[ -z "${SSH_USER}" ]]; then
    echo "FAIL: no ssh user given." >&2
    echo "      Pass it as the second argument or set EVO_SSH_USER." >&2
    exit 1
fi
SSH_TARGET="${SSH_USER}@${TARGET_IP}"

if [[ ! -f "${DIST}/index.html" ]]; then
    echo "FAIL: no built glass at ${DIST}/index.html." >&2
    echo "      Build evo-ui-shell before overlaying." >&2
    exit 1
fi

echo "=== overlay-staged-ui.sh ==="
echo "Target:  ${SSH_TARGET}"
echo "Staged:  ${DIST}"
echo

echo "[1/5] pre-flight ..."
ssh -o BatchMode=yes -o ConnectTimeout=5 "${SSH_TARGET}" 'true' \
    || { echo "  FAIL: keyless SSH to ${TARGET_IP} refused." >&2; exit 2; }
ssh "${SSH_TARGET}" 'test -d /opt/evo/ui' \
    || { echo "  FAIL: /opt/evo/ui missing — not an evo box." >&2; exit 2; }
echo "  ok"

if [[ ! -t 0 ]]; then
    echo "[2/5] FAIL: no terminal on which sudo could prompt." >&2
    echo "      Re-run from an interactive terminal." >&2
    exit 4
fi
echo "[2/5] terminal present for the sudo prompt ... ok"

REMOTE_TMP="/tmp/evo-ui-overlay.$$"
echo "[3/5] copy to ${TARGET_IP}:${REMOTE_TMP} ..."
ssh "${SSH_TARGET}" "rm -rf '${REMOTE_TMP}' && mkdir -p '${REMOTE_TMP}'"
scp -q -r "${DIST}/." "${SSH_TARGET}:${REMOTE_TMP}/" \
    || { echo "  FAIL: copying the glass failed." >&2; exit 3; }
echo "  ok"

echo "[4/5] verify the copy ..."
want="$(sha256sum "${DIST}/index.html" | cut -d' ' -f1)"
have="$(ssh "${SSH_TARGET}" "sha256sum '${REMOTE_TMP}/index.html' 2>/dev/null | cut -d' ' -f1")"
if [[ "${want}" != "${have}" ]]; then
    echo "  FAIL: index.html does not match what was sent." >&2
    echo "        sent ${want}, landed ${have:-<nothing>}" >&2
    echo "        Nothing has been installed; the box is untouched." >&2
    exit 3
fi
echo "  ok (${want})"

echo "[5/5] install and restart evo-ui (sudo will prompt) ..."
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
INSTALL_SCRIPT="set -e
RELEASE_DIR=/opt/evo/ui/releases/${RELEASE_ID}
sudo install -d -m 0755 -o ${SSH_USER} -g ${SSH_USER} /opt/evo/ui/releases /opt/evo/ui/data /opt/evo/ui/logs
sudo install -d -m 0755 -o ${SSH_USER} -g ${SSH_USER} \"\${RELEASE_DIR}\"
KEEP=
if [ ! -f ${REMOTE_TMP}/setup.html ] && [ -f /opt/evo/ui/setup.html ]; then
  KEEP=\$(mktemp)
  sudo cp -a /opt/evo/ui/setup.html \"\${KEEP}\"
fi
sudo cp -a ${REMOTE_TMP}/. \"\${RELEASE_DIR}/\"
sudo ln -sfn \"\${RELEASE_DIR}\" /opt/evo/ui/current
sudo cp -a ${REMOTE_TMP}/. /opt/evo/ui/
if [ -n \"\${KEEP}\" ]; then
  sudo install -m 0644 \"\${KEEP}\" /opt/evo/ui/setup.html
  sudo install -m 0644 \"\${KEEP}\" \"\${RELEASE_DIR}/setup.html\"
  rm -f \"\${KEEP}\"
fi
sudo chown -R ${SSH_USER}:${SSH_USER} /opt/evo/ui
rm -rf ${REMOTE_TMP}
if systemctl list-unit-files evo-ui.service >/dev/null 2>&1; then
  sudo systemctl restart evo-ui.service || true
fi"
ssh -t "${SSH_TARGET}" "${INSTALL_SCRIPT}" \
    || { echo "  FAIL: install or restart refused on ${TARGET_IP}." >&2; exit 3; }
echo "  ok"
echo

echo "=== on ${TARGET_IP} now ==="
ssh "${SSH_TARGET}" 'printf "  %-34s %s\n" /opt/evo/ui/current "$(readlink -f /opt/evo/ui/current)"; printf "  %-34s %s\n" index.html "$(sha256sum /opt/evo/ui/current/index.html | cut -d" " -f1)"'
