#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${NEXTAUTH_URL}"
BASE_URL="${BASE_URL%/}"
[ -n "$BASE_URL" ] || { echo "::error::NEXTAUTH_URL secret is empty"; exit 1; }
EXPECTED="$DEPLOY_TARGET_SHA"
for i in 1 2 3; do
  LIVE=$(curl --fail --silent --show-error --max-time 15 \
    --header 'Cache-Control: no-cache' \
    "$BASE_URL/api/v1/public/build-info?deploy=$DEPLOY_TARGET_SHA" \
    | sed -n 's/.*"artifactSha":"\([0-9a-f]\{40\}\)".*/\1/p')
  echo "attempt $i/3: live revision '${LIVE:-none}', expected '$EXPECTED'"
  if [ "$LIVE" = "$EXPECTED" ]; then
    exit 0
  fi
  [ "$i" -lt 3 ] && sleep 15
done
echo "::error::production is not serving ${EXPECTED} — check for a failed swap or a stale process"
exit 1
