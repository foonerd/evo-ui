#!/usr/bin/env bash
#
# check-public-leaks.sh — fail-fast guard against working-voice +
# decision-narrative leaks in evo-ui-eng source.
#
# The evo-ui-eng repository is engineering-tier; its source is
# released to the public evo-ui repository via squash-and-scrub.
# Several classes of identifier MUST NOT appear in the shipped
# artefacts because they describe the engineering process, not
# the running system:
#
#   1. ADR references (`ADR-NNNN`, `ADR-NNNN §M`). Decision-doc
#      identifiers are private to the engineering journal. Rewrite
#      each comment to describe the *constraint* directly ("the
#      universal collection pattern", "the three-affordance
#      breadcrumb", "the theme `domain_icons` contract") rather
#      than the doc that ratified it.
#
#   2. Internal-org identifiers (`framework delivery group`,
#      `UI team`, `delivery group`). Source should describe the
#      framework's current behaviour, not which agent / group
#      authored which change.
#
#   3. Release-version strings (`v0.1.13`, `0.1.13-RC`, etc.).
#      Source code is version-agnostic. Version pinning lives in
#      `Cargo.toml` / `package.json`, not in comments.
#
#   4. Specific operator-rig identifiers — IPs, hostnames,
#      service users. The framework's behaviour is generic; the
#      validation rig's particulars are operational artefacts
#      that live in evidence files, not in shipped source.
#
#   5. Chunk identifiers (`(S5a)`, `(U1)`, `chunk-NN`,
#      `wave-N`). These are release-engineering narrative
#      markers, not framework primitives.
#
#   6. Deferral language (`defer`, `deferral`, `postpone`,
#      `follow-on release`, `backlog`, `future release`).
#      Scope is a wall; "we will do this later" never appears in
#      shipped source. Either it's in scope and we did it, or
#      it's out of scope and the source doesn't mention it.
#
# Exits 0 when clean. Exits 1 with a punch list when any pattern
# matches.

set -eo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

SCAN_PATHS=(
    "apps/evo-ui-shell/src"
    "apps/evo-ui-shell/scripts"
    "apps/evo-ui-shell/tests"
    "apps/evo-ui-shell/docs"
    "apps/evo-ui-runtime/src"
    "docs"
    "scripts"
)

FAIL=0
PUNCH_LIST=""

scan_pattern() {
    local label="$1"
    local pattern="$2"
    local exclusion_egrep="${3:-^$}"

    # Exclude the guard family — this scanner and the control that
    # proves it fire — so pattern definitions documented in their
    # own comments, and the samples the control plants, do not
    # register as leaks against themselves. Named by exact path
    # rather than by folder, so a new file under scripts/preflight/
    # is scanned like anything else.
    local hits
    hits="$(grep -rnE "${pattern}" "${SCAN_PATHS[@]}" 2>/dev/null | \
            grep -vE "scripts/preflight/check-public-leaks(-positive)?\.sh:" | \
            grep -vE "${exclusion_egrep}" || true)"
    if [[ -n "${hits}" ]]; then
        FAIL=1
        PUNCH_LIST+="=== ${label} ===\n${hits}\n\n"
    fi
}

# 1. ADR identifiers.
scan_pattern "ADR identifiers" 'ADR-[0-9]{4}'

# 1b. Risk-register and parked-decision identifiers. The same
# family as the ADR reference above and private to the engineering
# journal for the same reason: a reader of the shipped source
# cannot consult the register, so the number tells them nothing
# the comment should not have said directly. Rewrite each to state
# the constraint it stands for.
#
# Word-bounded so a token that merely ends in the letter — a CSS
# custom property, a grid area, an identifier like `SENSOR-042` —
# cannot false-hit. Three digits minimum, matching the register's
# own numbering.
scan_pattern "Risk-register identifiers (R-NNN)" '\bR-[0-9]{3,}'
scan_pattern "Parked-decision identifiers (PD-NNN)" '\bPD-[0-9]{3,}'

# 2. Internal-org identifiers.
scan_pattern "Internal-org identifiers" \
    '(framework delivery group|UI team|delivery group)' \
    '/node_modules/|/dist/'

# 3. Release-version strings.
scan_pattern "Release-version strings" 'v?0\.1\.[0-9]+\b'

# 4. Rig identifiers.
scan_pattern "Rig identifiers (IPs / hostnames / users)" \
    '(192\.168\.30\.[0-9]+|evoproto|pi5target|x64proto|nucproto|[Ii][Nn][Tt][Rr][Aa][Nn][Ee][Tt]|[Ss]ernik|intranet\.lan|KITCHEN)'

# 5. Chunk / wave / phase / track identifiers.
#
# The numeric+suffix-letter forms ("Wave 2C", "Track 4N",
# "Chunk 3a") are common in the engineering journal. The
# regex carries an optional trailing letter so suffix-letter
# variants do not slip past the gate (a boot.tsx leak in the
# 2026-05-21 sweep hid behind a tighter pattern that required
# a word boundary immediately after the digit).
scan_pattern "Chunk / wave / phase / track identifiers" \
    '(\(S[0-9][a-z]?\)|\(U[0-9]\)|\bchunk-[0-9]+\b|\bwave-[0-9]+\b|\bChunk [0-9]+[A-Za-z]?\b|\bWave [0-9]+[A-Za-z]?\b|\bPhase [0-9]+\b|\bTrack [0-9]+[A-Za-z]?\b)' \
    'IMPLEMENTATION_CHUNK_'

# 6. Deferral language.
scan_pattern "Deferral language" \
    '\b(defer|deferral|deferred|postpone|postponed|follow-on (release|cycle)|backlog|future release|future cycle)\b' \
    '/node_modules/'

# 7. Real-name attributions.
#
# The project's canonical copyright / license / commit-
# attribution name is "Just a Nerd". Source comments must not
# carry the real first name or email prefix that git config
# happens to hold — those are operational artefacts that don't
# belong in shipped source. Rewrite each hit to describe the
# constraint or decision directly (e.g. "locked 2026-07-13")
# rather than the person who ratified it.
scan_pattern "Real-name attributions" \
    '\b(Andrew|andser)\b' \
    '/node_modules/|/dist/'

# 8. Engineering-tier repository names.
#
# Names of private engineering-tier repositories (evo-internal,
# evo-core-eng, evo-device-audio-eng, evo-catalogue-schemas,
# and the ui-eng repo itself) must not appear in shipped source.
# The public evo-ui / evo-core / evo-device-audio repos exist —
# those names are fine. Rewrite each hit to describe the artefact
# or contract directly ("the framework's list_plugins surface",
# "the shelf's published schema", "the reference plugin
# manifest") rather than name-dropping the engineering repo the
# artefact was authored in.
scan_pattern "Engineering-tier repository names" \
    '\b(evo-internal|evo-core-eng|evo-device-audio-eng|evo-catalogue-schemas|evo-ui-eng)\b' \
    '/node_modules/|/dist/'

if [[ "${FAIL}" -ne 0 ]]; then
    printf '%b' "${PUNCH_LIST}"
    echo
    echo "FAIL: public-leak patterns detected. Rewrite each comment"
    echo "      to describe the constraint directly, then re-run this"
    echo "      check before committing."
    exit 1
fi

echo "OK: public-leak scan clean across ${SCAN_PATHS[*]}"
exit 0
