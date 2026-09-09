#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only production diagnostic for the PostgreSQL recovery-point gate.
# It deliberately never sources backup.env and never prints configuration
# values, credentials, paths from that file, or the public age recipient.

umask 077

BACKUP_ENV_FILE="/etc/leaddrive/backup.env"
BACKUP_SERVICE="leaddrive-postgres-backup.service"
BACKUP_TIMER="leaddrive-postgres-backup.timer"
SECRETS_SERVICE="leaddrive-secrets-snapshot.service"
SECRETS_TIMER="leaddrive-secrets-snapshot.timer"
RUNTIME_FILES_SERVICE="leaddrive-runtime-files-snapshot.service"
RUNTIME_FILES_TIMER="leaddrive-runtime-files-snapshot.timer"
LOG_SERVICE="leaddrive-log-ship.service"
LOG_TIMER="leaddrive-log-ship.timer"
EXPECTED_LOG_SOURCE_DIRS="/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql"
EXPECTED_LOG_SOURCE_FILES="/var/log/leaddrive-resilience-cron.log"
EXPECTED_LOG_JOURNAL_UNITS="leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service"
REVIEWED_LOG_CURSOR_AWK_RE='^(/var/lib/leaddrive-v2-logs/[^/]+[.]log|/var/log/nginx/[^/]+[.]log|/var/log/postgresql/[^/]+[.]log|/var/log/leaddrive-resilience-cron[.]log)$'
EXPECTED_SERVICE_FRAGMENT="/etc/systemd/system/leaddrive-postgres-backup.service"
EXPECTED_ARTIFACT_FRAGMENT="/opt/leaddrive-v2/.next/standalone/ops/systemd/leaddrive-postgres-backup.service"
EXPECTED_SECRETS_FRAGMENT="/etc/systemd/system/leaddrive-secrets-snapshot.service"
EXPECTED_SECRETS_ARTIFACT_FRAGMENT="/opt/leaddrive-v2/.next/standalone/ops/systemd/leaddrive-secrets-snapshot.service"
EXPECTED_RUNTIME_FILES_FRAGMENT="/etc/systemd/system/leaddrive-runtime-files-snapshot.service"
EXPECTED_RUNTIME_FILES_ARTIFACT_FRAGMENT="/opt/leaddrive-v2/.next/standalone/ops/systemd/leaddrive-runtime-files-snapshot.service"
EXPECTED_LOG_FRAGMENT="/etc/systemd/system/leaddrive-log-ship.service"
EXPECTED_LOG_ARTIFACT_FRAGMENT="/opt/leaddrive-v2/.next/standalone/ops/systemd/leaddrive-log-ship.service"
EVIDENCE_ROOT="/etc/leaddrive/backup-evidence"
LOG_GENESIS_ANCHOR="$EVIDENCE_ROOT/log-evidence-genesis.env"
LOG_BOOTSTRAP_TRANSACTION="/var/lib/leaddrive-log-ship/bootstrap-transaction"
LOG_BOOTSTRAP_PREPARING="/var/lib/leaddrive-log-ship/bootstrap-transaction.preparing"
LOG_BOOTSTRAP_TOMBSTONE="/var/lib/leaddrive-log-ship/bootstrap-transaction.committed"
CANDIDATE_DIR="$EVIDENCE_ROOT/candidates"
CUSTODY_MARKER="$EVIDENCE_ROOT/key-custody.env"
RESTORE_MARKER="$EVIDENCE_ROOT/offline-restore-current.env"
BOOTSTRAP_RESTORE_MARKER="$EVIDENCE_ROOT/bootstrap-offline-restore-current.env"
ALLOWED_SIGNERS="$EVIDENCE_ROOT/offline-allowed-signers"
SIGNED_DIR="$EVIDENCE_ROOT/signed"
AGE_VERSION="1.3.2"
AGE_ARCHIVE_SHA256="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"
AGE_BINARY_SHA256="eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c"
AGE_BIN="/usr/local/lib/leaddrive-backup/tools/age/$AGE_VERSION/age"
AGE_PROVENANCE="/usr/local/lib/leaddrive-backup/tools/age/$AGE_VERSION/LEADDRIVE_PROVENANCE"
AWS_VERSION="2.36.40"
AWS_ARCHIVE_SHA256="a904e314340ad4c4b62beb50e9259d4becb2acf3dffc86c96c553c834d7fdf7a"
AWS_SIGNING_FINGERPRINT="FB5DB77FD5C118B80511ADA8A6310ACC4672475C"
AWS_ROOT="/usr/local/lib/leaddrive-backup/tools/aws-cli/$AWS_VERSION"
AWS_BIN="$AWS_ROOT/v2/current/bin/aws"
AWS_PROVENANCE="$AWS_ROOT/LEADDRIVE_PROVENANCE"
CUSTODY_VERIFIER_SHA256="a02101a2e9ae313c7486d31337b9efe771ea2127d565b059d6e2427df86eca91"
ARCHIVE_VERIFIER_SHA256="c6d4caabb1f44db3036c79d59b63253f961fa8ce29780724c9d15667dac644a6"
POSTGRES_BACKUP_SHA256="ddf2142311b6c7ad561e510369925ca3f5347f667966a5c265451c0823e4e065"
SECRETS_SNAPSHOT_SHA256="16d4bf083ad2549cd34e1bd89a53ee958f1625605235fe5370c8acecc401de99"
RUNTIME_FILES_SNAPSHOT_SHA256="d5fe33b4b0b0e581194b3aff770eca45a14a493774ec314340146bd69475e53e"
RESTORE_CANARY_SHA256="af743a9bd8df3daa6ba6b60d90141daea28629f6140d8d12d1623f6b083f5d9e"
PII_PROOF_SHA256="e83f3fc65c56e0dc8db7eb26e47780c0901917908c05d7aa6552792a37f99e18"
CANARY_SQL_SHA256="5c3a9bf2b14c84c4deafa31525ac23518ba2290ab32a7cf5f66e2d05d4b249c9"
ISSUES=0
ENTERPRISE_GAPS=0
CERTIFIED_CANDIDATE_CREATED_EPOCH=""
AWS_TOOLCHAIN_READY=0
CURRENT_BACKUP_DATABASE_IDENTITY_SHA256=""
CURRENT_BACKUP_MIGRATION_LEDGER_SHA256=""

declare -A CONFIG=()

pass() {
  printf '[backup-readiness] PASS: %s\n' "$*"
}

info() {
  printf '[backup-readiness] INFO: %s\n' "$*"
}

fail() {
  ISSUES=$((ISSUES + 1))
  printf '[backup-readiness] FAIL: %s\n' "$*"
}

enterprise_gap() {
  ENTERPRISE_GAPS=$((ENTERPRISE_GAPS + 1))
  printf '[backup-readiness] ENTERPRISE-GAP: %s\n' "$*"
}

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

# Read one literal KEY=VALUE without executing the root-owned file. Return 2
# when a duplicate key makes the effective value ambiguous.
read_static_env_value() {
  local file="$1"
  local target_key="$2"
  local line key value first last
  local matches=0
  local resolved=""

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="$(trim_value "$line")"
    [ -n "$line" ] || continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" == export[[:space:]]* ]]; then
      line="$(trim_value "${line#export}")"
    fi
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    [ "$key" = "$target_key" ] || continue

    matches=$((matches + 1))
    [ "$matches" -eq 1 ] || return 2
    value="$(trim_value "${BASH_REMATCH[2]}")"
    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } \
        || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi
    resolved="$value"
  done < "$file"

  printf '%s' "$resolved"
}

load_config_key() {
  local key="$1"
  local value status

  set +e
  value="$(read_static_env_value "$BACKUP_ENV_FILE" "$key")"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    fail "configuration contains duplicate $key entries"
    CONFIG["$key"]=""
    return 0
  fi
  CONFIG["$key"]="$value"
}

os_id="$(read_static_env_value /etc/os-release ID 2>/dev/null || true)"
os_version="$(read_static_env_value /etc/os-release VERSION_ID 2>/dev/null || true)"
machine_arch="$(uname -m 2>/dev/null || true)"
info "platform=${os_id:-unknown} version=${os_version:-unknown} arch=${machine_arch:-unknown}"
if command -v apt-cache >/dev/null 2>&1; then
  age_candidate="$(apt-cache policy age 2>/dev/null | awk '/Candidate:/ { print $2; exit }' || true)"
  aws_candidate="$(apt-cache policy awscli 2>/dev/null | awk '/Candidate:/ { print $2; exit }' || true)"
  info "apt candidates: age=${age_candidate:-none}, awscli=${aws_candidate:-none}"
fi

looks_like_placeholder() {
  local value="${1,,}"
  case "$value" in
    *replace*|*.example|*.example/*|private-postgres-hostname|private-restore-verifier-hostname)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_config_key() {
  local key="$1"
  local value="${CONFIG[$key]:-}"

  if [ -z "$value" ]; then
    fail "$key is missing"
  elif looks_like_placeholder "$value"; then
    fail "$key still contains a placeholder"
  else
    pass "$key is configured (value redacted)"
  fi
}

check_service_secret_file() {
  local key="$1"
  local path="${CONFIG[$key]:-}"
  local owner mode

  [ -n "$path" ] || return 0
  if [[ "$path" != /* ]] || [ ! -f "$path" ] || [ -L "$path" ]; then
    fail "$key does not name a regular absolute non-symlink file"
    return 0
  fi
  owner="$(stat -c '%U:%G' "$path" 2>/dev/null || true)"
  mode="$(stat -c '%a' "$path" 2>/dev/null || true)"
  case "$mode" in
    440|600|640) ;;
    *) fail "$key file must use mode 0440, 0600 or 0640 (observed mode redacted from output)" ;;
  esac
  case "$owner:$mode" in
    leaddrive-backup:*:600|root:leaddrive-backup:440|root:leaddrive-backup:640) ;;
    *) fail "$key file ownership is not service-user 0600 or root:service-group 0440/0640" ;;
  esac
  if command -v runuser >/dev/null 2>&1 \
    && runuser -u leaddrive-backup -- /bin/sh -c 'test -r "$1"' sh "$path"; then
    pass "$key file is readable by the backup service user"
  else
    fail "$key file is not readable by the backup service user"
  fi
}

check_root_recovery_file() {
  local label="$1"
  local path="$2"
  local expected_mode="$3"
  if [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%U:%G:%a' "$path" 2>/dev/null || true)" = "root:root:$expected_mode" ]; then
    pass "$label is root-owned with mode $expected_mode"
  else
    fail "$label is missing, symlinked, or has unsafe ownership/mode"
  fi
}

check_ca_file() {
  local key="$1"
  local path="${CONFIG[$key]:-}"
  local mode owner
  [ -n "$path" ] || return 0
  if [[ "$path" != /* ]] || [ ! -f "$path" ] || [ -L "$path" ]; then
    fail "$key does not name a regular absolute non-symlink CA file"
    return 0
  fi
  owner="$(stat -c '%U' "$path" 2>/dev/null || true)"
  mode="$(stat -c '%a' "$path" 2>/dev/null || true)"
  case "$owner:$mode" in
    root:400|root:440|root:444|root:600|root:640|root:644)
      pass "$key is a root-owned CA file with a reviewed mode"
      ;;
    *) fail "$key CA file ownership or mode is unsafe" ;;
  esac
}

is_root_owned_nonwritable_file() {
  local path="$1"
  local mode
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%u' "$path" 2>/dev/null || true)" = 0 ] || return 1
  mode="$(stat -c '%a' "$path" 2>/dev/null || true)"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 ))
}

verify_active_operations_release() {
  local artifact_root="/opt/leaddrive-v2/.next/standalone"
  local ops_root="/usr/local/lib/leaddrive-v2/ops"
  local current_link="$ops_root/current"
  local release_root release_name script helper unit rotate manifest name mode
  local failed=0
  local -a backup_scripts=(
    hash-recovery-db-contract.sh hash-recovery-program-set.sh postgres-backup.sh
    postgres-restore-canary.sh prove-source-database.sh ship-logs.sh
    snapshot-runtime-files.sh snapshot-secrets.sh
  )
  local -a backup_helpers=(
    bootstrap-backup-role.sql canary.sql migration-ledger.sql prove-restored-pii.mjs
    recovery-db-contract.tsv
  )
  local -a units=(
    leaddrive-log-ship.service leaddrive-log-ship.timer
    leaddrive-postgres-backup.service leaddrive-postgres-backup.timer
    leaddrive-runtime-files-snapshot.service leaddrive-runtime-files-snapshot.timer
    leaddrive-secrets-snapshot.service leaddrive-secrets-snapshot.timer
  )
  local -a rotate_files=(leaddrive-v2 leaddrive-cron-logs)

  if [ ! -L "$current_link" ]; then
    fail "active operations pointer is missing or is not a symlink"
    return 0
  fi
  release_root="$(readlink -f -- "$current_link" 2>/dev/null || true)"
  release_name="${release_root##*/}"
  case "$release_root" in
    "$ops_root"/releases/$release_name) ;;
    *) fail "active operations pointer escapes the immutable release root"; return 0 ;;
  esac
  [[ "$release_name" =~ ^[0-9a-f]{40}$ ]] \
    && [ -d "$release_root" ] && [ ! -L "$release_root" ] \
    && [ "$(stat -c '%u' "$release_root" 2>/dev/null || true)" = 0 ] || {
      fail "active operations release identity or ownership is invalid"
      return 0
    }
  for ancestor in /usr/local /usr/local/lib /usr/local/lib/leaddrive-v2 "$ops_root" \
    "$ops_root/releases" "$release_root"; do
    [ -d "$ancestor" ] && [ ! -L "$ancestor" ] \
      && [ "$(stat -c '%u' "$ancestor" 2>/dev/null || true)" = 0 ] || { failed=1; continue; }
    mode="$(stat -c '%a' "$ancestor" 2>/dev/null || true)"
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) || failed=1
  done

  for script in "${backup_scripts[@]}"; do
    is_root_owned_nonwritable_file "$release_root/backup/$script" \
      && [ -x "$release_root/backup/$script" ] \
      && cmp -s -- "$artifact_root/scripts/backup/$script" "$release_root/backup/$script" \
      || failed=1
  done
  for helper in "${backup_helpers[@]}"; do
    is_root_owned_nonwritable_file "$release_root/backup/$helper" \
      && cmp -s -- "$artifact_root/scripts/backup/$helper" "$release_root/backup/$helper" \
      || failed=1
  done
  for unit in "${units[@]}"; do
    is_root_owned_nonwritable_file "$release_root/systemd/$unit" \
      && cmp -s -- "$artifact_root/ops/systemd/$unit" "$release_root/systemd/$unit" \
      || failed=1
  done
  for rotate in "${rotate_files[@]}"; do
    is_root_owned_nonwritable_file "$release_root/logrotate/$rotate" \
      && cmp -s -- "$artifact_root/ops/logrotate/$rotate" "$release_root/logrotate/$rotate" \
      || failed=1
  done
  for helper in backup.env.example recovery-program-set.files; do
    is_root_owned_nonwritable_file "$release_root/backup/$helper" \
      && cmp -s -- "$artifact_root/ops/backup/$helper" "$release_root/backup/$helper" \
      || failed=1
  done
  manifest="$release_root/cron-script-manifest.txt"
  is_root_owned_nonwritable_file "$manifest" \
    && cmp -s -- "$artifact_root/scripts/release-cron-script-manifest.txt" "$manifest" \
    || failed=1
  if [ -f "$manifest" ] && [ ! -L "$manifest" ]; then
    while IFS= read -r name || [ -n "$name" ]; do
      [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.sh$ ]] \
        && is_root_owned_nonwritable_file "$release_root/cron-scripts/$name" \
        && [ -x "$release_root/cron-scripts/$name" ] \
        && cmp -s -- "$artifact_root/scripts/$name" "$release_root/cron-scripts/$name" \
        || failed=1
    done <"$manifest"
  fi
  if [ "$failed" -eq 0 ]; then
    pass "active immutable operations release exactly matches every reviewed artifact member"
  else
    fail "active operations release has missing, writable, or drifted artifact members"
  fi
}

