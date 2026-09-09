#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DUMP_FILE="${1:-}"
SOURCE_CANARY="${2:-}"
SOURCE_SYSTEM_IDENTIFIER="${3:-}"
SOURCE_AUTHORITY="${4:-}"
SOURCE_MIGRATION_LEDGER="${5:-}"
SOURCE_DB_CONTRACT="${6:-}"
PII_MASTER_KEY_FILE="${7:-}"
SCRATCH_DB=""
SCRATCH_DB_CREATED=0
RESTORED_CANARY=""
SOURCE_SECURITY=""
RESTORED_SECURITY=""
RESTORED_MIGRATION_LEDGER=""
RESTORED_APPLIED_MIGRATIONS=""
CONTRACT_MIGRATIONS=""
EXPECTED_APPLIED_MIGRATIONS=""
VERIFY_ENV=()

log() {
  printf '[restore-canary] %s\n' "$*"
}

fatal() {
  printf '[restore-canary] ERROR: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fatal "$name is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fatal "required command not found: $1"
}

assert_connection_file() {
  local label="$1"
  local file="$2"
  local kind="$3"
  local mode owner
  [[ "$file" = /* ]] || fatal "$label must use an absolute path"
  [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] \
    || fatal "$label must be a readable regular non-symlink file"
  owner="$(stat -c '%u' "$file")"
  { [ "$owner" = "0" ] || [ "$owner" = "$(id -u)" ]; } \
    || fatal "$label must belong to root or the verifier account"
  mode="$(stat -c '%a' "$file")"
  case "$kind:$mode" in
    ca:400|ca:440|ca:444|ca:600|ca:640|ca:644) ;;
    password:400|password:440|password:600|password:640) ;;
    *) fatal "$label has an unsafe mode" ;;
  esac
}

cleanup() {
  local status=$?
  local drop_attempt remaining
  trap - EXIT
  if [ "$SCRATCH_DB_CREATED" -eq 1 ] && [ -n "$SCRATCH_DB" ]; then
    case "$SCRATCH_DB" in
      leaddrive_restore_verify_*)
        remaining=1
        for drop_attempt in 1 2 3; do
          if env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
              dropdb --if-exists --force "$SCRATCH_DB" >/dev/null 2>&1 \
            && [ "$(env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
              psql -X -v ON_ERROR_STOP=1 -At -v candidate="$SCRATCH_DB" -c \
                "SELECT count(*) FROM pg_database WHERE datname = :'candidate'" \
              2>/dev/null || printf '1')" = "0" ]; then
            remaining=0
            break
          fi
          [ "$drop_attempt" -eq 3 ] || sleep "$drop_attempt"
        done
        if [ "$remaining" -ne 0 ]; then
          printf '[restore-canary] ERROR: scratch database destruction was not confirmed after three attempts: %s\n' \
            "$SCRATCH_DB" >&2
          status=1
        fi
        ;;
      *)
        printf '[restore-canary] REFUSED cleanup of unexpected database name: %s\n' "$SCRATCH_DB" >&2
        ;;
    esac
  fi
  if [ -n "$RESTORED_CANARY" ]; then
    rm -f -- "$RESTORED_CANARY"
  fi
  [ -z "$SOURCE_SECURITY" ] || rm -f -- "$SOURCE_SECURITY"
  [ -z "$RESTORED_SECURITY" ] || rm -f -- "$RESTORED_SECURITY"
  [ -z "$RESTORED_MIGRATION_LEDGER" ] || rm -f -- "$RESTORED_MIGRATION_LEDGER"
  [ -z "$RESTORED_APPLIED_MIGRATIONS" ] || rm -f -- "$RESTORED_APPLIED_MIGRATIONS"
  [ -z "$CONTRACT_MIGRATIONS" ] || rm -f -- "$CONTRACT_MIGRATIONS"
  [ -z "$EXPECTED_APPLIED_MIGRATIONS" ] || rm -f -- "$EXPECTED_APPLIED_MIGRATIONS"
  exit "$status"
}
trap cleanup EXIT

[ -s "$DUMP_FILE" ] || fatal "dump file is missing or empty"
[ -s "$SOURCE_CANARY" ] || fatal "source canary file is missing or empty"
[ -s "$SOURCE_AUTHORITY" ] && [ ! -L "$SOURCE_AUTHORITY" ] \
  || fatal "source database authority catalog is missing, empty or symlinked"
[ -s "$SOURCE_MIGRATION_LEDGER" ] && [ ! -L "$SOURCE_MIGRATION_LEDGER" ] \
  || fatal "source Prisma migration ledger is missing, empty or symlinked"
[ -s "$SOURCE_DB_CONTRACT" ] && [ ! -L "$SOURCE_DB_CONTRACT" ] \
  || fatal "source recovery DB contract is missing, empty or symlinked"
[ -r "$SCRIPT_DIR/canary.sql" ] || fatal "canary.sql is missing"
[ -r "$SCRIPT_DIR/migration-ledger.sql" ] && [ ! -L "$SCRIPT_DIR/migration-ledger.sql" ] \
  || fatal "migration-ledger.sql is missing or symlinked"
[[ "$SOURCE_SYSTEM_IDENTIFIER" =~ ^[0-9]{1,20}$ ]] \
  || fatal "source PostgreSQL system identifier is required"
[ "$#" -ge 6 ] && [ "$#" -le 7 ] \
  || fatal "usage: postgres-restore-canary.sh DUMP SOURCE_CANARY SOURCE_SYSTEM_IDENTIFIER SOURCE_AUTHORITY SOURCE_MIGRATION_LEDGER SOURCE_DB_CONTRACT [PII_MASTER_KEY_FILE]"

require_env VERIFY_PGHOST
require_env VERIFY_PGPORT
require_env VERIFY_PGUSER
require_env VERIFY_PGPASSFILE
require_env VERIFY_PGMAINTENANCE_DB

require_command createdb
require_command dropdb
require_command pg_restore
require_command psql
require_command cmp
require_command head
require_command mv
require_command sort
require_command tail
require_command sleep

if [ -n "$PII_MASTER_KEY_FILE" ]; then
  [ -s "$PII_MASTER_KEY_FILE" ] && [ ! -L "$PII_MASTER_KEY_FILE" ] \
    || fatal "PII master-key source must be a non-empty regular non-symlink file"
  case "$(stat -c '%a' "$PII_MASTER_KEY_FILE")" in
    400|600) ;;
    *) fatal "PII master-key source must use mode 0400 or 0600" ;;
  esac
  [ "${VERIFY_ALLOW_SOURCE_CLUSTER:-0}" != "1" ] \
    || fatal "PII recovery proof forbids the source-cluster override"
  case "$VERIFY_PGHOST" in
    127.0.0.1|localhost|::1) ;;
    *) fatal "PII recovery proof requires an isolated loopback scratch PostgreSQL" ;;
  esac
  [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ] && [ ! -L "$TMPDIR" ] \
    || fatal "PII recovery proof requires an explicit real scratch TMPDIR"
  [ -f "$SCRIPT_DIR/prove-restored-pii.mjs" ] && [ ! -L "$SCRIPT_DIR/prove-restored-pii.mjs" ] \
    || fatal "fixed PII recovery proof is missing"
  require_command node
fi

assert_connection_file "VERIFY_PGPASSFILE" "$VERIFY_PGPASSFILE" password

[ "${VERIFY_ALLOW_SOURCE_CLUSTER:-0}" != "1" ] \
  || fatal "scratch verification on the source cluster is forbidden"
[ "${VERIFY_PGHOST}:${VERIFY_PGPORT}" != "${PGHOST:-}:${PGPORT:-5432}" ] \
  || fatal "scratch verification must use a different host/port"

VERIFY_PGCONNECT_TIMEOUT="${VERIFY_PGCONNECT_TIMEOUT:-10}"
VERIFY_PGSSLMODE="${VERIFY_PGSSLMODE:-verify-full}"
[[ "$VERIFY_PGCONNECT_TIMEOUT" =~ ^[0-9]+$ ]] \
  && [ "$VERIFY_PGCONNECT_TIMEOUT" -ge 1 ] && [ "$VERIFY_PGCONNECT_TIMEOUT" -le 30 ] \
  || fatal "VERIFY_PGCONNECT_TIMEOUT must be between 1 and 30 seconds"
case "$VERIFY_PGSSLMODE" in
  verify-full)
    require_env VERIFY_PGSSLROOTCERT
    assert_connection_file "VERIFY_PGSSLROOTCERT" "$VERIFY_PGSSLROOTCERT" ca
    ;;
  disable)
    [ -n "$PII_MASTER_KEY_FILE" ] \
      && [ "${VERIFY_OFFLINE_LOOPBACK_PLAINTEXT:-0}" = "1" ] \
      || fatal "plaintext scratch transport is allowed only for the explicit offline loopback drill"
    case "$VERIFY_PGHOST" in 127.0.0.1|localhost|::1) ;; *) fatal "offline plaintext scratch must use loopback" ;; esac
    ;;
  *) fatal "VERIFY_PGSSLMODE must be verify-full for production restore checks" ;;
esac

VERIFY_ENV=(
  "PGHOST=$VERIFY_PGHOST"
  "PGPORT=$VERIFY_PGPORT"
  "PGUSER=$VERIFY_PGUSER"
  "PGPASSFILE=$VERIFY_PGPASSFILE"
  "PGCONNECT_TIMEOUT=$VERIFY_PGCONNECT_TIMEOUT"
  "PGSSLMODE=$VERIFY_PGSSLMODE"
)
if [ "$VERIFY_PGSSLMODE" = "verify-full" ]; then
  VERIFY_ENV+=("PGSSLROOTCERT=$VERIFY_PGSSLROOTCERT")
fi

role_state="$(env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
  psql -X -v ON_ERROR_STOP=1 -AtF '|' -c \
  "SELECT rolsuper::int, rolcreatedb::int FROM pg_roles WHERE rolname = session_user")"
[ "$role_state" = "0|1" ] || fatal "scratch verifier must be NOSUPERUSER and CREATEDB (got: ${role_state:-no row})"

orphan_scratch_count="$(env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
  psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*)
     FROM pg_database d
     JOIN pg_roles r ON r.oid = d.datdba
    WHERE d.datname ~ '^leaddrive_restore_verify_[0-9]{8}_[0-9]{6}_[0-9]+$'
      AND r.rolname = session_user")" \
  || fatal "existing scratch-database inventory could not be read"
[ "$orphan_scratch_count" = "0" ] \
  || fatal "found $orphan_scratch_count existing verifier-owned scratch database(s); quarantine and remove them with the runbook before retrying"

verify_system_identifier="$(env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
  psql -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT (pg_control_system()).system_identifier::text")" \
  || fatal "scratch PostgreSQL system identity could not be read"
[[ "$verify_system_identifier" =~ ^[0-9]{1,20}$ ]] \
  || fatal "scratch PostgreSQL returned an invalid system identifier"
[ "$verify_system_identifier" != "$SOURCE_SYSTEM_IDENTIFIER" ] \
  || fatal "scratch verification endpoint is the source PostgreSQL cluster"

SCRATCH_DB="leaddrive_restore_verify_$(date -u '+%Y%m%d_%H%M%S')_$$"
RESTORED_CANARY="$(mktemp "${TMPDIR:-/tmp}/leaddrive-restored-canary.XXXXXX")"
SOURCE_SECURITY="$(mktemp "${TMPDIR:-/tmp}/leaddrive-source-security.XXXXXX")"
RESTORED_SECURITY="$(mktemp "${TMPDIR:-/tmp}/leaddrive-restored-security.XXXXXX")"
RESTORED_MIGRATION_LEDGER="$(mktemp "${TMPDIR:-/tmp}/leaddrive-restored-migration-ledger.XXXXXX")"
RESTORED_APPLIED_MIGRATIONS="$(mktemp "${TMPDIR:-/tmp}/leaddrive-restored-applied-migrations.XXXXXX")"
CONTRACT_MIGRATIONS="$(mktemp "${TMPDIR:-/tmp}/leaddrive-contract-migrations.XXXXXX")"
EXPECTED_APPLIED_MIGRATIONS="$(mktemp "${TMPDIR:-/tmp}/leaddrive-expected-applied-migrations.XXXXXX")"

log "creating isolated scratch database $SCRATCH_DB"
env "${VERIFY_ENV[@]}" PGDATABASE="$VERIFY_PGMAINTENANCE_DB" \
  createdb --maintenance-db="$VERIFY_PGMAINTENANCE_DB" "$SCRATCH_DB"
SCRATCH_DB_CREATED=1

log "restoring dump"
env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
  pg_restore --exit-on-error --no-owner --no-privileges --dbname="$SCRATCH_DB" "$DUMP_FILE"

log "comparing the exact Prisma migration ledger from the restored database"
env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
  psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' \
    -f "$SCRIPT_DIR/migration-ledger.sql" >"$RESTORED_MIGRATION_LEDGER"
if ! cmp -s "$SOURCE_MIGRATION_LEDGER" "$RESTORED_MIGRATION_LEDGER"; then
  source_ledger_sha="$(sha256sum "$SOURCE_MIGRATION_LEDGER" | awk '{print $1}')"
  restored_ledger_sha="$(sha256sum "$RESTORED_MIGRATION_LEDGER" | awk '{print $1}')"
  printf '[restore-canary] migration ledger mismatch (source_sha256=%s restored_sha256=%s; rows redacted)\n' \
    "$source_ledger_sha" "$restored_ledger_sha" >&2
  fatal "restored Prisma migration ledger does not match the source recovery point"
fi
rm -f -- "$RESTORED_MIGRATION_LEDGER"
RESTORED_MIGRATION_LEDGER=""
log "restored Prisma migration ledger proof passed"

awk -F '\t' '
  NR == 1 { if ($1 != "SCHEMA" || $2 != "prisma/schema.prisma" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  NR == 2 { if ($1 != "MIGRATION_LOCK" || $2 != "prisma/migrations/migration_lock.toml" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  $1 != "MIGRATION" || $2 !~ /^[0-9]{8,14}_[A-Za-z0-9_]+$/ || $3 !~ /^[0-9a-f]{64}$/ { bad=1; next }
  seen[$2]++ { bad=1 }
  { if (previous != "" && previous >= $2) bad=1; previous=$2; migrations++ }
  END { if (NR < 3 || migrations < 1 || bad) exit 1 }
' "$SOURCE_DB_CONTRACT" || fatal "recovery DB contract manifest is malformed"
awk -F '\t' '$1 == "MIGRATION" { print $2 "\t" $3 }' \
  "$SOURCE_DB_CONTRACT" >"$CONTRACT_MIGRATIONS"
env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
  psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$RESTORED_APPLIED_MIGRATIONS" <<'SQL'
SELECT '__unresolved__', count(*)::text
  FROM public._prisma_migrations
 WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT migration_name, checksum
  FROM public._prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY migration_name COLLATE "C";
SQL
[ "$(head -n 1 "$RESTORED_APPLIED_MIGRATIONS")" = $'__unresolved__\t0' ] \
  || fatal "restored Prisma ledger contains an unresolved migration"
tail -n +2 "$RESTORED_APPLIED_MIGRATIONS" >"$RESTORED_APPLIED_MIGRATIONS.rows"
mv -- "$RESTORED_APPLIED_MIGRATIONS.rows" "$RESTORED_APPLIED_MIGRATIONS"
LC_ALL=C sort -o "$RESTORED_APPLIED_MIGRATIONS" "$RESTORED_APPLIED_MIGRATIONS"
awk -F '\t' '
  NF != 2 || $1 !~ /^[0-9]{8,14}_[A-Za-z0-9_]+$/ || $2 !~ /^[0-9a-f]{64}$/ { bad=1 }
  seen[$1]++ { bad=1 }
  END { if (NR < 1 || bad) exit 1 }
' "$RESTORED_APPLIED_MIGRATIONS" || fatal "restored successful migration ledger is empty, duplicate, or malformed"
applied_migration_count="$(wc -l <"$RESTORED_APPLIED_MIGRATIONS" | tr -d '[:space:]')"
head -n "$applied_migration_count" "$CONTRACT_MIGRATIONS" \
  >"$EXPECTED_APPLIED_MIGRATIONS" || fatal "cannot select restored recovery DB contract prefix"
cmp -s -- "$RESTORED_APPLIED_MIGRATIONS" "$EXPECTED_APPLIED_MIGRATIONS" \
  || fatal "restored Prisma ledger is not an exact checksum-matching prefix of the recovery DB contract"
rm -f -- "$RESTORED_APPLIED_MIGRATIONS" "$CONTRACT_MIGRATIONS" "$EXPECTED_APPLIED_MIGRATIONS"
RESTORED_APPLIED_MIGRATIONS=""
CONTRACT_MIGRATIONS=""
EXPECTED_APPLIED_MIGRATIONS=""
log "restored applied migrations match the recovery DB contract"

log "comparing source and restored canaries"
env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
  psql -X -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/canary.sql" >"$RESTORED_CANARY"

if ! cmp -s "$SOURCE_CANARY" "$RESTORED_CANARY"; then
  source_canary_sha="$(sha256sum "$SOURCE_CANARY" | awk '{print $1}')"
  restored_canary_sha="$(sha256sum "$RESTORED_CANARY" | awk '{print $1}')"
  printf '[restore-canary] canary mismatch (source_sha256=%s restored_sha256=%s; values redacted)\n' \
    "$source_canary_sha" "$restored_canary_sha" >&2
  fatal "restored counts/fingerprints do not match the source canary"
fi

rm -f -- "$RESTORED_CANARY"
RESTORED_CANARY=""
log "restore canary passed"

awk -F '\t' '$1 == "SECURITY_RELATION" || $1 == "SECURITY_POLICY" { print }' \
  "$SOURCE_AUTHORITY" >"$SOURCE_SECURITY"
[ -s "$SOURCE_SECURITY" ] || fatal "source authority catalog has no RLS security records"
env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
  psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' >"$RESTORED_SECURITY" <<'SQL'
WITH raw(kind, k1, k2, k3, k4, k5, k6, k7, k8) AS (
  SELECT 'SECURITY_RELATION', n.nspname::text, c.relname::text, c.relkind::text,
         c.relrowsecurity::int::text, c.relforcerowsecurity::int::text, '', '', ''
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r','p')
  UNION ALL
  SELECT 'SECURITY_POLICY', p.schemaname::text, p.tablename::text, p.policyname::text,
         p.permissive::text, coalesce(array_to_string(p.roles, E'\x1f'), ''),
         p.cmd::text, coalesce(p.qual, ''), coalesce(p.with_check, '')
    FROM pg_catalog.pg_policies p
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
if ! cmp -s "$SOURCE_SECURITY" "$RESTORED_SECURITY"; then
  source_security_sha="$(sha256sum "$SOURCE_SECURITY" | awk '{print $1}')"
  restored_security_sha="$(sha256sum "$RESTORED_SECURITY" | awk '{print $1}')"
  printf '[restore-canary] RLS catalog mismatch (source_sha256=%s restored_sha256=%s; records redacted)\n' \
    "$source_security_sha" "$restored_security_sha" >&2
  fatal "restored RLS/FORCE RLS policy catalog does not match the source snapshot"
fi
rm -f -- "$SOURCE_SECURITY" "$RESTORED_SECURITY"
SOURCE_SECURITY=""
RESTORED_SECURITY=""
log "restored RLS/FORCE RLS catalog proof passed"

if [ -n "$PII_MASTER_KEY_FILE" ]; then
  log "proving one restored encrypted PII value with recovered secret material"
  env "${VERIFY_ENV[@]}" PGDATABASE="$SCRATCH_DB" \
    TENANT_PII_MASTER_KEY_FILE="$PII_MASTER_KEY_FILE" \
    node "$SCRIPT_DIR/prove-restored-pii.mjs"
  log "restored encrypted PII proof passed (value redacted)"
fi
