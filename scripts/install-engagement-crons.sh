#!/bin/bash
# Installs the engagement/automation cron jobs into root's crontab. Idempotent —
# re-running only adds missing entries, never duplicates. Run once per server
# (and on any new shared-box tenant / dedicated box like fanum):
#   bash /opt/leaddrive-v2/.next/standalone/scripts/install-engagement-crons.sh
#
# Mirrors install-contract-crons.sh. These five features ship working but lie
# DORMANT until their crontab line exists (no error, just nothing fires):
#   loyalty-expiry          — D8: expire loyalty points per Organization.settings.loyaltyPointsExpiryDays (daily 02:00; no-op for tenants without expiry configured)
#   sequences               — S3: advance due sales-sequence enrollment steps (every 15 min)
#   social-poll             — §5: poll Twitter/TikTok/YouTube/VK/Telegram for mentions (every 30 min; no-op without connected accounts)
#   post-resolution-survey  — B9: catch-up re-send of CSAT/NPS invites whose primary send failed (hourly; bounded 2h window + 30-day suppression)
#   account-engagement-recompute — C5: recompute ABM account score+grade from intent signals + write a score snapshot (daily 02:30; no-op until companies are promoted to accounts)
# All call cron-trigger.sh, which reads CRON_SECRET from /etc/leaddrive/app.env
# and POSTs the endpoint. Scheduled commands stay in the external immutable
# release root rather than the checkout.

SCRIPTS="${SCRIPTS:-/usr/local/lib/leaddrive-v2/ops/current/cron-scripts}"
LOG=/var/log/leaddrive-cron.log

[ -x "$SCRIPTS/cron-trigger.sh" ] || {
  echo "release-owned cron trigger is not executable: $SCRIPTS/cron-trigger.sh" >&2
  exit 1
}

# "schedule|endpoint-name"
JOBS=(
  "0 2 * * *|loyalty-expiry"
  "*/15 * * * *|sequences"
  "*/30 * * * *|social-poll"
  "0 * * * *|post-resolution-survey"
  "30 2 * * *|account-engagement-recompute"
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
echo "Engagement cron jobs now in crontab:"
crontab -l 2>/dev/null | grep -E 'cron-trigger.sh (loyalty-expiry|sequences|social-poll|post-resolution-survey|account-engagement-recompute)' || echo "  (none)"
