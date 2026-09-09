#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   CRONTAB="$(crontab -l 2>/dev/null)"
   ACTIVE_COUNT="$(printf "%s\n" "$CRONTAB" | awk '\''
     $0 !~ /^[[:space:]]*#/ &&
     $0 ~ /cron-trigger\.sh \/api\/cron\/mtm-cleanup/ { count++ }
     END { print count + 0 }
   '\'')"
   if [ "$ACTIVE_COUNT" -ne 1 ]; then
     echo "FATAL: expected exactly one active MTM cleanup cron; found $ACTIVE_COUNT"
     exit 1
   fi
   if ! systemctl is-active --quiet cron.service; then
     echo "FATAL: cron.service is not active"
     exit 1
   fi
   SMOKE_OUTPUT="$(CRON_TRIGGER_LOCK_WAIT_SECONDS=120 /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh /api/cron/mtm-cleanup)"
   printf "%s\n" "$SMOKE_OUTPUT"
   if ! printf "%s\n" "$SMOKE_OUTPUT" | grep -Fq '\''"success":true'\''; then
     echo "FATAL: MTM cleanup trigger did not complete successfully"
     exit 1
   fi
   APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
   DATABASE_URL="$(sed -nE "s/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*(.*)$/\1/p" "$APP_ENV_FILE" | tail -1)"
   DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
   [ -n "$DATABASE_URL" ] || { echo "FATAL: DATABASE_URL not found in canonical app environment"; exit 1; }
   HEARTBEAT="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF "|" -c "
     SELECT \"name\", (\"lastCompletedAt\" >= now() - make_interval(mins => 5))
     FROM \"system_job_leases\"
     ORDER BY \"name\"")"
   printf "%s\n" "$HEARTBEAT"
   if ! printf "%s\n" "$HEARTBEAT" | grep -Fx mtm-cleanup\|t; then
     echo "FATAL: MTM cleanup lease is missing or lacks a fresh completed heartbeat"
     exit 1
   fi'
