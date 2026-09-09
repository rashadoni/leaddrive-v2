#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

DB_NAME="${DB_NAME:-leaddrive_v2}"
APP_OWNER_ROLE="${APP_OWNER_ROLE:-hermes}"
MIGRATION_ROLE="${MIGRATION_ROLE:-leaddrive_migrator}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
MIGRATION_ENV_FILE="${MIGRATION_ENV_FILE:-/etc/leaddrive/migration.env}"

log() { printf '[migration-role] %s\n' "$*"; }
fatal() { printf '[migration-role] ERROR: %s\n' "$*" >&2; exit 1; }

for identifier in "$DB_NAME" "$APP_OWNER_ROLE" "$MIGRATION_ROLE"; do
  [[ "$identifier" =~ ^[a-z_][a-z0-9_]*$ ]] || fatal "unsafe PostgreSQL identifier: $identifier"
done

[ "$(id -u)" = "0" ] || fatal "run as root"
command -v openssl >/dev/null 2>&1 || fatal "openssl is required"
command -v psql >/dev/null 2>&1 || fatal "psql is required"
command -v sudo >/dev/null 2>&1 || fatal "sudo is required"

if sudo -u postgres psql -d "$DB_NAME" -X -At -c \
  "SELECT 1 FROM pg_roles WHERE rolname='$MIGRATION_ROLE'" | grep -qx 1; then
  fatal "role $MIGRATION_ROLE already exists; rotate it through the documented procedure"
fi
[ ! -e "$MIGRATION_ENV_FILE" ] || fatal "$MIGRATION_ENV_FILE already exists"

PASSWORD="$(openssl rand -hex 32)"
SQL_FILE="$(mktemp)"
ENV_TMP="$(mktemp)"
SUCCESS=0
ROLE_CREATED=0

cleanup() {
  local status=$?
  trap - EXIT
  if command -v shred >/dev/null 2>&1; then
    shred -u "$SQL_FILE" "$ENV_TMP" 2>/dev/null || true
  else
    rm -f "$SQL_FILE" "$ENV_TMP"
  fi
  if [ "$SUCCESS" -ne 1 ] && [ "$status" -ne 0 ]; then
    rm -f "$MIGRATION_ENV_FILE"
    if [ "$ROLE_CREATED" = "1" ]; then
      sudo -u postgres psql -d "$DB_NAME" -X -v ON_ERROR_STOP=1 -c \
        "DROP ROLE \"$MIGRATION_ROLE\"" >/dev/null 2>&1 || true
    fi
    log "provisioning failed; attempted to remove the partial role and secret file"
  fi
  exit "$status"
}
trap cleanup EXIT

printf '%s\n' \
  "BEGIN;" \
  "CREATE ROLE \"$MIGRATION_ROLE\" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 2 PASSWORD '$PASSWORD';" \
  "GRANT \"$APP_OWNER_ROLE\" TO \"$MIGRATION_ROLE\";" \
  "ALTER ROLE \"$MIGRATION_ROLE\" IN DATABASE \"$DB_NAME\" SET lock_timeout = '10s';" \
  "ALTER ROLE \"$MIGRATION_ROLE\" IN DATABASE \"$DB_NAME\" SET statement_timeout = '14min';" \
  "ALTER ROLE \"$MIGRATION_ROLE\" IN DATABASE \"$DB_NAME\" SET idle_in_transaction_session_timeout = '60s';" \
  "COMMIT;" \
  >"$SQL_FILE"

sudo -u postgres psql -d "$DB_NAME" -X -v ON_ERROR_STOP=1 <"$SQL_FILE" >/dev/null
ROLE_CREATED=1

printf '%s\n' \
  "MIGRATION_DATABASE_URL='postgresql://$MIGRATION_ROLE:$PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?connect_timeout=10'" \
  "MIGRATION_EXPECTED_DB_ROLE=$MIGRATION_ROLE" \
  >"$ENV_TMP"
install -o root -g root -m 0600 "$ENV_TMP" "$MIGRATION_ENV_FILE"

# Verify the real password connection, RLS bypass, owner membership, bounded
# lock waits, and DDL ownership. The ALTER probe is fully rolled back.
set -a
# shellcheck disable=SC1090
source "$MIGRATION_ENV_FILE"
set +a

ROLE_STATE=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
  "SELECT session_user, rolsuper::int, rolbypassrls::int, rolcanlogin::int,
          pg_has_role(session_user, '$APP_OWNER_ROLE', 'MEMBER')::int,
          current_setting('lock_timeout')
   FROM pg_roles WHERE rolname = session_user")
[ "$ROLE_STATE" = "$MIGRATION_ROLE|0|1|1|1|10s" ] || fatal "unexpected role state: $ROLE_STATE"

psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
ALTER TABLE "_prisma_migrations" ADD COLUMN "_migration_role_probe" BOOLEAN;
ROLLBACK;
SQL

PROBE_COLUMN=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='_prisma_migrations'
     AND column_name='_migration_role_probe'")
[ "$PROBE_COLUMN" = "0" ] || fatal "DDL rollback probe left an unexpected column"

SUCCESS=1
log "provisioned $MIGRATION_ROLE and installed $MIGRATION_ENV_FILE (root:root 0600)"
