#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} \
  'set -euo pipefail
   CRONTAB="$(crontab -l 2>/dev/null)"
   ACTIVE_COUNT="$(printf "%s\n" "$CRONTAB" | awk '\''
     $0 !~ /^[[:space:]]*#/ &&
     $0 ~ /cron-trigger\.sh \/api\/cron\/chatwoot-inbound-poll/ { count++ }
     END { print count + 0 }
   '\'')"
   if [ "$ACTIVE_COUNT" -ne 1 ]; then
     echo "FATAL: expected exactly one active Chatwoot inbound poll cron; found $ACTIVE_COUNT"
     exit 1
   fi
   if ! systemctl is-active --quiet cron.service; then
     echo "FATAL: cron.service is not active"
     exit 1
   fi
   echo "Chatwoot inbound backstop scheduler proof passed"'
