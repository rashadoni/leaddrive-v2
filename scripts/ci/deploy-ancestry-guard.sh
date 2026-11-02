#!/usr/bin/env bash
# Refuse to deploy a commit production has already moved past.
#
# The deploy job's lock (`concurrency: production-deploy`) orders deploys by
# the moment each run becomes READY — its checks and build both done — not by
# the age of its commit. On 2026-11-02 run 41433109030 (20b932824, pushed
# 10:59) had checks that ran 30 minutes, while run 41434296719 (6934a7a9b,
# pushed 11:07, a descendant) finished checks and build by 11:27. The newer
# run took the free slot and deployed; the older one became ready at 11:29,
# queued behind it with no newer run to replace it, and deployed at 11:54 —
# production went back to older code (undoing #1249) until the next deploy at
# 12:10. Concurrency cannot express "newest commit wins", so the deploy job
# asks production what it serves once it already holds the lock.
#
# Usage: deploy-ancestry-guard.sh <target-sha> <build-info-url> <repository-url>
#
# Writes skip=true|false to $GITHUB_OUTPUT when it is set and prints one line
# starting with "deploy-ancestry-guard:". It skips ONLY when the target is a
# strict ancestor of the live revision. Redeploying the live revision, moving
# forward, and every case it cannot decide (production down, no artifactSha,
# a revision missing from the repository) deploy as before: a production that
# does not answer is exactly the one a deploy may have to fix. A deliberate
# rollback goes through the workflow_dispatch recovery_sha path, which does
# not run this guard.
set -euo pipefail

TARGET="${1:-}"
BUILD_INFO_URL="${2:-}"
REPO_URL="${3:-}"

[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || {
  echo "::error::deploy-ancestry-guard: target '$TARGET' is not a full commit SHA"
  exit 1
}
[ -n "$BUILD_INFO_URL" ] && [ -n "$REPO_URL" ] || {
  echo "::error::usage: deploy-ancestry-guard.sh <target-sha> <build-info-url> <repository-url>"
  exit 1
}

decide() {
  local skip="$1" message="$2"
  echo "deploy-ancestry-guard: $message"
  if [ "$skip" = true ]; then
    echo "::notice title=Deploy skipped::$message"
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "skip=$skip" >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

undecided() {
  echo "::warning::deploy-ancestry-guard: $1; deploying $TARGET without the ancestry check"
  decide false "deploy $TARGET (ancestry not checked: $1)"
}

BUILD_INFO="$(curl --fail --silent --show-error --max-time 15 \
  --header 'Cache-Control: no-cache' "$BUILD_INFO_URL" 2>&1)" \
  || undecided "production build-info did not answer ($BUILD_INFO)"
LIVE="$(printf '%s' "$BUILD_INFO" | sed -n 's/.*"artifactSha":"\([0-9a-f]\{40\}\)".*/\1/p')"
[ -n "$LIVE" ] || undecided "production build-info has no artifactSha"

if [ "$LIVE" = "$TARGET" ]; then
  decide false "deploy $TARGET: production already serves it, redeploying the same revision"
fi

# Commits only (no trees, no blobs): the whole main history is a few MB and
# under a second, and the deploy checkout itself stays shallow and untouched.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git init --quiet "$WORK"
fetch() {
  git -C "$WORK" -c protocol.version=2 fetch --quiet --no-tags --filter=tree:0 "$REPO_URL" "$1" 2>&1
}
FETCH_LOG="$(fetch "$TARGET")" || undecided "cannot fetch target $TARGET ($FETCH_LOG)"
FETCH_LOG="$(fetch "$LIVE")" || undecided "live revision $LIVE is not in the repository ($FETCH_LOG)"

if git -C "$WORK" merge-base --is-ancestor "$TARGET" "$LIVE"; then
  decide true "skip $TARGET: production already serves $LIVE, which contains it; deploying it would roll production back"
fi
if git -C "$WORK" merge-base --is-ancestor "$LIVE" "$TARGET"; then
  decide false "deploy $TARGET: it moves production forward from $LIVE"
fi
echo "::warning::deploy-ancestry-guard: $TARGET and live $LIVE have diverged (neither contains the other)"
decide false "deploy $TARGET: diverged from live $LIVE, not a rollback by ancestry"
