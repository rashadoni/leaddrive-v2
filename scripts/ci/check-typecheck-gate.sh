#!/usr/bin/env bash
# Blocking half of the TypeScript check: fails the PR on the error families that
# are never "just a type error", and — equally — on a typecheck that did not run.
#
# Usage: check-typecheck-gate.sh <log-file> <exit-code-file>
#
# Why the exit code matters as much as the log
# --------------------------------------------
# The gate used to grep the log alone. A log with no matching lines was read as
# "clean", but a typecheck that CRASHES also produces a log with no matching
# lines: `FATAL ERROR: ... heap out of memory` and nothing else. So an
# out-of-memory kill — which happens on this project, whose type graph needs a
# 12 GB heap — reported a green gate having checked nothing at all. The same
# went for `tsc: not found` and for a runner killed mid-run.
#
# That is precisely the failure this gate exists to prevent, one level up: a
# check that cannot fail. It was added on 2026-08-11 after an undefined variable
# reached production and white-screened the inbox, and it shipped with this hole
# on the same day.
#
# tsc's own exit codes are the discriminator (ExitStatus in the compiler):
#   0  no diagnostics
#   1  diagnostics reported, outputs skipped
#   2  diagnostics reported, outputs generated
#   3  invalid project
#   4  project reference cycle
# Anything else is not tsc speaking — it is tsc dying (134 abort/OOM, 137 SIGKILL,
# 127 command not found). 3 and 4 mean the project never compiled, so they are
# inconclusive too.
set -Eeuo pipefail

readonly LOG="${1:?usage: check-typecheck-gate.sh <log-file> <exit-code-file>}"
readonly CODE_FILE="${2:?usage: check-typecheck-gate.sh <log-file> <exit-code-file>}"

# Families that get no grace period while the type-error baseline is large:
#   TS1xxx          grammar — the file cannot be parsed, `next build` dies.
#   TS2307          an import resolving to nothing — webpack gives up.
#   TS2304 / TS2552 a name that does not exist. This one does NOT stop the
#                   build, because next.config sets typescript.ignoreBuildErrors;
#                   it ships and throws ReferenceError in the browser instead.
readonly BLOCKING='error (TS1[0-9]{3}|TS2307|TS2304|TS2552):'

inconclusive() {
  printf 'typecheck gate: %s\n' "$1" >&2
  printf 'Nothing was verified, so this is NOT a pass.\n' >&2
  if [ -f "$LOG" ]; then
    printf -- '--- last 20 lines of the typecheck log ---\n' >&2
    tail -20 "$LOG" >&2 || true
  fi
  exit 1
}

[ -f "$LOG" ] || inconclusive "no log file at $LOG — the typecheck step produced nothing."
[ -f "$CODE_FILE" ] || inconclusive "no exit-code file at $CODE_FILE — cannot tell a clean run from a crash."

code="$(tr -d '[:space:]' < "$CODE_FILE")"
case "$code" in
  0|1|2) ;;
  '') inconclusive "the exit-code file is empty." ;;
  *)  inconclusive "the typecheck exited $code, which is not a code tsc reports diagnostics with." ;;
esac

# Cross-check: a non-zero tsc exit means diagnostics were reported, so they must
# be in the log. If they are not, the log was truncated or redirected wrongly and
# grepping it proves nothing.
if [ "$code" != "0" ] && ! grep -q 'error TS' "$LOG"; then
  inconclusive "tsc exited $code but printed no diagnostics."
fi

if grep -Eq "$BLOCKING" "$LOG"; then
  echo "These break the production build, or ship a ReferenceError to the browser:"
  grep -E "$BLOCKING" "$LOG"
  exit 1
fi

echo "Typecheck completed (exit $code). No syntax, missing-module or undefined-name errors."
