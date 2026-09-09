#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   CRONTAB="$(crontab -l 2>/dev/null)"
   ACTIVE_COUNT="$(printf "%s\n" "$CRONTAB" | awk '\''
     $0 !~ /^[[:space:]]*#/ &&
     $0 ~ /cron-trigger\.sh \/api\/cron\/commitment-escalation/ { count++ }
     END { print count + 0 }
   '\'')"
   if [ "$ACTIVE_COUNT" -ne 1 ]; then
     echo "FATAL: expected exactly one active callback commitment cron; found $ACTIVE_COUNT"
     exit 1
   fi
   if ! systemctl is-active --quiet cron.service; then
     echo "FATAL: cron.service is not active"
     exit 1
   fi
   SMOKE_OUTPUT="$(CRON_TRIGGER_LOCK_WAIT_SECONDS=120 /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh "/api/cron/commitment-escalation?smoke=1")"
   printf "%s\n" "$SMOKE_OUTPUT"
   if ! printf "%s\n" "$SMOKE_OUTPUT" | grep -Fq '\''"smoke":true'\''; then
     echo "FATAL: callback commitment cron smoke was not side-effect-free and successful"
     exit 1
   fi'