verify_log_ship_cursor_state() {
  local state_dir="/var/lib/leaddrive-log-ship"
  local state_file="$state_dir/log-ship-offsets"
  local live_script="/usr/local/lib/leaddrive-v2/ops/current/backup/ship-logs.sh"
  local program_record="/usr/local/lib/leaddrive-v2/ops/current/recovery-program-set.sha256"
  local state_script_sha state_program_sha live_script_sha live_program_sha
  local state_bytes state_rows unit cursor retained journal_status terminal_line
  local evidence_start evidence_key evidence_version evidence_sha head_state head_status
  local anchor_status anchor_start anchor_key anchor_version anchor_sha anchor_bytes anchor_format
  local anchor_deploy anchor_program anchor_ranges anchor_file_count anchor_file_bytes anchor_journal_count
  local anchor_cursor anchor_created anchor_bytes_count anchor_rows
  local remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges
  local remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_modified
  local retention_state retention_status retention_mode retention_until
  local retention_epoch minimum_retention_epoch now_epoch evidence_start_epoch modified_epoch retention_days

  if [ -e "$LOG_BOOTSTRAP_TRANSACTION" ] || [ -L "$LOG_BOOTSTRAP_TRANSACTION" ] \
      || [ -e "$LOG_BOOTSTRAP_PREPARING" ] || [ -L "$LOG_BOOTSTRAP_PREPARING" ] \
      || [ -e "$LOG_BOOTSTRAP_TOMBSTONE" ] || [ -L "$LOG_BOOTSTRAP_TOMBSTONE" ]; then
    fail "log-evidence genesis has an unfinished bootstrap transaction or cleanup tombstone"
    return 0
  fi
  if [ ! -f "$LOG_GENESIS_ANCHOR" ] || [ -L "$LOG_GENESIS_ANCHOR" ] \
      || [ "$(realpath -e -- "$LOG_GENESIS_ANCHOR" 2>/dev/null || true)" != "$LOG_GENESIS_ANCHOR" ] \
      || [ "$(stat -c '%U:%G:%a:%h' "$LOG_GENESIS_ANCHOR" 2>/dev/null || true)" != root:root:600:1 ]; then
    fail "root-owned committed log-evidence genesis anchor is missing or unsafe"
    return 0
  fi
  anchor_bytes_count="$(wc -c <"$LOG_GENESIS_ANCHOR" | tr -d '[:space:]')"
  anchor_rows="$(wc -l <"$LOG_GENESIS_ANCHOR" | tr -d '[:space:]')"
  if ! [[ "$anchor_bytes_count" =~ ^[0-9]+$ ]] || [ "$anchor_bytes_count" -gt 16384 ] \
      || [ "$anchor_rows" -ne 16 ] \
      || ! awk '
        NR == 1 { if ($0 != "FORMAT_VERSION=1") bad=1; next }
        NR == 2 { if ($0 != "STATUS=COMMITTED") bad=1; next }
        NR == 3 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
        NR == 4 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\// || length($0) > 1200) bad=1; next }
        NR == 5 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=[-A-Za-z0-9._~+\/=]+$/ || $0 ~ /=None$/ || $0 ~ /=null$/ || length($0) > 1100) bad=1; next }
        NR == 6 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_SHA256=[0-9a-f]{64}$/) bad=1; next }
        NR == 7 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_BYTES=[1-9][0-9]*$/) bad=1; next }
        NR == 8 { if ($0 != "LOG_EVIDENCE_OBJECT_FORMAT_VERSION=4") bad=1; next }
        NR == 9 { if ($0 !~ /^BOOTSTRAP_DEPLOY_SHA=[0-9a-f]{40}$/) bad=1; next }
        NR == 10 { if ($0 !~ /^BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
        NR == 11 { if ($0 !~ /^BOOTSTRAP_RANGES_SHA256=[0-9a-f]{64}$/) bad=1; next }
        NR == 12 { if ($0 !~ /^BOOTSTRAP_FILE_RANGE_COUNT=[0-9]+$/) bad=1; next }
        NR == 13 { if ($0 !~ /^BOOTSTRAP_FILE_RANGE_BYTES=[0-9]+$/) bad=1; next }
        NR == 14 { if ($0 !~ /^BOOTSTRAP_JOURNAL_RANGE_COUNT=[0-9]+$/) bad=1; next }
        NR == 15 { if ($0 !~ /^BOOTSTRAP_CURSOR_SHA256=[0-9a-f]{64}$/) bad=1; next }
        NR == 16 { if ($0 !~ /^OBJECT_CREATED_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|\+00:00)$/) bad=1; next }
        { bad=1 }
        END { if (NR != 16 || bad) exit 1 }
      ' "$LOG_GENESIS_ANCHOR"; then
    fail "root log-evidence genesis anchor is not the exact committed schema"
    return 0
  fi
  anchor_status="$(read_static_env_value "$LOG_GENESIS_ANCHOR" STATUS 2>/dev/null || true)"
  anchor_start="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT 2>/dev/null || true)"
  anchor_key="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY 2>/dev/null || true)"
  anchor_version="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID 2>/dev/null || true)"
  anchor_sha="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_SHA256 2>/dev/null || true)"
  anchor_bytes="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_BYTES 2>/dev/null || true)"
  anchor_format="$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_OBJECT_FORMAT_VERSION 2>/dev/null || true)"
  anchor_deploy="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA 2>/dev/null || true)"
  anchor_program="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256 2>/dev/null || true)"
  anchor_ranges="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_RANGES_SHA256 2>/dev/null || true)"
  anchor_file_count="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_COUNT 2>/dev/null || true)"
  anchor_file_bytes="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_BYTES 2>/dev/null || true)"
  anchor_journal_count="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_JOURNAL_RANGE_COUNT 2>/dev/null || true)"
  anchor_cursor="$(read_static_env_value "$LOG_GENESIS_ANCHOR" BOOTSTRAP_CURSOR_SHA256 2>/dev/null || true)"
  anchor_created="$(read_static_env_value "$LOG_GENESIS_ANCHOR" OBJECT_CREATED_AT 2>/dev/null || true)"
  [ "$anchor_status" = COMMITTED ] && [[ "$anchor_deploy" =~ ^[0-9a-f]{40}$ ]] \
    || { fail "root log-evidence genesis anchor is not committed"; return 0; }

  if [ ! -d "$state_dir" ] || [ -L "$state_dir" ] \
    || [ "$(realpath -e -- "$state_dir" 2>/dev/null || true)" != "$state_dir" ] \
    || [ "$(stat -c '%U:%G:%a' "$state_dir" 2>/dev/null || true)" != leaddrive-backup:leaddrive-backup:750 ] \
    || [ ! -f "$state_file" ] || [ -L "$state_file" ] \
    || [ "$(realpath -e -- "$state_file" 2>/dev/null || true)" != "$state_file" ] \
    || [ "$(stat -c '%U:%G:%a' "$state_file" 2>/dev/null || true)" != leaddrive-backup:leaddrive-backup:600 ]; then
    fail "log-shipping cursor authority is missing or has unsafe ownership/mode"
    return 0
  fi
  state_bytes="$(wc -c <"$state_file" | tr -d '[:space:]')"
  state_rows="$(wc -l <"$state_file" | tr -d '[:space:]')"
  if ! [[ "$state_bytes" =~ ^[0-9]+$ ]] || [ "$state_bytes" -gt 4194304 ] \
      || ! [[ "$state_rows" =~ ^[0-9]+$ ]] || [ "$state_rows" -gt 100000 ]; then
    fail "log-shipping cursor exceeds the reviewed 4 MiB/100000-row bound"
    return 0
  fi
  if ! awk -F '\t' -v expected="$EXPECTED_LOG_JOURNAL_UNITS" -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    BEGIN {
      count=split(expected, units, " ")
      for (i=1; i<=count; i++) allowed[units[i]]=1
    }
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 !~ /^SHIP_LOGS_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 3 { if ($0 !~ /^RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 4 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
    NR == 5 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\// || length($0) > 1200) bad=1; next }
    NR == 6 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=[-A-Za-z0-9._~+\/=]+$/ || $0 ~ /=None$/ || $0 ~ /=null$/ || length($0) > 1100) bad=1; next }
    NR == 7 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_SHA256=[0-9a-f]{64}$/) bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || $2 !~ reviewed ||
          $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ ||
          $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/ || $7 !~ /^[0-9a-f]{64}$/ ||
          ($5 == 0 && $6 != 0) || ($5 > 0 && ($6 < 1 || $6 > 4096 || $6 > $5))) bad=1
      if ($2 ~ /^\/var\/lib\/leaddrive-v2-logs\//) saw_pm2=1
      else if ($2 ~ /^\/var\/log\/nginx\//) saw_nginx=1
      else if ($2 ~ /^\/var\/log\/postgresql\//) saw_postgres=1
      else if ($2 == "/var/log/leaddrive-resilience-cron.log") saw_resilience=1
      if (seen_file[$2]++) bad=1
      next
    }
    $1 == "JOURNAL" {
      if (NF != 3 || !allowed[$2] ||
          ($3 != "NO_CURSOR" && ($3 !~ /^[!-~]+$/ || length($3) > 2048))) bad=1
      if (seen_journal[$2]++) bad=1
      next
    }
    { bad=1 }
    END {
      for (unit in allowed) if (seen_journal[unit] != 1) bad=1
      if (!saw_pm2 || !saw_nginx || !saw_postgres || !saw_resilience) bad=1
      if (NR < 11 || bad) exit 1
    }
  ' "$state_file"; then
    fail "log-shipping cursor is not the exact complete version-4 evidence state"
    return 0
  fi
  state_script_sha="$(read_static_env_value "$state_file" SHIP_LOGS_SHA256 2>/dev/null || true)"
  state_program_sha="$(read_static_env_value "$state_file" RECOVERY_PROGRAM_SET_SHA256 2>/dev/null || true)"
  live_script_sha="$(sha256sum "$live_script" 2>/dev/null | awk '{print $1}')"
  live_program_sha="$(tr -d '\r\n' <"$program_record" 2>/dev/null || true)"
  if [ "$state_script_sha" = "$live_script_sha" ] \
    && [ "$state_program_sha" = "$live_program_sha" ] \
    && [[ "$state_script_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$state_program_sha" =~ ^[0-9a-f]{64}$ ]]; then
    pass "log cursor was committed by the active immutable recovery program"
  else
    fail "log cursor belongs to another or unprovable recovery-program release"
    return 0
  fi
  evidence_start="$(read_static_env_value "$state_file" LOG_EVIDENCE_START_AT 2>/dev/null || true)"
  evidence_key="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_KEY 2>/dev/null || true)"
  evidence_version="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID 2>/dev/null || true)"
  evidence_sha="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_SHA256 2>/dev/null || true)"
  if ! [[ "$evidence_start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
      || ! [[ "$evidence_key" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$ ]] \
      || ! [[ "$evidence_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
      || [ "$evidence_version" = None ] || [ "$evidence_version" = null ] \
      || ! [[ "$evidence_sha" =~ ^[0-9a-f]{64}$ ]]; then
    fail "log-evidence watermark or first immutable object authority is malformed"
    return 0
  fi
  if [ "$evidence_start" != "$anchor_start" ] || [ "$evidence_key" != "$anchor_key" ] \
      || [ "$evidence_version" != "$anchor_version" ] || [ "$evidence_sha" != "$anchor_sha" ]; then
    fail "live log cursor diverges from the root committed genesis authority"
    return 0
  fi
  if [ "$AWS_TOOLCHAIN_READY" -ne 1 ]; then
    fail "pinned AWS toolchain is unavailable for the first log-evidence object proof"
    return 0
  fi
  set +e
  head_state="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
    AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]:-}" \
    AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]:-}" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    timeout 45 "$AWS_BIN" s3api head-object \
      --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]:-}" \
      --region "${CONFIG[BACKUP_S3_REGION]:-}" --no-cli-pager \
      --bucket "${CONFIG[BACKUP_S3_BUCKET]:-}" --key "$evidence_key" \
      --version-id="$evidence_version" \
      --query '[ContentLength,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256,LastModified]' \
      --output text 2>/dev/null)"
  head_status=$?
  set -e
  read -r remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges \
    remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_modified <<<"$head_state"
  evidence_start_epoch="$(date -u -d "$evidence_start" '+%s' 2>/dev/null || true)"
  modified_epoch="$(date -u -d "$remote_modified" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  if [ "$head_status" -ne 0 ] || ! [[ "$remote_bytes" =~ ^[1-9][0-9]*$ ]] \
      || [ "$remote_bytes" -gt 2199023255552 ] || [ "$remote_bytes" != "$anchor_bytes" ] \
      || [ "$remote_sha" != "$anchor_sha" ] || [ "$remote_format" != "$anchor_format" ] \
      || [ "$remote_start" != "$anchor_start" ] || [ "$remote_bootstrap" != 1 ] \
      || [ "$remote_program" != "$anchor_program" ] || [ "$remote_ranges" != "$anchor_ranges" ] \
      || [ "$remote_file_count" != "$anchor_file_count" ] \
      || [ "$remote_file_bytes" != "$anchor_file_bytes" ] \
      || [ "$remote_journal_count" != "$anchor_journal_count" ] \
      || [ "$remote_cursor" != "$anchor_cursor" ] || [ "$remote_modified" != "$anchor_created" ] \
      || ! [[ "$remote_file_count" =~ ^[0-9]+$ ]] || [ "$remote_file_count" -gt 100000 ] \
      || ! [[ "$remote_file_bytes" =~ ^[0-9]+$ ]] || [ "$remote_file_bytes" -gt 1099511627776 ] \
      || ! [[ "$remote_journal_count" =~ ^[0-9]+$ ]] || [ "$remote_journal_count" -gt 1000 ] \
      || [ $((remote_file_count + remote_journal_count)) -lt 1 ] \
      || ! [[ "$evidence_start_epoch" =~ ^[0-9]+$ ]] \
      || ! [[ "$modified_epoch" =~ ^[0-9]+$ ]] \
      || [ "$modified_epoch" -lt $((evidence_start_epoch - 60)) ] \
      || [ "$modified_epoch" -gt $((now_epoch + 300)) ]; then
    fail "root anchor, live cursor, and exact immutable log object do not form one three-way proof"
    return 0
  fi
  set +e
  retention_state="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
    AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]:-}" \
    AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]:-}" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    timeout 45 "$AWS_BIN" s3api get-object-retention \
      --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]:-}" \
      --region "${CONFIG[BACKUP_S3_REGION]:-}" --no-cli-pager \
      --bucket "${CONFIG[BACKUP_S3_BUCKET]:-}" --key "$evidence_key" \
      --version-id="$evidence_version" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)"
  retention_status=$?
  set -e
  read -r retention_mode retention_until <<<"$retention_state"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)"
  retention_days="${CONFIG[LOG_SHIP_RETENTION_DAYS]:-}"
  if ! [[ "$retention_days" =~ ^[0-9]+$ ]] || [ "$retention_days" -lt 400 ]; then
    fail "log-evidence retention policy is below the reviewed minimum"
    return 0
  fi
  minimum_retention_epoch="$(date -u -d "+$((retention_days - 30)) days" '+%s' 2>/dev/null || true)"
  if [ "$retention_status" -ne 0 ] || [ "$retention_mode" != COMPLIANCE ] \
      || ! [[ "$retention_epoch" =~ ^[0-9]+$ ]] \
      || ! [[ "$minimum_retention_epoch" =~ ^[0-9]+$ ]] \
      || [ "$retention_epoch" -lt "$minimum_retention_epoch" ]; then
    fail "first log-evidence object is below the rolling COMPLIANCE retention horizon"
    return 0
  fi
  pass "root anchor, live cursor, exact object version, metadata, and COMPLIANCE horizon agree"
  for unit in $EXPECTED_LOG_JOURNAL_UNITS; do
    cursor="$(awk -F '\t' -v want="$unit" '$1 == "JOURNAL" && $2 == want { print $3 }' "$state_file")"
    set +e
    if [ "$cursor" = NO_CURSOR ]; then
      retained="$(LC_ALL=C journalctl -q -u "$unit" -n 1 --show-cursor --no-pager 2>&1)"
      journal_status=$?
      set -e
      if [ "$journal_status" -ne 0 ] || [ "$retained" != "-- No entries --" ]; then
        fail "log cursor has not captured retained journal evidence for $unit"
        return 0
      fi
      continue
    fi
    retained="$(LC_ALL=C journalctl -q -u "$unit" --after-cursor="$cursor" \
      --show-cursor --no-pager 2>&1)"
    journal_status=$?
    set -e
    terminal_line="$(printf '%s\n' "$retained" | tail -n 1)"
    if [ "$journal_status" -ne 0 ] || [[ ! "$terminal_line" =~ ^--\ cursor:\ [!-~]{1,2048}$ ]]; then
      fail "log cursor is no longer seekable in retained journal history for $unit"
      return 0
    fi
  done
  pass "log-shipping state contains one retained, seekable cursor for every reviewed journal unit"
}

probe_current_backup_database_state() {
  local ledger_sql="/opt/leaddrive-v2/.next/standalone/scripts/backup/migration-ledger.sql"
  local key value identity ledger_output status
  local -a pg_env=()

  if [ ! -f "$ledger_sql" ] || [ -L "$ledger_sql" ]; then
    fail "running artifact is missing migration-ledger.sql"
    return 0
  fi
  for key in PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGSSLMODE PGSSLROOTCERT PGCONNECT_TIMEOUT; do
    value="${CONFIG[$key]:-}"
    if [ "$key" = PGPORT ]; then value="${value:-5432}"; fi
    if [ "$key" = PGCONNECT_TIMEOUT ]; then value="${value:-10}"; fi
    if [ -z "$value" ]; then
      fail "current backup database state probe is missing $key"
      return 0
    fi
    pg_env+=("$key=$value")
  done
  set +e
  identity="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent "${pg_env[@]}" \
    timeout 45 psql -X -v ON_ERROR_STOP=1 -AtF '|' -c \
      "SELECT (pg_control_system()).system_identifier::text,
              current_database(),
              (SELECT oid::text FROM pg_database WHERE datname = current_database()),
              pg_is_in_recovery()::int" 2>/dev/null)"
  status=$?
  set -e
  if [ "$status" -ne 0 ] || ! [[ "$identity" =~ ^[0-9]+\|[^\|[:space:]]+\|[0-9]+\|0$ ]]; then
    fail "current backup-source database identity cannot be proved"
    return 0
  fi
  set +e
  ledger_output="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent "${pg_env[@]}" \
    timeout 45 psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' -f "$ledger_sql" 2>/dev/null)"
  status=$?
  set -e
  if [ "$status" -ne 0 ] || [ -z "$ledger_output" ] \
    || ! printf '%s\n' "$ledger_output" | awk -F '\t' '
      NF != 8 { bad=1; next }
      { for (i=1; i<=8; i++) if ($i !~ /^(n|x([0-9a-f][0-9a-f])*)$/) bad=1 }
      END { if (NR < 1 || bad) exit 1 }
    '; then
    fail "current Prisma migration ledger cannot be proved"
    return 0
  fi
  CURRENT_BACKUP_DATABASE_IDENTITY_SHA256="$(printf '%s' "$identity" | sha256sum | awk '{print $1}')"
  CURRENT_BACKUP_MIGRATION_LEDGER_SHA256="$(printf '%s\n' "$ledger_output" | sha256sum | awk '{print $1}')"
  pass "current backup-source database identity and migration ledger are readable"
}

