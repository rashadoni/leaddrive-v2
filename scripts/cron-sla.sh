#!/bin/bash
# SLA Escalation Cron Script
# Do not add a checkout path to crontab. Add this script to the reviewed
# ops/cron/release-script-allowlist.txt before scheduling it from the external
# immutable operations release.

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

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${APP_URL}/api/cron/sla-escalation" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "$(date): HTTP ${HTTP_CODE} — ${BODY}"

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "$(date): ERROR - SLA escalation cron failed"
  exit 1
fi
