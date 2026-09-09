#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="upload"
FORCE_RETENTION_TIER=""
if [ "${1:-}" = "--local-canary" ] && [ "$#" -eq 1 ]; then
  MODE="local-canary"
elif [ "${1:-}" = "--commission-monthly" ] && [ "$#" -eq 1 ]; then
  FORCE_RETENTION_TIER="monthly"
elif [ "$#" -gt 0 ]; then
  printf 'Usage: %s [--local-canary|--commission-monthly]\n' "$0" >&2
  exit 2
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/leaddrive/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # This file is root-owned and mode 0600/0640.  It must contain only shell-safe
  # KEY=VALUE assignments generated from ops/backup/backup.env.example.
  # shellcheck disable=SC1090
  set -a
  source "$BACKUP_ENV_FILE"
  set +a
fi

WORK_ROOT="${BACKUP_WORK_ROOT:-/run/leaddrive-postgres-backup}"
STATE_ROOT="${BACKUP_STATE_ROOT:-/var/lib/leaddrive-postgres-backup}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock}"
WORK_DIR=""
SUCCESS=0
SNAPSHOT_HOLDER_PID=""

log() {
  printf '[postgres-backup] %s\n' "$*"
}

fatal() {
  printf '[postgres-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fatal "$name is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fatal "required command not found: $1"
}

assert_real_directory() {
  local label="$1"
  local directory="$2"
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    || fatal "$label must be a real non-symlink directory"
  [ "$(realpath -e -- "$directory")" = "$directory" ] \
    || fatal "$label must resolve to its canonical reviewed path"
}

assert_tmpfs_work_root() {
  local required_hint="${1:-0}"
  local available minimum required
  assert_real_directory "backup work root" "$WORK_ROOT"
  [ "$(findmnt -n -o FSTYPE --target "$WORK_ROOT")" = "tmpfs" ] \
    || fatal "backup plaintext work root must be backed by tmpfs"
  minimum="${BACKUP_MIN_WORK_AVAILABLE_BYTES:-1073741824}"
  [[ "$minimum" =~ ^[0-9]+$ ]] && [ "$minimum" -ge 1073741824 ] \
    || fatal "BACKUP_MIN_WORK_AVAILABLE_BYTES must be at least 1073741824"
  [[ "$required_hint" =~ ^[0-9]+$ ]] \
    || fatal "calculated backup capacity requirement is invalid"
  required="$minimum"
  [ "$required_hint" -le "$required" ] || required="$required_hint"
  available="$(df -B1 --output=avail "$WORK_ROOT" | tail -n 1 | tr -d '[:space:]')"
  [[ "$available" =~ ^[0-9]+$ ]] && [ "$available" -ge "$required" ] \
    || fatal "backup tmpfs has insufficient free capacity"
}

