#!/bin/bash
# Atomically installs the schedules moved out of src/instrumentation.ts, the
# durable Social Monitoring queue drain, and the opt-in social workers. During
# the transition both paths may run; PostgreSQL leases make duplicate ticks safe.
set -euo pipefail

SCRIPTS="${SCRIPTS:-/usr/local/lib/leaddrive-v2/ops/current/cron-scripts}"
TRIGGER="$SCRIPTS/cron-trigger.sh"
DISPATCH="$SCRIPTS/cron-dispatch.sh"
LOG="${LOG:-/var/log/leaddrive-resilience-cron.log}"
BEGIN_MARKER="# BEGIN LEADDRIVE RESILIENCE CRONS"
END_MARKER="# END LEADDRIVE RESILIENCE CRONS"
SOCIAL_DISABLED_MARKER="# LEADDRIVE SOCIAL CRONS DISABLED"
EXPECTED_CRONTAB_PATH="${LEADDRIVE_CRON_EXPECTED_PATH:-}"

[ -x "$TRIGGER" ] || { echo "cron trigger is not executable: $TRIGGER"; exit 1; }
[ -x "$DISPATCH" ] || { echo "cron dispatcher is not executable: $DISPATCH"; exit 1; }
command -v cksum >/dev/null || { echo "cksum command is missing"; exit 1; }
command -v crontab >/dev/null || { echo "crontab command is missing"; exit 1; }
command -v flock >/dev/null || { echo "flock command is missing"; exit 1; }

CURRENT="$(mktemp)"
CLEAN="$(mktemp)"
SCHEDULE="$(mktemp)"
NEXT="$(mktemp)"
EXPECTED_STAGE=""
trap 'rm -f "$CURRENT" "$CLEAN" "$SCHEDULE" "$NEXT" "${EXPECTED_STAGE:-}"' EXIT

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
  /cron-dispatch\.sh/ { next }
  /cron-trigger\.sh \/api\/v1\/journeys\/process/ { next }
  /cron-trigger\.sh finance-deadlines/ { next }
  /cron-trigger\.sh mtm-auto-checkout/ { next }
  /cron-trigger\.sh mtm-route-notification-outbox/ { next }
  # Retire schedules installed by the removed branch-only v2 cleanup route.
  /cron-trigger\.sh mtm-mobile-sync-v2-snapshot-cleanup/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/poll-all/ { next }
  /cron-trigger\.sh \/api\/cron\/social-monitoring-sources/ { next }
  /cron-trigger\.sh \/api\/cron\/social-monitoring-run-jobs/ { next }
  /cron-trigger\.sh \/api\/cron\/social-relevance-judge/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/reconcile-providers/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/process-media/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/purge-observations/ { next }
  /cron-trigger\.sh \/api\/v1\/social\/cron\/process-outbound/ { next }
  /cron-trigger\.sh \/api\/cron\/inbox-autonomous-agent/ { next }
  /cron-trigger\.sh \/api\/cron\/chatwoot-inbound-poll/ { next }
  /cron-trigger\.sh \/api\/cron\/voice-session-reaper/ { next }
  /cron-trigger\.sh \/api\/cron\/zeytun-catalog-refresh/ { next }
  /cron-trigger\.sh \/api\/cron\/zeytun-waitlist-callback/ { next }
  /cron-trigger\.sh \/api\/cron\/zeytun-sales-history/ { next }
  /cron-trigger\.sh \/api\/cron\/voice-call-queues/ { next }
  /cron-trigger\.sh \/api\/cron\/commitment-escalation/ { next }
  /cron-trigger\.sh \/api\/cron\/missed-inbound-reconciliation/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-cleanup/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-route-day-close/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-attendance-reports/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-attendance-reminders/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-customer-eta/ { next }
  /cron-trigger\.sh \/api\/cron\/demo-call-retention/ { next }
  /cron-trigger\.sh \/api\/cron\/call-recordings-retention/ { next }
  /cron-trigger\.sh \/api\/cron\/az-calendar-watch/ { next }
  /cron-trigger\.sh \/api\/cron\/demo-social-release/ { next }
  /cron-trigger\.sh \/api\/cron\/campaign-scheduled-send/ { next }
  /cron-trigger\.sh \/api\/cron\/mtm-demo-pulse/ { next }
  /cron-trigger\.sh \/api\/cron\/sla-escalation/ { next }
  /cron-trigger\.sh \/api\/cron\/ticket-closure-requests/ { next }
  /cron-trigger\.sh \/api\/cron\/booking-effects/ { next }
  /cron-trigger\.sh \/api\/cron\/booking-reminders/ { next }
  /cron-trigger\.sh \/api\/cron\/ad-conversions/ { next }
  /cron-trigger\.sh \/api\/cron\/kapitalbank-reconcile/ { next }
  /cron-trigger\.sh (\/api\/cron\/)?renewal-alerts([ ?]|$)/ { next }
  /cron-trigger\.sh (\/api\/cron\/)?contract-approval-escalations([ ?]|$)/ { next }
  /cron-trigger\.sh (\/api\/cron\/)?contract-milestone-reminders([ ?]|$)/ { next }
  /cron-trigger\.sh (\/api\/cron\/)?esign-reminders([ ?]|$)/ { next }
  { print }
