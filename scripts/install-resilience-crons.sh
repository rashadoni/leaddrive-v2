#!/bin/bash
# Atomically installs the schedules moved out of src/instrumentation.ts, the
# durable Social Monitoring queue drain, and the opt-in social workers. During
# the transition both paths may run; PostgreSQL leases make duplicate ticks safe.
set -euo pipefail

SCRIPTS="${SCRIPTS:-/usr/local/lib/leaddrive-v2/ops/current/cron-scripts}"
TRIGGER="$SCRIPTS/cron-trigger.sh"
LOG="${LOG:-/var/log/leaddrive-resilience-cron.log}"
BEGIN_MARKER="# BEGIN LEADDRIVE RESILIENCE CRONS"
END_MARKER="# END LEADDRIVE RESILIENCE CRONS"
SOCIAL_DISABLED_MARKER="# LEADDRIVE SOCIAL CRONS DISABLED"
EXPECTED_CRONTAB_PATH="${LEADDRIVE_CRON_EXPECTED_PATH:-}"

[ -x "$TRIGGER" ] || { echo "cron trigger is not executable: $TRIGGER"; exit 1; }
command -v crontab >/dev/null || { echo "crontab command is missing"; exit 1; }
command -v flock >/dev/null || { echo "flock command is missing"; exit 1; }

CURRENT="$(mktemp)"
CLEAN="$(mktemp)"
NEXT="$(mktemp)"
EXPECTED_STAGE=""
trap 'rm -f "$CURRENT" "$CLEAN" "$NEXT" "${EXPECTED_STAGE:-}"' EXIT

crontab -l > "$CURRENT" 2>/dev/null || true
SOCIAL_CRONS_DISABLED=false
if grep -qxF "$SOCIAL_DISABLED_MARKER" "$CURRENT"; then
  SOCIAL_CRONS_DISABLED=true
fi

# Remove the previous managed block and any pre-block copies of these exact
# endpoints so rerunning the installer cannot create duplicate schedules.
awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" -v social_disabled="$SOCIAL_DISABLED_MARKER" '
  $0 == begin { managed = 1; next }
  $0 == end { managed = 0; next }
  managed { next }
  $0 == social_disabled { next }
  /cron-trigger\.sh \/api\/v1\/journeys\/process/ { next }
  /cron-trigger\.sh finance-deadlines/ { next }
  /cron-trigger\.sh mtm-auto-checkout/ { next }
  /cron-trigger\.sh mtm-route-notification-outbox/ { next }
  # Retire schedules installed by the removed branch-only v2 cleanup route.
  /cron-trigger\.sh mtm-mobile-sync-v2-snapshot-cleanup/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/poll-all/ { next }
  /cron-trigger\.sh \/api\/cron\/social-monitoring-sources/ { next }
  /cron-trigger\.sh \/api\/cron\/social-monitoring-run-jobs/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/reconcile-providers/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/process-media/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/purge-observations/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/process-outbound/ { next }
  /cron-trigger\.sh \/api\/cron\/inbox-autonomous-agent/ { next }
  /cron-trigger\.sh \/api\/cron\/chatwoot-inbound-poll/ { next }
  /cron-trigger\.sh \/api\/cron\/voice-session-reaper/ { next }
  /cron-trigger\.sh \/api\/cron\/voice-call-queues/ { next }
  /cron-trigger\.sh \/api\/cron\/commitment-escalation/ { next }
  /cron-trigger\.sh \/api\/cron\/missed-inbound-reconciliation/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-cleanup/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-route-day-close/ { next }
  { print }
' "$CURRENT" > "$CLEAN"

