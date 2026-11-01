#!/usr/bin/env bash
# Watch the PostgreSQL WAL archive. Read-only: it never repairs anything.
#
# Exit 0 healthy, 1 warning, 2 critical. A critical state means the recovery
# point has silently moved back to the last nightly logical dump.
set -Eeuo pipefail

umask 077

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
[ -f "$WAL_ENV_FILE" ] || {
  printf '[wal-check] FATAL missing %s\n' "$WAL_ENV_FILE" >&2
  exit 2
}
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

: "${WAL_STANZA:?}" "${WAL_PG_PORT:?}" "${WAL_PG_USER:?}" "${WAL_SPOOL_PATH:?}"
: "${WAL_CHECK_LAG_WARN_SECONDS:=900}" "${WAL_CHECK_LAG_CRIT_SECONDS:=3600}"
: "${WAL_CHECK_BACKLOG_WARN:=64}"
: "${WAL_FULL_INTERVAL_DAYS:=7}"
: "${WAL_CHECK_STATE_FILE:=/var/lib/leaddrive-wal-archive/check-state.json}"
: "${WAL_CHECK_LOCK_FILE:=/var/lib/leaddrive-recovery-runner-locks/wal-check.lock}"
: "${WAL_ALERT_COMMAND:=}"

install -d -m 0750 "$(dirname "$WAL_CHECK_STATE_FILE")" "$(dirname "$WAL_CHECK_LOCK_FILE")"
exec 9>"$WAL_CHECK_LOCK_FILE"
flock -n 9 || {
  printf '[wal-check] another run holds the lock\n' >&2
  exit 0
}

status=ok
problems=()

note() {
  local level="$1"
  shift
  problems+=("$*")
  if [ "$level" = crit ]; then
    status=crit
  elif [ "$level" = warn ] && [ "$status" != crit ]; then
    status=warn
  fi
}

as_pg() { su - "$WAL_PG_USER" -c "$1" 2>&1; }

# 1. Does PostgreSQL still think archiving works?
archiver_row="$(as_pg "psql -XtAqF'|' -p $WAL_PG_PORT -d postgres -c \"select coalesce(last_archived_wal,''), coalesce(extract(epoch from now()-last_archived_time)::bigint,-1), coalesce(extract(epoch from now()-last_failed_time)::bigint,-1), failed_count, archived_count from pg_stat_archiver\"" || true)"
if [[ "$archiver_row" != *"|"* ]]; then
  note crit "pg_stat_archiver unreadable: $archiver_row"
  archiver_row="||-1|-1|0|0"
fi
IFS='|' read -r last_wal last_archived_age last_failed_age failed_count archived_count <<<"$archiver_row"

if [ "${last_failed_age:--1}" -ge 0 ] && { [ "${last_archived_age:--1}" -lt 0 ] || [ "$last_failed_age" -lt "$last_archived_age" ]; }; then
  note crit "archive_command is failing (failed_count=$failed_count, last failure ${last_failed_age}s ago)"
fi

if [ "${last_archived_age:--1}" -lt 0 ]; then
  note crit "nothing has ever been archived (archived_count=$archived_count)"
elif [ "$last_archived_age" -ge "$WAL_CHECK_LAG_CRIT_SECONDS" ]; then
  note crit "last segment archived ${last_archived_age}s ago"
elif [ "$last_archived_age" -ge "$WAL_CHECK_LAG_WARN_SECONDS" ]; then
  note warn "last segment archived ${last_archived_age}s ago"
fi

# 2. Spool backlog: segments waiting to be shipped.
backlog=0
if [ -d "$WAL_SPOOL_PATH/archive/$WAL_STANZA/out" ]; then
  backlog="$(find "$WAL_SPOOL_PATH/archive/$WAL_STANZA/out" -type f -name '*.ok' -prune -o -type f -print 2>/dev/null | wc -l)"
fi
[ "$backlog" -lt "$WAL_CHECK_BACKLOG_WARN" ] || note warn "$backlog segments waiting in the spool"

# 3. Dropped WAL: the queue-max trade-off fired and PITR continuity is broken.
dropped_total=0
if [ -d /var/log/pgbackrest ]; then
  dropped_total="$(grep -rhc 'queue exceeded' /var/log/pgbackrest 2>/dev/null | awk '{s+=$1} END {print s+0}')"
fi

# 4. Repository: is there a restorable backup, and how old is it?
# --log-level-console=info is required: the production config sets warn, and
# at warn pgBackRest prints nothing at all for the info command.
repo_json="$(as_pg "pgbackrest --stanza=$WAL_STANZA --log-level-console=info --output=json info" || true)"
repo_summary="$(printf '%s' "$repo_json" | python3 -I -c '
import json, sys, time
raw = sys.stdin.read().strip()
try:
    data = json.loads(raw)
except Exception:
    print("unreadable|-1|-1|none")
    raise SystemExit(0)
if not data:
    print("nostanza|-1|-1|none")
    raise SystemExit(0)
stanza = data[0]
status = stanza.get("status", {}).get("message", "unknown")
backups = stanza.get("backup", [])
if not backups:
    print(f"{status}|-1|-1|none")
    raise SystemExit(0)
