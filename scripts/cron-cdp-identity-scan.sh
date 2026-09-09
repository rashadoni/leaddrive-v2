#!/bin/bash
# CDP Identity Resolution — fuzzy duplicate-scan cron.
# Daily sweep over each tenant's unified profiles that surfaces *similar*
# (fuzzy) duplicate pairs into the /cdp/merge-queue operator queue. Complements
# cron-cdp-profile-refresh.sh (hourly): refresh BUILDS profiles + auto-merges
# exact identity collisions; this scan finds the near-duplicates exact matching
# misses. It never merges — every hit is queued `pending` for human review.
#
# Add to crontab (daily, after the hourly refresh has had a chance to run):
#   0 3 * * * /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-cdp-identity-scan.sh >> /var/log/leaddrive-cdp-cron.log 2>&1

# Read only the cron credential from the canonical app environment. Do not
# source it: app.env contains values that are not safe shell input.
APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
read_app_env_value() {
  local key="$1" value first last
  [ -f "$APP_ENV_FILE" ] || return 0
  value="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*(.*)$/\2/p" "$APP_ENV_FILE" | tail -1)"
  value="${value%$'\r'}"
  if [ "${#value}" -ge 2 ]; then
    first="${value:0:1}"
    last="${value: -1}"
    if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}
if [ -f "$APP_ENV_FILE" ]; then
  CRON_SECRET="$(read_app_env_value CRON_SECRET)"
fi

# Default to localhost:3001 (PM2 process)
APP_URL="${APP_URL:-http://localhost:3001}"
CRON_SECRET="${CRON_SECRET:-}"

if [ -z "$CRON_SECRET" ]; then
  echo "$(date): ERROR - CRON_SECRET not set"
  exit 1
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${APP_URL}/api/cron/cdp-identity-scan" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
# `sed '$d'` (drop last line), not `head -n -1` — the latter is GNU-only and
# fails on macOS/BSD. Same lesson as scripts/cron-cdp-profile-refresh.sh.
BODY=$(echo "$RESPONSE" | sed '$d')

echo "$(date): HTTP ${HTTP_CODE} — ${BODY}"

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "$(date): ERROR - CDP identity-scan cron failed"
  exit 1
fi
