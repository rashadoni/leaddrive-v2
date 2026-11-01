#!/usr/bin/env bash
# Install or verify the PostgreSQL WAL archive (pgBackRest) on the production
# host. Default mode only reports; nothing is written without --apply.
#
# Closes the RPO half of gate 6 in docs/BACKUP_RUNBOOK.md: until WAL archiving
# runs, the recoverable point is the last nightly logical dump.
set -Eeuo pipefail

umask 077

MODE=check
case "${1:-}" in
  "" | --check) MODE=check ;;
  --apply) MODE=apply ;;
  *)
    printf 'Usage: %s [--check|--apply]\n' "$0" >&2
    exit 2
    ;;
esac
readonly MODE

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
PGBACKREST_CONF="${PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}"
MIN_PGBACKREST_VERSION=2.46

log() { printf '[wal-install] %s\n' "$*"; }
fatal() {
  printf '[wal-install] FATAL %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fatal "run as root"
[ -f "$WAL_ENV_FILE" ] || fatal "missing $WAL_ENV_FILE (template: ops/backup/wal-archive.env.example)"

env_mode="$(stat -c '%a %U' "$WAL_ENV_FILE")"
[ "$env_mode" = "600 root" ] || fatal "$WAL_ENV_FILE must be 0600 root-owned, found: $env_mode"

set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

require_var() {
  local name="$1" pattern="$2" value="${!1:-}"
  [ -n "$value" ] || fatal "$name is empty in $WAL_ENV_FILE"
  [[ "$value" =~ $pattern ]] || fatal "$name has an unexpected format"
}

require_var WAL_STANZA '^[a-z][a-z0-9-]{1,31}$'
require_var WAL_PG_VERSION '^1[4-9]$'
require_var WAL_PG_DATA '^/[A-Za-z0-9._/-]+$'
require_var WAL_PG_CONF_DIR '^/[A-Za-z0-9._/-]+$'
require_var WAL_PG_PORT '^[1-9][0-9]{2,4}$'
require_var WAL_PG_USER '^[a-z_][a-z0-9_-]*$'
require_var WAL_REPO_BUCKET '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'
require_var WAL_REPO_ENDPOINT '^[a-z0-9][a-z0-9.-]+$'
require_var WAL_REPO_REGION '^[a-z0-9-]+$'
require_var WAL_REPO_PATH '^/[A-Za-z0-9._/-]*$'
require_var WAL_REPO_KEY '^[A-Za-z0-9]{8,}$'
require_var WAL_REPO_KEY_SECRET '^[A-Za-z0-9+/=_-]{16,}$'
require_var WAL_REPO_CIPHER_PASS '^[0-9a-f]{64}$'
require_var WAL_RETENTION_FULL '^[1-9][0-9]?$'
require_var WAL_RETENTION_DIFF '^[1-9][0-9]?$'
require_var WAL_SPOOL_PATH '^/[A-Za-z0-9._/-]+$'
require_var WAL_ARCHIVE_QUEUE_MAX '^[1-9][0-9]*(MiB|GiB)$'
require_var WAL_ARCHIVE_TIMEOUT '^[1-9][0-9]*s$'
require_var WAL_PROCESS_MAX '^[1-8]$'

case "$WAL_REPO_BUCKET" in
  *REPLACE*) fatal "WAL_REPO_BUCKET still holds a placeholder" ;;
esac

command -v pgbackrest >/dev/null 2>&1 || fatal "pgbackrest is not installed"
pgbackrest_version="$(pgbackrest version | awk '{print $2}')"
if [ "$(printf '%s\n%s\n' "$MIN_PGBACKREST_VERSION" "$pgbackrest_version" | sort -V | head -1)" != "$MIN_PGBACKREST_VERSION" ]; then
  fatal "pgbackrest $pgbackrest_version is older than $MIN_PGBACKREST_VERSION"
fi
log "pgbackrest $pgbackrest_version"

[ -d "$WAL_PG_DATA" ] || fatal "data directory $WAL_PG_DATA does not exist"
[ -d "$WAL_PG_CONF_DIR/conf.d" ] || fatal "$WAL_PG_CONF_DIR/conf.d does not exist; include_dir is not configured"

psql_show() {
  su - "$WAL_PG_USER" -c "psql -XtAq -p $WAL_PG_PORT -d postgres -c 'show $1'" 2>/dev/null | tr -d '[:space:]'
}

server_version="$(psql_show server_version_num)"
[ -n "$server_version" ] || fatal "cannot reach PostgreSQL on port $WAL_PG_PORT as $WAL_PG_USER"
[ "${server_version:0:2}" = "$WAL_PG_VERSION" ] || fatal "server reports $server_version, WAL_PG_VERSION is $WAL_PG_VERSION"

current_archive_mode="$(psql_show archive_mode)"
current_wal_level="$(psql_show wal_level)"
expected_archive_command="pgbackrest --stanza=$WAL_STANZA archive-push %p"

case "$current_wal_level" in
  replica | logical) ;;
  *) fatal "wal_level is $current_wal_level; archiving needs at least replica" ;;
