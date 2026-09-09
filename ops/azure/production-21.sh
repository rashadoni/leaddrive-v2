#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${NEXTAUTH_URL}"
BASE_URL="${BASE_URL%/}"
[ -n "$BASE_URL" ] || { echo "::error::NEXTAUTH_URL secret is empty"; exit 1; }
for i in 1 2 3 4 5; do
  CODE=$(curl -s -o /tmp/ping-body -w '%{http_code}' --max-time 15 "$BASE_URL/api/v1/ping" || echo "000")
  echo "attempt $i/5: /api/v1/ping -> $CODE"
  if [ "$CODE" = "200" ]; then
    cat /tmp/ping-body; echo
    exit 0
  fi
  [ "$i" -lt 5 ] && sleep 10
done
echo "::error::/api/v1/ping did not return 200 after 5 attempts"
exit 1
