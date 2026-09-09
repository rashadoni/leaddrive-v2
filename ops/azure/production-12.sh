#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   CRONTAB="$(crontab -l 2>/dev/null)"
   ACTIVE_COUNT="$(printf "%s\n" "$CRONTAB" | awk '\''
     $0 !~ /^[[:space:]]*#/ &&
     $0 ~ /cron-trigger\.sh \/api\/cron\/social-monitoring-run-jobs/ { count++ }
     END { print count + 0 }
   '\'')"
   if [ "$ACTIVE_COUNT" -ne 1 ]; then
     echo "FATAL: expected exactly one active Social Monitoring queue cron; found $ACTIVE_COUNT"
     exit 1
   fi
   if ! systemctl is-active --quiet cron.service; then
     echo "FATAL: cron.service is not active"
     exit 1
   fi
   SMOKE_ENDPOINT="/api/cron/social-monitoring-run-jobs?organizationId=codex-prod-smoke-no-such-org&limit=1&maxItemsPerJob=1"
   SMOKE_OUTPUT="$(CRON_TRIGGER_LOCK_WAIT_SECONDS=120 /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh "$SMOKE_ENDPOINT")"
   printf "%s\n" "$SMOKE_OUTPUT"
   if ! printf "%s\n" "$SMOKE_OUTPUT" | grep -Fq "\"selected\":0,\"claimed\":0"; then
     echo "FATAL: Social Monitoring queue smoke did not return an empty successful drain"
     exit 1
   fi'
