#!/usr/bin/env bash
#
# check-cargo-workout.sh — compulsory commit entry gate for the
# Rust UI runtime crate. Shell/npm work is a separate gate.
#
# Usage:
#   scripts/check-cargo-workout.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${REPO_ROOT}/apps/evo-ui-runtime"
cd "${CRATE_DIR}"

TOOLCHAIN="${CARGO_TOOLCHAIN:-1.85}"

log_step() { printf '\n[workout] %s\n' "$*" >&2; }
log_ok()   { printf '[workout] OK: %s\n' "$*" >&2; }
log_fail() { printf '[workout] FAIL: %s\n' "$*" >&2; }

unset CARGO_TARGET_DIR

log_step "1/5 cargo +${TOOLCHAIN} clean"
cargo "+${TOOLCHAIN}" clean
log_ok "clean"

log_step "2/5 cargo +${TOOLCHAIN} fmt --all -- --check"
if ! cargo "+${TOOLCHAIN}" fmt --all -- --check; then
    log_fail "fmt drift. Fix: cargo +${TOOLCHAIN} fmt --all"
    exit 1
fi
log_ok "fmt"

log_step "3/5 cargo +${TOOLCHAIN} clippy --workspace --all-targets -- -D warnings"
if ! cargo "+${TOOLCHAIN}" clippy --workspace --all-targets -- -D warnings; then
    log_fail "clippy -D warnings"
    exit 1
fi
log_ok "clippy"

log_step "4/5 cargo +${TOOLCHAIN} test --workspace"
if ! cargo "+${TOOLCHAIN}" test --workspace; then
    log_fail "tests"
    exit 1
fi
log_ok "test"

log_step "5/5 RUSTDOCFLAGS='-D warnings' cargo +${TOOLCHAIN} doc --workspace --no-deps"
if ! RUSTDOCFLAGS='-D warnings' cargo "+${TOOLCHAIN}" doc --workspace --no-deps; then
    log_fail "rustdoc -D warnings (intra-doc links, private links, HTML, rustdoc lints)"
    exit 1
fi
log_ok "rustdoc"

printf '\n[workout] all five steps clean (toolchain +%s, evo-ui-runtime).\n' \
    "${TOOLCHAIN}" >&2
