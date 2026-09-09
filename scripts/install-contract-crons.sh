#!/bin/bash
# Installs the contract-lifecycle cron jobs into root's crontab. Idempotent —
# re-running only adds missing entries, never duplicates. Run once per server:
#   bash /opt/leaddrive-v2/.next/standalone/scripts/install-contract-crons.sh
#
# Schedules: revenue recognition monthly (1st @ 02:00); embeddings, milestone
# reminders, e-sign reminders daily; approval escalations hourly. All call
# cron-trigger.sh, which reads CRON_SECRET from /etc/leaddrive/app.env and
# POSTs the endpoint. Scheduled commands are always external release-owned
# scripts, never files in the replaceable checkout.

SCRIPTS="${SCRIPTS:-/usr/local/lib/leaddrive-v2/ops/current/cron-scripts}"
LOG=/var/log/leaddrive-cron.log

[ -x "$SCRIPTS/cron-trigger.sh" ] || {
  echo "release-owned cron trigger is not executable: $SCRIPTS/cron-trigger.sh" >&2
  exit 1
}

# "schedule|endpoint-name"
JOBS=(
  "0 2 1 * *|revenue-recognition"
  "0 3 * * *|contract-embeddings"
  "0 8 * * *|contract-milestone-reminders"
  "0 9 * * *|esign-reminders"
  "0 * * * *|contract-approval-escalations"
)

CURRENT="$(crontab -l 2>/dev/null || true)"
NEW="$CURRENT"
for j in "${JOBS[@]}"; do
  sched="${j%%|*}"
  name="${j##*|}"
  if printf '%s\n' "$CURRENT" | grep -qF "cron-trigger.sh ${name}"; then
    echo "  skip  ${name} — already in crontab"
  else
    NEW="${NEW}"$'\n'"${sched} ${SCRIPTS}/cron-trigger.sh ${name} >> ${LOG} 2>&1"
    echo "  add   ${name} — (${sched})"
  fi
done

printf '%s\n' "$NEW" | crontab -
echo ""
echo "Contract cron jobs now in crontab:"
crontab -l 2>/dev/null | grep 'cron-trigger.sh' || echo "  (none)"
