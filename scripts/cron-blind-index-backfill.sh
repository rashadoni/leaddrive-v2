#!/bin/bash
# Slice-3 blind-index backfill cron driver.
#
# Drives the /api/cron/pii-blind-index-backfill endpoint until the
# response reports `hasMore: false` (or a max-iterations safety stop).
# Designed to be safe to run repeatedly — the route is idempotent.
#
# Do not add a checkout path to crontab. Add this script to the reviewed
# ops/cron/release-script-allowlist.txt before scheduling it from the external
# immutable operations release.
#
# Hourly is appropriate while a fresh wave of legacy rows is in play.
# After the WHERE filter goes empty the cron is a no-op (~1 SELECT
# per entity, no UPDATEs). Once production confirms zero work for a
# week+ the cadence can drop to daily, or the cron can be retired.

set -e

# Read only the values this driver needs from the canonical app environment.
# Do not source it: app.env contains values that are not safe shell input.
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
  TENANT_PII_MASTER_KEY="$(read_app_env_value TENANT_PII_MASTER_KEY)"
fi

APP_URL="${APP_URL:-http://localhost:3001}"
CRON_SECRET="${CRON_SECRET:-}"
# Per-entity batch size — keeps each HTTP request inside the route
# layer's effective budget. The cron route itself clamps to [1, 1000].
BATCH="${BLIND_INDEX_BATCH:-200}"
# Safety cap: stop after N iterations even if hasMore=true keeps
# coming back. Prevents a runaway loop on a misconfigured route.
MAX_ITER="${BLIND_INDEX_MAX_ITER:-50}"

if [ -z "$CRON_SECRET" ]; then
  echo "$(date): ERROR - CRON_SECRET not set"
  exit 1
fi

iter=0
total_updated=0

while [ "$iter" -lt "$MAX_ITER" ]; do
  iter=$((iter + 1))

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${APP_URL}/api/cron/pii-blind-index-backfill?maxRowsPerEntity=${BATCH}" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  # Strip the trailing HTTP-code line via `sed '$d'` rather than
  # `head -n -1` — GNU head supports negative N but macOS / BSD head
  # does not, so a dev smoke-testing this on macOS would otherwise see
  # BODY = entire response (including the code line) and the
  # `hasMore: false` grep would match prematurely on iter 1.
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "$(date): iter=${iter} HTTP=${HTTP_CODE} body=${BODY}"

  if [ "$HTTP_CODE" -ne 200 ]; then
    echo "$(date): ERROR - blind-index-backfill request failed"
    exit 1
  fi

  # Extract totalUpdated (best-effort grep — jq isn't a hard dep on
  # the prod host) and bump the running total.
  ITER_UPDATED=$(echo "$BODY" | grep -oE '"totalUpdated"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' || echo "0")
  total_updated=$((total_updated + ITER_UPDATED))

  # If the response reports no more work, stop.
  if echo "$BODY" | grep -q '"hasMore"[[:space:]]*:[[:space:]]*false'; then
    echo "$(date): done — totalUpdated across iterations=${total_updated}"
    exit 0
  fi
done

echo "$(date): WARN - hit MAX_ITER=${MAX_ITER}; totalUpdated=${total_updated}; will resume next tick"
exit 0