{
  cat "$CLEAN"
  printf '%s\n' "$BEGIN_MARKER"
  printf '%s\n' "* * * * * $TRIGGER /api/v1/journeys/process >> $LOG 2>&1"
  printf '%s\n' "5 */6 * * * $TRIGGER finance-deadlines >> $LOG 2>&1"
  printf '%s\n' "*/15 * * * * $TRIGGER mtm-auto-checkout >> $LOG 2>&1"
  # R5 route workflow notices are durable outbox rows. The worker is bounded,
  # idempotent and uses a cross-process lease, so a minute cadence only reduces
  # post-commit delivery latency; it does not duplicate notifications.
  printf '%s\n' "* * * * * $TRIGGER mtm-route-notification-outbox >> $LOG 2>&1"
  printf '%s\n' "*/5 * * * * $TRIGGER /api/cron/inbox-autonomous-agent >> $LOG 2>&1"
  # Backstop delayed/missed Chatwoot message_created webhooks. The endpoint is
  # bounded, exact-id idempotent and pinned to one configured TikTok inbox.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/chatwoot-inbound-poll >> $LOG 2>&1"
  # Voice sessions cannot be ended from our side — a closed tab or a phone in a
  # pocket leaves a row holding its minute reservation. Without this sweep the
  # reservation is never settled and the monthly budget drains to zero without
  # anyone having talked. Every minute: the grace window is 90s.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/voice-session-reaper >> $LOG 2>&1"
  # Durable AI lead queues advance by at most one state transition per tenant
  # per tick. Dispatch remains a no-op unless both the server execution flag
  # and the tenant's VoIP queue switch are explicitly enabled.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/voice-call-queues >> $LOG 2>&1"
  # Human callback outcomes create durable commitment tasks. A minute runner
  # makes the promised time actionable; the endpoint itself is leased and
  # idempotent, so reinstall/retry cannot duplicate the reminder.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/commitment-escalation >> $LOG 2>&1"
  # PBX lifecycle events are the source of truth for inbound misses. This
  # worker records one generic, unassigned CRM task without placing a call or
  # sending a message; its database event fence makes minute retries safe.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/missed-inbound-reconciliation >> $LOG 2>&1"
  # Bounded MTM cache/GPS retention scans at most ten tenants and capped row
  # sets per tick.  Fifteen minutes keeps the round-robin pass comfortably
  # inside the retention window at the S6 tenant target without letting one
  # noisy tenant turn a single cleanup into an unbounded job.  The endpoint
  # owns the PostgreSQL lease; cron is only the durable external heartbeat.
  printf '%s\n' "*/15 * * * * $TRIGGER /api/cron/mtm-cleanup >> $LOG 2>&1"
  # A route stays PLANNED/IN_PROGRESS until a person closes it, so an ordinary
  # interrupted day never ended: prod had fourteen August routes sitting in the
  # "in progress" list. This sweep retires days that are over to INCOMPLETE.
  # Hourly, not daily: the boundary is each organization's own local morning,
  # which no single UTC tick can hit for every tenant. The update is idempotent
  # and leased, so extra ticks cost one bounded query per tenant.
  printf '%s\n' "20 * * * * $TRIGGER /api/cron/mtm-route-day-close >> $LOG 2>&1"
  # The durable queue drain is required for user-started jobs and is safe to
  # run independently. Keep the legacy marker and all other social workers
  # behind their existing opt-in state. Retaining the marker also ensures an
  # older installer preserves the disabled state during rollback.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/social-monitoring-run-jobs >> $LOG 2>&1"
  if [ "$SOCIAL_CRONS_DISABLED" = true ]; then
    printf '%s\n' "$SOCIAL_DISABLED_MARKER"
    printf '%s\n' "# 2,17,32,47 * * * * $TRIGGER /api/v1/social/cron/poll-all >> $LOG 2>&1"
    printf '%s\n' "# */5 * * * * $TRIGGER /api/cron/social-monitoring-sources >> $LOG 2>&1"
    printf '%s\n' "# */2 * * * * $TRIGGER /api/v1/social/cron/reconcile-providers >> $LOG 2>&1"
    printf '%s\n' "# */2 * * * * $TRIGGER /api/v1/social/cron/process-media >> $LOG 2>&1"
    printf '%s\n' "# 25 3 * * * $TRIGGER /api/v1/social/cron/purge-observations >> $LOG 2>&1"
    printf '%s\n' "# * * * * * $TRIGGER /api/v1/social/cron/process-outbound >> $LOG 2>&1"
  else
    printf '%s\n' "2,17,32,47 * * * * $TRIGGER /api/v1/social/cron/poll-all >> $LOG 2>&1"
    printf '%s\n' "*/5 * * * * $TRIGGER /api/cron/social-monitoring-sources >> $LOG 2>&1"
    printf '%s\n' "*/2 * * * * $TRIGGER /api/v1/social/cron/reconcile-providers >> $LOG 2>&1"
    printf '%s\n' "*/2 * * * * $TRIGGER /api/v1/social/cron/process-media >> $LOG 2>&1"
    printf '%s\n' "25 3 * * * $TRIGGER /api/v1/social/cron/purge-observations >> $LOG 2>&1"
    printf '%s\n' "* * * * * $TRIGGER /api/v1/social/cron/process-outbound >> $LOG 2>&1"
  fi
  printf '%s\n' "$END_MARKER"
} > "$NEXT"

# During a release activation, persist the exact crontab that is about to be
# installed before the atomic `crontab` call. This gives the parent deploy a
# durable expected state if the host loses power in the tiny interval between
# that call and its normal post-install verification. Manual invocations leave
# this unset and retain their historical behavior.
if [ -n "$EXPECTED_CRONTAB_PATH" ]; then
  case "$EXPECTED_CRONTAB_PATH" in
    /opt/leaddrive-v2-backups/backup-*/root-crontab.after-resilience-release) ;;
    *)
      echo "refusing an unsafe resilience expected-crontab path: $EXPECTED_CRONTAB_PATH" >&2
      exit 1
      ;;
  esac
  EXPECTED_PARENT="$(dirname -- "$EXPECTED_CRONTAB_PATH")"
  [ -d "$EXPECTED_PARENT" ] && [ ! -L "$EXPECTED_PARENT" ] || {
    echo "resilience expected-crontab parent is not a real directory: $EXPECTED_PARENT" >&2
    exit 1
  }
  EXPECTED_STAGE="$(mktemp "$EXPECTED_PARENT/.root-crontab.resilience.XXXXXX")"
  install -m 0600 -- "$NEXT" "$EXPECTED_STAGE"
  sync -f -- "$EXPECTED_STAGE"
  mv -Tf -- "$EXPECTED_STAGE" "$EXPECTED_CRONTAB_PATH"
  EXPECTED_STAGE=""
  sync -f -- "$EXPECTED_CRONTAB_PATH" "$EXPECTED_PARENT"
  cmp -s "$NEXT" "$EXPECTED_CRONTAB_PATH" || {
    echo "cannot verify resilience expected crontab snapshot" >&2
    exit 1
  }
fi

crontab "$NEXT"

echo "Installed LeadDrive resilience schedules:"
sed -n "/^${BEGIN_MARKER}$/,/^${END_MARKER}$/p" "$NEXT"
