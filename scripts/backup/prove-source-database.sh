#!/usr/bin/env bash
set -Eeuo pipefail

application_name="${1:-}"
[[ "$application_name" =~ ^leaddrive-cutover-backup-[0-9a-f]{32}$ ]] || {
  printf 'invalid backup source-probe application name\n' >&2
  exit 2
}

# Mirror postgres-backup.sh exactly: systemd loads the canonical EnvironmentFile
# and the program sources that same root-owned shell-safe file once more. This
# avoids proving systemd's parser while the real backup later uses Bash's.
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/leaddrive/backup.env}"
[ "$BACKUP_ENV_FILE" = "/etc/leaddrive/backup.env" ] && [ -r "$BACKUP_ENV_FILE" ] || {
  printf 'backup source proof requires canonical BACKUP_ENV_FILE\n' >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
source "$BACKUP_ENV_FILE"
set +a

for name in PGHOST PGDATABASE PGUSER PGPASSFILE BACKUP_EXPECTED_DB_ROLE; do
  [ -n "${!name:-}" ] || {
    printf '%s is required for backup source proof\n' "$name" >&2
    exit 1
  }
done
[ -r "$PGPASSFILE" ] || {
  printf 'backup source proof cannot read PGPASSFILE\n' >&2
  exit 1
}

export PGHOST PGDATABASE PGUSER PGPASSFILE
export PGPORT="${PGPORT:-5432}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGSSLMODE="${PGSSLMODE:-verify-full}"
export PGAPPNAME="$application_name"
if [ -n "${PGSSLROOTCERT:-}" ]; then
  export PGSSLROOTCERT
fi

role_state="$(psql -X -qAt -v ON_ERROR_STOP=1 -F '|' -c \
  "SELECT session_user, current_database(), rolsuper::int,
          rolbypassrls::int, rolcanlogin::int
     FROM pg_roles WHERE rolname = session_user")"
expected_state="$BACKUP_EXPECTED_DB_ROLE|$PGDATABASE|0|1|1"
[ "$role_state" = "$expected_state" ] || {
  printf 'backup source role/database contract mismatch\n' >&2
  exit 1
}

# The deployment observes this uniquely named backend through its migration
# connection, then stops the transient unit. No data is read or written.
psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT pg_sleep(90)" >/dev/null
