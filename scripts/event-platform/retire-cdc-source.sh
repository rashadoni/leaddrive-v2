#!/usr/bin/env bash
# Retire the production database as the Kafka CDC source (owner, 2026-10-25:
# Kafka is wound down to cut costs; the CRM keeps writing to PostgreSQL only).
# Runs on the production web/PostgreSQL host as root:
#
#   retire-cdc-source.sh inspect   read-only: CDC slots, publication, role, event rows, latest backup
#   retire-cdc-source.sh apply     safety dump, then retire CDC; idempotent, re-run is a no-op
#   retire-cdc-source.sh restore   undo apply: CDC role may log in again, publication back;
#                                  the connector creates its slot itself when it reconnects
#
# Why this exists: a Debezium slot left behind when the Connect hosts go away
# pins WAL on the production disk (~0.4 GB/day, up to max_slot_wal_keep_size)
# and is then invalidated by PostgreSQL — a stopped CDC holding WAL. Apply
# therefore removes the CDC ends on the database side, in an order Debezium
# cannot undo while it is still running:
#
#   1. pg_dump of the database, verified readable (data first);
#   2. the CDC role loses LOGIN, so a reconnecting connector is refused and
#      cannot recreate the slot;
#   3. its sessions (the walsender) are terminated;
#   4. its logical slots are dropped — only slots named leaddrive_event_outbox_*
#      with pgoutput in this database; any other slot is reported, never touched;
#   5. the publication is dropped (the connector has autocreate disabled).
#
# Deliberately untouched: wal_level and the conf.d drop-in (changing them needs
# a PostgreSQL restart and gains nothing), pg_hba (the role cannot log in), the
# WireGuard overlay, the role itself and its grants, and every table and row.
#
# Environment: DBNAME (default leaddrive_v2), PG_AS (default "sudo -u postgres";
# empty runs psql/pg_dump as the caller, for tests), SAFETY_DIR (default
# /var/backups/leaddrive-pre-cdc), DAILY_BACKUP_DIR (default /var/backups/leaddrive),
# APP_PING_URL (default http://127.0.0.1:3001/api/v1/ping; "skip" in tests).
set -Eeuo pipefail
die() { printf 'retire-cdc: FATAL: %s\n' "$*" >&2; exit 1; }

mode="${1:-}"
case "$mode" in inspect|apply|restore) ;; *) sed -n '2,10p' "$0" 2>/dev/null || true; die "usage: inspect|apply|restore" ;; esac

dbname="${DBNAME:-leaddrive_v2}"
[[ "$dbname" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "DBNAME has an unexpected shape"
pg_as="${PG_AS-sudo -u postgres}"
safety_dir="${SAFETY_DIR:-/var/backups/leaddrive-pre-cdc}"
daily_dir="${DAILY_BACKUP_DIR:-/var/backups/leaddrive}"
ping_url="${APP_PING_URL:-http://127.0.0.1:3001/api/v1/ping}"

ROLE=leaddrive_event_cdc
PUBLICATION=leaddrive_event_outbox

# shellcheck disable=SC2086 # PG_AS is a command prefix by design
psql_db() { $pg_as psql -X -q -v ON_ERROR_STOP=1 -At -d "$dbname" "$@"; }
# </dev/null: on production this script itself arrives on bash's stdin.
count() { psql_db -c "$1" </dev/null; }

psql_db -c 'select 1' </dev/null >/dev/null || die "cannot reach database $dbname as the PostgreSQL superuser"
[ "$(count 'select rolsuper from pg_roles where rolname = current_user')" = t ] \
  || die "must run as a PostgreSQL superuser"

# Our slots: the connector's naming, its plugin, this database.
OUR_SLOTS="slot_name like 'leaddrive\\_event\\_outbox\\_%' and slot_type = 'logical' and plugin = 'pgoutput' and database = current_database()"

report() {
  psql_db <<SQL
select 'cdc_slots=' || count(*) || ' active=' || count(*) filter (where active)
  || ' retained_wal_bytes=' || coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)), 0)::bigint
  from pg_replication_slots where $OUR_SLOTS;
select 'other_slots=' || count(*) from pg_replication_slots where not ($OUR_SLOTS);
select 'publication=' || count(*) from pg_publication where pubname = '$PUBLICATION';
select 'cdc_role=' || coalesce((select case when rolcanlogin then 'login' else 'nologin' end
  from pg_roles where rolname = '$ROLE'), 'absent');
select 'cdc_sessions=' || count(*) from pg_stat_activity where usename = '$ROLE';
select 'wal_level=' || current_setting('wal_level') || ' slot_cap=' || current_setting('max_slot_wal_keep_size');
select 'database_bytes=' || pg_database_size(current_database());
-- What Kafka could hold that PostgreSQL does not: nothing, as long as the
-- outbox it mirrors is still here. Counted as superuser, so RLS does not hide rows.
select 'event_rows ' || string_agg(t || '=' || coalesce(n, 'absent'), ' ' order by t) from (
  select t, case when to_regclass('public.' || t) is not null then
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
  end as n
  from unnest(array['event_outbox', 'domain_events']) as t
) counted;
SQL
  latest="$(find "$daily_dir" -maxdepth 1 -type f -name '*.dump.age' -printf '%T@ %f\n' 2>/dev/null | sort -n | tail -1 || true)"
  if [ -n "$latest" ]; then
    printf 'latest_daily_backup=%s age_hours=%s\n' "${latest#* }" "$(( ($(date +%s) - ${latest%%.*}) / 3600 ))"
  else
    printf 'latest_daily_backup=none\n'
  fi
}


