#!/usr/bin/env bash
# Take the scheduled pgBackRest backup that makes the WAL archive restorable.
#
# WAL on its own restores nothing: every point-in-time restore replays forward
# from a full backup. Archiving without this schedule leaves the repository
# with exactly one full backup for ever — the replay window grows without
# bound, and `expire` never runs, so retention is never applied either.
#
# Nothing here alerts. The watch (wal-archive-check.sh) reads the repository
# state every five minutes and complains about a stale or missing backup; it
# judges the result, not whether this job ran. A scheduler that reported its
# own success would be the gate that greens on its own failure.
set -Eeuo pipefail

umask 077

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
[ -f "$WAL_ENV_FILE" ] || {
  printf '[wal-backup] FATAL missing %s\n' "$WAL_ENV_FILE" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

: "${WAL_STANZA:?}" "${WAL_PG_USER:?}"
: "${WAL_FULL_INTERVAL_DAYS:=7}"
: "${WAL_BACKUP_LOCK_FILE:=/var/lib/leaddrive-recovery-runner-locks/wal-backup.lock}"
# Tests point this at a stub; production never sets it.
: "${PGBACKREST_BIN:=pgbackrest}"

case "$WAL_FULL_INTERVAL_DAYS" in
  [1-9] | [1-9][0-9]) ;;
  *)
    printf '[wal-backup] FATAL WAL_FULL_INTERVAL_DAYS must be 1..99, got %s\n' \
      "$WAL_FULL_INTERVAL_DAYS" >&2
    exit 1
    ;;
esac

log() { printf '[wal-backup] %s\n' "$*"; }

# Production runs this as root and switches to the database superuser. When the
# caller already IS that user — the contract test, and an operator running it by
# hand as postgres — su would demand a password for no gain, so run directly.
as_pg() {
  if [ "$(id -un)" = "$WAL_PG_USER" ]; then
    eval "$1" 2>&1
  else
    su - "$WAL_PG_USER" -c "$1" 2>&1
  fi
}

install -d -m 0750 "$(dirname "$WAL_BACKUP_LOCK_FILE")"
exec 9>"$WAL_BACKUP_LOCK_FILE"
# A backup still running is not a failure: the next day's run takes over.
flock -n 9 || {
  log "another backup holds the lock; leaving it alone"
  exit 0
}

# --log-level-console=info is required: the production config sets warn, and at
# warn pgBackRest prints nothing at all for the info command.
repo_json="$(as_pg "$PGBACKREST_BIN --stanza=$WAL_STANZA --log-level-console=info --output=json info" || true)"
decision="$(printf '%s' "$repo_json" | WAL_FULL_INTERVAL_DAYS="$WAL_FULL_INTERVAL_DAYS" python3 -I -c '
import json, os, sys, time

interval = int(os.environ["WAL_FULL_INTERVAL_DAYS"]) * 86400
raw = sys.stdin.read().strip()
try:
    data = json.loads(raw)
except Exception:
    # An unreadable repository is not a reason to skip: a full backup is the
    # one command that repairs a repository with no usable backup set.
    print("full|repository unreadable")
    raise SystemExit(0)
if not data:
    print("full|no stanza in the repository")
    raise SystemExit(0)
backups = data[0].get("backup", [])
newest_full = None
for b in backups:
    if b.get("type") == "full":
        stop = b.get("timestamp", {}).get("stop")
        if stop is not None and (newest_full is None or stop > newest_full):
            newest_full = stop
if newest_full is None:
    print("full|no full backup yet")
    raise SystemExit(0)
age = int(time.time() - newest_full)
if age >= interval:
    print("full|newest full is %dh old" % (age // 3600))
else:
    print("diff|newest full is %dh old" % (age // 3600))
' 2>/dev/null || printf 'full|cannot read the repository')"

backup_type="${decision%%|*}"
reason="${decision#*|}"

case "$backup_type" in
  full | diff) ;;
  *)
    log "FATAL unexpected backup type: $backup_type"
    exit 1
    ;;
esac

if [ "${WAL_BACKUP_DECIDE_ONLY:-0}" = 1 ]; then
  printf 'DECISION %s %s\n' "$backup_type" "$reason"
  exit 0
fi

log "taking a $backup_type backup ($reason)"
started="$(date -u +%s)"
if ! backup_output="$(as_pg "$PGBACKREST_BIN --stanza=$WAL_STANZA --type=$backup_type --log-level-console=info backup")"; then
  printf '%s\n' "$backup_output" | tail -5 >&2
  log "FATAL $backup_type backup failed"
  printf 'SUMMARY wal-backup type=%s result=failed\n' "$backup_type"
  exit 1
fi
elapsed="$(( $(date -u +%s) - started ))"

size="$(printf '%s' "$backup_output" | sed -n 's/.*backup size = \([0-9.]*[KMGT]*B\).*/\1/p' | tail -1)"
log "$backup_type backup done in ${elapsed}s${size:+, size $size}"
printf 'SUMMARY wal-backup type=%s result=ok seconds=%s size=%s\n' \
  "$backup_type" "$elapsed" "${size:-unknown}"