' "$CURRENT" > "$CLEAN"

# The schedule, one job per line in cron's own syntax. cron does not run these
# lines itself: see the dispatcher block below for why and how they run.
{
  # cron forks a child, runs PAM and logs a session for every line due in a
  # minute, all in its first second. Measured on production 2026-11-08: 25
  # lines that only `sleep` put 41 threads in the run queue, the kernel took
  # 47 % of six cores, and /api/v1/ping answered in 0.99 s instead of 0.05 s;
  # with the eleven every-minute lines plus the twelve five-minute ones that
  # was every fifth minute (1.2 s, and the station's own requests waited too).
  # So the five-minute jobs are not all on minutes 0, 5, 10…: each sits in its
  # own phase of the five (1-59/5 … 4-59/5, three per phase), and the
  # quarter-hour ones take the free minutes 0/5/10 of their quarter. No minute
  # now starts more than ~15 jobs. A new five-minute job goes into the phase
  # with the fewest lines, not on */5. Since 2026-11-09 cron starts none of
  # these lines itself (scripts/cron-dispatch.sh), and the phases still keep
  # the jobs' own work from piling onto one minute.
  printf '%s\n' "* * * * * $TRIGGER /api/v1/journeys/process >> $LOG 2>&1"
  printf '%s\n' "5 */6 * * * $TRIGGER finance-deadlines >> $LOG 2>&1"
  printf '%s\n' "*/15 * * * * $TRIGGER mtm-auto-checkout >> $LOG 2>&1"
  # R5 route workflow notices are durable outbox rows. The worker is bounded,
  # idempotent and uses a cross-process lease, so a minute cadence only reduces
  # post-commit delivery latency; it does not duplicate notifications.
  printf '%s\n' "* * * * * $TRIGGER mtm-route-notification-outbox >> $LOG 2>&1"
  printf '%s\n' "1-59/5 * * * * $TRIGGER /api/cron/inbox-autonomous-agent >> $LOG 2>&1"
  # Backstop delayed/missed Chatwoot message_created webhooks. The endpoint is
  # bounded, exact-id idempotent and pinned to one configured TikTok inbox.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/chatwoot-inbound-poll >> $LOG 2>&1"
  # Voice sessions cannot be ended from our side — a closed tab or a phone in a
  # pocket leaves a row holding its minute reservation. Without this sweep the
  # reservation is never settled and the monthly budget drains to zero without
  # anyone having talked. Every minute: the grace window is 90s.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/voice-session-reaper >> $LOG 2>&1"
  # Zeytun's phone line serves only a catalog snapshot younger than a day.
  # Half-hourly ticks; the endpoint downloads at most hourly (its own lock and
  # persisted deadline) and does nothing without the private 1C connection file.
  printf '%s\n' "*/30 * * * * $TRIGGER /api/cron/zeytun-catalog-refresh >> $LOG 2>&1"
  # Owner's queue task 10: the line's AI calls a pharmacy back about products it waited for.
  # A no-op unless the order organization switched it on; one call at most, inside voice hours.
  printf '%s\n' "1-59/5 * * * * $TRIGGER /api/cron/zeytun-waitlist-callback >> $LOG 2>&1"
  # What 1C sold each pharmacy, for the line's ear (zeytun-sales-history.ts): two minutes of
  # one-at-a-time Get_Sales requests per tick at most; a no-op without its private connection file.
  printf '%s\n' "3-59/15 * * * * $TRIGGER /api/cron/zeytun-sales-history >> $LOG 2>&1"
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
  printf '%s\n' "5-59/15 * * * * $TRIGGER /api/cron/mtm-cleanup >> $LOG 2>&1"
  # A demo call's words are kept for 90 days — the AI agent says so in its
  # first sentence, and the prospect agreed to exactly that. Daily is plenty
  # for a 90-day promise; the endpoint touches only calls the demo placed.
  printf '%s\n' "17 3 * * * $TRIGGER /api/cron/demo-call-retention >> $LOG 2>&1"
  # The Zeytun line's call recordings are kept 90 days (owner, 2026-10-31);
  # daily is plenty, the files are deleted by their own age on disk.
  printf '%s\n' "27 3 * * * $TRIGGER /api/cron/call-recordings-retention >> $LOG 2>&1"
  # Next year's official holidays, read from report.az for the admin to add
  # (src/lib/mtm/az-calendar-watch.ts). Hourly, because the article passes
  # through the feed in a few hours; outside Nov–Dec, and once a year is
  # read, a tick fetches nothing.
  printf '%s\n' "41 * * * * $TRIGGER /api/cron/az-calendar-watch >> $LOG 2>&1"
  # A prospect's own Facebook Page is connected to the demo for one day at
  # most. This sweep unbinds every connection that is over — unsubscribes the
  # Page from our app and wipes our copy; the person's own Meta grant stays
  # his (docs/DEMO_CENTER.md says why) — and the demo's own live check already
  # stops all use without it. Every five minutes, because the unbinding is
  # what the prospect was promised; a tick with nothing due reads one empty
  # table, and each row is leased, so overlaps send nothing twice.
  printf '%s\n' "1-59/5 * * * * $TRIGGER /api/cron/demo-social-release >> $LOG 2>&1"
  # A route stays PLANNED/IN_PROGRESS until a person closes it, so an ordinary
  # interrupted day never ended: prod had fourteen August routes sitting in the
  # "in progress" list. This sweep retires days that are over to INCOMPLETE.
  # Hourly, not daily: the boundary is each organization's own local morning,
  # which no single UTC tick can hit for every tenant. The update is idempotent
  # and leased, so extra ticks cost one bounded query per tenant.
  printf '%s\n' "20 * * * * $TRIGGER /api/cron/mtm-route-day-close >> $LOG 2>&1"
  # Attendance inbox reminders are optional, bounded and deduplicated.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/mtm-attendance-reminders >> $LOG 2>&1"
  # «Агент едет к вам»: the link to a customer an agent has set off to. Off
  # for every organization until it switches it on; one message per stop at
  # most (unique row before the send), so overlapping ticks send nothing twice.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/mtm-customer-eta >> $LOG 2>&1"
  # Private attendance schedules are opt-in; worker rechecks access per letter.
  printf '%s\n' "2-59/5 * * * * $TRIGGER /api/cron/mtm-attendance-reports >> $LOG 2>&1"
  # A campaign with status «scheduled» goes out when its scheduledAt comes.
  # These are real messages to customers' contacts: each campaign is claimed
  # with one conditional write before sending, so overlapping ticks or a manual
  # send racing the cron still deliver it once. Every minute, because the
  # promise to the user is "at the chosen time".
  printf '%s\n' "* * * * * $TRIGGER /api/cron/campaign-scheduled-send >> $LOG 2>&1"
  # Kapital Bank has no server-to-server callback: a customer who paid and
  # closed the tab on the bank's page never returns to tell us. This asks the
  # bank about open card orders, the longest-waiting first, a bounded number
  # per tick; recording is a conditional claim, so overlaps record once.
  printf '%s\n' "2-59/5 * * * * $TRIGGER /api/cron/kapitalbank-reconcile >> $LOG 2>&1"
  # New leads and won deals to the organizations' Meta pixels. Meta refuses a
  # whole batch holding an event older than 7 days, so this runs often; each
  # record is queued once (unique per destination, event and record).
  printf '%s\n' "2-59/5 * * * * $TRIGGER /api/cron/ad-conversions >> $LOG 2>&1"
  # Durable meeting projections and calendar/customer delivery intents.
  printf '%s\n' "* * * * * $TRIGGER /api/cron/booking-effects >> $LOG 2>&1"
  # Reminders before a visit: the day before and two hours before, with the
  # buttons that keep a chair from going empty. Every five minutes is enough —
  # each window is hours wide and a booking is marked only once it is sent.
  printf '%s\n' "3-59/5 * * * * $TRIGGER /api/cron/booking-reminders >> $LOG 2>&1"
  # The demo organization's field day (owner decision 2026-09-22). A no-op for
  # every tenant without the hand-set `mtm-demo-pulse` flag; keyed writes make
  # a repeated or late tick harmless, and the endpoint holds its own lease.
  printf '%s\n' "*/10 * * * * $TRIGGER /api/cron/mtm-demo-pulse >> $LOG 2>&1"
  # Support escalation rules and support-term milestones act only when this
  # endpoint is called. The schedule was not carried over when production moved
  # hosts in September 2026: rules could still be edited and previewed, and
  # none had fired since. Every five minutes is the cadence the handler was
  # written for; it applies at most one rule per ticket per run and leaves
  # thirty minutes between two escalations of the same ticket.
  printf '%s\n' "3-59/5 * * * * $TRIGGER /api/cron/sla-escalation >> $LOG 2>&1"
  # A resolved ticket asks the customer to confirm; unanswered, it closes after
  # seven days, and the ticket card says so. Without this sweep it never did.
  # Hourly is plenty for a seven-day promise, and a request is closed once.
  printf '%s\n' "37 * * * * $TRIGGER /api/cron/ticket-closure-requests >> $LOG 2>&1"
  # Contract reminders: the renewal alerts (90/60/30/14/7 days before the end
  # date), overdue approval stages, milestones coming due, and the reminder
  # e-mail to a signer whose turn it is. They lived only in a hand-run script
  # and did not move with production in September 2026, so a month of them
  # never fired (owner, 2026-10-17: «включить, сначала перевести»). Each is
  # idempotent: an alert is sent once, an approval escalates at most three
  # times a day apart, a milestone is reminded once a day, a signer at most
  # three times three days apart. Mornings by the server clock.
  printf '%s\n' "5 7 * * * $TRIGGER /api/cron/renewal-alerts >> $LOG 2>&1"
  printf '%s\n' "15 * * * * $TRIGGER /api/cron/contract-approval-escalations >> $LOG 2>&1"
  printf '%s\n' "0 8 * * * $TRIGGER /api/cron/contract-milestone-reminders >> $LOG 2>&1"
  printf '%s\n' "0 9 * * * $TRIGGER /api/cron/esign-reminders >> $LOG 2>&1"
  # Social Monitoring, trimmed to what produces something (owner, 2026-11-08:
  # «максимально оптимизировать мусор в этом модуле»). Measured on prod for
  # 1-8 November, docs/social-monitoring-audit-2026-11-08.md:
  # - poll-all (every 15 min) brought 0 new mentions in a week; the 15
  #   accounts with a token have never brought one. It is no longer scheduled;
  #   the awk filter above still strips the old line, so a reinstall removes it.
  # - social-relevance-judge (every 15 min) re-read the same 15 text-less
  #   records 11,160 times a week and decided nothing. Not scheduled either.
  # - the queue drain, outbound replies and media worker found work in a
  #   handful of ticks out of thousands; every five minutes is enough for a
  #   module nobody waits on. Provider reconciliation saw no run all week.
  # The durable queue drain is required for user-started jobs and is safe to
  # run independently. Keep the legacy marker and all other social workers
  # behind their existing opt-in state. Retaining the marker also ensures an
  # older installer preserves the disabled state during rollback.
  printf '%s\n' "3-59/5 * * * * $TRIGGER /api/cron/social-monitoring-run-jobs >> $LOG 2>&1"
  if [ "$SOCIAL_CRONS_DISABLED" = true ]; then
    printf '%s\n' "$SOCIAL_DISABLED_MARKER"
    printf '%s\n' "# 4-59/5 * * * * $TRIGGER /api/cron/social-monitoring-sources >> $LOG 2>&1"
    printf '%s\n' "# 10-59/15 * * * * $TRIGGER /api/v1/social/cron/reconcile-providers >> $LOG 2>&1"
    printf '%s\n' "# 4-59/5 * * * * $TRIGGER /api/v1/social/cron/process-media >> $LOG 2>&1"
    printf '%s\n' "# 25 3 * * * $TRIGGER /api/v1/social/cron/purge-observations >> $LOG 2>&1"
    printf '%s\n' "# 4-59/5 * * * * $TRIGGER /api/v1/social/cron/process-outbound >> $LOG 2>&1"
  else
    printf '%s\n' "4-59/5 * * * * $TRIGGER /api/cron/social-monitoring-sources >> $LOG 2>&1"
    printf '%s\n' "10-59/15 * * * * $TRIGGER /api/v1/social/cron/reconcile-providers >> $LOG 2>&1"
    printf '%s\n' "4-59/5 * * * * $TRIGGER /api/v1/social/cron/process-media >> $LOG 2>&1"
    printf '%s\n' "25 3 * * * $TRIGGER /api/v1/social/cron/purge-observations >> $LOG 2>&1"
    printf '%s\n' "4-59/5 * * * * $TRIGGER /api/v1/social/cron/process-outbound >> $LOG 2>&1"
  fi
} > "$SCHEDULE"