if [ ! -e "$BACKUP_ENV_FILE" ]; then
  fail "canonical PostgreSQL backup environment is missing"
elif [ -L "$BACKUP_ENV_FILE" ] || [ ! -f "$BACKUP_ENV_FILE" ]; then
  fail "canonical PostgreSQL backup environment is not a regular non-symlink file"
else
  env_owner="$(stat -c '%U:%G' "$BACKUP_ENV_FILE" 2>/dev/null || true)"
  env_mode="$(stat -c '%a' "$BACKUP_ENV_FILE" 2>/dev/null || true)"
  if [ "$env_owner:$env_mode" = "root:root:600" ] \
    || [ "$env_owner:$env_mode" = "root:leaddrive-backup:640" ]; then
    pass "backup environment ownership and mode are restricted"
  else
    fail "backup environment must be root:root 0600 or root:leaddrive-backup 0640"
  fi
fi

config_keys=(
  PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGSSLMODE PGSSLROOTCERT PGCONNECT_TIMEOUT
  BACKUP_EXPECTED_DB_ROLE VERIFY_PGHOST VERIFY_PGPORT VERIFY_PGUSER
  VERIFY_PGPASSFILE VERIFY_PGMAINTENANCE_DB VERIFY_PGSSLMODE VERIFY_PGSSLROOTCERT
  VERIFY_PGCONNECT_TIMEOUT
  VERIFY_ALLOW_SOURCE_CLUSTER BACKUP_ENCRYPTION BACKUP_AGE_RECIPIENT
  SECRETS_AGE_RECIPIENT
  BACKUP_ENV_FILE BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET
  BACKUP_S3_PREFIX BACKUP_WORK_ROOT BACKUP_STATE_ROOT BACKUP_LOCK_FILE
  BACKUP_RETENTION_DAILY_DAYS BACKUP_RETENTION_WEEKLY_DAYS
  BACKUP_RETENTION_MONTHLY_DAYS BACKUP_MIN_DUMP_BYTES
  BACKUP_MIN_WORK_AVAILABLE_BYTES BACKUP_WORK_CAPACITY_RATIO_PERCENT
  APP_ENV_FILE SECRETS_WORK_ROOT SECRETS_LOCK_FILE SECRETS_S3_PREFIX
  SECRETS_RETENTION_DAYS
  RUNTIME_FILES_SOURCE_ROOT RUNTIME_FILES_STATE_ROOT RUNTIME_FILES_WORK_ROOT
  RUNTIME_FILES_LOCK_FILE RUNTIME_FILES_S3_PREFIX RUNTIME_FILES_CAPACITY_RATIO_PERCENT
  RUNTIME_FILES_MIN_FREE_BYTES RUNTIME_FILES_HEALTHCHECK_URL RUNTIME_FILES_PATHS
  LOG_SHIP_SOURCE_DIR LOG_SHIP_SOURCE_DIRS LOG_SHIP_STATE_FILE LOG_SHIP_WORK_ROOT
  LOG_SHIP_LOCK_FILE LOG_SHIP_S3_PREFIX LOG_SHIP_RETENTION_DAYS
  LOG_SHIP_JOURNAL_UNITS LOG_SHIP_JOURNAL_SINCE LOG_SHIP_HEALTHCHECK_URL
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_REQUIRE_HEALTHCHECK
  BACKUP_HEALTHCHECK_URL SECRETS_HEALTHCHECK_URL BACKUP_TIER_OVERRIDE
  SECRETS_FILES SECRETS_DRY_RUN
)
if [ -f "$BACKUP_ENV_FILE" ] && [ ! -L "$BACKUP_ENV_FILE" ]; then
  for key in "${config_keys[@]}"; do
    load_config_key "$key"
  done
else
  for key in "${config_keys[@]}"; do
    CONFIG["$key"]=""
  done
fi

required_keys=(
  PGHOST PGDATABASE PGUSER PGPASSFILE PGSSLROOTCERT BACKUP_EXPECTED_DB_ROLE
  VERIFY_PGHOST VERIFY_PGPORT VERIFY_PGUSER VERIFY_PGPASSFILE
  VERIFY_PGMAINTENANCE_DB VERIFY_PGSSLROOTCERT BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT
  BACKUP_S3_REGION BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY BACKUP_HEALTHCHECK_URL SECRETS_HEALTHCHECK_URL
  RUNTIME_FILES_HEALTHCHECK_URL LOG_SHIP_HEALTHCHECK_URL
)
for key in "${required_keys[@]}"; do
  require_config_key "$key"
done

for policy in \
  'PGSSLMODE:verify-full' \
  'VERIFY_PGSSLMODE:verify-full' \
  'BACKUP_REQUIRE_HEALTHCHECK:1' \
  'BACKUP_WORK_ROOT:/run/leaddrive-postgres-backup' \
  'BACKUP_STATE_ROOT:/var/lib/leaddrive-postgres-backup' \
  'BACKUP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock' \
  'BACKUP_S3_PREFIX:postgres' \
  'APP_ENV_FILE:/etc/leaddrive/app.env' \
  'SECRETS_WORK_ROOT:/run/leaddrive-secrets-snapshot' \
  'SECRETS_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock' \
  'SECRETS_S3_PREFIX:secrets' \
  'RUNTIME_FILES_SOURCE_ROOT:/var/lib/leaddrive-v2' \
  'RUNTIME_FILES_STATE_ROOT:/var/lib/leaddrive-runtime-files-snapshot' \
  'RUNTIME_FILES_WORK_ROOT:/run/leaddrive-runtime-files-snapshot' \
  'RUNTIME_FILES_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock' \
  'RUNTIME_FILES_S3_PREFIX:runtime-files' \
  "LOG_SHIP_SOURCE_DIRS:$EXPECTED_LOG_SOURCE_DIRS" \
  "LOG_SHIP_SOURCE_FILES:$EXPECTED_LOG_SOURCE_FILES" \
  'LOG_SHIP_STATE_FILE:/var/lib/leaddrive-log-ship/log-ship-offsets' \
  'LOG_SHIP_WORK_ROOT:/run/leaddrive-log-ship' \
  'LOG_SHIP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/log-ship.lock' \
  'LOG_SHIP_S3_PREFIX:logs' \
  "LOG_SHIP_JOURNAL_UNITS:$EXPECTED_LOG_JOURNAL_UNITS"; do
  policy_key="${policy%%:*}"
  policy_expected="${policy#*:}"
  policy_configured="${CONFIG[$policy_key]:-}"
  case "$policy_key" in
    BACKUP_WORK_ROOT|BACKUP_STATE_ROOT|BACKUP_LOCK_FILE|BACKUP_S3_PREFIX|\
    APP_ENV_FILE|SECRETS_WORK_ROOT|SECRETS_LOCK_FILE|SECRETS_S3_PREFIX|\
    RUNTIME_FILES_SOURCE_ROOT|RUNTIME_FILES_STATE_ROOT|RUNTIME_FILES_WORK_ROOT|\
    RUNTIME_FILES_LOCK_FILE|RUNTIME_FILES_S3_PREFIX|LOG_SHIP_SOURCE_DIRS|LOG_SHIP_SOURCE_FILES|\
    LOG_SHIP_STATE_FILE|LOG_SHIP_WORK_ROOT|LOG_SHIP_LOCK_FILE|LOG_SHIP_S3_PREFIX|\
    LOG_SHIP_JOURNAL_UNITS)
      policy_configured="${policy_configured:-$policy_expected}"
      ;;
  esac
  if [ "$policy_configured" = "$policy_expected" ]; then
    pass "$policy_key matches the reviewed fail-closed policy"
  else
    fail "$policy_key does not match the reviewed fail-closed policy"
  fi
done
runner_lock_root=/var/lib/leaddrive-recovery-runner-locks
runner_lock_set_ok=1
if [ ! -d "$runner_lock_root" ] || [ -L "$runner_lock_root" ] \
    || [ "$(realpath -e -- "$runner_lock_root" 2>/dev/null || true)" != "$runner_lock_root" ] \
    || [ "$(stat -c '%U:%G:%a' "$runner_lock_root" 2>/dev/null || true)" != root:root:755 ]; then
  runner_lock_set_ok=0
fi
for runner_lock_spec in \
  'postgres-backup.lock|root:leaddrive-backup:660' \
  'secrets-snapshot.lock|root:root:600' \
  'runtime-files-snapshot.lock|root:root:600' \
  'log-ship.lock|root:leaddrive-backup:660'; do
  runner_lock_name="${runner_lock_spec%%|*}"
  runner_lock_identity="${runner_lock_spec#*|}"
  runner_lock_path="$runner_lock_root/$runner_lock_name"
  if [ ! -f "$runner_lock_path" ] || [ -L "$runner_lock_path" ] \
      || [ "$(realpath -e -- "$runner_lock_path" 2>/dev/null || true)" != "$runner_lock_path" ] \
      || [ "$(stat -c '%U:%G:%a' "$runner_lock_path" 2>/dev/null || true)" != "$runner_lock_identity" ]; then
    runner_lock_set_ok=0
  fi
done
if [ "$runner_lock_set_ok" -eq 1 ]; then
  pass "all four recovery runners use canonical root-managed persistent lock inodes"
else
  fail "root-managed persistent recovery-runner lock authority is missing or unsafe"
fi
for forbidden_key in BACKUP_ENV_FILE BACKUP_TIER_OVERRIDE SECRETS_FILES SECRETS_DRY_RUN \
  RUNTIME_FILES_PATHS LOG_SHIP_SOURCE_DIR LOG_SHIP_JOURNAL_SINCE; do
  if [ -z "${CONFIG[$forbidden_key]:-}" ]; then
    pass "$forbidden_key override is absent"
  else
    fail "$forbidden_key override is forbidden"
  fi
done
for bounded_key in PGCONNECT_TIMEOUT VERIFY_PGCONNECT_TIMEOUT; do
  bounded_value="${CONFIG[$bounded_key]:-}"
  if [[ "$bounded_value" =~ ^[0-9]+$ ]] \
    && [ "$bounded_value" -ge 1 ] && [ "$bounded_value" -le 30 ]; then
    pass "$bounded_key is within the reviewed 1-30 second bound"
  else
    fail "$bounded_key is missing or outside the reviewed bound"
  fi
done
for minimum_policy in \
  'BACKUP_RETENTION_DAILY_DAYS:16' \
  'BACKUP_RETENTION_WEEKLY_DAYS:63' \
  'BACKUP_RETENTION_MONTHLY_DAYS:400' \
  'SECRETS_RETENTION_DAYS:400' \
  'BACKUP_MIN_DUMP_BYTES:1048576' \
  'BACKUP_MIN_WORK_AVAILABLE_BYTES:1073741824' \
  'BACKUP_WORK_CAPACITY_RATIO_PERCENT:250' \
  'RUNTIME_FILES_CAPACITY_RATIO_PERCENT:110' \
  'RUNTIME_FILES_MIN_FREE_BYTES:1073741824' \
  'LOG_SHIP_RETENTION_DAYS:400'; do
  minimum_key="${minimum_policy%%:*}"
  minimum_value="${minimum_policy#*:}"
  configured_value="${CONFIG[$minimum_key]:-$minimum_value}"
  if [[ "$configured_value" =~ ^[0-9]+$ ]] && [ "$configured_value" -ge "$minimum_value" ]; then
    pass "$minimum_key meets the reviewed minimum"
  else
    fail "$minimum_key is missing or below the reviewed minimum"
  fi
done

for health_key in BACKUP_HEALTHCHECK_URL SECRETS_HEALTHCHECK_URL \
  RUNTIME_FILES_HEALTHCHECK_URL LOG_SHIP_HEALTHCHECK_URL; do
  health_value="${CONFIG[$health_key]:-}"
  if [[ "$health_value" =~ ^https://[^[:space:]]+$ ]] && ! looks_like_placeholder "$health_value"; then
    pass "$health_key uses a non-placeholder HTTPS endpoint"
  else
    fail "$health_key must use a non-placeholder HTTPS endpoint"
  fi
done

if [ -n "${CONFIG[BACKUP_S3_ENDPOINT]:-}" ] && [ -n "${CONFIG[BACKUP_S3_REGION]:-}" ] \
  && [ "${CONFIG[BACKUP_S3_ENDPOINT]}" = "https://${CONFIG[BACKUP_S3_REGION]}.your-objectstorage.com" ]; then
  pass "Object Storage endpoint matches the configured Hetzner region"
else
  fail "Object Storage endpoint does not match the configured Hetzner region"
fi

backup_encryption="${CONFIG[BACKUP_ENCRYPTION]:-age}"
case "$backup_encryption" in
  age) pass "PostgreSQL backup encryption is age" ;;
  off) fail "PostgreSQL backup encryption is explicitly off" ;;
  *) fail "PostgreSQL backup encryption has an unsupported value" ;;
esac

if [ -z "${CONFIG[SECRETS_AGE_RECIPIENT]:-}" ] \
  || [ "${CONFIG[SECRETS_AGE_RECIPIENT]}" = "${CONFIG[BACKUP_AGE_RECIPIENT]:-}" ]; then
  pass "database and secrets snapshots resolve to the same commissioned recipient"
else
  fail "SECRETS_AGE_RECIPIENT differs from BACKUP_AGE_RECIPIENT during initial commissioning"
fi

if [ "${CONFIG[BACKUP_REQUIRE_HEALTHCHECK]:-1}" = "1" ]; then
  pass "external dead-man monitor is required by configuration"
else
  fail "external dead-man monitor is not required by configuration"
fi

if [ -n "${CONFIG[PGUSER]:-}" ] \
  && [ "${CONFIG[PGUSER]}" = "${CONFIG[BACKUP_EXPECTED_DB_ROLE]:-}" ]; then
  pass "source login and expected backup role agree"
else
  fail "source login and expected backup role do not agree"
fi

source_port="${CONFIG[PGPORT]:-5432}"
if [ -n "${CONFIG[PGHOST]:-}" ] && [ -n "${CONFIG[VERIFY_PGHOST]:-}" ] \
  && [ "${CONFIG[PGHOST]}:${source_port}" != "${CONFIG[VERIFY_PGHOST]}:${CONFIG[VERIFY_PGPORT]:-}" ]; then
  pass "scratch restore target is separate from the source host/port"
else
  fail "scratch restore target is not demonstrably separate from the source host/port"
fi
if [ "${CONFIG[VERIFY_ALLOW_SOURCE_CLUSTER]:-0}" = "1" ]; then
  fail "production readiness forbids VERIFY_ALLOW_SOURCE_CLUSTER=1"
else
  pass "source-cluster restore override is disabled"
fi

for command_name in age aws cmp createdb curl df dropdb du find findmnt flock gpg journalctl pg_dump \
  pg_dumpall pg_restore psql readlink realpath sha256sum sort ssh-keygen stat sync systemctl \
  systemd-run tar timeout unzip xargs; do
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$command_name command is installed"
  else
    fail "$command_name command is missing"
  fi
done