esac

log "archive_mode=$current_archive_mode wal_level=$current_wal_level (left as is)"

render_conf() {
  cat <<PGBACKREST_CONF
[global]
repo1-type=s3
repo1-s3-bucket=$WAL_REPO_BUCKET
repo1-s3-endpoint=$WAL_REPO_ENDPOINT
repo1-s3-region=$WAL_REPO_REGION
repo1-s3-uri-style=path
repo1-s3-key=$WAL_REPO_KEY
repo1-s3-key-secret=$WAL_REPO_KEY_SECRET
repo1-path=$WAL_REPO_PATH
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$WAL_REPO_CIPHER_PASS
repo1-retention-full=$WAL_RETENTION_FULL
repo1-retention-diff=$WAL_RETENTION_DIFF
repo1-bundle=y
compress-type=zst
compress-level=3
process-max=$WAL_PROCESS_MAX
start-fast=y
delta=y
archive-async=y
archive-push-queue-max=$WAL_ARCHIVE_QUEUE_MAX
spool-path=$WAL_SPOOL_PATH
log-path=/var/log/pgbackrest
log-level-console=warn
log-level-file=info

[$WAL_STANZA]
pg1-path=$WAL_PG_DATA
pg1-port=$WAL_PG_PORT
pg1-user=$WAL_PG_USER
PGBACKREST_CONF
}

render_pg_conf() {
  cat <<PG_DROPIN
# Managed by scripts/backup/wal-archive-install.sh. Do not edit by hand.
# archive_mode needs a restart; archive_command and archive_timeout reload.
#
# wal_level is deliberately absent. Production runs `logical` for the Kafka
# CDC slot, `logical` already contains everything `replica` does, and writing
# `replica` here would silently disable logical decoding at the next restart.
archive_mode = on
archive_command = '$expected_archive_command'
archive_timeout = $WAL_ARCHIVE_TIMEOUT
PG_DROPIN
}

pg_dropin="$WAL_PG_CONF_DIR/conf.d/90-leaddrive-wal.conf"
conf_changed=0
dropin_changed=0
restart_needed=0

if [ ! -f "$PGBACKREST_CONF" ] || ! render_conf | cmp -s - "$PGBACKREST_CONF"; then
  conf_changed=1
fi
if [ ! -f "$pg_dropin" ] || ! render_pg_conf | cmp -s - "$pg_dropin"; then
  dropin_changed=1
fi
[ "$current_archive_mode" = "on" ] || restart_needed=1

if [ "$MODE" = check ]; then
  log "pgbackrest.conf would change: $conf_changed"
  log "postgresql drop-in would change: $dropin_changed"
  log "postgresql restart required: $restart_needed"
  printf 'SUMMARY wal-install mode=check conf_changed=%s dropin_changed=%s restart_needed=%s\n' \
    "$conf_changed" "$dropin_changed" "$restart_needed"
  exit 0
fi

install -d -m 0750 -o root -g "$WAL_PG_USER" /etc/pgbackrest
install -d -m 0750 -o "$WAL_PG_USER" -g "$WAL_PG_USER" "$WAL_SPOOL_PATH" /var/log/pgbackrest
install -d -m 0750 -o root -g root "$(dirname "${WAL_CHECK_STATE_FILE:-/var/lib/leaddrive-wal-archive/check-state.json}")"

if [ "$conf_changed" = 1 ]; then
  tmp_conf="$(mktemp /etc/pgbackrest/.pgbackrest.conf.XXXXXX)"
  render_conf >"$tmp_conf"
  chown root:"$WAL_PG_USER" "$tmp_conf"
  chmod 0640 "$tmp_conf"
  mv -f "$tmp_conf" "$PGBACKREST_CONF"
  log "wrote $PGBACKREST_CONF"
fi

if [ "$dropin_changed" = 1 ]; then
  tmp_dropin="$(mktemp "$WAL_PG_CONF_DIR/conf.d/.90-leaddrive-wal.conf.XXXXXX")"
  render_pg_conf >"$tmp_dropin"
  chown "$WAL_PG_USER":"$WAL_PG_USER" "$tmp_dropin"
  chmod 0644 "$tmp_dropin"
  mv -f "$tmp_dropin" "$pg_dropin"
  log "wrote $pg_dropin"
fi

su - "$WAL_PG_USER" -c "pgbackrest --stanza=$WAL_STANZA stanza-create" 2>&1 | grep -v 'already exists' || true

if [ "$restart_needed" = 1 ]; then
  log "archive_mode is off: PostgreSQL must be restarted before archiving starts"
  printf 'SUMMARY wal-install mode=apply stanza=%s restart_required=1\n' "$WAL_STANZA"
  exit 0
fi

su - "$WAL_PG_USER" -c "psql -XtAq -p $WAL_PG_PORT -d postgres -c 'select pg_reload_conf()'" >/dev/null
su - "$WAL_PG_USER" -c "pgbackrest --stanza=$WAL_STANZA check"
printf 'SUMMARY wal-install mode=apply stanza=%s restart_required=0 check=ok\n' "$WAL_STANZA"