assert_root_connection_file() {
  local label="$1"
  local file="$2"
  local kind="$3"
  local mode group_id
  [[ "$file" = /* ]] || fatal "$label must use an absolute path"
  [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] \
    || fatal "$label must be a readable regular non-symlink file"
  [ "$(stat -c '%u' "$file")" = "0" ] || fatal "$label must be root-owned"
  mode="$(stat -c '%a' "$file")"
  case "$kind:$mode" in
    ca:400|ca:440|ca:444|ca:600|ca:640|ca:644) ;;
    password:400|password:600) [ "$(id -u)" = "0" ] || fatal "$label mode $mode is not readable by the backup account" ;;
    password:440|password:640)
      group_id="$(stat -c '%g' "$file")"
      [ "$group_id" = "$(id -g)" ] || fatal "$label group does not match the backup account"
      ;;
    *) fatal "$label has an unsafe mode for $kind material" ;;
  esac
}

retention_deadline() {
  local days="$1"
  if date -u -d "+$days days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null; then
    return 0
  fi
  if date -u "-v+${days}d" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null; then
    return 0
  fi
  fatal "date implementation cannot calculate a +$days day retention deadline"
}

ping_healthcheck() {
  local suffix="${1:-}"
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  curl --fail --silent --show-error --retry 2 --max-time 10 \
    "${BACKUP_HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$SNAPSHOT_HOLDER_PID" ]; then
    kill "$SNAPSHOT_HOLDER_PID" >/dev/null 2>&1 || true
    wait "$SNAPSHOT_HOLDER_PID" >/dev/null 2>&1 || true
    SNAPSHOT_HOLDER_PID=""
  fi
  if [ "$SUCCESS" -ne 1 ] || [ "$status" -ne 0 ]; then
    ping_healthcheck "/fail"
  fi
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf -- "$WORK_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

[ "$BACKUP_ENV_FILE" = "/etc/leaddrive/backup.env" ] \
  || fatal "BACKUP_ENV_FILE must remain /etc/leaddrive/backup.env"
[ "${BACKUP_WORK_ROOT:-/run/leaddrive-postgres-backup}" = "/run/leaddrive-postgres-backup" ] \
  && [ "$WORK_ROOT" = "/run/leaddrive-postgres-backup" ] \
  || fatal "BACKUP_WORK_ROOT override is forbidden"
[ "${BACKUP_STATE_ROOT:-/var/lib/leaddrive-postgres-backup}" = "/var/lib/leaddrive-postgres-backup" ] \
  && [ "$STATE_ROOT" = "/var/lib/leaddrive-postgres-backup" ] \
  || fatal "BACKUP_STATE_ROOT override is forbidden"
[ "${BACKUP_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock}" = "/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock" ] \
  && [ "$LOCK_FILE" = "/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock" ] \
  || fatal "BACKUP_LOCK_FILE override is forbidden"
[ -z "${BACKUP_TIER_OVERRIDE:-}" ] \
  || fatal "BACKUP_TIER_OVERRIDE is forbidden for scheduled production backups"
[ "${BACKUP_S3_PREFIX:-postgres}" = "postgres" ] \
  || fatal "BACKUP_S3_PREFIX must remain postgres"
for retention_policy in \
  "${BACKUP_RETENTION_DAILY_DAYS:-16}:16:daily" \
  "${BACKUP_RETENTION_WEEKLY_DAYS:-63}:63:weekly" \
  "${BACKUP_RETENTION_MONTHLY_DAYS:-400}:400:monthly"; do
  IFS=: read -r configured_retention minimum_retention retention_label <<<"$retention_policy"
  case "$configured_retention" in
    ''|*[!0-9]*) fatal "$retention_label retention must be an integer" ;;
  esac
  [ "$configured_retention" -ge "$minimum_retention" ] \
    || fatal "$retention_label retention is below the reviewed recovery policy"
done

require_env PGHOST
require_env PGDATABASE
require_env PGUSER
require_env PGPASSFILE
require_env PGSSLROOTCERT
require_env BACKUP_EXPECTED_DB_ROLE

PGPORT="${PGPORT:-5432}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
PGSSLMODE="${PGSSLMODE:-verify-full}"
[ "$PGSSLMODE" = "verify-full" ] || fatal "PGSSLMODE must remain verify-full"
[[ "$PGCONNECT_TIMEOUT" =~ ^[0-9]+$ ]] \
  && [ "$PGCONNECT_TIMEOUT" -ge 1 ] && [ "$PGCONNECT_TIMEOUT" -le 30 ] \
  || fatal "PGCONNECT_TIMEOUT must be between 1 and 30 seconds"
export PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGCONNECT_TIMEOUT PGSSLMODE PGSSLROOTCERT

assert_root_connection_file "PGPASSFILE" "$PGPASSFILE" password
assert_root_connection_file "PGSSLROOTCERT" "$PGSSLROOTCERT" ca
[ -r "$SCRIPT_DIR/canary.sql" ] || fatal "canary.sql is missing"
[ -r "$SCRIPT_DIR/migration-ledger.sql" ] && [ ! -L "$SCRIPT_DIR/migration-ledger.sql" ] \
  || fatal "migration-ledger.sql is missing or symlinked"
[ -r "$SCRIPT_DIR/recovery-db-contract.tsv" ] && [ ! -L "$SCRIPT_DIR/recovery-db-contract.tsv" ] \
  || fatal "recovery-db-contract.tsv is missing or symlinked"
[ -x "$SCRIPT_DIR/postgres-restore-canary.sh" ] || fatal "postgres-restore-canary.sh is not executable"

for command_name in awk cat cmp curl date df findmnt flock head install mv pg_dump pg_dumpall pg_restore psql realpath sha256sum sort stat stdbuf tail tar; do
  require_command "$command_name"
done

mkdir -p "$WORK_ROOT" "$STATE_ROOT"
assert_tmpfs_work_root
assert_real_directory "backup state root" "$STATE_ROOT"
[ "$(stat -c '%U:%G:%a' "$STATE_ROOT" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:750 ] \
  || fatal "backup state root has unsafe ownership/mode"
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
  && [ "$(realpath -e -- "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = /var/lib/leaddrive-recovery-runner-locks ] \
  && [ "$(stat -c '%U:%G:%a' "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = root:root:755 ] \
  && [ "$(stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null || true)" = root:leaddrive-backup:660 ] \
  || fatal "backup lock is missing, symlinked, or has unsafe ownership/mode"
exec 9<"$LOCK_FILE"
flock -n 9 || fatal "another backup run already holds $LOCK_FILE"
[ "$(stat -Lc '%d:%i' "$LOCK_FILE" 2>/dev/null || true)" = \
  "$(stat -Lc '%d:%i' "/proc/$$/fd/9" 2>/dev/null || true)" ] \
  || fatal "backup lock inode changed while it was acquired"

if [ "${BACKUP_REQUIRE_HEALTHCHECK:-1}" = "1" ] && [ -z "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  fatal "BACKUP_HEALTHCHECK_URL is required when BACKUP_REQUIRE_HEALTHCHECK=1"
fi

role_state="$(psql -X -v ON_ERROR_STOP=1 -AtF '|' -c \
  "SELECT session_user, current_database(), rolsuper::int, rolbypassrls::int, rolcanlogin::int
   FROM pg_roles WHERE rolname = session_user")"
IFS='|' read -r actual_role actual_database is_super can_bypass can_login <<<"$role_state"
[ "$actual_role" = "$BACKUP_EXPECTED_DB_ROLE" ] || fatal "connected as $actual_role; expected $BACKUP_EXPECTED_DB_ROLE"
[ "$actual_database" = "$PGDATABASE" ] || fatal "connected to $actual_database; expected $PGDATABASE"
[ "$is_super" = "0" ] || fatal "backup role must not be superuser"
[ "$can_bypass" = "1" ] || fatal "backup role must have BYPASSRLS; FORCE RLS can otherwise produce an empty/failing dump"
[ "$can_login" = "1" ] || fatal "backup role is not LOGIN-enabled"

read_only_default="$(psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT current_setting('default_transaction_read_only')")"
[ "$read_only_default" = "on" ] || fatal "backup role must default to read-only transactions"

membership_count="$(psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=session_user")"
[ "$membership_count" = "0" ] || fatal "backup role unexpectedly inherits $membership_count role membership(s)"
inbound_membership_count="$(psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname=session_user")"
[ "$inbound_membership_count" = "0" ] \
  || fatal "$inbound_membership_count role membership(s) can assume the BYPASSRLS backup role"

source_database_identity="$(psql -X -v ON_ERROR_STOP=1 -AtF '|' -c \
  "SELECT (pg_control_system()).system_identifier::text,
          current_database(),
          (SELECT oid::text FROM pg_database WHERE datname = current_database()),
          pg_is_in_recovery()::int")"
[ "${source_database_identity##*|}" = "0" ] || fatal "backup source must be the writable PostgreSQL primary"
log "source database identity $source_database_identity"
SOURCE_DATABASE_BYTES="$(psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT pg_database_size(current_database())::text")"
[[ "$SOURCE_DATABASE_BYTES" =~ ^[0-9]+$ ]] && [ "$SOURCE_DATABASE_BYTES" -gt 0 ] \
  || fatal "source database size preflight returned an invalid value"
CAPACITY_RATIO_PERCENT="${BACKUP_WORK_CAPACITY_RATIO_PERCENT:-250}"
[[ "$CAPACITY_RATIO_PERCENT" =~ ^[0-9]+$ ]] && [ "$CAPACITY_RATIO_PERCENT" -ge 250 ] \
  || fatal "BACKUP_WORK_CAPACITY_RATIO_PERCENT must be at least 250"
REQUIRED_WORK_BYTES=$((SOURCE_DATABASE_BYTES * CAPACITY_RATIO_PERCENT / 100 + 536870912))
assert_tmpfs_work_root "$REQUIRED_WORK_BYTES"
log "tmpfs capacity preflight passed for source size $SOURCE_DATABASE_BYTES bytes"

write_grant_count="$(psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'
     AND c.relkind IN ('r','p')
     AND (
       has_table_privilege(session_user, c.oid, 'INSERT') OR
       has_table_privilege(session_user, c.oid, 'UPDATE') OR
       has_table_privilege(session_user, c.oid, 'DELETE') OR
       has_table_privilege(session_user, c.oid, 'TRUNCATE') OR
       has_table_privilege(session_user, c.oid, 'TRIGGER')
     )")"
[ "$write_grant_count" = "0" ] || fatal "backup role has write privileges on $write_grant_count public table(s)"

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
MONTH_KEY="$(date -u '+%Y-%m')"
WEEK_KEY="$(date -u '+%G-W%V')"
MONTH_MARKER="$STATE_ROOT/last-monthly-period"
WEEK_MARKER="$STATE_ROOT/last-weekly-period"
LAST_MONTHLY="$(cat "$MONTH_MARKER" 2>/dev/null || true)"
LAST_WEEKLY="$(cat "$WEEK_MARKER" 2>/dev/null || true)"

if [ -n "$FORCE_RETENTION_TIER" ]; then
  TIER="$FORCE_RETENTION_TIER"
elif [ "$LAST_MONTHLY" != "$MONTH_KEY" ]; then
  TIER="monthly"
elif [ "$LAST_WEEKLY" != "$WEEK_KEY" ]; then
  TIER="weekly"
else
  TIER="daily"
fi

case "$TIER" in
  monthly) RETENTION_DAYS="${BACKUP_RETENTION_MONTHLY_DAYS:-400}" ;;
  weekly) RETENTION_DAYS="${BACKUP_RETENTION_WEEKLY_DAYS:-63}" ;;
  daily) RETENTION_DAYS="${BACKUP_RETENTION_DAILY_DAYS:-16}" ;;
  *) fatal "BACKUP_TIER_OVERRIDE must be daily, weekly or monthly" ;;
esac

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) fatal "retention days must be an integer" ;;
esac
[ "$RETENTION_DAYS" -ge 14 ] || fatal "retention must be at least 14 days"

WORK_DIR="$(mktemp -d "$WORK_ROOT/run-${TIMESTAMP}.XXXXXX")"
DUMP_FILE="$WORK_DIR/database.dump"
GLOBALS_FILE="$WORK_DIR/globals.sql"
AUTHORITY_FILE="$WORK_DIR/authority.tsv"
AUTHORITY_AFTER_FILE="$WORK_DIR/authority.after.tsv"
MIGRATION_LEDGER_FILE="$WORK_DIR/migration-ledger.tsv"
MIGRATION_LEDGER_AFTER_FILE="$WORK_DIR/migration-ledger.after.tsv"
APPLIED_MIGRATIONS_FILE="$WORK_DIR/applied-migrations.tsv"
CONTRACT_MIGRATIONS_FILE="$WORK_DIR/contract-migrations.tsv"
EXPECTED_APPLIED_MIGRATIONS_FILE="$WORK_DIR/expected-applied-migrations.tsv"
RECOVERY_DB_CONTRACT_FILE="$WORK_DIR/recovery-db-contract.tsv"
SOURCE_CANARY="$WORK_DIR/source-canary.tsv"
DUMP_LIST="$WORK_DIR/database.list"
MANIFEST_FILE="$WORK_DIR/manifest.env"

SNAPSHOT_SESSION_OUTPUT="$WORK_DIR/source-snapshot-session.tsv"
log "exporting one read-only MVCC snapshot for both source canary and pg_dump"
{
  printf '%s\n' \
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
    "SELECT '__leaddrive_snapshot__', pg_export_snapshot();"
  cat -- "$SCRIPT_DIR/canary.sql"
  printf '%s\n' \
    "SELECT '__leaddrive_snapshot_ready__', '1';" \
    'SELECT pg_sleep(14400);'
} | stdbuf -oL psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$SNAPSHOT_SESSION_OUTPUT" &
SNAPSHOT_HOLDER_PID=$!
for snapshot_attempt in $(seq 1 120); do
  grep -Fqx $'__leaddrive_snapshot_ready__\t1' "$SNAPSHOT_SESSION_OUTPUT" 2>/dev/null && break
  kill -0 "$SNAPSHOT_HOLDER_PID" 2>/dev/null \
    || fatal "source snapshot holder exited before exporting a usable snapshot"
  [ "$snapshot_attempt" -lt 120 ] \
    || fatal "source snapshot holder did not become ready within two minutes"
  sleep 1
done
SOURCE_SNAPSHOT_ID="$(awk -F '\t' '$1 == "__leaddrive_snapshot__" { print $2 }' \
  "$SNAPSHOT_SESSION_OUTPUT")"
[[ "$SOURCE_SNAPSHOT_ID" =~ ^[0-9A-Fa-f-]{8,80}$ ]] \
  || fatal "source snapshot holder emitted an invalid snapshot identifier"
awk -F '\t' '$1 != "__leaddrive_snapshot__" && $1 != "__leaddrive_snapshot_ready__" && NF > 0' \
  "$SNAPSHOT_SESSION_OUTPUT" >"$SOURCE_CANARY"
[ "$(wc -l <"$SOURCE_CANARY" | tr -d '[:space:]')" = "7" ] \
  || fatal "source snapshot canary did not emit the seven reviewed metrics"

organizations_count="$(awk -F '\t' '$1 == "organizations" {print $2}' "$SOURCE_CANARY")"
users_count="$(awk -F '\t' '$1 == "users" {print $2}' "$SOURCE_CANARY")"
[ -n "$organizations_count" ] && [ -n "$users_count" ] \
  || fatal "canary did not return organizations/users counts"
[ "$organizations_count" -gt 0 ] || fatal "organizations canary is empty"
[ "$users_count" -gt 0 ] || fatal "users canary is empty"

capture_migration_ledger() {
  local destination="$1"
  local snapshot_id="${2:-}"
  {
    printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    if [ -n "$snapshot_id" ]; then
      printf "SET TRANSACTION SNAPSHOT '%s';\n" "$snapshot_id"
    fi
    cat -- "$SCRIPT_DIR/migration-ledger.sql"
    printf '%s\n' 'COMMIT;'
  } | psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$destination"
}

log "capturing the exact Prisma migration ledger from the exported MVCC snapshot"
capture_migration_ledger "$MIGRATION_LEDGER_FILE" "$SOURCE_SNAPSHOT_ID"
awk -F '\t' '
  NF != 8 { bad=1; next }
  { for (i=1; i<=8; i++) if ($i !~ /^(n|x([0-9a-f][0-9a-f])*)$/) bad=1 }
  END { if (NR < 1 || bad) exit 1 }
' "$MIGRATION_LEDGER_FILE" || fatal "Prisma migration ledger is empty or malformed"

install -m 0600 -- "$SCRIPT_DIR/recovery-db-contract.tsv" "$RECOVERY_DB_CONTRACT_FILE"
awk -F '\t' '
  NR == 1 { if ($1 != "SCHEMA" || $2 != "prisma/schema.prisma" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  NR == 2 { if ($1 != "MIGRATION_LOCK" || $2 != "prisma/migrations/migration_lock.toml" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  $1 != "MIGRATION" || $2 !~ /^[0-9]{8,14}_[A-Za-z0-9_]+$/ || $3 !~ /^[0-9a-f]{64}$/ { bad=1; next }
  seen[$2]++ { bad=1 }
  { if (previous != "" && previous >= $2) bad=1; previous=$2; migrations++ }
  END { if (NR < 3 || migrations < 1 || bad) exit 1 }
' "$RECOVERY_DB_CONTRACT_FILE" || fatal "recovery DB contract manifest is malformed"
awk -F '\t' '$1 == "MIGRATION" { print $2 "\t" $3 }' \
  "$RECOVERY_DB_CONTRACT_FILE" >"$CONTRACT_MIGRATIONS_FILE"

{
  printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
  printf "SET TRANSACTION SNAPSHOT '%s';\n" "$SOURCE_SNAPSHOT_ID"
  cat <<'SQL'
SELECT '__unresolved__', count(*)::text
  FROM public._prisma_migrations
 WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT migration_name, checksum
  FROM public._prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY migration_name COLLATE "C";
SQL
  printf '%s\n' 'COMMIT;'
} | psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$APPLIED_MIGRATIONS_FILE"
[ "$(head -n 1 "$APPLIED_MIGRATIONS_FILE")" = $'__unresolved__\t0' ] \
  || fatal "source Prisma ledger contains an unresolved migration"
tail -n +2 "$APPLIED_MIGRATIONS_FILE" >"$APPLIED_MIGRATIONS_FILE.rows"
mv -- "$APPLIED_MIGRATIONS_FILE.rows" "$APPLIED_MIGRATIONS_FILE"
LC_ALL=C sort -o "$APPLIED_MIGRATIONS_FILE" "$APPLIED_MIGRATIONS_FILE"
awk -F '\t' '
  NF != 2 || $1 !~ /^[0-9]{8,14}_[A-Za-z0-9_]+$/ || $2 !~ /^[0-9a-f]{64}$/ { bad=1 }
  seen[$1]++ { bad=1 }
  { if (previous != "" && previous >= $1) bad=1; previous=$1 }
  END { if (NR < 1 || bad) exit 1 }
' "$APPLIED_MIGRATIONS_FILE" || fatal "successful Prisma migration ledger is empty, duplicate, or malformed"
applied_migration_count="$(wc -l <"$APPLIED_MIGRATIONS_FILE" | tr -d '[:space:]')"
head -n "$applied_migration_count" "$CONTRACT_MIGRATIONS_FILE" \
  >"$EXPECTED_APPLIED_MIGRATIONS_FILE" || fatal "cannot select the applied recovery DB contract prefix"
cmp -s -- "$APPLIED_MIGRATIONS_FILE" "$EXPECTED_APPLIED_MIGRATIONS_FILE" \
  || fatal "source Prisma ledger is not an exact checksum-matching prefix of the recovery DB contract"

log "creating custom-format PostgreSQL dump"
pg_dump \
  --format=custom \
  --compress=gzip:6 \
  --snapshot="$SOURCE_SNAPSHOT_ID" \
  --file="$DUMP_FILE"

capture_authority() {
  local destination="$1"
  local snapshot_id="${2:-}"
  {
    printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    if [ -n "$snapshot_id" ]; then
      printf "SET TRANSACTION SNAPSHOT '%s';\n" "$snapshot_id"
    fi
    cat <<'SQL'
WITH raw(kind, k1, k2, k3, k4, k5, k6, k7, k8) AS (
  SELECT 'ROLE', r.rolname::text,
         concat_ws(',', r.rolsuper::int, r.rolinherit::int, r.rolcreaterole::int,
           r.rolcreatedb::int, r.rolcanlogin::int, r.rolreplication::int,
           r.rolbypassrls::int)::text,
         r.rolconnlimit::text, coalesce(r.rolvaliduntil::text, ''),
         coalesce(array_to_string(r.rolconfig, E'\\x1f'), ''), '', '', ''
    FROM pg_catalog.pg_roles r
   WHERE r.rolname !~ '^pg_'
  UNION ALL
  SELECT 'MEMBERSHIP', granted.rolname::text, member.rolname::text,
         grantor.rolname::text, m.admin_option::int::text, '', '', '', ''
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
    JOIN pg_catalog.pg_roles member ON member.oid = m.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = m.grantor
  UNION ALL
  SELECT 'DATABASE', d.datname::text, pg_catalog.pg_get_userbyid(d.datdba)::text,
         coalesce(array_to_string(d.datacl, E'\\x1f'), ''), d.datconnlimit::text,
         d.datallowconn::int::text, '', '', ''
    FROM pg_catalog.pg_database d
   WHERE d.datname = current_database()
  UNION ALL
  SELECT 'SCHEMA', n.nspname::text, pg_catalog.pg_get_userbyid(n.nspowner)::text,
         coalesce(array_to_string(n.nspacl, E'\\x1f'), ''), '', '', '', '', ''
    FROM pg_catalog.pg_namespace n
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'RELATION', n.nspname::text, c.relname::text, c.relkind::text,
         pg_catalog.pg_get_userbyid(c.relowner)::text, c.relrowsecurity::int::text,
         c.relforcerowsecurity::int::text, coalesce(array_to_string(c.relacl, E'\\x1f'), ''), ''
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r','p','v','m','S','f')
  UNION ALL
  SELECT 'TYPE', n.nspname::text, t.typname::text, t.typtype::text,
         t.typcategory::text, pg_catalog.pg_get_userbyid(t.typowner)::text,
         coalesce(array_to_string(t.typacl, E'\\x1f'), ''),
         t.typisdefined::int::text, t.typnotnull::int::text
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND t.typrelid = 0
  UNION ALL
  SELECT 'SECURITY_RELATION', n.nspname::text, c.relname::text, c.relkind::text,
         c.relrowsecurity::int::text, c.relforcerowsecurity::int::text, '', '', ''
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r','p')
  UNION ALL
  SELECT 'POLICY', p.schemaname::text, p.tablename::text, p.policyname::text,
         p.permissive::text, coalesce(array_to_string(p.roles, E'\\x1f'), ''),
         p.cmd::text, coalesce(p.qual, ''), coalesce(p.with_check, '')
    FROM pg_catalog.pg_policies p
  UNION ALL
  SELECT 'SECURITY_POLICY', p.schemaname::text, p.tablename::text, p.policyname::text,
         p.permissive::text, coalesce(array_to_string(p.roles, E'\\x1f'), ''),
         p.cmd::text, coalesce(p.qual, ''), coalesce(p.with_check, '')
    FROM pg_catalog.pg_policies p
  UNION ALL
  SELECT 'DEFAULT_ACL', r.rolname::text, coalesce(n.nspname, ''), d.defaclobjtype::text,
         coalesce(array_to_string(d.defaclacl, E'\\x1f'), ''), '', '', '', ''
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
  UNION ALL
  SELECT 'FUNCTION', n.nspname::text, p.proname::text,
         pg_catalog.pg_get_function_identity_arguments(p.oid)::text,
         pg_catalog.pg_get_userbyid(p.proowner)::text,
         coalesce(array_to_string(p.proacl, E'\\x1f'), ''), '', '', ''
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'SETTING', coalesce(r.rolname, '*')::text, coalesce(d.datname, '*')::text,
         coalesce(array_to_string(s.setconfig, E'\\x1f'), ''), '', '', '', '', ''
    FROM pg_catalog.pg_db_role_setting s
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
    LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
), encoded AS (
  SELECT kind,
         'x' || encode(convert_to(coalesce(k1, ''), 'UTF8'), 'hex') AS e1,
         'x' || encode(convert_to(coalesce(k2, ''), 'UTF8'), 'hex') AS e2,
         'x' || encode(convert_to(coalesce(k3, ''), 'UTF8'), 'hex') AS e3,
         'x' || encode(convert_to(coalesce(k4, ''), 'UTF8'), 'hex') AS e4,
         'x' || encode(convert_to(coalesce(k5, ''), 'UTF8'), 'hex') AS e5,
         'x' || encode(convert_to(coalesce(k6, ''), 'UTF8'), 'hex') AS e6,
         'x' || encode(convert_to(coalesce(k7, ''), 'UTF8'), 'hex') AS e7,
         'x' || encode(convert_to(coalesce(k8, ''), 'UTF8'), 'hex') AS e8
    FROM raw
)
SELECT kind, e1, e2, e3, e4, e5, e6, e7, e8
  FROM encoded
 ORDER BY kind, e1, e2, e3, e4, e5, e6, e7, e8;
SQL
    printf '%s\n' 'COMMIT;'
  } | psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$destination"
}

log "capturing database roles, ownership, grants and RLS authority from the same MVCC snapshot"
capture_authority "$AUTHORITY_FILE" "$SOURCE_SNAPSHOT_ID"
awk -F '\t' '
  NF != 9 || $1 !~ /^(ROLE|MEMBERSHIP|DATABASE|SCHEMA|RELATION|TYPE|SECURITY_RELATION|POLICY|SECURITY_POLICY|DEFAULT_ACL|FUNCTION|SETTING)$/ { bad=1; next }
  { for (i=2; i<=9; i++) if ($i !~ /^x([0-9a-f][0-9a-f])*$/) bad=1; seen[$1]++ }
  END {
    if (NR < 5 || bad || !seen["ROLE"] || !seen["DATABASE"] || !seen["SCHEMA"] \
        || !seen["RELATION"] || !seen["TYPE"] || !seen["SECURITY_RELATION"]) exit 1
  }
' "$AUTHORITY_FILE" || fatal "database authority catalog is incomplete or malformed"

MIN_BYTES="${BACKUP_MIN_DUMP_BYTES:-1048576}"
case "$MIN_BYTES" in
  ''|*[!0-9]*) fatal "BACKUP_MIN_DUMP_BYTES must be an integer" ;;
esac
DUMP_BYTES="$(wc -c <"$DUMP_FILE" | tr -d '[:space:]')"
[ "$DUMP_BYTES" -ge "$MIN_BYTES" ] || fatal "dump is only $DUMP_BYTES bytes; minimum is $MIN_BYTES"

pg_restore --list "$DUMP_FILE" >"$DUMP_LIST"
for required_table in organizations users contacts deals; do
  grep -Eq "TABLE DATA public ${required_table}([[:space:]]|$)" "$DUMP_LIST" \
    || fatal "dump list is missing TABLE DATA for public.$required_table"
done

log "capturing roles/grants without password hashes"
pg_dumpall \
  --database="$PGDATABASE" \
  --globals-only \
  --no-role-passwords \
  --file="$GLOBALS_FILE"
if grep -Fq 'SCRAM-SHA-256$' "$GLOBALS_FILE" \
  || grep -Eiq 'md5[0-9a-f]{32}' "$GLOBALS_FILE" \
  || grep -Eiq "PASSWORD[[:space:]]+(E)?'[^']*'" "$GLOBALS_FILE"; then
  fatal "globals.sql contains password material despite --no-role-passwords"
fi

# pg_dumpall cannot import the exported table snapshot. Re-read the complete
# authority catalog after globals capture and reject the run if any role,
# owner, ACL, RLS policy or default privilege drifted across the interval.
capture_authority "$AUTHORITY_AFTER_FILE"
cmp -s -- "$AUTHORITY_FILE" "$AUTHORITY_AFTER_FILE" \
  || fatal "database authority changed while dump/globals were being captured"
rm -f -- "$AUTHORITY_AFTER_FILE"
capture_migration_ledger "$MIGRATION_LEDGER_AFTER_FILE"
cmp -s -- "$MIGRATION_LEDGER_FILE" "$MIGRATION_LEDGER_AFTER_FILE" \
  || fatal "Prisma migration ledger changed while the recovery point was being captured"
rm -f -- "$MIGRATION_LEDGER_AFTER_FILE"

kill "$SNAPSHOT_HOLDER_PID" >/dev/null 2>&1 || true
wait "$SNAPSHOT_HOLDER_PID" >/dev/null 2>&1 || true
SNAPSHOT_HOLDER_PID=""

log "restoring into scratch database and comparing canary"
SOURCE_SYSTEM_IDENTIFIER="${source_database_identity%%|*}"
"$SCRIPT_DIR/postgres-restore-canary.sh" \
  "$DUMP_FILE" "$SOURCE_CANARY" "$SOURCE_SYSTEM_IDENTIFIER" "$AUTHORITY_FILE" \
  "$MIGRATION_LEDGER_FILE" "$RECOVERY_DB_CONTRACT_FILE"

PG_DUMP_VERSION="$(pg_dump --version | tr ' ' '_')"
AUTHORITY_SHA256="$(sha256sum "$AUTHORITY_FILE" | awk '{print $1}')"
MIGRATION_LEDGER_SHA256="$(sha256sum "$MIGRATION_LEDGER_FILE" | awk '{print $1}')"
RECOVERY_DB_CONTRACT_SHA256="$(sha256sum "$RECOVERY_DB_CONTRACT_FILE" | awk '{print $1}')"
cat >"$MANIFEST_FILE" <<EOF
BACKUP_FORMAT_VERSION=3
CREATED_AT_UTC=$TIMESTAMP
SOURCE_DATABASE=$actual_database
SOURCE_ROLE=$actual_role
SOURCE_SYSTEM_IDENTIFIER=$SOURCE_SYSTEM_IDENTIFIER
SOURCE_DATABASE_BYTES=$SOURCE_DATABASE_BYTES
PG_DUMP_VERSION=$PG_DUMP_VERSION
DUMP_BYTES=$DUMP_BYTES
RETENTION_TIER=$TIER
RETENTION_DAYS=$RETENTION_DAYS
CANARY_STATUS=passed
AUTHORITY_STATUS=captured
AUTHORITY_SHA256=$AUTHORITY_SHA256
MIGRATION_LEDGER_STATUS=captured_and_restored
MIGRATION_LEDGER_SHA256=$MIGRATION_LEDGER_SHA256
RECOVERY_DB_CONTRACT_STATUS=applied_prefix_verified
RECOVERY_DB_CONTRACT_SHA256=$RECOVERY_DB_CONTRACT_SHA256
EOF
(
  cd "$WORK_DIR"
  sha256sum database.dump globals.sql authority.tsv migration-ledger.tsv recovery-db-contract.tsv source-canary.tsv database.list >SHA256SUMS
)

if [ "$MODE" = "local-canary" ]; then
  SUCCESS=1
  log "local canary completed; no archive was encrypted or uploaded"
  exit 0
fi

# Encryption is on unless the owner turns it off. Defaulting to "age" means a
# missing or misspelled value keeps the archive encrypted: the failure mode of a
# typo must never be "silently ship the customer database in the clear".
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-age}"
[ "$BACKUP_ENCRYPTION" = "age" ] \
  || fatal "upload mode requires BACKUP_ENCRYPTION=age"
require_env BACKUP_AGE_RECIPIENT
require_command age
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_REGION
require_env BACKUP_S3_BUCKET
require_env AWS_ACCESS_KEY_ID
require_env AWS_SECRET_ACCESS_KEY
require_command aws

export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_EC2_METADATA_DISABLED=true
export AWS_PAGER=""

ENCRYPTED_FILE="$WORK_DIR/leaddrive-postgres-${TIMESTAMP}.tar.age"
log "encrypting backup with offline age recipient"
tar -C "$WORK_DIR" -cf - \
  database.dump globals.sql authority.tsv migration-ledger.tsv recovery-db-contract.tsv source-canary.tsv database.list manifest.env SHA256SUMS \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$ENCRYPTED_FILE"
UPLOAD_FILE="$ENCRYPTED_FILE"
OBJECT_EXT="tar.age"
UPLOAD_BYTES="$(wc -c <"$UPLOAD_FILE" | tr -d '[:space:]')"
UPLOAD_SHA256="$(sha256sum "$UPLOAD_FILE" | awk '{print $1}')"

S3_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" --no-cli-pager)
lock_state="$(aws s3api get-object-lock-configuration \
  "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" \
  --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]' \
  --output text)"
read -r lock_enabled lock_mode lock_days <<<"$lock_state"
[ "$lock_enabled" = "Enabled" ] || fatal "S3 bucket Object Lock is not enabled"
[ "$lock_mode" = "COMPLIANCE" ] || fatal "S3 bucket default retention must use COMPLIANCE mode"
case "$lock_days" in
  ''|*[!0-9]*) fatal "S3 bucket default retention days are missing" ;;
esac
[ "$lock_days" -ge 14 ] || fatal "S3 bucket default retention must be at least 14 days"

S3_PREFIX="${BACKUP_S3_PREFIX:-postgres}"
IFS= read -r OBJECT_NONCE </proc/sys/kernel/random/uuid \
  || fatal "cannot allocate a cryptographically random object-key nonce"
[[ "$OBJECT_NONCE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fatal "kernel object-key nonce has an unexpected format"
OBJECT_KEY="$S3_PREFIX/$TIER/$(date -u '+%Y/%m')/leaddrive-postgres-${TIMESTAMP}-${OBJECT_NONCE}.${OBJECT_EXT}"
log "uploading encrypted archive to s3://$BACKUP_S3_BUCKET/$OBJECT_KEY"
aws s3 cp "$UPLOAD_FILE" "s3://$BACKUP_S3_BUCKET/$OBJECT_KEY" \
  "${S3_ARGS[@]}" \
  --only-show-errors \
  --no-progress \
  --metadata "sha256=$UPLOAD_SHA256,tier=$TIER,format-version=3,migration-ledger-sha256=$MIGRATION_LEDGER_SHA256"

head_state="$(aws s3api head-object \
  "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "$OBJECT_KEY" \
  --query '[ContentLength,VersionId,Metadata.sha256]' \
  --output text)"
read -r remote_bytes version_id remote_sha256 <<<"$head_state"
[ "$remote_bytes" = "$UPLOAD_BYTES" ] || fatal "uploaded object size mismatch: local=$UPLOAD_BYTES remote=$remote_bytes"
[ "$remote_sha256" = "$UPLOAD_SHA256" ] || fatal "uploaded object SHA-256 metadata mismatch"
[ -n "$version_id" ] && [ "$version_id" != "None" ] || fatal "uploaded object has no version ID; Object Lock/versioning may be misconfigured"

RETAIN_UNTIL="$(retention_deadline "$RETENTION_DAYS")"
# --version-id=VALUE, not --version-id VALUE: S3 version IDs may begin with a
# hyphen (observed: -TG2lbh8Z9QB5M8XlkzgGCRkYgNG08D), and argparse then reads the
# value as the next option and fails with "expected one argument". It is
# intermittent — roughly one upload in thirty — so it looks like a transient S3
# problem rather than a quoting bug, and the object silently keeps only the
# bucket's default retention instead of the one this script meant to set.
aws s3api put-object-retention \
  "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "$OBJECT_KEY" \
  --version-id="$version_id" \
  --retention "Mode=COMPLIANCE,RetainUntilDate=$RETAIN_UNTIL" >/dev/null

retention_state="$(aws s3api get-object-retention \
  "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "$OBJECT_KEY" \
  --version-id="$version_id" \
  --query '[Retention.Mode,Retention.RetainUntilDate]' \
  --output text)"
read -r remote_mode remote_until <<<"$retention_state"
[ "$remote_mode" = "COMPLIANCE" ] || fatal "uploaded object is not COMPLIANCE-locked"
[ -n "$remote_until" ] && [ "$remote_until" != "None" ] || fatal "uploaded object has no retain-until date"
requested_retention_epoch="$(date -u -d "$RETAIN_UNTIL" '+%s' 2>/dev/null)" \
  || fatal "requested object-retention deadline is invalid"
remote_retention_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null)" \
  || fatal "uploaded object retain-until date is invalid"
[ "$remote_retention_epoch" -ge "$requested_retention_epoch" ] \
  || fatal "uploaded object retention is shorter than the selected $TIER policy"

SUCCESS=1
case "$TIER" in
  monthly) printf '%s\n' "$MONTH_KEY" >"$MONTH_MARKER" ;;
  weekly) printf '%s\n' "$WEEK_KEY" >"$WEEK_MARKER" ;;
esac
ping_healthcheck
log "backup verified and locked until $remote_until (version $version_id)"
log "SUMMARY key=$OBJECT_KEY version=$version_id tier=$TIER retention_days=$RETENTION_DAYS bytes=$UPLOAD_BYTES sha256=$UPLOAD_SHA256 retain_until=$remote_until migration_ledger_sha256=$MIGRATION_LEDGER_SHA256 recovery_db_contract_sha256=$RECOVERY_DB_CONTRACT_SHA256"