printf 'retire-cdc: mode=%s database=%s observed_at=%s\n' "$mode" "$dbname" "$(date -u +%FT%TZ)"
report
[ "$mode" = inspect ] && exit 0

if [ "$mode" = restore ]; then
  # Owner, 2026-10-25, the same evening: Kafka stays. Undo apply on the
  # database side only. The publication is the one prepare-cdc.sql creates;
  # the slot is left to Debezium (slot.drop.on.stop=false, it creates a missing
  # slot on start), so nothing here pins WAL before a connector is back.
  [ "$(count "select count(*) from pg_roles where rolname = '$ROLE'")" = 1 ] \
    || die "CDC role $ROLE is missing; enrol the source with source-enroll.sh cdc-role instead"
  psql_db <<SQL
alter role $ROLE login;
do \$pub\$
begin
  if not exists (select 1 from pg_publication where pubname = '$PUBLICATION') then
    create publication $PUBLICATION for table only public."event_outbox"
      with (publish = 'insert', publish_via_partition_root = false);
  end if;
end
\$pub\$;
SQL
  [ "$(count "select count(*) from pg_roles where rolname = '$ROLE' and rolcanlogin")" = 1 ] || die "the CDC role still cannot log in"
  [ "$(count "select string_agg(schemaname || '.' || tablename, ',') from pg_publication_tables where pubname = '$PUBLICATION'")" = public.event_outbox ] \
    || die "the CDC publication does not cover exactly public.event_outbox"
  echo "retire-cdc: after restore"
  report
  echo "retire-cdc: RESTORED — CDC role can log in, publication present; restart the connector to recreate the slot"
  exit 0
fi

slots_now="$(count "select count(*) from pg_replication_slots where $OUR_SLOTS")"
pub_now="$(count "select count(*) from pg_publication where pubname = '$PUBLICATION'")"
login_now="$(count "select count(*) from pg_roles where rolname = '$ROLE' and rolcanlogin")"
if [ "$slots_now" = 0 ] && [ "$pub_now" = 0 ] && [ "$login_now" = 0 ]; then
  echo "retire-cdc: already retired — nothing changed"
else
  # 1. Data first. Room for the dump: three times the live database.
  db_bytes="$(count 'select pg_database_size(current_database())')"
  install -d -m 0700 "$safety_dir"
  avail="$(df --block-size=1 --output=avail "$safety_dir" | tail -1 | tr -d ' ')"
  [ "$avail" -gt $(( db_bytes * 3 )) ] || die "not enough free space for the safety dump ($avail bytes free)"
  dump="$safety_dir/$dbname-retire-cdc-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # shellcheck disable=SC2086
  (umask 077; $pg_as pg_dump -Fc -d "$dbname" >"$dump") || die "safety dump failed; nothing was changed"
  chmod 0600 "$dump"
  pg_restore -l "$dump" >/dev/null || die "safety dump unreadable; nothing was changed"
  printf 'safety_dump=%s bytes=%s\n' "$dump" "$(stat -c %s "$dump")"

  # 2-5. Shut the door, then clear the room.
  psql_db <<SQL
do \$retire\$
declare s record; deadline timestamptz := clock_timestamp() + interval '30 seconds';
begin
  if exists (select 1 from pg_roles where rolname = '$ROLE') then
    execute format('alter role %I nologin', '$ROLE');
  end if;
  loop
    perform pg_terminate_backend(pid) from pg_stat_activity where usename = '$ROLE';
    perform pg_terminate_backend(active_pid) from pg_replication_slots where $OUR_SLOTS and active_pid is not null;
    exit when not exists (select 1 from pg_replication_slots where $OUR_SLOTS and active);
    if clock_timestamp() > deadline then
      raise exception 'CDC slot still active after 30 s';
    end if;
    perform pg_sleep(0.2);
  end loop;
  for s in select slot_name from pg_replication_slots where $OUR_SLOTS loop
    perform pg_drop_replication_slot(s.slot_name);
    raise notice 'dropped slot %', s.slot_name;
  end loop;
end
\$retire\$;
drop publication if exists $PUBLICATION;
SQL
fi

# Verify from scratch, never from what was just attempted.
[ "$(count "select count(*) from pg_replication_slots where $OUR_SLOTS")" = 0 ] || die "a CDC slot is still present"
[ "$(count "select count(*) from pg_publication where pubname = '$PUBLICATION'")" = 0 ] || die "the CDC publication is still present"
[ "$(count "select count(*) from pg_roles where rolname = '$ROLE' and rolcanlogin")" = 0 ] || die "the CDC role can still log in"
echo "retire-cdc: after"
report

if [ "$ping_url" != skip ]; then
  body="$(curl -fsS --max-time 15 "$ping_url")" || die "CRM ping failed after retiring CDC"
  printf 'crm_ping=%s\n' "$body"
fi
echo "retire-cdc: PASS — no CDC slot, no publication, CDC role cannot log in"
