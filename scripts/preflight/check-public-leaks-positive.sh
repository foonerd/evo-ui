#!/usr/bin/env bash
#
# check-public-leaks-positive.sh — prove the public-leak gate fires.
#
# A clean run of check-public-leaks.sh is not evidence. It is a
# negative from an instrument nobody has shown can report a
# positive, and a class that matches nothing passes every file ever
# written. That is not hypothetical here: a risk-register number sat
# in shipped source, inside a directory the gate scans, and passed
# every run — because the gate had no class for it. A class that is
# absent and a class that is broken look identical from the outside,
# and both look like success.
#
# This reads the class list out of the gate itself, plants a sample
# for each one in a throwaway tree, and asserts the gate reports
# that class by name. A class added to the gate without a plant
# fails this control rather than passing unproven.
#
# The plant never touches the working tree: the gate is copied into
# a temporary directory whose layout mirrors the scanned paths, and
# run from there.
#
# Exits 0 only when every class is proved and the unplanted tree is
# clean.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="${REPO_ROOT}/scripts/preflight/check-public-leaks.sh"
if [[ ! -f "${GATE}" ]]; then
    echo "positive-control: gate missing: ${GATE}" >&2
    exit 1
fi

# The classes the gate defines, in its own words. Read from the gate
# so the two cannot drift apart.
mapfile -t CLASSES < <(
    grep -oE '^scan_pattern "[^"]+"' "${GATE}" \
        | sed 's/^scan_pattern "//; s/"$//'
)
if [[ ${#CLASSES[@]} -eq 0 ]]; then
    echo "positive-control: no classes found in ${GATE}." >&2
    exit 1
fi

# Sample text for each class. Two parallel lists rather than a
# `case`, because a case label is a glob and these labels carry
# characters a glob would reinterpret.
#
# Each sample is chosen to trigger exactly one class, so a header
# appearing in the output is evidence about that class and not about
# a neighbour that happened to match the same line.
SAMPLE_KEYS=(
    "ADR identifiers"
    "Risk-register identifiers (R-NNN)"
    "Parked-decision identifiers (PD-NNN)"
    "Internal-org identifiers"
    "Release-version strings"
    "Rig identifiers (IPs / hostnames / users)"
    "Chunk / wave / phase / track identifiers"
    "Deferral language"
    "Real-name attributions"
    "Engineering-tier repository names"
)
SAMPLE_VALS=(
    "see ADR-0161 for the rationale"
    "R-042 covers this"
    "PD-017 covers this"
    "handed over by the UI team"
    "shipped in v0.1.13"
    "reachable at 192.168.30.24"
    "landed in chunk-12"
    "deferred to the next cycle"
    "reviewed by Andrew"
    "mirrored from evo-internal"
)

sample_for() {
    local want="$1" i
    for i in "${!SAMPLE_KEYS[@]}"; do
        # POSIX string equality: `[[ = ]]` would glob the right side.
        if [ "${SAMPLE_KEYS[$i]}" = "${want}" ]; then
            printf '%s' "${SAMPLE_VALS[$i]}"
            return 0
        fi
    done
    return 1
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/ui-leak-positive.XXXXXX")"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

# Mirror enough of the repository for the gate to run against: the
# gate resolves its own root from where it sits, and scans a fixed
# list of directories relative to that root.
mkdir -p "${WORKDIR}/scripts/preflight"
cp "${GATE}" "${WORKDIR}/scripts/preflight/check-public-leaks.sh"
chmod +x "${WORKDIR}/scripts/preflight/check-public-leaks.sh"
mapfile -t SCANNED < <(
    sed -n '/^SCAN_PATHS=(/,/^)/p' "${GATE}" \
        | sed -n 's/^[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p'
)
if [[ ${#SCANNED[@]} -eq 0 ]]; then
    echo "positive-control: no SCAN_PATHS found in ${GATE}." >&2
    exit 1
fi
for d in "${SCANNED[@]}"; do
    mkdir -p "${WORKDIR}/${d}"
done

# The plant lands in the first scanned directory, in a file whose
# name and path trip none of the exclusions any class carries.
PLANT_DIR="${WORKDIR}/${SCANNED[0]}"
PLANT_FILE="${PLANT_DIR}/positive-control-plant.txt"

run_gate() {
    ( cd "${WORKDIR}" \
        && bash "scripts/preflight/check-public-leaks.sh" ) \
        >"${WORKDIR}/out.txt" 2>&1
}

# The unplanted case first: if an empty tree were reported as
# failing, every assertion below would pass for the wrong reason.
rm -f "${PLANT_FILE}"
if ! run_gate; then
    echo "positive-control: an unplanted tree FAILED." >&2
    cat "${WORKDIR}/out.txt" >&2
    exit 1
fi

for class in "${CLASSES[@]}"; do
    if ! sample="$(sample_for "${class}")"; then
        echo "positive-control: no plant for class: ${class}" >&2
        echo "The gate defines it and nothing here triggers it, so" >&2
        echo "it would pass unproven. Add a sample to SAMPLE_KEYS /" >&2
        echo "SAMPLE_VALS." >&2
        exit 1
    fi
    printf '%s\n' "${sample}" >"${PLANT_FILE}"
    if run_gate; then
        echo "positive-control: planted '${sample}' was CLEAN." >&2
        echo "The class ${class} matches nothing." >&2
        cat "${WORKDIR}/out.txt" >&2
        exit 1
    fi
    if ! grep -Fq "=== ${class} ===" "${WORKDIR}/out.txt"; then
        echo "positive-control: the tree was rejected but ${class}" >&2
        echo "was not the class that reported it." >&2
        cat "${WORKDIR}/out.txt" >&2
        exit 1
    fi
done

rm -f "${PLANT_FILE}"
if ! run_gate; then
    echo "positive-control: the tree still FAILS after unplanting." >&2
    cat "${WORKDIR}/out.txt" >&2
    exit 1
fi

echo "positive-control: ${#CLASSES[@]} classes caught; unplanted tree clean."
exit 0