tool_ancestor_failed=0
for tool_ancestor in \
  /usr/local /usr/local/bin /usr/local/lib /usr/local/lib/leaddrive-backup \
  /usr/local/lib/leaddrive-backup/tools /usr/local/lib/leaddrive-backup/tools/age \
  "/usr/local/lib/leaddrive-backup/tools/age/$AGE_VERSION" \
  /usr/local/lib/leaddrive-backup/tools/aws-cli "$AWS_ROOT" "$AWS_ROOT/v2" \
  "$AWS_ROOT/v2/$AWS_VERSION"; do
  if [ -d "$tool_ancestor" ] && [ ! -L "$tool_ancestor" ] \
    && [ "$(stat -c '%u' "$tool_ancestor" 2>/dev/null || true)" = "0" ]; then
    ancestor_mode="$(stat -c '%a' "$tool_ancestor" 2>/dev/null || true)"
    if [[ "$ancestor_mode" =~ ^[0-7]{3,4}$ ]] \
      && (( (8#$ancestor_mode & 8#022) == 0 )); then
      continue
    fi
  fi
  tool_ancestor_failed=1
done
if [ "$tool_ancestor_failed" -eq 0 ]; then
  pass "pinned backup tool ancestor chain is root-owned and non-writable"
else
  fail "pinned backup tool ancestor chain is missing, symlinked, or writable"
fi

if [ -x "$AGE_BIN" ] && [ ! -L "$AGE_BIN" ]; then
  age_version="$("$AGE_BIN" --version 2>&1 || true)"
  if [[ "$age_version" =~ ^(age[[:space:]]+)?v?1\.3\.2$ ]] \
    && [ -f "$AGE_BIN" ] && [ ! -L "$AGE_BIN" ] \
    && [ -f "$AGE_PROVENANCE" ] && [ ! -L "$AGE_PROVENANCE" ] \
    && [ "$(read_static_env_value "$AGE_PROVENANCE" VERSION)" = "$AGE_VERSION" ] \
    && [ "$(read_static_env_value "$AGE_PROVENANCE" ARCHIVE_SHA256)" = "$AGE_ARCHIVE_SHA256" ] \
    && [ "$(read_static_env_value "$AGE_PROVENANCE" BINARY_SHA256)" = "$AGE_BINARY_SHA256" ] \
    && [ "$(sha256sum "$AGE_BIN" | awk '{print $1}')" = "$AGE_BINARY_SHA256" ] \
    && [ -L /usr/local/bin/age ] \
    && [ "$(readlink -- /usr/local/bin/age)" = "$AGE_BIN" ] \
    && [ "$(readlink -f -- /usr/local/bin/age)" = "$AGE_BIN" ]; then
    pass "age is exact reviewed v1.3.2 with the pinned binary digest and link"
  else
    fail "age is not the exact digest-pinned reviewed v1.3.2 installation"
  fi
else
  fail "pinned age binary is missing or not executable"
fi
if [ -x "$AWS_BIN" ]; then
  aws_version="$("$AWS_BIN" --version 2>&1 || true)"
  aws_real="$(readlink -f -- "$AWS_BIN" 2>/dev/null || true)"
  if [ "${aws_version%% *}" = "aws-cli/$AWS_VERSION" ] \
    && [ -f "$AWS_PROVENANCE" ] && [ ! -L "$AWS_PROVENANCE" ] \
    && [ "$(read_static_env_value "$AWS_PROVENANCE" VERSION)" = "$AWS_VERSION" ] \
    && [ "$(read_static_env_value "$AWS_PROVENANCE" ARCHIVE_SHA256)" = "$AWS_ARCHIVE_SHA256" ] \
    && [ "$(read_static_env_value "$AWS_PROVENANCE" SIGNING_FINGERPRINT)" = "$AWS_SIGNING_FINGERPRINT" ] \
    && [ -L "$AWS_ROOT/v2/current" ] \
    && [ "$(readlink -- "$AWS_ROOT/v2/current")" = "$AWS_ROOT/v2/$AWS_VERSION" ] \
    && [ "$aws_real" = "$AWS_ROOT/v2/$AWS_VERSION/dist/aws" ] \
    && [ -L /usr/local/bin/aws ] \
    && [ "$(readlink -- /usr/local/bin/aws)" = "$AWS_BIN" ] \
    && [ "$(readlink -f -- /usr/local/bin/aws)" = "$aws_real" ]; then
    pass "AWS CLI is exact reviewed v2.36.40 with the pinned versioned link"
    AWS_TOOLCHAIN_READY=1
  else
    fail "AWS CLI is not the exact pinned v2.36.40 installation"
  fi
else
  fail "pinned AWS CLI binary is missing or not executable"
fi

if getent passwd leaddrive-backup >/dev/null 2>&1; then
  pass "dedicated backup service account exists"
else
  fail "dedicated backup service account is missing"
fi

check_service_secret_file PGPASSFILE
check_service_secret_file VERIFY_PGPASSFILE
check_ca_file PGSSLROOTCERT
check_ca_file VERIFY_PGSSLROOTCERT
check_root_recovery_file "application recovery secret" /etc/leaddrive/app.env 600
check_root_recovery_file "migration recovery secret" /etc/leaddrive/migration.env 600

if [ "$(findmnt -n -o FSTYPE --target /run 2>/dev/null || true)" = "tmpfs" ]; then
  pass "production /run is tmpfs for plaintext backup staging"
else
  fail "production /run is not tmpfs"
fi
if [ -d /var/lib/leaddrive-backup ] && \
    find /var/lib/leaddrive-backup -mindepth 1 -maxdepth 2 \
      \( -name 'run-*' -o -name 'secrets-*' -o -name 'logship-*' \
         -o -name '*.dump' -o -name '*.tar' -o -name '*.age' \) \
      -print -quit 2>/dev/null | grep -q .; then
  fail "legacy backup root contains possible backup remnants"
else
  pass "legacy backup root has no reviewed remnant pattern"
fi

if [ -n "${CONFIG[BACKUP_AGE_RECIPIENT]:-}" ] && [ -x "$AGE_BIN" ]; then
  if printf 'leaddrive-backup-readiness\n' \
    | "$AGE_BIN" --recipient "${CONFIG[BACKUP_AGE_RECIPIENT]}" >/dev/null 2>&1; then
    pass "public age recipient accepts encryption (recipient redacted)"
  else
    fail "configured public age recipient cannot encrypt a test payload"
  fi
fi

service_load="$(systemctl show --property=LoadState --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_user="$(systemctl show --property=User --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_group="$(systemctl show --property=Group --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_env_files="$(systemctl show --property=EnvironmentFiles --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_env="$(systemctl show --property=Environment --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_pass_env="$(systemctl show --property=PassEnvironment --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_fragment="$(systemctl show --property=FragmentPath --value "$BACKUP_SERVICE" 2>/dev/null || true)"
service_dropins="$(systemctl show --property=DropInPaths --value "$BACKUP_SERVICE" 2>/dev/null || true)"

[ "$service_load" = "loaded" ] \
  && pass "backup systemd service is loaded" \
  || fail "backup systemd service is not loaded"
[ "$service_user:$service_group" = "leaddrive-backup:leaddrive-backup" ] \
  && pass "backup service uses the dedicated account" \
  || fail "backup service does not use the dedicated account"
[[ "$service_env_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] \
  && pass "backup service reads only the canonical environment file" \
  || fail "backup service EnvironmentFile is unexpected"
[ -z "$service_env" ] && [ -z "$service_pass_env" ] \
  && pass "backup service has no environment override channel" \
  || fail "backup service imports an environment override"
[ "$service_fragment" = "$EXPECTED_SERVICE_FRAGMENT" ] && [ -z "$service_dropins" ] \
  && pass "backup service uses the canonical unit without drop-ins" \
  || fail "backup service fragment or drop-ins are unexpected"

if [ -f "$EXPECTED_SERVICE_FRAGMENT" ] && [ ! -L "$EXPECTED_SERVICE_FRAGMENT" ] \
  && [ -f "$EXPECTED_ARTIFACT_FRAGMENT" ] && [ ! -L "$EXPECTED_ARTIFACT_FRAGMENT" ] \
  && cmp -s -- "$EXPECTED_SERVICE_FRAGMENT" "$EXPECTED_ARTIFACT_FRAGMENT"; then
  pass "live backup unit matches the running immutable artifact"
else
  fail "live backup unit does not match the running immutable artifact"
fi

secrets_load="$(systemctl show --property=LoadState --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_user="$(systemctl show --property=User --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_env_files="$(systemctl show --property=EnvironmentFiles --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_env="$(systemctl show --property=Environment --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_pass_env="$(systemctl show --property=PassEnvironment --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_fragment="$(systemctl show --property=FragmentPath --value "$SECRETS_SERVICE" 2>/dev/null || true)"
secrets_dropins="$(systemctl show --property=DropInPaths --value "$SECRETS_SERVICE" 2>/dev/null || true)"
[ "$secrets_load" = "loaded" ] && [ "$secrets_user" = "root" ] \
  && [[ "$secrets_env_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] \
  && [ -z "$secrets_env" ] && [ -z "$secrets_pass_env" ] \
  && [ "$secrets_fragment" = "$EXPECTED_SECRETS_FRAGMENT" ] && [ -z "$secrets_dropins" ] \
  && pass "secrets snapshot service uses its canonical root-only authority without overrides" \
  || fail "secrets snapshot service authority, fragment, or override channel is unexpected"
if [ -f "$EXPECTED_SECRETS_FRAGMENT" ] && [ ! -L "$EXPECTED_SECRETS_FRAGMENT" ] \
  && [ -f "$EXPECTED_SECRETS_ARTIFACT_FRAGMENT" ] && [ ! -L "$EXPECTED_SECRETS_ARTIFACT_FRAGMENT" ] \
  && cmp -s -- "$EXPECTED_SECRETS_FRAGMENT" "$EXPECTED_SECRETS_ARTIFACT_FRAGMENT"; then
  pass "live secrets snapshot unit matches the running immutable artifact"
else
  fail "live secrets snapshot unit does not match the running immutable artifact"
fi

runtime_files_load="$(systemctl show --property=LoadState --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_user="$(systemctl show --property=User --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_group="$(systemctl show --property=Group --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_env_files="$(systemctl show --property=EnvironmentFiles --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_env="$(systemctl show --property=Environment --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_pass_env="$(systemctl show --property=PassEnvironment --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_fragment="$(systemctl show --property=FragmentPath --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
runtime_files_dropins="$(systemctl show --property=DropInPaths --value "$RUNTIME_FILES_SERVICE" 2>/dev/null || true)"
if [ "$runtime_files_load" = loaded ] && [ "$runtime_files_user" = root ] \
  && { [ -z "$runtime_files_group" ] || [ "$runtime_files_group" = root ]; } \
  && [[ "$runtime_files_env_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] \
  && [ -z "$runtime_files_env" ] && [ -z "$runtime_files_pass_env" ] \
  && [ "$runtime_files_fragment" = "$EXPECTED_RUNTIME_FILES_FRAGMENT" ] \
  && [ -z "$runtime_files_dropins" ]; then
  pass "runtime-files snapshot service uses its canonical root-only authority without overrides"
else
  fail "runtime-files snapshot service authority, fragment, or override channel is unexpected"
fi
if [ -f "$EXPECTED_RUNTIME_FILES_FRAGMENT" ] && [ ! -L "$EXPECTED_RUNTIME_FILES_FRAGMENT" ] \
  && [ -f "$EXPECTED_RUNTIME_FILES_ARTIFACT_FRAGMENT" ] && [ ! -L "$EXPECTED_RUNTIME_FILES_ARTIFACT_FRAGMENT" ] \
  && cmp -s -- "$EXPECTED_RUNTIME_FILES_FRAGMENT" "$EXPECTED_RUNTIME_FILES_ARTIFACT_FRAGMENT"; then
  pass "live runtime-files snapshot unit matches the running immutable artifact"
else
  fail "live runtime-files snapshot unit does not match the running immutable artifact"
fi

log_load="$(systemctl show --property=LoadState --value "$LOG_SERVICE" 2>/dev/null || true)"
log_user="$(systemctl show --property=User --value "$LOG_SERVICE" 2>/dev/null || true)"
log_group="$(systemctl show --property=Group --value "$LOG_SERVICE" 2>/dev/null || true)"
log_supplementary_groups="$(systemctl show --property=SupplementaryGroups --value "$LOG_SERVICE" 2>/dev/null || true)"
log_env_files="$(systemctl show --property=EnvironmentFiles --value "$LOG_SERVICE" 2>/dev/null || true)"
log_env="$(systemctl show --property=Environment --value "$LOG_SERVICE" 2>/dev/null || true)"
log_pass_env="$(systemctl show --property=PassEnvironment --value "$LOG_SERVICE" 2>/dev/null || true)"
log_fragment="$(systemctl show --property=FragmentPath --value "$LOG_SERVICE" 2>/dev/null || true)"
log_dropins="$(systemctl show --property=DropInPaths --value "$LOG_SERVICE" 2>/dev/null || true)"
if [ "$log_load" = loaded ] \
  && [ "$log_user:$log_group" = "leaddrive-backup:leaddrive-backup" ] \
  && [ "$log_supplementary_groups" = "systemd-journal adm" ] \
  && [[ "$log_env_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] \
  && [ -z "$log_env" ] && [ -z "$log_pass_env" ] \
  && [ "$log_fragment" = "$EXPECTED_LOG_FRAGMENT" ] && [ -z "$log_dropins" ]; then
  pass "log shipping service uses the canonical least-privilege authority without overrides"
else
  fail "log shipping service authority, fragment, or override channel is unexpected"
fi
if [ -f "$EXPECTED_LOG_FRAGMENT" ] && [ ! -L "$EXPECTED_LOG_FRAGMENT" ] \
  && [ -f "$EXPECTED_LOG_ARTIFACT_FRAGMENT" ] && [ ! -L "$EXPECTED_LOG_ARTIFACT_FRAGMENT" ] \
  && cmp -s -- "$EXPECTED_LOG_FRAGMENT" "$EXPECTED_LOG_ARTIFACT_FRAGMENT"; then
  pass "live log shipping unit matches the running immutable artifact"
else
  fail "live log shipping unit does not match the running immutable artifact"
fi

# Services and timers are one release-owned recovery program. Validate every
# byte here: checking only ExecStart services leaves a modified timer able to
# suppress or reschedule recovery without changing the signed artifact digest.
live_unit_set_ok=1
for reviewed_unit in \
  leaddrive-log-ship.service leaddrive-log-ship.timer \
  leaddrive-postgres-backup.service leaddrive-postgres-backup.timer \
  leaddrive-runtime-files-snapshot.service leaddrive-runtime-files-snapshot.timer \
  leaddrive-secrets-snapshot.service leaddrive-secrets-snapshot.timer; do
  live_unit="/etc/systemd/system/$reviewed_unit"
  artifact_unit="/opt/leaddrive-v2/.next/standalone/ops/systemd/$reviewed_unit"
  loaded_fragment="$(systemctl show --property=FragmentPath --value "$reviewed_unit" 2>/dev/null || true)"
  loaded_dropins="$(systemctl show --property=DropInPaths --value "$reviewed_unit" 2>/dev/null || true)"
  if [ "$loaded_fragment" != "$live_unit" ] || [ -n "$loaded_dropins" ] \
    || [ ! -f "$live_unit" ] || [ -L "$live_unit" ] \
    || [ ! -f "$artifact_unit" ] || [ -L "$artifact_unit" ] \
    || ! cmp -s -- "$live_unit" "$artifact_unit"; then
    live_unit_set_ok=0
  fi
done
if [ "$live_unit_set_ok" -eq 1 ]; then
  pass "all eight live recovery units/timers exactly match the running artifact without drop-ins"
else
  fail "one or more live recovery units/timers differ from the running artifact or have override channels"
fi

live_logrotate_set_ok=1
for reviewed_rotate in leaddrive-v2 leaddrive-cron-logs; do
  live_rotate="/etc/logrotate.d/$reviewed_rotate"
  artifact_rotate="/opt/leaddrive-v2/.next/standalone/ops/logrotate/$reviewed_rotate"
  if [ ! -f "$live_rotate" ] || [ -L "$live_rotate" ] \
    || [ ! -f "$artifact_rotate" ] || [ -L "$artifact_rotate" ] \
    || ! cmp -s -- "$live_rotate" "$artifact_rotate"; then
    live_logrotate_set_ok=0
  fi
done
if [ "$live_logrotate_set_ok" -eq 1 ]; then
  pass "both live logrotate authorities exactly match the running artifact"
else
  fail "one or more live logrotate authorities differ from the running artifact"
fi

verify_active_operations_release
verify_log_ship_cursor_state

for program_spec in \
  "PostgreSQL backup:/usr/local/lib/leaddrive-v2/ops/current/backup/postgres-backup.sh:/opt/leaddrive-v2/.next/standalone/scripts/backup/postgres-backup.sh:$POSTGRES_BACKUP_SHA256" \
  "secrets snapshot:/usr/local/lib/leaddrive-v2/ops/current/backup/snapshot-secrets.sh:/opt/leaddrive-v2/.next/standalone/scripts/backup/snapshot-secrets.sh:$SECRETS_SNAPSHOT_SHA256" \
  "runtime-files snapshot:/usr/local/lib/leaddrive-v2/ops/current/backup/snapshot-runtime-files.sh:/opt/leaddrive-v2/.next/standalone/scripts/backup/snapshot-runtime-files.sh:$RUNTIME_FILES_SNAPSHOT_SHA256"; do
  program_label="${program_spec%%:*}"
  program_rest="${program_spec#*:}"
  program_live="${program_rest%%:*}"
  program_rest="${program_rest#*:}"
  program_artifact="${program_rest%%:*}"
  program_sha="${program_rest#*:}"
  if [ -x "$program_live" ] && [ ! -L "$program_live" ] \
    && [ -x "$program_artifact" ] && [ ! -L "$program_artifact" ] \
    && cmp -s -- "$program_live" "$program_artifact" \
    && [ "$(sha256sum "$program_live" | awk '{print $1}')" = "$program_sha" ]; then
    pass "$program_label program matches the reviewed immutable artifact and digest"
  else
    fail "$program_label program is missing or differs from reviewed immutable bytes"
  fi
done
if [ -x /usr/local/lib/leaddrive-v2/ops/current/backup/ship-logs.sh ] \
  && [ ! -L /usr/local/lib/leaddrive-v2/ops/current/backup/ship-logs.sh ] \
  && [ -x /opt/leaddrive-v2/.next/standalone/scripts/backup/ship-logs.sh ] \
  && [ ! -L /opt/leaddrive-v2/.next/standalone/scripts/backup/ship-logs.sh ] \
  && cmp -s -- /usr/local/lib/leaddrive-v2/ops/current/backup/ship-logs.sh \
    /opt/leaddrive-v2/.next/standalone/scripts/backup/ship-logs.sh; then
  pass "log shipping program matches the running immutable artifact"
else
  fail "log shipping program is missing or differs from the running immutable artifact"
fi

runtime_source_ready=1
for runtime_path in /var/lib/leaddrive-v2 /var/lib/leaddrive-v2/uploads /var/lib/leaddrive-v2/help-videos; do
  if [ ! -d "$runtime_path" ] || [ -L "$runtime_path" ] \
    || [ "$(realpath -e -- "$runtime_path" 2>/dev/null || true)" != "$runtime_path" ]; then
    runtime_source_ready=0
  fi
done
if [ "$runtime_source_ready" -eq 1 ]; then
  pass "authoritative runtime-file roots are fixed, present and non-symlinked"
else
  fail "authoritative runtime-file roots are missing, symlinked or non-canonical"
fi
if [ -d /run/leaddrive-runtime-files-snapshot ] \
  && [ ! -L /run/leaddrive-runtime-files-snapshot ] \
  && [ "$(findmnt -n -o FSTYPE --target /run/leaddrive-runtime-files-snapshot 2>/dev/null || true)" = tmpfs ]; then
  pass "runtime-file plaintext inventory workspace is on tmpfs"
else
  fail "runtime-file plaintext inventory workspace is absent, symlinked or not tmpfs"
fi
info "runtime-file archive is host-loss coverage only; application-consistent enterprise media DR requires immutable object keys plus tombstone reconciliation or a coordinated write/COW snapshot boundary"

# The full certificate deliberately carries the independent, limited
# bootstrap certificate that authorized the first immutable log object.  Do
# not treat its digest as a label: re-open the preserved marker, its candidate
# and its signature with the same allowlist before accepting the full chain.
check_bootstrap_certificate_chain() {
  local expected_recipient="$1"
  local expected_marker_sha="$2"
  local expected_marker_bytes="$3"
  local expected_candidate_sha="$4"
  local expected_evidence_sha="$5"
  local expected_signature_sha="$6"
  local expected_signers_sha="$7"
  local marker_sha marker_bytes marker_candidate marker_evidence marker_signature marker_signers
  local operator evidence_ref evidence_at evidence_dir evidence_file signature_file candidate_file
  local candidate_digest candidate_matches=0 file

  for digest in "$expected_marker_sha" "$expected_candidate_sha" "$expected_evidence_sha" \
    "$expected_signature_sha" "$expected_signers_sha"; do
    if ! [[ "$digest" =~ ^[0-9a-f]{64}$ ]]; then
      fail "full recovery certificate has an invalid bootstrap-chain digest"
      return 1
    fi
  done
  if ! [[ "$expected_marker_bytes" =~ ^[1-9][0-9]*$ ]] || [ "$expected_marker_bytes" -gt 65536 ]; then
    fail "full recovery certificate has an invalid bootstrap-marker size"
    return 1
  fi
  if [ ! -f "$BOOTSTRAP_RESTORE_MARKER" ] || [ -L "$BOOTSTRAP_RESTORE_MARKER" ] \
    || [ "$(stat -c '%U:%G:%a' "$BOOTSTRAP_RESTORE_MARKER" 2>/dev/null || true)" != "root:root:600" ]; then
    fail "limited bootstrap restore marker is missing or unsafe"
    return 1
  fi
  if grep -q '^LOG_GENESIS_' "$BOOTSTRAP_RESTORE_MARKER"; then
    fail "limited bootstrap restore marker must not claim a log-genesis proof"
    return 1
  fi
  marker_sha="$(sha256sum "$BOOTSTRAP_RESTORE_MARKER" | awk '{print $1}')"
  marker_bytes="$(stat -c '%s' "$BOOTSTRAP_RESTORE_MARKER")"
  marker_candidate="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" CANDIDATE_SHA256 2>/dev/null || true)"
  marker_evidence="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" SIGNED_EVIDENCE_SHA256 2>/dev/null || true)"
  marker_signature="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" SIGNED_SIGNATURE_SHA256 2>/dev/null || true)"
  marker_signers="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" ALLOWED_SIGNERS_SHA256 2>/dev/null || true)"
  operator="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" OFFLINE_OPERATOR 2>/dev/null || true)"
  evidence_ref="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" EVIDENCE_REF 2>/dev/null || true)"
  evidence_at="$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" EVIDENCE_AT_UTC 2>/dev/null || true)"
  if [ "$marker_sha" != "$expected_marker_sha" ] || [ "$marker_bytes" != "$expected_marker_bytes" ] \
    || [ "$marker_candidate" != "$expected_candidate_sha" ] \
    || [ "$marker_evidence" != "$expected_evidence_sha" ] \
    || [ "$marker_signature" != "$expected_signature_sha" ] \
    || [ "$marker_signers" != "$expected_signers_sha" ] \
    || [ "$(sha256sum "$ALLOWED_SIGNERS" | awk '{print $1}')" != "$expected_signers_sha" ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" FORMAT_VERSION 2>/dev/null || true)" != 1 ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" EVIDENCE_TYPE 2>/dev/null || true)" != archive-restore ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" STATUS 2>/dev/null || true)" != verified ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" RECOVERY_SCOPE 2>/dev/null || true)" != log-genesis-bootstrap-only ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" RECIPIENT_SHA256 2>/dev/null || true)" != "$expected_recipient" ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" DECRYPT_STATUS 2>/dev/null || true)" != passed ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" INTERNAL_CHECKSUM_STATUS 2>/dev/null || true)" != passed ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" SCRATCH_RESTORE_STATUS 2>/dev/null || true)" != passed ] \
    || [ "$(read_static_env_value "$BOOTSTRAP_RESTORE_MARKER" TENANT_CANARY_STATUS 2>/dev/null || true)" != passed ]; then
    fail "limited bootstrap marker does not match the full recovery certificate"
    return 1
  fi

  if [ ! -d "$CANDIDATE_DIR" ] || [ -L "$CANDIDATE_DIR" ] \
    || [ "$(stat -c '%U:%G:%a' "$CANDIDATE_DIR" 2>/dev/null || true)" != "root:root:700" ]; then
    fail "bootstrap candidate directory is missing or unsafe"
    return 1
  fi
  for file in "$CANDIDATE_DIR"/*.env; do
    [ -f "$file" ] && [ ! -L "$file" ] || continue
    candidate_digest="$(sha256sum "$file" | awk '{print $1}')"
    if [ "$candidate_digest" = "$expected_candidate_sha" ]; then
      candidate_file="$file"
      candidate_matches=$((candidate_matches + 1))
    fi
  done
  if [ "$candidate_matches" -ne 1 ] \
    || [ "$(stat -c '%U:%G:%a' "$candidate_file" 2>/dev/null || true)" != "root:root:600" ] \
    || [ "$(read_static_env_value "$candidate_file" FORMAT_VERSION 2>/dev/null || true)" != 2 ] \
    || [ "$(read_static_env_value "$candidate_file" RECOVERY_SCOPE 2>/dev/null || true)" != log-genesis-bootstrap-only ] \
    || [ "$(read_static_env_value "$candidate_file" STATUS 2>/dev/null || true)" != awaiting_offline_restore ] \
    || [ "$(read_static_env_value "$candidate_file" RECIPIENT_SHA256 2>/dev/null || true)" != "$expected_recipient" ]; then
    fail "limited bootstrap candidate is absent, unsafe, or not independently scoped"
    return 1
  fi

  evidence_dir="$SIGNED_DIR/$expected_evidence_sha"
  evidence_file="$evidence_dir/evidence.env"
  signature_file="$evidence_dir/evidence.env.sig"
  if [ ! -d "$evidence_dir" ] || [ -L "$evidence_dir" ] \
    || [ "$(stat -c '%U:%G:%a' "$evidence_dir" 2>/dev/null || true)" != "root:root:700" ] \
    || [ ! -f "$evidence_file" ] || [ -L "$evidence_file" ] \
    || [ "$(stat -c '%U:%G:%a' "$evidence_file" 2>/dev/null || true)" != "root:root:600" ] \
    || [ ! -f "$signature_file" ] || [ -L "$signature_file" ] \
    || [ "$(stat -c '%U:%G:%a' "$signature_file" 2>/dev/null || true)" != "root:root:600" ] \
    || [ "$(sha256sum "$evidence_file" | awk '{print $1}')" != "$expected_evidence_sha" ] \
    || [ "$(sha256sum "$signature_file" | awk '{print $1}')" != "$expected_signature_sha" ] \
    || ! [[ "$operator" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]]; then
    fail "limited bootstrap signed evidence is missing, unsafe, or unbound"
    return 1
  fi
  if ! ssh-keygen -Y verify -f "$ALLOWED_SIGNERS" -I "$operator" \
    -n leaddrive-backup-evidence -s "$signature_file" <"$evidence_file" >/dev/null 2>&1 \
    || [ "$(read_static_env_value "$evidence_file" FORMAT_VERSION 2>/dev/null || true)" != 1 ] \
    || [ "$(read_static_env_value "$evidence_file" EVIDENCE_TYPE 2>/dev/null || true)" != archive-restore ] \
    || [ "$(read_static_env_value "$evidence_file" STATUS 2>/dev/null || true)" != verified ] \
    || [ "$(read_static_env_value "$evidence_file" RECOVERY_SCOPE 2>/dev/null || true)" != log-genesis-bootstrap-only ] \
    || [ "$(read_static_env_value "$evidence_file" CANDIDATE_SHA256 2>/dev/null || true)" != "$expected_candidate_sha" ] \
    || [ "$(read_static_env_value "$evidence_file" RECIPIENT_SHA256 2>/dev/null || true)" != "$expected_recipient" ] \
    || [ "$(read_static_env_value "$evidence_file" EVIDENCE_REF 2>/dev/null || true)" != "$evidence_ref" ] \
    || [ "$(read_static_env_value "$evidence_file" OFFLINE_OPERATOR 2>/dev/null || true)" != "$operator" ] \
    || [ "$(read_static_env_value "$evidence_file" VERIFIED_AT_UTC 2>/dev/null || true)" != "$evidence_at" ]; then
    fail "limited bootstrap signature does not independently prove the referenced candidate"
    return 1
  fi
  pass "limited bootstrap certificate is preserved and independently bound to the full recovery chain"
}

check_signed_evidence_marker() {
  local marker="$1"
  local expected_type="$2"
  local evidence_sha signature_sha signers_sha operator evidence_dir evidence_file signature_file
  local signer_count integration_status evidence_ref evidence_at reviewed_sha workflow_sha recipient_sha
  local expected_evidence_format=1 marker_scope
  local candidate_sha candidate_file candidate_digest candidate_matches=0 file candidate_created candidate_epoch
  local database_ciphertext secrets_ciphertext runtime_files_ciphertext candidate_bucket database_key secrets_key runtime_files_key
  local database_version secrets_version runtime_files_version database_bytes secrets_bytes runtime_files_bytes
  local database_invocation secrets_invocation runtime_files_invocation
  local source_identity_sha source_migration_ledger_sha recovery_db_contract_sha
  local code_bundle_sha recovery_program_set_sha
  local artifact_program_set_sha artifact_program_set_helper current_program_set_record
  local artifact_db_contract_helper artifact_db_contract_manifest artifact_db_contract_sha
  local computed_db_contract_sha current_db_contract_manifest current_db_contract_record
  local evidence_epoch evidence_now_epoch evidence_maximum_age
  local app_env_sha backup_env_sha migration_env_sha
  local database_tier runtime_files_tier database_retention_days secrets_retention_days runtime_files_retention_days
  local database_retain_until secrets_retain_until runtime_files_retain_until
  local database_retain_epoch secrets_retain_epoch runtime_files_retain_epoch
  local retention_state retention_mode retention_until retention_epoch head_state remote_bytes remote_sha
  local label key version expected_bytes expected_sha expected_retain_until expected_retain_epoch retention_days
  local remote_database_retain_epoch="" remote_secrets_retain_epoch=""
  local remote_runtime_files_retain_epoch="" remote_log_retain_epoch=""
  local runtime_files_inventory runtime_files_count catalog_field
  local recovery_catalog_key recovery_catalog_version recovery_catalog_sha recovery_catalog_bytes
  local recovery_catalog_created_at recovery_catalog_created_epoch recovery_catalog_retain_until
  local recovery_catalog_retention_days
  local recovery_catalog_retain_epoch recovery_catalog_head recovery_catalog_remote_bytes
  local recovery_catalog_remote_sha recovery_catalog_remote_candidate recovery_catalog_remote_evidence
  local recovery_catalog_remote_signature recovery_catalog_remote_signers recovery_catalog_retention
  local recovery_catalog_mode recovery_catalog_remote_until recovery_catalog_remote_epoch
  local recovery_catalog_tmp recovery_catalog_get_status recovery_catalog_entries
  local log_key log_version log_bytes log_ciphertext log_retain_until log_created_at
  local log_anchor_sha log_anchor_bytes log_anchor_file_sha log_anchor_file_bytes
  local log_created_epoch log_retain_epoch recovery_payload_retain_until recovery_payload_retain_epoch
  local bootstrap_certificate_format bootstrap_certificate_sha bootstrap_certificate_bytes
  local bootstrap_certificate_candidate_sha bootstrap_certificate_evidence_sha
  local bootstrap_certificate_signature_sha bootstrap_certificate_signers_sha
  local recovery_catalog_remote_format recovery_catalog_remote_genesis
  local recovery_catalog_remote_bootstrap recovery_catalog_remote_bootstrap_evidence
  local recovery_catalog_remote_bootstrap_signature payload_created_epoch
  [ -d "$EVIDENCE_ROOT" ] && [ ! -L "$EVIDENCE_ROOT" ] \
    && [ "$(stat -c '%U:%G:%a' "$EVIDENCE_ROOT" 2>/dev/null || true)" = "root:root:700" ] || {
      fail "backup evidence root is missing or not root:root 0700"
      return 0
    }
  [ -f "$marker" ] && [ ! -L "$marker" ] \
    && [ "$(stat -c '%U:%G:%a' "$marker" 2>/dev/null || true)" = "root:root:600" ] || {
      fail "$expected_type marker is missing or not root:root 0600"
      return 0
    }
  [ -f "$ALLOWED_SIGNERS" ] && [ ! -L "$ALLOWED_SIGNERS" ] \
    && [ "$(stat -c '%U:%G:%a' "$ALLOWED_SIGNERS" 2>/dev/null || true)" = "root:root:600" ] || {
      fail "offline verifier allowlist is missing or not root:root 0600"
      return 0
    }
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    {
      key=$0
      sub(/=.*/, "", key)
      if (seen[key]++) bad=1
    }
    END { if (NR < 1 || bad) exit 1 }
  ' "$marker" || {
    fail "$expected_type marker is malformed or contains duplicate keys"
    return 0
  }
  if [ "$expected_type" = archive-restore ]; then
    marker_scope="$(read_static_env_value "$marker" RECOVERY_SCOPE 2>/dev/null || true)"
    if [ "$marker_scope" != full-recovery ]; then
      fail "archive recovery marker is not the full-recovery certificate"
      return 0
    fi
    expected_evidence_format=2
  fi
  awk '
    NF != 3 || $1 !~ /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/ \
      || $2 != "ssh-ed25519" || $3 !~ /^AAAA[A-Za-z0-9+\/=]+$/ { bad=1 }
    END { if (NR < 1 || bad) exit 1 }
  ' "$ALLOWED_SIGNERS" || {
    fail "offline verifier allowlist has an unsupported record"
    return 0
  }
  evidence_sha="$(read_static_env_value "$marker" SIGNED_EVIDENCE_SHA256)" || {
    fail "$expected_type marker contains duplicate evidence digest"
    return 0
  }
  signature_sha="$(read_static_env_value "$marker" SIGNED_SIGNATURE_SHA256)" || {
    fail "$expected_type marker contains duplicate signature digest"
    return 0
  }
  signers_sha="$(read_static_env_value "$marker" ALLOWED_SIGNERS_SHA256)" || {
    fail "$expected_type marker contains duplicate signer digest"
    return 0
  }
  operator="$(read_static_env_value "$marker" OFFLINE_OPERATOR)" || {
    fail "$expected_type marker contains duplicate operator"
    return 0
  }
  evidence_ref="$(read_static_env_value "$marker" EVIDENCE_REF)"
  evidence_at="$(read_static_env_value "$marker" EVIDENCE_AT_UTC)"
  reviewed_sha="$(read_static_env_value "$marker" REVIEWED_MAIN_SHA)"
  workflow_sha="$(read_static_env_value "$marker" WORKFLOW_SHA)"
  recipient_sha="$(read_static_env_value "$marker" RECIPIENT_SHA256)"
  [[ "$evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signature_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signers_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$operator" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
    && [[ "$evidence_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]] \
    && [[ "$evidence_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [[ "$reviewed_sha" =~ ^[0-9a-f]{40}$ ]] \
    && [ "$workflow_sha" = "$reviewed_sha" ] \
    && [[ "$recipient_sha" =~ ^[0-9a-f]{64}$ ]] || {
      fail "$expected_type marker has invalid signed-evidence references"
      return 0
    }
  evidence_epoch="$(date -u -d "$evidence_at" '+%s' 2>/dev/null || true)"
  evidence_now_epoch="$(date -u '+%s')"
  case "$expected_type" in
    archive-restore) evidence_maximum_age=3024000 ;;
    age-key-custody) evidence_maximum_age=7776000 ;;
    *)
      fail "unsupported signed recovery evidence type"
      return 0
      ;;
  esac
  if [[ "$evidence_epoch" =~ ^[0-9]+$ ]] \
    && [ "$evidence_epoch" -le $((evidence_now_epoch + 300)) ] \
    && [ "$evidence_epoch" -ge $((evidence_now_epoch - evidence_maximum_age)) ]; then
    pass "$expected_type evidence is within its reviewed freshness window"
  else
    fail "$expected_type evidence is stale or future-dated"
    return 0
  fi
  [ "$(sha256sum "$ALLOWED_SIGNERS" | awk '{print $1}')" = "$signers_sha" ] || {
    fail "offline verifier allowlist drifted after $expected_type commissioning"
    return 0
  }
  signer_count="$(awk -v principal="$operator" '$1 == principal && $2 == "ssh-ed25519" { count++ } END { print count+0 }' \
    "$ALLOWED_SIGNERS")"
  [ "$signer_count" = "1" ] || {
    fail "$expected_type operator has no unique trusted Ed25519 signer"
    return 0
  }
  evidence_dir="$SIGNED_DIR/$evidence_sha"
  evidence_file="$evidence_dir/evidence.env"
  signature_file="$evidence_dir/evidence.env.sig"
  [ -d "$evidence_dir" ] && [ ! -L "$evidence_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$evidence_dir" 2>/dev/null || true)" = "root:root:700" ] \
    && [ -f "$evidence_file" ] && [ ! -L "$evidence_file" ] \
    && [ "$(stat -c '%U:%G:%a' "$evidence_file" 2>/dev/null || true)" = "root:root:600" ] \
    && [ -f "$signature_file" ] && [ ! -L "$signature_file" ] \
    && [ "$(stat -c '%U:%G:%a' "$signature_file" 2>/dev/null || true)" = "root:root:600" ] \
    && [ "$(sha256sum "$evidence_file" | awk '{print $1}')" = "$evidence_sha" ] \
    && [ "$(sha256sum "$signature_file" | awk '{print $1}')" = "$signature_sha" ] || {
      fail "$expected_type preserved evidence bytes or permissions are invalid"
      return 0
    }
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    {
      key=$0
      sub(/=.*/, "", key)
      if (seen[key]++) bad=1
    }
    END { if (NR < 1 || bad) exit 1 }
  ' "$evidence_file" || {
    fail "$expected_type signed evidence is malformed or contains duplicate keys"
    return 0
  }
  ssh-keygen -Y verify -f "$ALLOWED_SIGNERS" -I "$operator" \
    -n leaddrive-backup-evidence -s "$signature_file" <"$evidence_file" >/dev/null 2>&1 || {
      fail "$expected_type preserved evidence signature is invalid"
      return 0
    }
  [ "$(read_static_env_value "$marker" EVIDENCE_TYPE)" = "$expected_type" ] \
    && [ "$(read_static_env_value "$marker" STATUS)" = "verified" ] \
    && [ "$(read_static_env_value "$evidence_file" FORMAT_VERSION)" = "$expected_evidence_format" ] \
    && [ "$(read_static_env_value "$evidence_file" EVIDENCE_TYPE)" = "$expected_type" ] \
    && [ "$(read_static_env_value "$evidence_file" STATUS)" = "verified" ] \
    && [ "$(read_static_env_value "$evidence_file" RECIPIENT_SHA256)" = "$recipient_sha" ] \
    && [ "$(read_static_env_value "$evidence_file" EVIDENCE_REF)" = "$evidence_ref" ] \
    && [ "$(read_static_env_value "$evidence_file" OFFLINE_OPERATOR)" = "$operator" ] \
    && [ "$(read_static_env_value "$evidence_file" VERIFIED_AT_UTC)" = "$evidence_at" ] \
    && [ "$(read_static_env_value "$evidence_file" REVIEWED_MAIN_SHA)" = "$reviewed_sha" ] || {
      fail "$expected_type signed evidence does not match its marker"
      return 0
    }
  case "$expected_type" in
    age-key-custody)
      [ "$(read_static_env_value "$marker" FORMAT_VERSION)" = "1" ] \
        && [ "$(read_static_env_value "$marker" COPY_COUNT_MINIMUM)" = "2" ] \
        && [ "$(read_static_env_value "$marker" INDEPENDENT_DECRYPT_TEST)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" COPY_FILESYSTEM_DEVICE_STATUS)" = "distinct" ] \
        && [ "$(read_static_env_value "$marker" COPY_FAILURE_DOMAIN_ATTESTATION)" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_COUNT_MINIMUM)" = "2" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_ONE_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_TWO_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_FILE_IDENTITY_STATUS)" = "distinct" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_FILESYSTEM_DEVICE_STATUS)" = "distinct" ] \
        && [ "$(read_static_env_value "$evidence_file" COPY_FAILURE_DOMAIN_ATTESTATION)" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
        && [ "$(read_static_env_value "$evidence_file" CUSTODY_VERIFIER_SHA256)" = "$CUSTODY_VERIFIER_SHA256" ] || {
          fail "signed age custody evidence does not prove two decrypting copies"
          return 0
        }
      ;;
    archive-restore)
      integration_status="$(read_static_env_value "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)"
      database_ciphertext="$(read_static_env_value "$marker" DATABASE_CIPHERTEXT_SHA256)"
      secrets_ciphertext="$(read_static_env_value "$marker" SECRETS_CIPHERTEXT_SHA256)"
      runtime_files_ciphertext="$(read_static_env_value "$marker" RUNTIME_FILES_CIPHERTEXT_SHA256)"
      candidate_sha="$(read_static_env_value "$marker" CANDIDATE_SHA256)"
      app_env_sha="$(read_static_env_value "$marker" SOURCE_APP_ENV_SHA256)"
      backup_env_sha="$(read_static_env_value "$marker" SOURCE_BACKUP_ENV_SHA256)"
      migration_env_sha="$(read_static_env_value "$marker" SOURCE_MIGRATION_ENV_SHA256)"
      source_migration_ledger_sha="$(read_static_env_value "$marker" SOURCE_MIGRATION_LEDGER_SHA256)"
      recovery_db_contract_sha="$(read_static_env_value "$marker" RECOVERY_DB_CONTRACT_SHA256)"
      [[ "$database_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$secrets_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$runtime_files_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$app_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$backup_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$migration_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$source_migration_ledger_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$(read_static_env_value "$marker" FORMAT_VERSION)" = "4" ] \
        && [ "$(read_static_env_value "$marker" RECOVERY_SCOPE)" = "full-recovery" ] \
        && [ "$(read_static_env_value "$evidence_file" RECOVERY_SCOPE)" = "full-recovery" ] \
        && [ "$(read_static_env_value "$marker" DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" INTERNAL_CHECKSUM_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" SCRATCH_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" TENANT_CANARY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
        && [ "$(read_static_env_value "$marker" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" RLS_FORCE_RLS_CATALOG_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" FULL_AUTHORITY_RESTORE_STATUS)" = "not_tested" ] \
        && [[ "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$(read_static_env_value "$marker" PII_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" CANDIDATE_SHA256)" = "$candidate_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" DATABASE_CIPHERTEXT_SHA256)" = "$database_ciphertext" ] \
        && [ "$(read_static_env_value "$evidence_file" SECRETS_CIPHERTEXT_SHA256)" = "$secrets_ciphertext" ] \
        && [ "$(read_static_env_value "$evidence_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$runtime_files_ciphertext" ] \
        && [ "$(read_static_env_value "$evidence_file" DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" INTERNAL_CHECKSUM_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" SCRATCH_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" TENANT_CANARY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
        && [ "$(read_static_env_value "$evidence_file" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" RLS_FORCE_RLS_CATALOG_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" FULL_AUTHORITY_RESTORE_STATUS)" = "not_tested" ] \
        && [ "$(read_static_env_value "$evidence_file" DATABASE_AUTHORITY_CATALOG_SHA256)" = "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_SHA256)" ] \
        && [ "$(read_static_env_value "$evidence_file" PII_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$evidence_file" DATABASE_STORAGE_ATTESTATION)" = "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED" ] \
        && [ "$(read_static_env_value "$evidence_file" ARCHIVE_VERIFIER_SHA256)" = "$ARCHIVE_VERIFIER_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" RESTORE_CANARY_SHA256)" = "$RESTORE_CANARY_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" PII_PROOF_SHA256)" = "$PII_PROOF_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" CANARY_SQL_SHA256)" = "$CANARY_SQL_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_MIGRATION_LEDGER_SHA256)" = "$source_migration_ledger_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" RECOVERY_DB_CONTRACT_SHA256)" = "$recovery_db_contract_sha" ] \
        && { [ "$integration_status" = "passed" ] || [ "$integration_status" = "not_applicable_no_persisted_ciphertext" ]; } || {
          fail "signed DB, secrets, PII and runtime-files recovery evidence is incomplete"
          return 0
        }

      [ -d "$CANDIDATE_DIR" ] && [ ! -L "$CANDIDATE_DIR" ] \
        && [ "$(stat -c '%U:%G:%a' "$CANDIDATE_DIR" 2>/dev/null || true)" = "root:root:700" ] || {
          fail "backup candidate directory is missing or unsafe"
          return 0
        }
      for file in "$CANDIDATE_DIR"/*.env; do
        [ -f "$file" ] && [ ! -L "$file" ] || continue
        candidate_digest="$(sha256sum "$file" | awk '{print $1}')"
        [ "$candidate_digest" = "$candidate_sha" ] || continue
        candidate_file="$file"
        candidate_matches=$((candidate_matches + 1))
      done
      [ "$candidate_matches" -eq 1 ] \
        && [ "$(stat -c '%U:%G:%a' "$candidate_file" 2>/dev/null || true)" = "root:root:600" ] || {
          fail "archive marker does not identify one safe preserved candidate"
          return 0
        }
      awk '
        !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
        { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
        END { if (NR < 1 || bad) exit 1 }
      ' "$candidate_file" || {
        fail "preserved backup candidate is malformed"
        return 0
      }
      candidate_bucket="$(read_static_env_value "$candidate_file" OBJECT_BUCKET)"
      database_key="$(read_static_env_value "$candidate_file" DATABASE_OBJECT_KEY)"
      secrets_key="$(read_static_env_value "$candidate_file" SECRETS_OBJECT_KEY)"
      runtime_files_key="$(read_static_env_value "$candidate_file" RUNTIME_FILES_OBJECT_KEY)"
      database_version="$(read_static_env_value "$candidate_file" DATABASE_OBJECT_VERSION_ID)"
      secrets_version="$(read_static_env_value "$candidate_file" SECRETS_OBJECT_VERSION_ID)"
      runtime_files_version="$(read_static_env_value "$candidate_file" RUNTIME_FILES_OBJECT_VERSION_ID)"
      database_bytes="$(read_static_env_value "$candidate_file" DATABASE_CIPHERTEXT_BYTES)"
      secrets_bytes="$(read_static_env_value "$candidate_file" SECRETS_CIPHERTEXT_BYTES)"
      runtime_files_bytes="$(read_static_env_value "$candidate_file" RUNTIME_FILES_CIPHERTEXT_BYTES)"
      database_invocation="$(read_static_env_value "$candidate_file" DATABASE_SYSTEMD_INVOCATION_ID)"
      secrets_invocation="$(read_static_env_value "$candidate_file" SECRETS_SYSTEMD_INVOCATION_ID)"
      runtime_files_invocation="$(read_static_env_value "$candidate_file" RUNTIME_FILES_SYSTEMD_INVOCATION_ID)"
      source_identity_sha="$(read_static_env_value "$candidate_file" SOURCE_DATABASE_IDENTITY_SHA256)"
      source_migration_ledger_sha="$(read_static_env_value "$candidate_file" SOURCE_MIGRATION_LEDGER_SHA256)"
      recovery_db_contract_sha="$(read_static_env_value "$candidate_file" RECOVERY_DB_CONTRACT_SHA256)"
      code_bundle_sha="$(read_static_env_value "$candidate_file" COMMISSION_CODE_BUNDLE_SHA256)"
      recovery_program_set_sha="$(read_static_env_value "$candidate_file" RECOVERY_PROGRAM_SET_SHA256)"
      database_tier="$(read_static_env_value "$candidate_file" DATABASE_RETENTION_TIER)"
      runtime_files_tier="$(read_static_env_value "$candidate_file" RUNTIME_FILES_RETENTION_TIER)"
      database_retention_days="$(read_static_env_value "$candidate_file" DATABASE_RETENTION_DAYS)"
      secrets_retention_days="$(read_static_env_value "$candidate_file" SECRETS_RETENTION_DAYS)"
      runtime_files_retention_days="$(read_static_env_value "$candidate_file" RUNTIME_FILES_RETENTION_DAYS)"
      database_retain_until="$(read_static_env_value "$candidate_file" DATABASE_RETAIN_UNTIL)"
      secrets_retain_until="$(read_static_env_value "$candidate_file" SECRETS_RETAIN_UNTIL)"
      runtime_files_retain_until="$(read_static_env_value "$candidate_file" RUNTIME_FILES_RETAIN_UNTIL)"
      runtime_files_inventory="$(read_static_env_value "$candidate_file" RUNTIME_FILES_INVENTORY_SHA256)"
      runtime_files_count="$(read_static_env_value "$candidate_file" RUNTIME_FILES_FILE_COUNT)"
      candidate_created="$(read_static_env_value "$candidate_file" CREATED_AT_UTC)"
      candidate_epoch="$(date -u -d "$candidate_created" '+%s' 2>/dev/null || true)"
      database_retain_epoch="$(date -u -d "$database_retain_until" '+%s' 2>/dev/null || true)"
      secrets_retain_epoch="$(date -u -d "$secrets_retain_until" '+%s' 2>/dev/null || true)"
      runtime_files_retain_epoch="$(date -u -d "$runtime_files_retain_until" '+%s' 2>/dev/null || true)"
      [ "$(read_static_env_value "$candidate_file" FORMAT_VERSION)" = "3" ] \
        && [ "$(read_static_env_value "$candidate_file" RECOVERY_SCOPE)" = "full-recovery" ] \
        && [ "$(read_static_env_value "$candidate_file" STATUS)" = "awaiting_offline_restore" ] \
        && [ "$(read_static_env_value "$candidate_file" RECIPIENT_SHA256)" = "$recipient_sha" ] \
        && [ "$(read_static_env_value "$candidate_file" WORKFLOW_SHA)" = "$reviewed_sha" ] \
        && [ "$candidate_bucket" = "${CONFIG[BACKUP_S3_BUCKET]:-}" ] \
        && [[ "$database_key" =~ ^[A-Za-z0-9._/-]+\.tar\.age$ ]] \
        && [[ "$secrets_key" =~ ^[A-Za-z0-9._/-]+\.tar\.age$ ]] \
        && [[ "$runtime_files_key" =~ ^runtime-files/monthly/[A-Za-z0-9._/-]+\.tar\.age$ ]] \
        && [[ "$database_version" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
        && [[ "$secrets_version" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
        && [[ "$runtime_files_version" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
        && [[ "$database_bytes" =~ ^[0-9]+$ ]] && [ "$database_bytes" -gt 1048576 ] \
        && [[ "$secrets_bytes" =~ ^[0-9]+$ ]] && [ "$secrets_bytes" -gt 1024 ] \
        && [[ "$runtime_files_bytes" =~ ^[0-9]+$ ]] && [ "$runtime_files_bytes" -gt 1024 ] \
        && [[ "$database_invocation" =~ ^[0-9a-f]{32}$ ]] \
        && [[ "$secrets_invocation" =~ ^[0-9a-f]{32}$ ]] \
        && [[ "$runtime_files_invocation" =~ ^[0-9a-f]{32}$ ]] \
        && [[ "$source_identity_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$source_migration_ledger_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$code_bundle_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$recovery_program_set_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$database_tier" = "monthly" ] \
        && [ "$runtime_files_tier" = "monthly" ] \
        && [[ "$database_retention_days" =~ ^[0-9]+$ ]] \
        && [ "$database_retention_days" -ge "${CONFIG[BACKUP_RETENTION_MONTHLY_DAYS]:-400}" ] \
        && [[ "$secrets_retention_days" =~ ^[0-9]+$ ]] \
        && [ "$secrets_retention_days" -ge "${CONFIG[SECRETS_RETENTION_DAYS]:-400}" ] \
        && [[ "$runtime_files_retention_days" =~ ^[0-9]+$ ]] \
        && [ "$runtime_files_retention_days" -ge "${CONFIG[BACKUP_RETENTION_MONTHLY_DAYS]:-400}" ] \
        && [[ "$runtime_files_inventory" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$runtime_files_count" =~ ^[0-9]+$ ]] \
        && [[ "$candidate_epoch" =~ ^[0-9]+$ ]] \
        && [ "$candidate_epoch" -le "$evidence_epoch" ] \
        && [ "$candidate_epoch" -ge $((evidence_now_epoch - 3024000)) ] \
        && [[ "$database_retain_epoch" =~ ^[0-9]+$ ]] \
        && [[ "$secrets_retain_epoch" =~ ^[0-9]+$ ]] \
        && [[ "$runtime_files_retain_epoch" =~ ^[0-9]+$ ]] \
        && [ "$database_retain_epoch" -ge $((candidate_epoch + database_retention_days * 86400 - 300)) ] \
        && [ "$secrets_retain_epoch" -ge $((candidate_epoch + secrets_retention_days * 86400 - 300)) ] \
        && [ "$runtime_files_retain_epoch" -ge $((candidate_epoch + runtime_files_retention_days * 86400 - 300)) ] \
        && [ "$database_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$secrets_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$runtime_files_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$(read_static_env_value "$candidate_file" DATABASE_CIPHERTEXT_SHA256)" = "$database_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" SECRETS_CIPHERTEXT_SHA256)" = "$secrets_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$runtime_files_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" SECRETS_FILE_COUNT)" = "3" ] \
        && [ "$(read_static_env_value "$candidate_file" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
        && [ "$(read_static_env_value "$candidate_file" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
        && [ "$(read_static_env_value "$candidate_file" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
        && [ "$(read_static_env_value "$candidate_file" POSTGRES_BACKUP_SHA256)" = "$POSTGRES_BACKUP_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" POSTGRES_RESTORE_CANARY_SHA256)" = "$RESTORE_CANARY_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" CANARY_SQL_SHA256)" = "$CANARY_SQL_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" SECRETS_SNAPSHOT_SHA256)" = "$SECRETS_SNAPSHOT_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_SNAPSHOT_SHA256)" = "$RUNTIME_FILES_SNAPSHOT_SHA256" ] \
        && [ "$(sha256sum /etc/leaddrive/app.env | awk '{print $1}')" = "$app_env_sha" ] \
        && [ "$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" = "$backup_env_sha" ] \
        && [ "$(sha256sum /etc/leaddrive/migration.env | awk '{print $1}')" = "$migration_env_sha" ] || {
          fail "preserved backup candidate is incomplete, stale, or drifted"
          return 0
        }

      log_key="$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_KEY)"
      log_version="$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_VERSION_ID)"
      log_bytes="$(read_static_env_value "$candidate_file" LOG_GENESIS_CIPHERTEXT_BYTES)"
      log_ciphertext="$(read_static_env_value "$candidate_file" LOG_GENESIS_CIPHERTEXT_SHA256)"
      log_retain_until="$(read_static_env_value "$candidate_file" LOG_GENESIS_RETAIN_UNTIL)"
      log_created_at="$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_CREATED_AT)"
      log_anchor_sha="$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_SHA256)"
      log_anchor_bytes="$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_BYTES)"
      bootstrap_certificate_format="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)"
      bootstrap_certificate_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)"
      bootstrap_certificate_bytes="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)"
      bootstrap_certificate_candidate_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)"
      bootstrap_certificate_evidence_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)"
      bootstrap_certificate_signature_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)"
      bootstrap_certificate_signers_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)"
      log_created_epoch="$(date -u -d "$log_created_at" '+%s' 2>/dev/null || true)"
      log_retain_epoch="$(date -u -d "$log_retain_until" '+%s' 2>/dev/null || true)"
      if ! [[ "$log_key" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[A-Za-z0-9._-]+[.]tar[.]gz[.]age$ ]] \
        || ! [[ "$log_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
        || [ "$log_version" = None ] || [ "$log_version" = null ] \
        || ! [[ "$log_bytes" =~ ^[1-9][0-9]*$ ]] \
        || ! [[ "$log_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$log_anchor_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$log_anchor_bytes" =~ ^[1-9][0-9]*$ ]] \
        || [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_FORMAT_VERSION)" != 1 ] \
        || [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_STATUS)" != COMMITTED ] \
        || [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_EVIDENCE_BOOTSTRAP)" != 1 ] \
        || [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_FORMAT_VERSION)" != 4 ] \
        || [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" != "$recovery_program_set_sha" ] \
        || [ "$bootstrap_certificate_format" != 1 ] \
        || ! [[ "$bootstrap_certificate_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$bootstrap_certificate_bytes" =~ ^[1-9][0-9]*$ ]] \
        || [ "$bootstrap_certificate_bytes" -gt 65536 ] \
        || ! [[ "$bootstrap_certificate_candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$bootstrap_certificate_evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$bootstrap_certificate_signature_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$bootstrap_certificate_signers_sha" =~ ^[0-9a-f]{64}$ ]] \
        || [ "$bootstrap_certificate_signers_sha" != "$signers_sha" ] \
        || ! [[ "$log_created_epoch" =~ ^[0-9]+$ ]] \
        || ! [[ "$log_retain_epoch" =~ ^[0-9]+$ ]] \
        || [ "$log_retain_epoch" -lt $((log_created_epoch + 400 * 86400 - 300)) ]; then
        fail "full-recovery candidate has an invalid immutable log-genesis or bootstrap-certificate authority"
        return 0
      fi
      for catalog_field in \
        LOG_GENESIS_ANCHOR_FORMAT_VERSION LOG_GENESIS_ANCHOR_STATUS \
        LOG_GENESIS_ANCHOR_SHA256 LOG_GENESIS_ANCHOR_BYTES \
        LOG_GENESIS_EVIDENCE_START_AT LOG_GENESIS_OBJECT_KEY \
        LOG_GENESIS_OBJECT_VERSION_ID LOG_GENESIS_CIPHERTEXT_SHA256 \
        LOG_GENESIS_CIPHERTEXT_BYTES LOG_GENESIS_OBJECT_FORMAT_VERSION \
        LOG_GENESIS_EVIDENCE_BOOTSTRAP LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA \
        LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256 LOG_GENESIS_RANGES_SHA256 \
        LOG_GENESIS_FILE_RANGE_COUNT LOG_GENESIS_FILE_RANGE_BYTES \
        LOG_GENESIS_JOURNAL_RANGE_COUNT LOG_GENESIS_CURSOR_SHA256 \
        LOG_GENESIS_OBJECT_CREATED_AT LOG_GENESIS_RETAIN_UNTIL \
        LOG_GENESIS_SHIP_LOGS_SHA256 \
        BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION \
        BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256 BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES \
        BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256 \
        BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256 \
        BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256 \
        BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256; do
        if [ "$(read_static_env_value "$marker" "$catalog_field")" != \
          "$(read_static_env_value "$candidate_file" "$catalog_field")" ] \
          || [ "$(read_static_env_value "$evidence_file" "$catalog_field")" != \
            "$(read_static_env_value "$candidate_file" "$catalog_field")" ]; then
          fail "full recovery proof does not bind log-genesis field $catalog_field"
          return 0
        fi
      done
      if [ "$(read_static_env_value "$marker" LOG_GENESIS_DECRYPT_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_ARCHIVE_LAYOUT_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_INTERNAL_CHECKSUM_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_RANGES_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_CURSOR_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_ANCHOR_BINDING_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_DECRYPT_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_ARCHIVE_LAYOUT_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_INTERNAL_CHECKSUM_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_RANGES_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_CURSOR_STATUS)" != passed ] \
        || [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_ANCHOR_BINDING_STATUS)" != passed ] \
        || ! [[ "$(read_static_env_value "$marker" LOG_GENESIS_MANIFEST_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_MANIFEST_SHA256)" != \
          "$(read_static_env_value "$evidence_file" LOG_GENESIS_MANIFEST_SHA256)" ] \
        || ! [[ "$(read_static_env_value "$marker" LOG_GENESIS_SHA256SUMS_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        || [ "$(read_static_env_value "$marker" LOG_GENESIS_SHA256SUMS_SHA256)" != \
          "$(read_static_env_value "$evidence_file" LOG_GENESIS_SHA256SUMS_SHA256)" ]; then
        fail "full-recovery evidence has no complete signed log-genesis restore proof"
        return 0
      fi
      if [ ! -f "$LOG_GENESIS_ANCHOR" ] || [ -L "$LOG_GENESIS_ANCHOR" ] \
        || [ "$(stat -c '%U:%G:%a' "$LOG_GENESIS_ANCHOR" 2>/dev/null || true)" != "root:root:600" ]; then
        fail "committed root log-genesis anchor is missing or unsafe"
        return 0
      fi
      log_anchor_file_sha="$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')"
      log_anchor_file_bytes="$(stat -c '%s' "$LOG_GENESIS_ANCHOR")"
      if [ "$log_anchor_file_sha" != "$log_anchor_sha" ] \
        || [ "$log_anchor_file_bytes" != "$log_anchor_bytes" ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" FORMAT_VERSION)" != 1 ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" STATUS)" != COMMITTED ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)" != "$log_key" ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)" != "$log_version" ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_SHA256)" != "$log_ciphertext" ] \
        || [ "$(read_static_env_value "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_BYTES)" != "$log_bytes" ]; then
        fail "committed root log-genesis anchor differs from the full recovery candidate"
        return 0
      fi
      if ! check_bootstrap_certificate_chain "$recipient_sha" "$bootstrap_certificate_sha" \
        "$bootstrap_certificate_bytes" "$bootstrap_certificate_candidate_sha" \
        "$bootstrap_certificate_evidence_sha" "$bootstrap_certificate_signature_sha" \
        "$bootstrap_certificate_signers_sha"; then
        return 0
      fi

      for catalog_field in \
        OBJECT_BUCKET \
        DATABASE_OBJECT_KEY DATABASE_OBJECT_VERSION_ID DATABASE_RETAIN_UNTIL \
        SECRETS_OBJECT_KEY SECRETS_OBJECT_VERSION_ID SECRETS_RETAIN_UNTIL \
        RUNTIME_FILES_OBJECT_KEY RUNTIME_FILES_OBJECT_VERSION_ID RUNTIME_FILES_RETAIN_UNTIL \
        RUNTIME_FILES_INVENTORY_SHA256 RUNTIME_FILES_FILE_COUNT \
        SOURCE_DATABASE_IDENTITY_SHA256 COMMISSION_CODE_BUNDLE_SHA256 \
        SOURCE_MIGRATION_LEDGER_SHA256 RECOVERY_PROGRAM_SET_SHA256 \
        RECOVERY_DB_CONTRACT_SHA256; do
        if [ "$(read_static_env_value "$marker" "$catalog_field")" != \
          "$(read_static_env_value "$candidate_file" "$catalog_field")" ] \
          || [ "$(read_static_env_value "$evidence_file" "$catalog_field")" != \
            "$(read_static_env_value "$candidate_file" "$catalog_field")" ]; then
          fail "signed recovery proof does not bind candidate catalog field $catalog_field"
          return 0
        fi
      done

      artifact_program_set_helper="/opt/leaddrive-v2/.next/standalone/scripts/backup/hash-recovery-program-set.sh"
      if [ ! -x "$artifact_program_set_helper" ] || [ -L "$artifact_program_set_helper" ]; then
        fail "running artifact is missing the recovery-program set verifier"
        return 0
      fi
      artifact_program_set_sha="$(
        "$artifact_program_set_helper" /opt/leaddrive-v2/.next/standalone 2>/dev/null || true
      )"
      if [[ "$artifact_program_set_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$artifact_program_set_sha" = "$recovery_program_set_sha" ]; then
        pass "running recovery-program set matches the signed commissioned digest"
      else
        fail "running recovery-program set differs from the signed commissioned digest"
        return 0
      fi
      current_program_set_record="/usr/local/lib/leaddrive-v2/ops/current/recovery-program-set.sha256"
      if [ -f "$current_program_set_record" ] && [ ! -L "$current_program_set_record" ] \
        && [ "$(stat -c '%U:%G:%a' "$current_program_set_record" 2>/dev/null || true)" = "root:root:444" ] \
        && cmp -s -- "$current_program_set_record" <(printf '%s\n' "$artifact_program_set_sha"); then
        pass "active operations release records the running signed recovery-program digest"
      else
        fail "active operations release does not record the running signed recovery-program digest"
        return 0
      fi

      artifact_db_contract_helper="/opt/leaddrive-v2/.next/standalone/scripts/backup/hash-recovery-db-contract.sh"
      artifact_db_contract_manifest="/opt/leaddrive-v2/.next/standalone/scripts/backup/recovery-db-contract.tsv"
      if [ ! -x "$artifact_db_contract_helper" ] || [ -L "$artifact_db_contract_helper" ] \
        || [ ! -f "$artifact_db_contract_manifest" ] || [ -L "$artifact_db_contract_manifest" ]; then
        fail "running artifact is missing its recovery DB contract authority"
        return 0
      fi
      artifact_db_contract_sha="$(sha256sum "$artifact_db_contract_manifest" | awk '{print $1}')"
      computed_db_contract_sha="$(
        "$artifact_db_contract_helper" /opt/leaddrive-v2/.next/standalone 2>/dev/null || true
      )"
      if [[ "$computed_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$artifact_db_contract_sha" = "$recovery_db_contract_sha" ] \
        && [ "$computed_db_contract_sha" = "$recovery_db_contract_sha" ]; then
        pass "running Prisma schema/migration bytes match the signed recovery DB contract"
      else
        fail "running Prisma schema/migrations differ from the signed recovery DB contract"
        return 0
      fi
      current_db_contract_manifest="/usr/local/lib/leaddrive-v2/ops/current/backup/recovery-db-contract.tsv"
      current_db_contract_record="/usr/local/lib/leaddrive-v2/ops/current/recovery-db-contract.sha256"
      if [ -f "$current_db_contract_manifest" ] && [ ! -L "$current_db_contract_manifest" ] \
        && cmp -s -- "$current_db_contract_manifest" "$artifact_db_contract_manifest" \
        && [ -f "$current_db_contract_record" ] && [ ! -L "$current_db_contract_record" ] \
        && [ "$(stat -c '%U:%G:%a' "$current_db_contract_record" 2>/dev/null || true)" = root:root:444 ] \
        && cmp -s -- "$current_db_contract_record" <(printf '%s\n' "$recovery_db_contract_sha"); then
        pass "active operations release records the signed recovery DB contract"
      else
        fail "active operations release does not contain the signed recovery DB contract"
        return 0
      fi

      probe_current_backup_database_state
      if [ "$CURRENT_BACKUP_DATABASE_IDENTITY_SHA256" = "$source_identity_sha" ] \
        && [ "$CURRENT_BACKUP_MIGRATION_LEDGER_SHA256" = "$source_migration_ledger_sha" ]; then
        pass "current backup source is the independently restored database identity and migration ledger"
      else
        fail "current database identity or migration ledger differs from the signed recovery point; run a new post-migration restore drill"
        return 0
      fi

      if [ "$AWS_TOOLCHAIN_READY" -ne 1 ]; then
        fail "exact candidate object versions cannot be checked without the pinned AWS CLI"
        return 0
      fi
      for label in DATABASE SECRETS RUNTIME_FILES LOG_GENESIS; do
        case "$label" in
          DATABASE)
            key="$database_key"; version="$database_version"; expected_bytes="$database_bytes"
            expected_sha="$database_ciphertext"; retention_days="$database_retention_days"
            expected_retain_until="$database_retain_until"
            payload_created_epoch="$candidate_epoch"
            ;;
          SECRETS)
            key="$secrets_key"; version="$secrets_version"; expected_bytes="$secrets_bytes"
            expected_sha="$secrets_ciphertext"; retention_days="$secrets_retention_days"
            expected_retain_until="$secrets_retain_until"
            payload_created_epoch="$candidate_epoch"
            ;;
          RUNTIME_FILES)
            key="$runtime_files_key"; version="$runtime_files_version"; expected_bytes="$runtime_files_bytes"
            expected_sha="$runtime_files_ciphertext"; retention_days="$runtime_files_retention_days"
            expected_retain_until="$runtime_files_retain_until"
            payload_created_epoch="$candidate_epoch"
            ;;
          LOG_GENESIS)
            key="$log_key"; version="$log_version"; expected_bytes="$log_bytes"
            expected_sha="$log_ciphertext"; retention_days="${CONFIG[LOG_SHIP_RETENTION_DAYS]:-400}"
            expected_retain_until="$log_retain_until"
            payload_created_epoch="$log_created_epoch"
            ;;
        esac
        set +e
        head_state="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
          AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
          AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
          AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' AWS_CONFIG_FILE=/dev/null \
          AWS_SHARED_CREDENTIALS_FILE=/dev/null timeout 45 "$AWS_BIN" s3api head-object \
          --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" --region "${CONFIG[BACKUP_S3_REGION]}" \
          --no-cli-pager --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
          --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null)"
        head_status=$?
        retention_state="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
          AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
          AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
          AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' AWS_CONFIG_FILE=/dev/null \
          AWS_SHARED_CREDENTIALS_FILE=/dev/null timeout 45 "$AWS_BIN" s3api get-object-retention \
          --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" --region "${CONFIG[BACKUP_S3_REGION]}" \
          --no-cli-pager --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
          --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)"
        retention_status=$?
        set -e
        read -r remote_bytes remote_sha <<<"$head_state"
        read -r retention_mode retention_until <<<"$retention_state"
        retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)"
        expected_retain_epoch="$(date -u -d "$expected_retain_until" '+%s' 2>/dev/null || true)"
        if [ "$head_status" -ne 0 ] || [ "$retention_status" -ne 0 ] \
          || [ "$remote_bytes" != "$expected_bytes" ] || [ "$remote_sha" != "$expected_sha" ] \
          || [ "$retention_mode" != "COMPLIANCE" ] \
          || ! [[ "$retention_epoch" =~ ^[0-9]+$ ]] \
          || ! [[ "$expected_retain_epoch" =~ ^[0-9]+$ ]] \
          || [ "$retention_epoch" -lt "$expected_retain_epoch" ] \
          || [ "$retention_epoch" -lt $((payload_created_epoch + retention_days * 86400 - 300)) ] \
          || [ "$retention_epoch" -le "$evidence_now_epoch" ]; then
          fail "$label exact candidate version or COMPLIANCE retention is invalid"
          return 0
        fi
        # Candidate records are immutable historical statements.  Full
        # certification can legitimately extend the exact Object Lock version
        # to the catalog horizon, so keep the *currently proved remote*
        # deadline for the later catalog comparison instead of pretending the
        # original candidate timestamp changed.
        case "$label" in
          DATABASE) remote_database_retain_epoch="$retention_epoch" ;;
          SECRETS) remote_secrets_retain_epoch="$retention_epoch" ;;
          RUNTIME_FILES) remote_runtime_files_retain_epoch="$retention_epoch" ;;
          LOG_GENESIS) remote_log_retain_epoch="$retention_epoch" ;;
        esac
      done

      recovery_catalog_key="$(read_static_env_value "$marker" RECOVERY_CATALOG_OBJECT_KEY)"
      recovery_catalog_version="$(read_static_env_value "$marker" RECOVERY_CATALOG_OBJECT_VERSION_ID)"
      recovery_catalog_sha="$(read_static_env_value "$marker" RECOVERY_CATALOG_SHA256)"
      recovery_catalog_bytes="$(read_static_env_value "$marker" RECOVERY_CATALOG_BYTES)"
      recovery_catalog_created_at="$(read_static_env_value "$marker" RECOVERY_CATALOG_CREATED_AT_UTC)"
      recovery_catalog_created_epoch="$(date -u -d "$recovery_catalog_created_at" '+%s' 2>/dev/null || true)"
      recovery_catalog_retention_days="$(read_static_env_value "$marker" RECOVERY_CATALOG_RETENTION_DAYS)"
      recovery_catalog_retain_until="$(read_static_env_value "$marker" RECOVERY_CATALOG_RETAIN_UNTIL)"
      recovery_catalog_retain_epoch="$(date -u -d "$recovery_catalog_retain_until" '+%s' 2>/dev/null || true)"
      recovery_payload_retain_until="$(read_static_env_value "$marker" RECOVERY_PAYLOAD_RETAIN_UNTIL)"
      recovery_payload_retain_epoch="$(date -u -d "$recovery_payload_retain_until" '+%s' 2>/dev/null || true)"
      if ! [[ "$recovery_catalog_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
        || ! [[ "$recovery_catalog_sha" =~ ^[0-9a-f]{64}$ ]] \
        || ! [[ "$recovery_catalog_bytes" =~ ^[0-9]+$ ]] \
        || [ "$recovery_catalog_bytes" -le 0 ] \
        || [ "$(read_static_env_value "$marker" RECOVERY_CATALOG_FORMAT_VERSION)" != 3 ] \
        || [ "$recovery_catalog_key" != "recovery-catalog/v3/archive-restore/$candidate_sha/$recovery_catalog_sha.tar" ] \
        || ! [[ "$recovery_catalog_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
        || ! [[ "$recovery_catalog_created_epoch" =~ ^[0-9]+$ ]] \
        || [ "$recovery_catalog_created_epoch" -lt "$evidence_epoch" ] \
        || [ "$recovery_catalog_created_epoch" -gt $((evidence_now_epoch + 300)) ] \
        || ! [[ "$recovery_catalog_retention_days" =~ ^[0-9]+$ ]] \
        || [ "$recovery_catalog_retention_days" -lt 400 ] \
        || ! [[ "$recovery_catalog_retain_epoch" =~ ^[0-9]+$ ]] \
        || [ "$recovery_catalog_retain_epoch" -lt $((recovery_catalog_created_epoch + recovery_catalog_retention_days * 86400 - 300)) ] \
        || [ "$recovery_catalog_retain_epoch" -le "$evidence_now_epoch" ] \
        || ! [[ "$recovery_payload_retain_epoch" =~ ^[0-9]+$ ]] \
        || [ "$recovery_payload_retain_epoch" -lt "$recovery_catalog_retain_epoch" ] \
        || ! [[ "$remote_database_retain_epoch" =~ ^[0-9]+$ ]] \
        || ! [[ "$remote_secrets_retain_epoch" =~ ^[0-9]+$ ]] \
        || ! [[ "$remote_runtime_files_retain_epoch" =~ ^[0-9]+$ ]] \
        || ! [[ "$remote_log_retain_epoch" =~ ^[0-9]+$ ]] \
        || [ "$remote_database_retain_epoch" -lt "$recovery_payload_retain_epoch" ] \
        || [ "$remote_secrets_retain_epoch" -lt "$recovery_payload_retain_epoch" ] \
        || [ "$remote_runtime_files_retain_epoch" -lt "$recovery_payload_retain_epoch" ] \
        || [ "$remote_log_retain_epoch" -lt "$recovery_payload_retain_epoch" ]; then
        fail "off-host recovery catalog marker is invalid or too short-lived"
        return 0
      fi
      set +e
      recovery_catalog_head="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
        AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
        AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
        AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' AWS_CONFIG_FILE=/dev/null \
        AWS_SHARED_CREDENTIALS_FILE=/dev/null timeout 45 "$AWS_BIN" s3api head-object \
        --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" --region "${CONFIG[BACKUP_S3_REGION]}" \
        --no-cli-pager --bucket "$candidate_bucket" --key "$recovery_catalog_key" \
        --version-id="$recovery_catalog_version" \
        --query '[ContentLength,Metadata.sha256,Metadata.candidate,Metadata.evidence,Metadata.signature,Metadata.signers,Metadata.catalog_format,Metadata.genesis,Metadata.bootstrap,Metadata.bootstrap_evidence,Metadata.bootstrap_signature]' \
        --output text 2>/dev/null)"
      recovery_catalog_head_status=$?
      recovery_catalog_retention="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent \
        AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
        AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
        AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' AWS_CONFIG_FILE=/dev/null \
        AWS_SHARED_CREDENTIALS_FILE=/dev/null timeout 45 "$AWS_BIN" s3api get-object-retention \
        --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" --region "${CONFIG[BACKUP_S3_REGION]}" \
        --no-cli-pager --bucket "$candidate_bucket" --key "$recovery_catalog_key" \
        --version-id="$recovery_catalog_version" \
        --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)"
      recovery_catalog_retention_status=$?
      set -e
      read -r recovery_catalog_remote_bytes recovery_catalog_remote_sha recovery_catalog_remote_candidate \
        recovery_catalog_remote_evidence recovery_catalog_remote_signature recovery_catalog_remote_signers \
        recovery_catalog_remote_format recovery_catalog_remote_genesis recovery_catalog_remote_bootstrap \
        recovery_catalog_remote_bootstrap_evidence recovery_catalog_remote_bootstrap_signature \
        <<<"$recovery_catalog_head"
      read -r recovery_catalog_mode recovery_catalog_remote_until <<<"$recovery_catalog_retention"
      recovery_catalog_remote_epoch="$(date -u -d "$recovery_catalog_remote_until" '+%s' 2>/dev/null || true)"
      if [ "$recovery_catalog_head_status" -ne 0 ] || [ "$recovery_catalog_retention_status" -ne 0 ] \
        || [ "$recovery_catalog_remote_bytes" != "$recovery_catalog_bytes" ] \
        || [ "$recovery_catalog_remote_sha" != "$recovery_catalog_sha" ] \
        || [ "$recovery_catalog_remote_candidate" != "$candidate_sha" ] \
        || [ "$recovery_catalog_remote_evidence" != "$evidence_sha" ] \
        || [ "$recovery_catalog_remote_signature" != "$signature_sha" ] \
        || [ "$recovery_catalog_remote_signers" != "$signers_sha" ] \
        || [ "$recovery_catalog_remote_format" != 3 ] \
        || [ "$recovery_catalog_remote_genesis" != "$log_anchor_sha" ] \
        || [ "$recovery_catalog_remote_bootstrap" != "$bootstrap_certificate_sha" ] \
        || [ "$recovery_catalog_remote_bootstrap_evidence" != "$bootstrap_certificate_evidence_sha" ] \
        || [ "$recovery_catalog_remote_bootstrap_signature" != "$bootstrap_certificate_signature_sha" ] \
        || [ "$recovery_catalog_mode" != COMPLIANCE ] \
        || ! [[ "$recovery_catalog_remote_epoch" =~ ^[0-9]+$ ]] \
        || [ "$recovery_catalog_remote_epoch" -lt "$recovery_catalog_retain_epoch" ]; then
        fail "exact off-host recovery catalog version, metadata or COMPLIANCE retention is invalid"
        return 0
      fi

      recovery_catalog_tmp="$(mktemp /run/leaddrive-readiness-recovery-catalog.XXXXXX)" || {
        fail "cannot allocate tmpfs recovery-catalog verification file"
        return 0
      }
      chmod 0600 "$recovery_catalog_tmp"
      set +e
      env -i PATH=/usr/bin:/bin HOME=/nonexistent \
        AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
        AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
        AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' AWS_CONFIG_FILE=/dev/null \
        AWS_SHARED_CREDENTIALS_FILE=/dev/null timeout 120 "$AWS_BIN" s3api get-object \
        --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" --region "${CONFIG[BACKUP_S3_REGION]}" \
        --no-cli-pager --bucket "$candidate_bucket" --key "$recovery_catalog_key" \
        --version-id="$recovery_catalog_version" "$recovery_catalog_tmp" >/dev/null 2>&1
      recovery_catalog_get_status=$?
      set -e
      recovery_catalog_entries="$(tar -tf "$recovery_catalog_tmp" 2>/dev/null || true)"
      if [ "$recovery_catalog_get_status" -ne 0 ] \
        || [ "$(stat -c '%s' "$recovery_catalog_tmp" 2>/dev/null || true)" != "$recovery_catalog_bytes" ] \
        || [ "$(sha256sum "$recovery_catalog_tmp" 2>/dev/null | awk '{print $1}')" != "$recovery_catalog_sha" ] \
        || [ "$recovery_catalog_entries" != $'bootstrap-evidence.env\nbootstrap-evidence.env.sig\nbootstrap-offline-restore.env\ncandidate.env\nevidence.env\nevidence.env.sig\nlog-evidence-genesis.env\noffline-allowed-signers' ] \
        || ! tar -tvf "$recovery_catalog_tmp" 2>/dev/null \
          | awk '$1 !~ /^-/ { unsafe=1 } END { exit unsafe }' \
        || [ "$(tar -xOf "$recovery_catalog_tmp" candidate.env 2>/dev/null | sha256sum | awk '{print $1}')" != "$candidate_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" evidence.env 2>/dev/null | sha256sum | awk '{print $1}')" != "$evidence_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" evidence.env.sig 2>/dev/null | sha256sum | awk '{print $1}')" != "$signature_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" bootstrap-offline-restore.env 2>/dev/null | sha256sum | awk '{print $1}')" != "$bootstrap_certificate_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" bootstrap-evidence.env 2>/dev/null | sha256sum | awk '{print $1}')" != "$bootstrap_certificate_evidence_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" bootstrap-evidence.env.sig 2>/dev/null | sha256sum | awk '{print $1}')" != "$bootstrap_certificate_signature_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" log-evidence-genesis.env 2>/dev/null | sha256sum | awk '{print $1}')" != "$log_anchor_sha" ] \
        || [ "$(tar -xOf "$recovery_catalog_tmp" offline-allowed-signers 2>/dev/null | sha256sum | awk '{print $1}')" != "$signers_sha" ]; then
        unlink -- "$recovery_catalog_tmp"
        fail "off-host recovery catalog bytes or contents are incomplete"
        return 0
      fi
      unlink -- "$recovery_catalog_tmp"
      pass "off-host recovery catalog exact version is readable, complete and COMPLIANCE-locked"
      ;;
  esac
  pass "$expected_type signed evidence is preserved and cryptographically valid"
}

if command -v ssh-keygen >/dev/null 2>&1; then
  check_signed_evidence_marker "$CUSTODY_MARKER" age-key-custody
  check_signed_evidence_marker "$RESTORE_MARKER" archive-restore
else
  fail "ssh-keygen is missing; signed recovery evidence cannot be verified"
fi

check_recent_service_success() {
  local service="$1"
  local label="$2"
  local maximum_age="$3"
  local result status exit_timestamp exit_epoch now_epoch swap_max
  result="$(systemctl show --property=Result --value "$service" 2>/dev/null || true)"
  status="$(systemctl show --property=ExecMainStatus --value "$service" 2>/dev/null || true)"
  exit_timestamp="$(systemctl show --property=ExecMainExitTimestamp --value "$service" 2>/dev/null || true)"
  swap_max="$(systemctl show --property=MemorySwapMax --value "$service" 2>/dev/null || true)"
  exit_epoch="$(date -u -d "$exit_timestamp" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  if [ "$result" = "success" ] && [ "$status" = "0" ] \
    && [[ "$exit_epoch" =~ ^[0-9]+$ ]] \
    && [ "$exit_epoch" -le $((now_epoch + 300)) ] \
    && [ "$exit_epoch" -ge $((now_epoch - maximum_age)) ]; then
    pass "$label last successful run is fresh"
  else
    fail "$label last run failed, never completed, or is stale"
  fi
  if [ "$swap_max" = "0" ]; then
    pass "$label cannot swap plaintext process memory"
  else
    fail "$label does not enforce MemorySwapMax=0"
  fi
}

timer_load="$(systemctl show --property=LoadState --value "$BACKUP_TIMER" 2>/dev/null || true)"
timer_enabled="$(systemctl is-enabled "$BACKUP_TIMER" 2>/dev/null || true)"
timer_active="$(systemctl is-active "$BACKUP_TIMER" 2>/dev/null || true)"
info "backup timer load=${timer_load:-unknown}, enabled=${timer_enabled:-unknown}, active=${timer_active:-unknown}"
if [ "$timer_load:$timer_enabled:$timer_active" = "loaded:enabled:active" ]; then
  pass "PostgreSQL backup timer is loaded, enabled and active"
else
  fail "PostgreSQL backup timer is not loaded, enabled and active"
fi
check_recent_service_success "$BACKUP_SERVICE" "PostgreSQL backup" 93600

secrets_timer_load="$(systemctl show --property=LoadState --value "$SECRETS_TIMER" 2>/dev/null || true)"
secrets_timer_enabled="$(systemctl is-enabled "$SECRETS_TIMER" 2>/dev/null || true)"
secrets_timer_active="$(systemctl is-active "$SECRETS_TIMER" 2>/dev/null || true)"
info "secrets timer load=${secrets_timer_load:-unknown}, enabled=${secrets_timer_enabled:-unknown}, active=${secrets_timer_active:-unknown}"
if [ "$secrets_timer_load:$secrets_timer_enabled:$secrets_timer_active" = "loaded:enabled:active" ]; then
  pass "secrets snapshot timer is loaded, enabled and active"
else
  fail "secrets snapshot timer is not loaded, enabled and active"
fi
check_recent_service_success "$SECRETS_SERVICE" "secrets snapshot" 691200

runtime_files_timer_load="$(systemctl show --property=LoadState --value "$RUNTIME_FILES_TIMER" 2>/dev/null || true)"
runtime_files_timer_enabled="$(systemctl is-enabled "$RUNTIME_FILES_TIMER" 2>/dev/null || true)"
runtime_files_timer_active="$(systemctl is-active "$RUNTIME_FILES_TIMER" 2>/dev/null || true)"
info "runtime-files timer load=${runtime_files_timer_load:-unknown}, enabled=${runtime_files_timer_enabled:-unknown}, active=${runtime_files_timer_active:-unknown}"
if [ "$runtime_files_timer_load:$runtime_files_timer_enabled:$runtime_files_timer_active" = "loaded:enabled:active" ]; then
  pass "runtime-files snapshot timer is loaded, enabled and active"
else
  fail "runtime-files snapshot timer is not loaded, enabled and active"
fi
check_recent_service_success "$RUNTIME_FILES_SERVICE" "runtime-files snapshot" 93600

log_timer_load="$(systemctl show --property=LoadState --value "$LOG_TIMER" 2>/dev/null || true)"
log_timer_enabled="$(systemctl is-enabled "$LOG_TIMER" 2>/dev/null || true)"
log_timer_active="$(systemctl is-active "$LOG_TIMER" 2>/dev/null || true)"
info "log shipping timer load=${log_timer_load:-unknown}, enabled=${log_timer_enabled:-unknown}, active=${log_timer_active:-unknown}"
if [ "$log_timer_load:$log_timer_enabled:$log_timer_active" = "loaded:enabled:active" ]; then
  pass "log shipping timer is loaded, enabled and active"
else
  fail "log shipping timer is not loaded, enabled and active"
fi
check_recent_service_success "$LOG_SERVICE" "log shipping" 6000
if [ -d /var/log/journal ] && [ ! -L /var/log/journal ] \
    && [ "$(realpath -e -- /var/log/journal 2>/dev/null || true)" = /var/log/journal ] \
    && [ "$(findmnt -n -o FSTYPE --target /var/log/journal 2>/dev/null || true)" != tmpfs ]; then
  pass "systemd journal has a canonical persistent-storage directory"
else
  fail "systemd journal is not backed by the reviewed persistent-storage directory"
fi

if [ "$AWS_TOOLCHAIN_READY" -eq 1 ] \
  && [ -n "${CONFIG[BACKUP_S3_ENDPOINT]:-}" ] \
  && [ -n "${CONFIG[BACKUP_S3_REGION]:-}" ] \
  && [ -n "${CONFIG[BACKUP_S3_BUCKET]:-}" ] \
  && [ -n "${CONFIG[AWS_ACCESS_KEY_ID]:-}" ] \
  && [ -n "${CONFIG[AWS_SECRET_ACCESS_KEY]:-}" ]; then
  set +e
  lock_state="$(env -i \
    PATH=/usr/bin:/bin HOME=/nonexistent \
    AWS_ACCESS_KEY_ID="${CONFIG[AWS_ACCESS_KEY_ID]}" \
    AWS_SECRET_ACCESS_KEY="${CONFIG[AWS_SECRET_ACCESS_KEY]}" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    timeout 45 "$AWS_BIN" s3api get-object-lock-configuration \
      --endpoint-url "${CONFIG[BACKUP_S3_ENDPOINT]}" \
      --region "${CONFIG[BACKUP_S3_REGION]}" \
      --no-cli-pager --bucket "${CONFIG[BACKUP_S3_BUCKET]}" \
      --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]' \
      --output text 2>/dev/null)"
  lock_status=$?
  set -e
  if [ "$lock_status" -ne 0 ]; then
    fail "writer credential cannot verify bucket Object Lock"
  else
    read -r lock_enabled lock_mode lock_days <<<"$lock_state"
    if [ "$lock_enabled" = "Enabled" ] && [ "$lock_mode" = "COMPLIANCE" ] \
      && [[ "$lock_days" =~ ^[0-9]+$ ]] && [ "$lock_days" -ge 14 ]; then
      pass "bucket default Object Lock is COMPLIANCE for at least 14 days"
    else
      fail "bucket default Object Lock is not COMPLIANCE for at least 14 days"
    fi
  fi
fi

info "offline private-key custody and independent decrypt/restore drill require operator evidence"
enterprise_gap "PostgreSQL WAL archiving/PITR and a tested write-watermark reconciliation are not commissioned"
enterprise_gap "DB, secrets, runtime files, logs and recovery catalog still share one object-storage provider/region/account failure domain"
enterprise_gap "the scoped role/owner/ACL/default-privilege catalog is captured, but complete PostgreSQL authority restoration remains untested"
enterprise_gap "uploads/help-videos snapshots are host-loss copies, not application-consistent media generations with tombstone reconciliation"
enterprise_gap "Kafka/immutable event archive is passive outside the Fund pilot and cannot close the database RPO"
enterprise_gap "recovery-catalog v3 is not a clean-host hydration capsule: custody/marker evidence and independently pinned capsule identity are not yet reconstructed"
enterprise_gap "a committed immutable log anchor cannot resume safely after host loss without a signed discontinuity/reseed protocol for its durable cursor"
enterprise_gap "persistent journald retention/capacity and bounded first-run export are not yet enforced as an operating SLO"
enterprise_gap "the signed migration ledger proves reviewed migration bytes and an applied prefix, not physical schema/catalog equality or absence of manual DDL"
if [ "$ISSUES" -eq 0 ]; then
  printf '[backup-readiness] SUMMARY: machine_ready=yes enterprise_ga_ready=no issues=0 enterprise_gaps=%d operator_attestation_required=yes\n' "$ENTERPRISE_GAPS"
  exit 0
fi

printf '[backup-readiness] SUMMARY: machine_ready=no enterprise_ga_ready=no issues=%d enterprise_gaps=%d operator_attestation_required=yes\n' "$ISSUES" "$ENTERPRISE_GAPS"
exit 1
