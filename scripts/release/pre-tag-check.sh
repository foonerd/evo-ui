#!/usr/bin/env bash
#
# pre-tag-check.sh — run the full pre-tag verification chain
# before minting a release tag on this repository.
#
# This repository carries two workspaces:
#   - apps/evo-ui-shell (Node + TypeScript + Vite)
#   - apps/evo-ui-runtime (Rust; static-file server + reverse proxy)
#
# The pre-tag chain runs the appropriate gate per workspace plus
# the repo-wide leak grep.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

log_step() { printf '\n[pre-tag] %s\n' "$*" >&2; }
log_ok()   { printf '[pre-tag] OK: %s\n' "$*" >&2; }
log_fail() { printf '[pre-tag] FAIL: %s\n' "$*" >&2; }

# -------------------------------------------------------------
# Gate 1: shell contracts:test
# -------------------------------------------------------------

log_step "Gate 1/5: apps/evo-ui-shell contracts:test"
if ! (cd apps/evo-ui-shell && npm run contracts:test); then
    log_fail "shell contracts:test failed"
    exit 1
fi
log_ok "shell contracts pass"

# -------------------------------------------------------------
# Gate 2: shell build (vite)
# -------------------------------------------------------------

log_step "Gate 2/5: apps/evo-ui-shell build"
if ! (cd apps/evo-ui-shell && npm run build); then
    log_fail "shell build failed"
    exit 1
fi
log_ok "shell build clean"

# -------------------------------------------------------------
# Gate 3: evo-ui-runtime cargo gate (fmt + clippy + test + build)
# -------------------------------------------------------------

log_step "Gate 3/5: apps/evo-ui-runtime cargo fmt+clippy+test+build"
if ! cargo fmt --manifest-path apps/evo-ui-runtime/Cargo.toml --all -- --check; then
    log_fail "runtime fmt drift"
    exit 1
fi
if ! cargo clippy --manifest-path apps/evo-ui-runtime/Cargo.toml --all-targets --locked -- -D warnings; then
    log_fail "runtime clippy warnings"
    exit 1
fi
if ! cargo test --manifest-path apps/evo-ui-runtime/Cargo.toml --all-targets --locked; then
    log_fail "runtime tests failed"
    exit 1
fi
if ! cargo build --manifest-path apps/evo-ui-runtime/Cargo.toml --release --locked; then
    log_fail "runtime release build failed"
    exit 1
fi
log_ok "runtime cargo gate clean"

# -------------------------------------------------------------
# Gate 4: public-leak grep
# -------------------------------------------------------------

log_step "Gate 4/5: scripts/preflight/check-public-leaks.sh"
if [[ -x "${REPO_ROOT}/scripts/preflight/check-public-leaks.sh" ]]; then
    if ! bash "${REPO_ROOT}/scripts/preflight/check-public-leaks.sh"; then
        log_fail "leak gate hit"
        exit 1
    fi
else
    log_fail "scripts/preflight/check-public-leaks.sh missing"
    exit 1
fi

# -------------------------------------------------------------
# Gate 5: validate-evo-core-prereq
# -------------------------------------------------------------

log_step "Gate 5/5: scripts/validate-evo-core-prereq.sh"
if [[ -x "${REPO_ROOT}/scripts/validate-evo-core-prereq.sh" ]]; then
    if ! bash "${REPO_ROOT}/scripts/validate-evo-core-prereq.sh"; then
        log_fail "evo-core prereq check failed"
        exit 1
    fi
else
    log_step "  scripts/validate-evo-core-prereq.sh not present; skipping"
fi

cat >&2 <<'BANNER'

[pre-tag] All gates clean. Ready for tag mint.

Next step: mint the tag with the agreed format
  v<MAJOR>.<MINOR>.<PATCH>[.<CLOSURE>][-<PRERELEASE>]

After tagging, run scripts/release/promote.sh to drive the
eng -> public squash-and-scrub into evo-device-audio-ui.
BANNER
