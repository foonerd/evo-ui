#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Just a Nerd
#
# set-cut-version.sh - cut(V): write the named cut version through
# this repo so the slot key and the tarball name carry it.
#
# There is one operation, cut(V). V is the operator's input, four
# components (MAJOR.MINOR.PATCH.CUT), and cutting a V that already
# has bytes is cut(V) again, not the next number. The cut version
# lives in VERSION at the repo root; the piece publisher reads it
# for the slot key. Cargo and npm carry three-part versions and
# receive the first three components of V - they never decide V,
# and the fourth component is never dropped from the slot key.
#
# Writes:
#   VERSION                              V
#   apps/evo-ui-shell/package.json       MAJOR.MINOR.PATCH
#   apps/evo-ui-runtime/Cargo.toml       MAJOR.MINOR.PATCH
#   apps/evo-ui-runtime/Cargo.lock       the evo-ui-runtime entry
#
# Usage: scripts/release/set-cut-version.sh V
set -euo pipefail

V="${1:-}"
if ! [[ "${V}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "cut(V): V must be MAJOR.MINOR.PATCH.CUT, got '${V}'" >&2
    exit 2
fi
THREE="${V%.*}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

printf '%s\n' "${V}" > VERSION

PKG=apps/evo-ui-shell/package.json
python3 - "${PKG}" "${THREE}" <<'PY'
import json, sys
path, three = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["version"] = three
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

TOML=apps/evo-ui-runtime/Cargo.toml
python3 - "${TOML}" "${THREE}" <<'PY'
import re, sys
path, three = sys.argv[1], sys.argv[2]
src = open(path).read()
out, n = re.subn(r'^version = "[^"]*"', f'version = "{three}"', src, count=1, flags=re.M)
if n != 1:
    sys.exit("cut(V): no version line in " + path)
open(path, "w").write(out)
PY

LOCK=apps/evo-ui-runtime/Cargo.lock
python3 - "${LOCK}" "${THREE}" <<'PY'
import re, sys
path, three = sys.argv[1], sys.argv[2]
src = open(path).read()
out, n = re.subn(r'(name = "evo-ui-runtime"\nversion = )"[^"]*"', rf'\1"{three}"', src, count=1)
if n != 1:
    sys.exit("cut(V): no evo-ui-runtime entry in " + path)
open(path, "w").write(out)
PY

echo "cut(${V}): VERSION=${V}; package.json and Cargo.toml carry ${THREE}"
