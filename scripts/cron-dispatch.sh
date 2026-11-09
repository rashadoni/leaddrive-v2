#!/bin/bash
# One crontab line starts every LeadDrive schedule.
#
# Why: cron forks a child, runs PAM and logs a session for EVERY line due in a
# minute, all in that minute's first second. Measured on production
# 2026-11-08: 25 lines that only `sleep` put 41 threads in the run queue and
# /api/v1/ping answered in 0.99 s instead of 0.05 s. Spreading the five-minute
# jobs over phases (PR #1443) brought the worst minute down to 0.3–0.7 s; the
# eleven every-minute lines still started together in second 0 of every
# minute. Now cron starts only this script, once a minute, and it starts each
# due job in that job's own second.
#
# The schedule stays in root's crontab, inside the managed block written by
# scripts/install-resilience-crons.sh, one job per line:
#
#   #@<second> <minute> <hour> <day> <month> <weekday> <command>
#
# The line is a comment to cron; to this script it is a job due when the five
# fields match the current local time (cron's own rules: `*`, N, A-B, any of
# them with /step, comma lists; day and weekday both restricted means either).
# <second> is the job's fixed offset in the minute, chosen by the installer
# from the target's name, so a job lands on the same second every minute.
# Keeping the schedule in the crontab keeps one atomic, snapshotted file: the
# deploy's expected-crontab proof and its rollback (which restores the old
# one-line-per-job crontab) need nothing new.
#
# Each job runs as cron would run it — `/bin/sh -c <command>`, the command's
# own redirection into the cron log — with CRON_TRIGGER_SPREAD_SECONDS=0,
# because the wait already happened here.
#
#   CRON_DISPATCH_DRY_RUN=1  print "<second><TAB><command>" for each due job
#                            and start nothing (the deploy's verifier)
#   CRON_DISPATCH_EPOCH=<s>  pretend it is this moment (tests, the verifier)
set -uo pipefail

BEGIN_MARKER="# BEGIN LEADDRIVE RESILIENCE CRONS"
END_MARKER="# END LEADDRIVE RESILIENCE CRONS"

if [ -n "${CRON_DISPATCH_EPOCH:-}" ]; then
  case "$CRON_DISPATCH_EPOCH" in
    '' | *[!0-9]*) echo "$(date): [cron-dispatch] ERROR - CRON_DISPATCH_EPOCH must be whole seconds" >&2; exit 1 ;;
  esac
  epoch="$CRON_DISPATCH_EPOCH"
else
  printf -v epoch '%(%s)T' -1
fi
printf -v fields '%(%M %H %d %m %w)T' "$epoch"
read -r minute hour day month weekday <<<"$fields"
minute_start=$(( epoch - epoch % 60 ))

if ! crontab_text="$(crontab -l 2>/dev/null)"; then
  echo "$(date): [cron-dispatch] ERROR - cannot read the crontab; nothing started" >&2
  exit 1
fi

# awk prints "<second>\t<command>" for every due job and "!<line>" for a job
# line it cannot read, which is reported and skipped rather than guessed at.
due="$(printf '%s\n' "$crontab_text" | awk \
  -v begin="$BEGIN_MARKER" -v end="$END_MARKER" \
  -v minute="$((10#$minute))" -v hour="$((10#$hour))" -v day="$((10#$day))" \
  -v month="$((10#$month))" -v weekday="$((10#$weekday))" '
  function part_matches(part, value, low_bound, high_bound,   step, range, bounds, low, high, n) {
    step = 1
    range = part
    if (index(part, "/") > 0) {
      n = split(part, bounds, "/")
      if (n != 2 || bounds[2] !~ /^[0-9]+$/ || bounds[2] + 0 == 0) return -1
      range = bounds[1]
      step = bounds[2] + 0
    }
    if (range == "*") {
      low = low_bound; high = high_bound
    } else if (range ~ /^[0-9]+-[0-9]+$/) {
      split(range, bounds, "-"); low = bounds[1] + 0; high = bounds[2] + 0
    } else if (range ~ /^[0-9]+$/) {
      low = range + 0
      # "N/step" runs from N to the end of the field, as in cron.
      high = (step > 1 || index(part, "/") > 0) ? high_bound : low
    } else {
      return -1
    }
    if (low < low_bound || high > high_bound || low > high) return -1
    return (value >= low && value <= high && (value - low) % step == 0) ? 1 : 0
  }
  function field_matches(field, value, low_bound, high_bound,   parts, n, i, r, hit) {
    n = split(field, parts, ",")
    hit = 0
    for (i = 1; i <= n; i++) {
      r = part_matches(parts[i], value, low_bound, high_bound)
      if (r < 0) return -1
      if (r == 1) hit = 1
    }
    return hit
  }
  $0 == begin { managed = 1; next }
  $0 == end { managed = 0; next }
  !managed { next }
  /^#@/ {
    if (!match($0, /^#@[0-9]+ +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+ +/)) { print "!" $0; next }
    command = substr($0, RLENGTH + 1)
    second = substr($1, 3) + 0
    if (second > 59 || command == "") { print "!" $0; next }
    m = field_matches($2, minute, 0, 59)
    h = field_matches($3, hour, 0, 23)
    d = field_matches($4, day, 1, 31)
    mo = field_matches($5, month, 1, 12)
    w = field_matches($6, weekday, 0, 7)
    if (weekday == 0 && w == 0) w = field_matches($6, 7, 0, 7)
    if (m < 0 || h < 0 || d < 0 || mo < 0 || w < 0) { print "!" $0; next }
    # cron: with both day of month and weekday restricted, either one is enough.
    if ($4 != "*" && $6 != "*") days = (d || w); else days = (d && w)
    if (m && h && mo && days) printf "%d\t%s\n", second, command
  }
' | sort -n -s -k1,1)"

while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  if [ "${entry:0:1}" = "!" ]; then
    echo "$(date): [cron-dispatch] ERROR - unreadable schedule line skipped: ${entry:1}" >&2
    continue
  fi
  second="${entry%%$'\t'*}"
  command="${entry#*$'\t'}"
  if [ -n "${CRON_DISPATCH_DRY_RUN:-}" ]; then
    printf '%s\t%s\n' "$second" "$command"
    continue
  fi
  printf -v now '%(%s)T' -1
  wait_for=$(( minute_start + second - now ))
  if [ "$wait_for" -gt 0 ]; then
    sleep "$wait_for"
  fi
  CRON_TRIGGER_SPREAD_SECONDS=0 /bin/sh -c "$command" </dev/null &
done <<<"$due"

exit 0
