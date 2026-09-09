#!/bin/bash
# C9 #17 — Marketing Attribution incremental recompute DRAINER.
# Recomputes ONLY the active models flagged dirty (a deal entered/left a won
# stage) and compare-and-clears the flag — so a won deal updates attribution
# within ~1 minute without a Redis/BullMQ queue (Postgres-cron drainer pattern).
# The nightly cron-attribution-recompute.sh full sweep stays as the backstop.
#
# Add to crontab (every minute):
#   * * * * * /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-attribution-drain.sh >> /var/log/leaddrive-attribution-drain.log 2>&1

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

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${APP_URL}/api/cron/attribution-drain" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
# sed '$d' (drop last line) — BSD/macOS-safe, unlike GNU-only `head -n -1`.
BODY=$(echo "$RESPONSE" | sed '$d')

# Only log when work happened or on error — a per-minute "0 models" line would
# flood the log.
if [ "$HTTP_CODE" -ne 200 ]; then
  echo "$(date): [attribution-drain] ERROR HTTP ${HTTP_CODE} — ${BODY}"
  exit 1
elif ! echo "$BODY" | grep -q '"modelsRun":0'; then
  echo "$(date): [attribution-drain] ${BODY}"
fi
