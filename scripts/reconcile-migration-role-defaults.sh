#!/usr/bin/env bash
set -Eeuo pipefail

# Reconcile only the two server-side defaults required by Prisma's standalone
# schema engine for the bounded concurrent Workforce index build. The caller
# supplies the already validated root-only migration URL; this helper neither
# reads an env file nor prints a credential.

MODE="${1:-}"
EXPECTED_LOCK_TIMEOUT="10s"
EXPECTED_STATEMENT_TIMEOUT="14min"

log() { printf '[migration-role-defaults] %s\n' "$*"; }
fatal() { printf '[migration-role-defaults] ERROR: %s\n' "$*" >&2; exit 1; }

case "$MODE" in
  --check|--reconcile) ;;
  *) fatal "mode must be --check or --reconcile" ;;
esac

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${MIGRATION_EXPECTED_DB_ROLE:?MIGRATION_EXPECTED_DB_ROLE is required}"
[[ "$MIGRATION_EXPECTED_DB_ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || \
  fatal "MIGRATION_EXPECTED_DB_ROLE is not a safe PostgreSQL identifier"
command -v psql >/dev/null 2>&1 || fatal "psql is required"

read_state() {
  env -u PGOPTIONS PGCONNECT_TIMEOUT=10 \
    psql "$MIGRATION_DATABASE_URL" -X -qAtF '|' -v ON_ERROR_STOP=1 \
      -c "SELECT session_user, current_user, current_database(),
                 current_setting('lock_timeout'),
                 current_setting('statement_timeout');"
}

parse_state() {
  local state="$1" extra=""
  IFS='|' read -r SESSION_ROLE CURRENT_ROLE DATABASE_NAME \
    LOCK_TIMEOUT STATEMENT_TIMEOUT extra <<<"$state"
  [ -z "$extra" ] || fatal "migration role state has an unexpected shape"
  [[ "$SESSION_ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || \
    fatal "connected session role is not a safe PostgreSQL identifier"
  [[ "$CURRENT_ROLE" =~ ^[a-z_][a-z0-9_]*$ ]] || \
    fatal "connected current role is not a safe PostgreSQL identifier"
  [[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || \
    fatal "connected database is not a safe PostgreSQL identifier"
  [ "$SESSION_ROLE" = "$MIGRATION_EXPECTED_DB_ROLE" ] || \
    fatal "connected as $SESSION_ROLE; expected $MIGRATION_EXPECTED_DB_ROLE"
  [ "$CURRENT_ROLE" = "$SESSION_ROLE" ] || \
    fatal "migration connection must not enter through SET ROLE"
}

is_exact() {
  [ "$LOCK_TIMEOUT" = "$EXPECTED_LOCK_TIMEOUT" ] \
    && [ "$STATEMENT_TIMEOUT" = "$EXPECTED_STATEMENT_TIMEOUT" ]
}

STATE="$(read_state)" || fatal "cannot read migration role session defaults"
parse_state "$STATE"

if [ "$MODE" = "--check" ]; then
  is_exact || fatal \
    "session defaults mismatch: observed lock_timeout=$LOCK_TIMEOUT statement_timeout=$STATEMENT_TIMEOUT; expected lock_timeout=$EXPECTED_LOCK_TIMEOUT statement_timeout=$EXPECTED_STATEMENT_TIMEOUT"
  log "fresh-session defaults verified: lock_timeout=$LOCK_TIMEOUT statement_timeout=$STATEMENT_TIMEOUT"
  exit 0
fi

if is_exact; then
  log "fresh-session defaults already exact; no configuration changed"
  exit 0
fi

# Fail closed instead of weakening or replacing an operator-selected nonzero
# value. The only accepted transition is from PostgreSQL's unbounded legacy
# default (or a partially applied copy of this exact contract) to 10s/14min.
case "$LOCK_TIMEOUT" in
  0|10s) ;;
  *) fatal \
    "refusing to replace unexpected lock_timeout=$LOCK_TIMEOUT (expected legacy 0 or reviewed 10s)" ;;
esac
case "$STATEMENT_TIMEOUT" in
  0|14min) ;;
  *) fatal \
    "refusing to replace unexpected statement_timeout=$STATEMENT_TIMEOUT (expected legacy 0 or reviewed 14min)" ;;
esac

log "reconciling accepted legacy defaults: lock_timeout=$LOCK_TIMEOUT statement_timeout=$STATEMENT_TIMEOUT"
env -u PGOPTIONS PGCONNECT_TIMEOUT=10 \
  psql "$MIGRATION_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $migration_role_defaults$
DECLARE
  target_role text := session_user;
  target_database text := current_database();
  observed_lock_timeout text := current_setting('lock_timeout');
  observed_statement_timeout text := current_setting('statement_timeout');
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'migration role reconciliation refuses SET ROLE sessions';
  END IF;
  IF observed_lock_timeout NOT IN ('0', '10s') THEN
    RAISE EXCEPTION 'migration role reconciliation saw unexpected lock_timeout';
  END IF;
  IF observed_statement_timeout NOT IN ('0', '14min') THEN
    RAISE EXCEPTION 'migration role reconciliation saw unexpected statement_timeout';
  END IF;

  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
    target_role,
    target_database,
    '10s'
  );
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    target_role,
    target_database,
    '14min'
  );
END
$migration_role_defaults$;
SQL

# ALTER ROLE defaults take effect only at login. A new connection is the
# authoritative proof for the later independent Prisma precondition.
STATE="$(read_state)" || fatal "cannot verify reconciled migration role defaults"
parse_state "$STATE"
is_exact || fatal \
  "reconciliation postcondition failed: observed lock_timeout=$LOCK_TIMEOUT statement_timeout=$STATEMENT_TIMEOUT"
log "fresh-session reconciliation postcondition passed: lock_timeout=$LOCK_TIMEOUT statement_timeout=$STATEMENT_TIMEOUT"