# One crontab line starts all of the above. Measured on production 2026-11-08:
# cron's fork, PAM session and session log per due line, all in the minute's
# first second, made /api/v1/ping take 0.99 s instead of 0.05 s with 25 lines;
# the phases above left 0.3-0.7 s every minute from the eleven every-minute
# lines alone. So cron starts scripts/cron-dispatch.sh once a minute, and it
# starts each due job in its own second of the minute.
#
# A job line becomes `#@<second> <five fields> <command>`: a comment to cron, a
# job to the dispatcher. <second> is the job's fixed offset — the target's
# cksum modulo SPREAD_SECONDS, the same offset cron-trigger.sh used to sleep —
# so a job lands on the same second every minute, a minute after its last
# tick, and no second of the busiest minute starts more than two jobs. Lines
# that are comments already (a disabled schedule) stay plain comments.
# The schedule stays in the crontab so the deploy's expected-crontab proof and
# its rollback, which restores the previous crontab whole, keep working as is.
SPREAD_SECONDS=50
{
  cat "$CLEAN"
  printf '%s\n' "$BEGIN_MARKER"
  printf '%s\n' "* * * * * $DISPATCH >> $LOG 2>&1"
  # Word-splitting a schedule line must not expand its `*` fields into files.
  set -f
  while IFS= read -r line; do
    case "$line" in
      '#'* | '') printf '%s\n' "$line" ;;
      *)
        # shellcheck disable=SC2086
        set -- $line
        [ "$#" -ge 7 ] || { echo "schedule line has no command: $line" >&2; exit 1; }
        offset=$(( $(printf '%s' "$7" | cksum | cut -d' ' -f1) % SPREAD_SECONDS ))
        printf '#@%s %s\n' "$offset" "$line"
        ;;
    esac
  done < "$SCHEDULE"
  set +f
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
