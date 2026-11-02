#!/usr/bin/env bash
# Decide whether owner-operated evidence bound to an earlier main SHA may be
# used by a run on the current main SHA.
#
# The owner chain (key receipt -> backup -> restore -> certification) used to
# require one main SHA from the first step to the last. Other sessions merge
# into main every hour or so, so the chain could never finish (2026-10-22: four
# merges in one evening, each invalidating a finished step). An earlier SHA is
# accepted only when
#   - it is an ancestor of the current main, and
#   - not one byte of the recovery code changed between them: the backup and
#     verifier programs, the owner workbench, the recovery units, the protected
#     workflow and its actions.
# Everything that judges the evidence is then byte-identical to what produced
# it, so a newer SHA changes nothing the evidence is checked against.
#
# usage: evidence-main-window.sh EVIDENCE_MAIN_SHA CURRENT_MAIN_SHA
# Run inside a checkout that has both commits. Prints nothing on success.
set -Eeuo pipefail

RECOVERY_PATHS=(
  scripts/backup
  ops/backup
  ops/systemd
  .github/actions
  .github/workflows/owner-recovery-proof.yml
)

fail() {
  printf 'evidence main window: %s\n' "$*" >&2
  exit 1
}

evidence_sha="${1:-}"
current_sha="${2:-}"
[ "$#" -eq 2 ] || fail "usage: evidence-main-window.sh EVIDENCE_MAIN_SHA CURRENT_MAIN_SHA"
[[ "$evidence_sha" =~ ^[0-9a-f]{40}$ ]] || fail "evidence main SHA must be an exact lowercase Git SHA"
[[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || fail "current main SHA must be an exact lowercase Git SHA"
[ "$evidence_sha" = "$current_sha" ] && exit 0

[ "$(git rev-parse --verify --quiet "$evidence_sha^{commit}")" = "$evidence_sha" ] \
  || fail "evidence main SHA is not available in this checkout"
[ "$(git rev-parse --verify --quiet "$current_sha^{commit}")" = "$current_sha" ] \
  || fail "current main SHA is not available in this checkout"
git merge-base --is-ancestor "$evidence_sha" "$current_sha" \
  || fail "evidence main SHA is not an ancestor of the current main"

changed="$(git diff --name-only "$evidence_sha" "$current_sha" -- "${RECOVERY_PATHS[@]}")" \
  || fail "cannot compare recovery code between the two SHAs"
[ -z "$changed" ] || {
  printf '%s\n' "$changed" | head -n 20 | sed 's/^/  changed: /' >&2
  fail "recovery code changed since the evidence was produced; produce it again on the current main"
}