last = backups[-1]
age = int(time.time() - last["timestamp"]["stop"])
full_age = -1
for b in reversed(backups):
    if b.get("type") == "full":
        full_age = int(time.time() - b["timestamp"]["stop"])
        break
print("%s|%d|%d|%s" % (status, age, full_age, last.get("label", "none")))
' 2>/dev/null || printf 'unreadable|-1|-1|none')"
IFS='|' read -r repo_status backup_age full_age last_label <<<"$repo_summary"

case "$repo_status" in
  ok) ;;
  unreadable | nostanza) note crit "repository unreadable ($repo_status)" ;;
  *) note crit "repository status: $repo_status" ;;
esac

if [ "${full_age:--1}" -lt 0 ]; then
  note crit "no full backup in the repository: WAL alone cannot restore anything"
elif [ "$dropped_total" -gt 0 ]; then
  note crit "pgBackRest dropped WAL ($dropped_total times): run a full backup now, PITR has a hole"
fi

if [ "${backup_age:--1}" -ge 0 ] && [ "$backup_age" -gt 172800 ]; then
  note warn "newest backup is $((backup_age / 3600))h old"
fi

# Differentials succeeding while full backups fail keeps the newest backup
# fresh and silently grows the replay chain, so the full backup gets its own
# deadline: twice its interval, which a single missed night cannot reach.
if [ "${full_age:--1}" -ge 0 ] && [ "$full_age" -gt $((WAL_FULL_INTERVAL_DAYS * 172800)) ]; then
  note warn "newest full backup is $((full_age / 86400))d old (interval ${WAL_FULL_INTERVAL_DAYS}d)"
fi

# 5. End-to-end: pgbackrest check pushes a real segment and reads it back.
if ! check_output="$(as_pg "pgbackrest --stanza=$WAL_STANZA check")"; then
  note crit "pgbackrest check failed: $(printf '%s' "$check_output" | tail -2 | tr '\n' ' ')"
fi

# Alert on two consecutive bad runs, recover after one clean run; same shape as
# the Kafka and line watches, so a single network blip stays quiet.
previous="$(cat "$WAL_CHECK_STATE_FILE" 2>/dev/null || printf '{}')"
read -r prev_status prev_streak <<<"$(printf '%s' "$previous" | python3 -I -c '
import json, sys
try:
    s = json.loads(sys.stdin.read() or "{}")
except Exception:
    s = {}
print(s.get("status", "ok"), int(s.get("streak", 0)))
')"

if [ "$status" = ok ]; then
  streak=0
else
  streak=$((prev_streak + 1))
fi

message="WAL-архив: $(IFS='; '; printf '%s' "${problems[*]:-всё в порядке}")"
should_alert=0
if [ "$status" != ok ] && [ "$streak" -ge 2 ]; then
  should_alert=1
elif [ "$status" = ok ] && [ "$prev_status" != ok ]; then
  should_alert=1
  message="WAL-архив снова в порядке"
fi

if [ "$should_alert" = 1 ] && [ -n "$WAL_ALERT_COMMAND" ] && [ -x "$WAL_ALERT_COMMAND" ]; then
  "$WAL_ALERT_COMMAND" "$message" || true
fi

# The watch on the workstation reads this file over ssh and forwards the
# message verbatim. The verdict, its wording and the two-run streak are decided
# here, next to the data, so exactly one place decides what is wrong; the watch
# decides only delivery and adds the one thing this host cannot say about
# itself — that it went silent. Written through a temporary file: a reader that
# caught a half-written file would see broken JSON and call it an incident.
WAL_STATE_STATUS="$status" WAL_STATE_STREAK="$streak" \
WAL_STATE_MESSAGE="$message" WAL_STATE_ALERT="$should_alert" \
WAL_STATE_FILE="$WAL_CHECK_STATE_FILE" python3 -I -c '
import json, os, tempfile, time

target = os.environ["WAL_STATE_FILE"]
payload = {
    "status": os.environ["WAL_STATE_STATUS"],
    "streak": int(os.environ["WAL_STATE_STREAK"]),
    "message": os.environ["WAL_STATE_MESSAGE"],
    "shouldAlert": os.environ["WAL_STATE_ALERT"] == "1",
    "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
directory = os.path.dirname(target) or "."
fd, tmp = tempfile.mkstemp(dir=directory)
try:
    with os.fdopen(fd, "w") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    os.chmod(tmp, 0o640)
    os.replace(tmp, target)
except BaseException:
    os.unlink(tmp)
    raise
'

printf 'SUMMARY wal-check status=%s lag=%ss backlog=%s dropped=%s backup_age=%ss full_age=%ss\n' \
  "$status" "${last_archived_age:--1}" "$backlog" "$dropped_total" "${backup_age:--1}" "${full_age:--1}"
[ "${#problems[@]}" -eq 0 ] || printf '%s\n' "${problems[@]}"

case "$status" in
  ok) exit 0 ;;
  warn) exit 1 ;;
  *) exit 2 ;;
esac
