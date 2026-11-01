#!/usr/bin/env bash
# Prove point-in-time recovery end to end on a throwaway cluster.
#
# Not a shape test: it writes two rows a second apart, destroys the data
# directory, restores to the moment between them and asserts the first row is
# back and the second one is not. It uses the same pgBackRest settings as
# production — asynchronous archive-push, repository encryption, zstd — so a
# setting that breaks recovery breaks this drill.
#
# Needs initdb/pg_ctl/psql (PostgreSQL 16) and pgbackrest on PATH, and must NOT
# run as root. It touches nothing outside its own temporary directory.
set -Eeuo pipefail

STANZA=drill
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wal-pitr-drill.XXXXXX")"
PGDATA="$WORK_DIR/pgdata"
PGPORT="${PGPORT:-55987}"
PGHOST="$WORK_DIR/sock"
CONF="$WORK_DIR/pgbackrest.conf"
export PGHOST PGPORT

log() { printf '[pitr-drill] %s\n' "$*"; }
fatal() {
  printf '[pitr-drill] FAIL %s\n' "$*" >&2
  exit 1
}

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

[ "$(id -u)" -ne 0 ] || fatal "do not run the drill as root"
for binary in initdb pg_ctl psql pgbackrest; do
  command -v "$binary" >/dev/null 2>&1 || fatal "$binary is not on PATH"
done

mkdir -p "$PGHOST" "$WORK_DIR/repo" "$WORK_DIR/spool" "$WORK_DIR/log"

cat >"$CONF" <<DRILL_CONF
[global]
repo1-path=$WORK_DIR/repo
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$(openssl rand -hex 32)
repo1-retention-full=2
repo1-bundle=y
compress-type=zst
compress-level=1
start-fast=y
delta=y
archive-async=y
archive-push-queue-max=1GiB
spool-path=$WORK_DIR/spool
log-path=$WORK_DIR/log
log-level-console=warn
log-level-file=detail

[$STANZA]
pg1-path=$PGDATA
pg1-port=$PGPORT
pg1-socket-path=$PGHOST
DRILL_CONF
chmod 0600 "$CONF"

log "initdb"
initdb -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8 -A trust >/dev/null

cat >>"$PGDATA/postgresql.conf" <<DRILL_PG
listen_addresses = ''
unix_socket_directories = '$PGHOST'
port = $PGPORT
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --config=$CONF --stanza=$STANZA archive-push %p'
archive_timeout = 10s
log_min_messages = warning
DRILL_PG

pg_ctl -D "$PGDATA" -l "$WORK_DIR/log/postgres.log" -w start >/dev/null
log "cluster up on port $PGPORT"

pgbackrest --config="$CONF" --stanza="$STANZA" stanza-create >/dev/null
pgbackrest --config="$CONF" --stanza="$STANZA" --type=full backup >/dev/null
log "full backup taken"

# pgBackRest selects a backup set whose stop time is strictly less than the
# target, and it compares whole seconds. A row written in the same second as
# the end of the backup is unrecoverable by time, so the drill steps over that
# second instead of pretending the boundary does not exist.
sleep 2

psql -XqAt -d postgres -c "create table drill_marker(id int primary key, note text, written_at timestamptz default clock_timestamp())" >/dev/null
psql -XqAt -d postgres -c "insert into drill_marker(id, note) values (1, 'before the target')" >/dev/null

# pgBackRest accepts "YYYY-MM-DD HH:MM:SS.msec+HH" with no space before the
# offset, so the offset is glued on from the same instant.
target_time="$(psql -XtAq -d postgres -c "select to_char(t, 'YYYY-MM-DD HH24:MI:SS.MS') || to_char(t, 'OF') from (select clock_timestamp() as t) s")"
log "target time: $target_time"

psql -XqAt -d postgres -c "select pg_sleep(1.5)" >/dev/null
psql -XqAt -d postgres -c "insert into drill_marker(id, note) values (2, 'after the target')" >/dev/null
# The segment being written now is the one holding row 2.
need_wal="$(psql -XtAq -d postgres -c "select pg_walfile_name(pg_current_wal_lsn())" | tr -d '[:space:]')"
psql -XqAt -d postgres -c "select pg_switch_wal()" >/dev/null
psql -XqAt -d postgres -c "checkpoint" >/dev/null

# Asynchronous archiving ships in the background; wait for that segment to
# reach the repository before destroying anything. WAL names are fixed-length
# uppercase hex, so byte order is chronological order.
deadline=$((SECONDS + 90))
while :; do
  archived="$(psql -XtAq -d postgres -c "select coalesce(last_archived_wal,'') from pg_stat_archiver" | tr -d '[:space:]')"
  if [ -n "$archived" ] && printf '%s\n%s\n' "$need_wal" "$archived" | LC_ALL=C sort -C; then
    break
  fi
  [ "$SECONDS" -lt "$deadline" ] || fatal "segment $need_wal not archived in 90s (last=$archived)"
  sleep 2
done
log "archived up to $archived (needed $need_wal)"

failed_count="$(psql -XtAq -d postgres -c "select failed_count from pg_stat_archiver" | tr -d '[:space:]')"
[ "$failed_count" = "0" ] || fatal "archive_command failed $failed_count times"

log "destroying the data directory"
pg_ctl -D "$PGDATA" -m immediate stop >/dev/null
rm -rf "${PGDATA:?}"
mkdir -m 0700 -p "$PGDATA"

log "restoring to the moment between the two rows"
# --no-delta: the data directory was just removed, so there is nothing to
# compare against and delta only prints a warning about it.
pgbackrest --config="$CONF" --stanza="$STANZA" --type=time --target="$target_time" \
  --target-action=promote --no-delta restore

pg_ctl -D "$PGDATA" -l "$WORK_DIR/log/restore.log" -w start >/dev/null

deadline=$((SECONDS + 60))
while psql -XtAq -d postgres -c "select pg_is_in_recovery()" 2>/dev/null | grep -q '^t$'; do
  [ "$SECONDS" -lt "$deadline" ] || fatal "cluster never left recovery"
  sleep 1
done

rows="$(psql -XtAq -d postgres -c "select coalesce(string_agg(id::text, ',' order by id), 'none') from drill_marker")"
log "rows after recovery: $rows"

[ "$rows" = "1" ] || fatal "expected only row 1 after point-in-time recovery, got: $rows"

log "PITR proved: row written before the target survived, row written after it did not"
printf 'SUMMARY wal-pitr-drill result=pass target=%s rows=%s\n' "$target_time" "$rows"
