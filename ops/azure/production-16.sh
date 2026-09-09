#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   CRONTAB="$(crontab -l 2>/dev/null)"
   ACTIVE_COUNT="$(printf "%s\n" "$CRONTAB" | awk '\''
     $0 !~ /^[[:space:]]*#/ &&
     $0 ~ /cron-trigger\.sh \/api\/cron\/voice-call-queues/ { count++ }
     END { print count + 0 }
   '\'')"
   if [ "$ACTIVE_COUNT" -ne 1 ]; then
     echo "FATAL: expected exactly one active AI-call queue cron; found $ACTIVE_COUNT"
     exit 1
   fi
   APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
   [ -f "$APP_ENV_FILE" ] || { echo "FATAL: canonical app environment missing"; exit 1; }
   QUEUE_FLAG="$(sed -nE '\''s/^[[:space:]]*VOICE_CALL_QUEUE_EXECUTION_ENABLED[[:space:]]*=[[:space:]]*(.*)$/\1/p'\'' "$APP_ENV_FILE" | tail -1 | tr -d '\''\r"'\'')"
   SMOKE_OUTPUT="$(CRON_TRIGGER_LOCK_WAIT_SECONDS=120 /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh /api/cron/voice-call-queues)"
   printf "%s\n" "$SMOKE_OUTPUT"
   # The cron must answer, whichever side of the fence it is on: a
   # scheduler that errors is a scheduler nobody notices is broken.
   if ! printf "%s\n" "$SMOKE_OUTPUT" | grep -Fq '\''"success":true'\''; then
     echo "FATAL: AI-call queue cron did not return success"
     exit 1
   fi
   if [ "$QUEUE_FLAG" = "true" ]; then
     echo "AI-call queue execution is ENABLED for this deployment (owner decision, 2026-08-13)."
   else
     # Still disabled: the cron must be a strict no-op, or something is
     # dispatching calls the fence was supposed to be holding back.
     if ! printf "%s\n" "$SMOKE_OUTPUT" | grep -Fq '\''"dispatching":0'\''; then
       echo "FATAL: disabled AI-call queue cron was not a successful no-op"
       exit 1
     fi
   fi'
