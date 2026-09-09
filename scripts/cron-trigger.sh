#!/bin/bash
# Generic cron trigger — POSTs to a local cron endpoint with CRON_SECRET.
# Usage:  cron-trigger.sh <cron-endpoint-name|/absolute/api/path>
#   CRON_TRIGGER_LOCK_WAIT_SECONDS=<n>  wait up to n seconds for the local
#     lock instead of skipping. For verifiers that must see a response;
#     scheduled ticks leave it unset. See the lock block below.
# Mirrors scripts/cron-cdp-profile-refresh.sh (POST + x-cron-secret, localhost:3001).
# Crontab lines are installed by scripts/install-contract-crons.sh.
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "$(date): ERROR - cron endpoint required"
  exit 1
fi

case "$TARGET" in
  /*) ENDPOINT="$TARGET" ;;
  *) ENDPOINT="/api/cron/$TARGET" ;;
esac
case "$ENDPOINT" in
  /api/*) ;;
  *) echo "$(date): ERROR - endpoint must stay under /api"; exit 1 ;;
esac

NAME="$(printf '%s' "$TARGET" | tr -c 'A-Za-z0-9_.-' '_')"

# Load only CRON_SECRET as data; never source or execute the canonical app
# environment, which may contain values that are not safe shell input.
APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
if [ -z "${CRON_SECRET:-}" ] && [ -f "$APP_ENV_FILE" ]; then
  CRON_SECRET="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?CRON_SECRET[[:space:]]*=[[:space:]]*(.*)$/\2/p' "$APP_ENV_FILE" | tail -1)"
  CRON_SECRET="${CRON_SECRET%$'\r'}"
  if [ "${#CRON_SECRET}" -ge 2 ]; then
    FIRST="${CRON_SECRET:0:1}"
    LAST="${CRON_SECRET: -1}"
    if { [ "$FIRST" = '"' ] && [ "$LAST" = '"' ]; } || { [ "$FIRST" = "'" ] && [ "$LAST" = "'" ]; }; then
      CRON_SECRET="${CRON_SECRET:1:${#CRON_SECRET}-2}"
    fi
  fi
fi

APP_URL="${APP_URL:-http://localhost:3001}"
CRON_SECRET="${CRON_SECRET:-}"

if [ -z "$CRON_SECRET" ]; then
  echo "$(date): [${NAME}] ERROR - CRON_SECRET not set"
  exit 1
fi

# Local flock avoids stacking repeated ticks on this server. PostgreSQL's
# SystemJobLease remains the cross-process/cross-server correctness boundary.
#
# Scheduled ticks must never queue: a `* * * * *` line that blocked would stack
# one waiting process per minute for as long as the holder runs. They keep the
# non-blocking default and skip.
#
# A verifier is the opposite case, and the reason CRON_TRIGGER_LOCK_WAIT_SECONDS
# exists. The deploy workflow runs this script to prove a scheduler answers, and
# SKIPPED tells it nothing at all — the endpoint was never called. Passing that
# off as success would let an unverified scheduler through the gate that exists
# to catch exactly the silently-broken one; failing on it turns ordinary lock
# contention with the every-minute schedule into a red deploy over healthy
# production, which is what happened on 2026-08-31. Neither answer is available
# from a skip, so such callers wait for the holder instead and assert against a
# real response. Still locked when the budget runs out IS a genuine failure:
# nothing on this box should hold a cron lock that long.
#
# The budget only bites when the caller's target string matches a crontab line
# byte for byte, because the lock name is derived from the whole target: the
# workflow's `/api/cron/mtm-cleanup` shares a lock with the schedule, while its
# `/api/cron/commitment-escalation?smoke=1` gets one of its own.
LOCK_DIR="${CRON_LOCK_DIR:-/run/lock}"
mkdir -p "$LOCK_DIR"
exec 9>"${LOCK_DIR}/leaddrive-${NAME}.lock"

LOCK_WAIT_SECONDS="${CRON_TRIGGER_LOCK_WAIT_SECONDS:-0}"
case "$LOCK_WAIT_SECONDS" in
  '' | *[!0-9]*)
    echo "$(date): [${NAME}] ERROR - CRON_TRIGGER_LOCK_WAIT_SECONDS must be whole seconds" >&2
    exit 1
    ;;
esac

if [ "$LOCK_WAIT_SECONDS" -gt 0 ]; then
  # Waiting callers capture stdout to assert on the endpoint's response, so the
  # line explaining why there is no response must not land inside the text being
  # asserted — and under `set -e` a captured failure is never echoed back at all.
  # Crontab lines redirect 2>&1 into the cron log, so stderr loses nothing there.
  if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
    echo "$(date): [${NAME}] ERROR - lock still held after ${LOCK_WAIT_SECONDS}s; endpoint never called" >&2
    exit 1
  fi
elif ! flock -n 9; then
  echo "$(date): [${NAME}] SKIPPED - previous local invocation still running"
  exit 0
fi

set +e
RESPONSE=$(curl -sS --max-time "${CRON_MAX_TIME_SECONDS:-840}" -w "\n%{http_code}" -X POST "${APP_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}")
CURL_STATUS=$?
set -e

if [ "$CURL_STATUS" -ne 0 ]; then
  echo "$(date): [${NAME}] ERROR - curl exited ${CURL_STATUS}"
  exit "$CURL_STATUS"
fi

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
# sed '$d' (drop last line) — BSD/macOS-safe, unlike GNU-only `head -n -1`.
BODY=$(echo "$RESPONSE" | sed '$d')

# The body is truncated on success and kept whole on failure. Not a style
# choice: /api/cron/mtm-shelf-backstop answers with ~1.1 MB of JSON and runs
# every minute, so logging it in full wrote roughly 900 MB per hour into
# /var/log/leaddrive-cron.log — onto the filesystem holding the database, and
# from there into off-box storage that is immutable for a year.
#
# The reason these lines log at all is to make a failing cron visible; the old
# crontab wrote to /dev/null, so a job returning 401 for a year looked exactly
# like a working one. A status line plus the first few hundred characters keeps
# that, and a failure still prints everything the endpoint said.
BODY_MAX="${CRON_LOG_BODY_MAX:-800}"

# Truncation hides the thing worth reading. Several of these endpoints answer
# HTTP 200 while reporting per-item trouble INSIDE the body — a poller whose
# provider token expired, an organisation that failed while others succeeded —
# and those markers can sit past the cut. Volume comes from arrays of ids, not
# from errors, so the rule keys on content rather than length: anything that
# looks like a failure is logged whole, whatever its size.
body_reports_trouble() {
  printf '%s' "$1" | grep -qiE '"success"[[:space:]]*:[[:space:]]*false|"error"|"errors"[[:space:]]*:[[:space:]]*\[[^]]|"[a-z]*[Ff]ailed[A-Za-z]*"[[:space:]]*:[[:space:]]*[1-9]'
}

if [ "$HTTP_CODE" -eq 200 ] && [ "${#BODY}" -gt "$BODY_MAX" ] && ! body_reports_trouble "$BODY"; then
  echo "$(date): [${NAME}] HTTP ${HTTP_CODE} — $(printf '%s' "$BODY" | head -c "$BODY_MAX")… [truncated, ${#BODY} bytes]"
else
  echo "$(date): [${NAME}] HTTP ${HTTP_CODE} — ${BODY}"
fi

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "$(date): [${NAME}] ERROR - cron failed"
  exit 1
fi
