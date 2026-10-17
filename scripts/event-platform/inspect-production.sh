#!/usr/bin/env bash
# Read-only, aggregate-only inventory. Executed over the pinned Actions SSH path.
set -euo pipefail

trim_static_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

# Deliberately never source/eval an environment file.
read_static_env_value() {
  local file="$1" target="$2" line key value first last result="" matches=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim_static_value "${line%$'\r'}")"
    [ -n "$line" ] || continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" == export[[:space:]]* ]]; then
      line="$(trim_static_value "${line#export}")"
    fi
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    [ "$key" = "$target" ] || continue
    matches=$((matches + 1))
    [ "$matches" -eq 1 ] || return 2
    value="$(trim_static_value "${BASH_REMATCH[2]}")"
    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"; last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi
    result="$value"
  done < "$file"
  [ "$matches" -eq 1 ] && [ -n "$result" ] || return 3
  printf '%s' "$result"
}

require_root_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%U:%G:%a' "$1")" = "root:root:$2" ]
}

run_readonly_psql() {
  # Pass credentials through the protected process environment, never argv.
  # Python's standard library is already used by the production operations
  # tooling; unsupported libpq options fail closed instead of changing target.
  LD_INSPECTION_DATABASE_URL="$1" timeout 45 python3 -c '
import os, urllib.parse
try:
    parsed = urllib.parse.urlsplit(os.environ["LD_INSPECTION_DATABASE_URL"])
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.path.strip("/") or parsed.fragment:
        raise ValueError()
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k != "LD_INSPECTION_DATABASE_URL"}
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGDATABASE=urllib.parse.unquote(parsed.path[1:]))
    if parsed.username is not None: env["PGUSER"] = urllib.parse.unquote(parsed.username)
    if parsed.password is not None: env["PGPASSWORD"] = urllib.parse.unquote(parsed.password)
    permitted = {"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT",
                 "sslkey": "PGSSLKEY", "sslcrl": "PGSSLCRL", "sslcrldir": "PGSSLCRLDIR",
                 "connect_timeout": "PGCONNECT_TIMEOUT", "hostaddr": "PGHOSTADDR",
                 "channel_binding": "PGCHANNELBINDING", "target_session_attrs": "PGTARGETSESSIONATTRS",
                 "application_name": "PGAPPNAME", "gssencmode": "PGGSSENCMODE", "passfile": "PGPASSFILE"}
    seen = set()
    for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True):
        if key not in permitted or key in seen: raise ValueError()
        # libpq read-write requires default_transaction_read_only=off, which
        # cannot coexist with this inspector. Primary-only selection remains
        # supported; never weaken read-only to satisfy the connection option.
        if key == "target_session_attrs" and value == "read-write": raise ValueError()
        seen.add(key)
        env[permitted[key]] = value
    env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=30s -c lock_timeout=3s"
    env["PGCONNECT_TIMEOUT"] = "15"
except Exception:
    raise SystemExit("FATAL: unsupported inspection connection configuration")
os.execvpe("psql", ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], env)
'
}

inspect_production() {
  export LC_ALL=C
  local artifact=/opt/leaddrive-v2/.next/standalone/.deploy-sha
  local migration_env=/etc/leaddrive/migration.env
  local deployed_sha database_url timer state
  [[ "${EXPECTED_DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'FATAL: expected SHA required'; return 1; }
  [ -f "$artifact" ] && [ ! -L "$artifact" ] && [ "$(stat -c '%U:%G' "$artifact")" = root:root ] || {
    echo 'FATAL: immutable artifact marker missing or unsafe'; return 1;
  }
  deployed_sha="$(tr -d '\r\n' < "$artifact")"
  [ "$deployed_sha" = "$EXPECTED_DEPLOY_SHA" ] || { echo 'FATAL: deployed artifact differs from the approved SHA'; return 1; }
  require_root_file "$migration_env" 600 || { echo 'FATAL: canonical migration environment missing or unsafe'; return 1; }
  database_url="$(read_static_env_value "$migration_env" MIGRATION_DATABASE_URL)" || {
    echo 'FATAL: migration database URL missing, empty or duplicated'; return 1;
  }

  printf 'inspection_mode=read-only-aggregate-inventory\nproduction_artifact_sha=%s\n' "$deployed_sha"
  date -u '+observed_at=%Y-%m-%dT%H:%M:%SZ'
  awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print "host_" $1 "=" $2 "kB"}' /proc/meminfo
  df --block-size=1 --output=size,avail /opt/leaddrive-v2 | tail -1 | awk '{print "app_filesystem_bytes=" $1 "\napp_filesystem_available_bytes=" $2}'
  for timer in leaddrive-postgres-backup leaddrive-secrets-snapshot leaddrive-runtime-files-snapshot leaddrive-log-ship; do
    state="$(systemctl is-active "$timer.timer" 2>/dev/null || true)"
    case "$state" in active|inactive|failed|activating|deactivating|unknown) ;; *) state=unavailable ;; esac
    printf '%s_timer=%s\n' "$timer" "$state"
  done
  # File presence is inventory only: it is never called a valid restore receipt.
  if [ -f /etc/leaddrive/backup.env ] && [ ! -L /etc/leaddrive/backup.env ]; then
    printf 'backup_configuration=present\n'
  else
    printf 'backup_configuration=absent-or-unsafe\n'
  fi
  printf 'backup_restore_verification=not-performed\n'

  # default_transaction_read_only is active before parsing SQL. URLs, role
  # names, addresses, slot names, tenant IDs and payloads are never selected.
  # Suppress server errors: they can contain connection details. On failure
  # report only the stage and preserve the non-zero exit.
  if ! run_readonly_psql "$database_url" 2>/dev/null <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
  'inventory', 'postgres',
  'serverVersionNum', current_setting('server_version_num')::int,
  'readOnly', current_setting('transaction_read_only'),
  'walLevel', current_setting('wal_level'),
  'maxReplicationSlots', current_setting('max_replication_slots')::int,
  'maxWalSenders', current_setting('max_wal_senders')::int,
  'maxSlotWalKeepSize', current_setting('max_slot_wal_keep_size'),
  'databaseBytes', pg_database_size(current_database()),
  'replicationSlotCount', (SELECT count(*) FROM pg_replication_slots),
  'activeReplicationSlots', (SELECT count(*) FROM pg_replication_slots WHERE active),
  'retainedSlotWalBytes', (SELECT coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)), 0) FROM pg_replication_slots),
  'outboxPublicationPresent', EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'leaddrive_event_outbox'),
  'eventTables', (
    SELECT json_agg(json_build_object(
      'table', expected.name, 'present', c.oid IS NOT NULL,
      'rls', coalesce(c.relrowsecurity, false), 'forceRls', coalesce(c.relforcerowsecurity, false),
      'estimatedRows', greatest(c.reltuples, 0)::bigint,
      'bytes', CASE WHEN c.oid IS NOT NULL THEN pg_total_relation_size(c.oid) ELSE NULL END
    ) ORDER BY expected.name)
    FROM (VALUES ('domain_events'), ('event_outbox'), ('consumer_inbox'),
      ('projection_builds'), ('projection_activations'), ('projection_checkpoints'),
      ('effect_outbox'), ('fund_balance_projections')) AS expected(name)
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || expected.name)
  )
);
SELECT json_build_object('inventory', 'wal-counter', 'walBytes', wal_bytes,
  'statsReset', stats_reset, 'observation', now()) FROM pg_stat_wal;
COMMIT;
SQL
  then
    echo 'FATAL: aggregate database inventory failed (details suppressed)'; return 1
  fi
  printf 'event_platform_inventory=PASS\n'
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  inspect_production "$@"
fi
