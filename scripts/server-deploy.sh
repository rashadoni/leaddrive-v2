#!/bin/bash
# ═══════════════════════════════════════════════════════════
# LeadDrive CRM v2 — Server-Side Deploy with Rollback
# Called by GitHub Actions. NOT for manual use.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

DEPLOY_MODE="${1:-}"
EXPECTED_DEPLOY_SHA_ARG="${2:-}"
case "$DEPLOY_MODE" in
  normal|recovery-bootstrap|recovery-bootstrap-resume) ;;
  *) printf '[deploy] FATAL: explicit deploy mode must be normal, recovery-bootstrap, or recovery-bootstrap-resume\n' >&2; exit 1 ;;
esac
[[ "$EXPECTED_DEPLOY_SHA_ARG" =~ ^[0-9a-f]{40}$ ]] || {
  printf '[deploy] FATAL: explicit expected deploy SHA must be 40 lowercase hex characters\n' >&2
  exit 1
}

APP_DIR="/opt/leaddrive-v2"
DEPLOY_TAR="/tmp/leaddrive-deploy.tar.gz"
BACKUP_DIR="/opt/leaddrive-v2-backups"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
APP_ENV_LOCK_FILE="${APP_ENV_LOCK_FILE:-/run/lock/leaddrive-app-env.lock}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/run/lock/leaddrive-deploy.lock}"
MIGRATION_ENV_FILE="${MIGRATION_ENV_FILE:-/etc/leaddrive/migration.env}"
HEALTH_URL="http://localhost:3001"
PM2_PROCESS="leaddrive-v2"
PM2_HOME="/root/.pm2"
# Production health and the PM2 fence are bound to one canonical name/port.
# Never let an ambient CI variable rename the process or move it off the port
# that the handoff proves. App dotenv files are denied these keys below too.
unset PM2_NAME
APP_PORT=3001
export PM2_HOME APP_PORT
MAX_BACKUPS=5
DEFAULT_RUNTIME_DIR="/var/lib/leaddrive-v2"
DEFAULT_LOG_DIR="/var/lib/leaddrive-v2-logs"
RUNTIME_DIR="$DEFAULT_RUNTIME_DIR"
RUNTIME_UPLOADS_DIR="$RUNTIME_DIR/uploads"
RUNTIME_STATE_DIR="$RUNTIME_DIR/state"
RUNTIME_ARCHIVE_DIR="$RUNTIME_DIR/checkout-archive"
LOG_DIR="$DEFAULT_LOG_DIR"
HELP_VIDEO_ASSET_DIR_DEFAULT="$RUNTIME_DIR/help-videos/player"
HELP_VIDEO_RUNTIME_ROOT="$RUNTIME_DIR/help-videos"
VOICE_OPERATOR_STATE_DIR_RESOLVED="$RUNTIME_DIR/state/operator"
OPS_ROOT="${OPS_ROOT:-/usr/local/lib/leaddrive-v2/ops}"
OPS_RELEASES_DIR="$OPS_ROOT/releases"
OPS_CURRENT_LINK="$OPS_ROOT/current"
OPS_ACTIVATION_JOURNAL="$OPS_ROOT/activation.journal"
SYSTEMD_UNIT_DIR="/etc/systemd/system"
LOGROTATE_DIR="/etc/logrotate.d"
HELP_VIDEO_PUBLIC_BASE_URL_DEFAULT="https://app.leaddrivecrm.org/api/help-videos"
HELP_VIDEO_ASSETS_COPIED=false
LEGACY_HELP_VIDEO_PATH_RECOGNIZED=false
STANDALONE_REPLACED=false
RUNTIME_CUTOVER_APPLIED=false
RUNTIME_PUBLIC_MERGE_JOURNAL=""
RUNTIME_UPLOADS_CUTOVER_ACTION="none"
RUNTIME_LOGS_CUTOVER_ACTION="none"
RUNTIME_HELP_VIDEOS_CUTOVER_ACTION="none"
LEGACY_PUBLIC_UPLOADS_ACTION="none"
LEGACY_PUBLIC_UPLOADS_ARCHIVE=""
RUNTIME_PLAN_FEATURES_STATE_ACTION="none"
RUNTIME_BASE_MODULES_LEDGER_STATE_ACTION="none"
RUNTIME_BASE_MODULES_V2_STATE_ACTION="none"
RUNTIME_VOICE_PROVIDER_LOCK_STATE_ACTION="none"
RUNTIME_STATE_CUTOVER_FINALIZED=false
HANDOFF_STARTED=false
HANDOFF_RECOVERY_COMPLETE=false
EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=false
OPS_CURRENT_PREVIOUS_TARGET=""
OPS_CURRENT_NEW_TARGET=""
OPS_CURRENT_SWITCHED=false
OPS_POINTER_SWITCH_INTENT=false
OPERATIONS_RELEASE_FINALIZED=false
OPERATIONS_CRONTAB_BEFORE=""
OPERATIONS_CRONTAB_EXPECTED=""
OPERATIONS_CRONTAB_MUTATED=false
OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR=""
OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT=""
OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=false
OPERATIONS_SYSTEM_CONFIG_APPLIED=false
OPERATIONS_ACTIVATION_STARTED=false
GENESIS_ACTIVATION_DURABLE=false
OPERATIONS_CRONTAB_INTENT=false
OPERATIONS_BACKUP_LOCK_FD=""
OPERATIONS_SECRETS_LOCK_FD=""
OPERATIONS_RUNTIME_FILES_LOCK_FD=""
OPERATIONS_LOG_LOCK_FD=""
EVENT_PLATFORM_CUTOVER_LOCK_PID=""
EVENT_PLATFORM_CUTOVER_LOCK_LOG=""
EVENT_PLATFORM_PILOT_MIGRATION="20260901100000_fund_event_source_pilot"
EVENT_PLATFORM_PILOT_GATE_KEY="fund-event-source-v1"
EVENT_PLATFORM_PILOT_RECOVERY_DIR="/var/lib/leaddrive-v2/recovery/event-platform-fund-v1"
EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup-transient.env"
EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA="8fbd00c410c6908df65be999e11f2564afcd9a67"
EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER=".event-platform-fund-atomic-insert-first-v1"
EVENT_PLATFORM_ATOMIC_PREREQUISITE_CONTRACT="fund-transaction-atomic-insert-first-v1"
EXPECTED_SHARED_SERVER_IP="13.140.132.245"
LEGACY_SHARED_SERVER_IP="46.224.171.53"
BACKUP_EVIDENCE_ROOT="/etc/leaddrive/backup-evidence"
BACKUP_CUSTODY_MARKER="$BACKUP_EVIDENCE_ROOT/key-custody.env"
BACKUP_OFFLINE_RESTORE_MARKER="$BACKUP_EVIDENCE_ROOT/offline-restore-current.env"
BACKUP_BOOTSTRAP_RESTORE_MARKER="$BACKUP_EVIDENCE_ROOT/bootstrap-offline-restore-current.env"
BACKUP_OFFLINE_ALLOWED_SIGNERS="$BACKUP_EVIDENCE_ROOT/offline-allowed-signers"
BACKUP_SIGNED_EVIDENCE_DIR="$BACKUP_EVIDENCE_ROOT/signed"
LOG_EVIDENCE_GENESIS_ANCHOR="$BACKUP_EVIDENCE_ROOT/log-evidence-genesis.env"
LOG_EVIDENCE_STATE_DIR="/var/lib/leaddrive-log-ship"
LOG_EVIDENCE_STATE_FILE="$LOG_EVIDENCE_STATE_DIR/log-ship-offsets"
LOG_EVIDENCE_BOOTSTRAP_TRANSACTION="$LOG_EVIDENCE_STATE_DIR/bootstrap-transaction"
LOG_EVIDENCE_BOOTSTRAP_PREPARING="$LOG_EVIDENCE_STATE_DIR/bootstrap-transaction.preparing"
LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE="$LOG_EVIDENCE_STATE_DIR/bootstrap-transaction.committed"
REVIEWED_LOG_CURSOR_AWK_RE='^(/var/lib/leaddrive-v2-logs/[^/]+[.]log|/var/log/nginx/[^/]+[.]log|/var/log/postgresql/[^/]+[.]log|/var/log/leaddrive-resilience-cron[.]log)$'
LOG_GENESIS_REMOTE_BYTES=""
LOG_GENESIS_REMOTE_SHA256=""
LOG_GENESIS_REMOTE_FORMAT=""
LOG_GENESIS_REMOTE_RANGES_SHA256=""
LOG_GENESIS_REMOTE_FILE_RANGE_COUNT=""
LOG_GENESIS_REMOTE_FILE_RANGE_BYTES=""
LOG_GENESIS_REMOTE_JOURNAL_RANGE_COUNT=""
LOG_GENESIS_REMOTE_CURSOR_SHA256=""
LOG_GENESIS_REMOTE_CREATED_AT=""
LOG_GENESIS_REMOTE_VERSION_ID=""
LOG_GENESIS_REMOTE_START_AT=""
LOG_GENESIS_REMOTE_KEY=""
LOG_BOOTSTRAP_TX_PRESENT=false
LOG_BOOTSTRAP_TX_PAYLOAD=""
LOG_BOOTSTRAP_TX_CIPHERTEXT_SHA256=""
LOG_BOOTSTRAP_TX_CIPHERTEXT_BYTES=""
LOG_BOOTSTRAP_TX_CURSOR_SHA256=""
LOG_BOOTSTRAP_TX_RANGES_SHA256=""
LOG_BOOTSTRAP_TX_FILE_RANGE_COUNT=""
LOG_BOOTSTRAP_TX_FILE_RANGE_BYTES=""
LOG_BOOTSTRAP_TX_JOURNAL_RANGE_COUNT=""
BACKUP_AGE_VERSION="1.3.2"
BACKUP_AGE_ARCHIVE_SHA256="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"
BACKUP_AGE_BINARY_SHA256="eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c"
BACKUP_AGE_BIN="/usr/local/lib/leaddrive-backup/tools/age/$BACKUP_AGE_VERSION/age"
BACKUP_AGE_PROVENANCE="/usr/local/lib/leaddrive-backup/tools/age/$BACKUP_AGE_VERSION/LEADDRIVE_PROVENANCE"
BACKUP_AWS_VERSION="2.36.40"
BACKUP_AWS_ARCHIVE_SHA256="a904e314340ad4c4b62beb50e9259d4becb2acf3dffc86c96c553c834d7fdf7a"
BACKUP_AWS_SIGNING_FINGERPRINT="FB5DB77FD5C118B80511ADA8A6310ACC4672475C"
BACKUP_AWS_ROOT="/usr/local/lib/leaddrive-backup/tools/aws-cli/$BACKUP_AWS_VERSION"
BACKUP_AWS_BIN="$BACKUP_AWS_ROOT/v2/current/bin/aws"
BACKUP_AWS_REAL_BIN="$BACKUP_AWS_ROOT/v2/$BACKUP_AWS_VERSION/dist/aws"
BACKUP_AWS_PROVENANCE="$BACKUP_AWS_ROOT/LEADDRIVE_PROVENANCE"
BACKUP_CUSTODY_VERIFIER_SHA256="a02101a2e9ae313c7486d31337b9efe771ea2127d565b059d6e2427df86eca91"
BACKUP_ARCHIVE_VERIFIER_SHA256="c6d4caabb1f44db3036c79d59b63253f961fa8ce29780724c9d15667dac644a6"
BACKUP_POSTGRES_SCRIPT_SHA256="ddf2142311b6c7ad561e510369925ca3f5347f667966a5c265451c0823e4e065"
BACKUP_SECRETS_SCRIPT_SHA256="16d4bf083ad2549cd34e1bd89a53ee958f1625605235fe5370c8acecc401de99"
BACKUP_RUNTIME_FILES_SCRIPT_SHA256="d5fe33b4b0b0e581194b3aff770eca45a14a493774ec314340146bd69475e53e"
BACKUP_RESTORE_CANARY_SHA256="af743a9bd8df3daa6ba6b60d90141daea28629f6140d8d12d1623f6b083f5d9e"
BACKUP_PII_PROOF_SHA256="e83f3fc65c56e0dc8db7eb26e47780c0901917908c05d7aa6552792a37f99e18"
BACKUP_CANARY_SQL_SHA256="5c3a9bf2b14c84c4deafa31525ac23518ba2290ab32a7cf5f66e2d05d4b249c9"
EVENT_PLATFORM_CUTOVER_STATE="unknown"
EVENT_PLATFORM_REQUIRES_VERIFICATION=false
EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE=""
EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM=""
EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD=""
EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH=""
EVENT_PLATFORM_PREVIOUS_ARTIFACT_SHA=""
EVENT_PLATFORM_PREVIOUS_CLIENT_HASH=""
EVENT_PLATFORM_PREVIOUS_STANDALONE_PATH=""
EVENT_PLATFORM_DATABASE_IDENTITY=""
EVENT_PLATFORM_PREVIOUS_CLIENT_COMPATIBLE=false
EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT=""
EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED=false
EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE=""
EVENT_PLATFORM_RECOVERY_GATE_MODE=""

# Keep this inventory in one place: the deployment snapshots exactly these
# singleton files before it changes /etc, and restores exactly these files on
# an incomplete activation.  An unlisted operational file must not become an
# implicit side effect of a release.
OPERATIONS_SYSTEMD_UNITS=(
  leaddrive-log-ship.service
  leaddrive-log-ship.timer
  leaddrive-postgres-backup.service
  leaddrive-postgres-backup.timer
  leaddrive-runtime-files-snapshot.service
  leaddrive-runtime-files-snapshot.timer
  leaddrive-secrets-snapshot.service
  leaddrive-secrets-snapshot.timer
)
OPERATIONS_TIMERS=(
  leaddrive-log-ship.timer
  leaddrive-postgres-backup.timer
  leaddrive-runtime-files-snapshot.timer
  leaddrive-secrets-snapshot.timer
)
OPERATIONS_LOGROTATE_FILES=(leaddrive-v2 leaddrive-cron-logs)

# The deployment and environment locks are held for the complete run. This is
# intentionally broader than GitHub Actions concurrency: the documented on-box
# build and a manual retry run on the same host and must not interleave an
# artifact swap, PM2 handoff, or atomic app-env update.
export APP_ENV_FILE

# Default health-probe vars so the Step 10 SUMMARY line is safe under
# `set -u` if any future refactor reaches it before the health loop
# populates these.
HTTP_CODE=000
CSS_CODE=000
DB_CODE=000

log() { echo "[$(date '+%H:%M:%S')] $1"; }
fatal() { log "FATAL: $1"; exit 1; }

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

assert_dotenv_key_allowed() {
  local scope="$1"
  local key="$2"

  # The app environment belongs to the web process. It may configure runtime
  # data roots, but it must never steer this root-run release program, its
  # loader, or child-process search paths. In particular this keeps a legacy
  # checkout .env from changing the destination of its own first migration.
  case "$key" in
    APP_DIR|APP_ENV_FILE|APP_ENV_LOCK_FILE|APP_ENV_SOURCE_FILE|\
    DEPLOY_TAR|DEPLOY_LOCK_FILE|DEPLOY_PREFLIGHT_ONLY|DEPLOY_MODE|EXPECTED_DEPLOY_SHA_ARG|DEPLOY_SHA|DEPLOY_SHA_FILE|\
    ARTIFACT_DEPLOY_SHA|BACKUP_DIR|BACKUP_PATH|MAX_BACKUPS|HEALTH_URL|PM2_PROCESS|PM2_HOME|PM2_NAME|APP_PORT|\
    DEFAULT_RUNTIME_DIR|DEFAULT_LOG_DIR|RUNTIME_DIR|RUNTIME_UPLOADS_DIR|\
    RUNTIME_STATE_DIR|RUNTIME_ARCHIVE_DIR|LOG_DIR|HELP_VIDEO_ASSET_DIR_DEFAULT|\
    HELP_VIDEO_RUNTIME_ROOT|VOICE_OPERATOR_STATE_DIR_RESOLVED|OPS_ROOT|\
    OPS_RELEASES_DIR|OPS_CURRENT_LINK|OPS_ACTIVATION_JOURNAL|SYSTEMD_UNIT_DIR|LOGROTATE_DIR|\
    HELP_VIDEO_PUBLIC_BASE_URL_DEFAULT|RESILIENCE_CRON_INSTALLER|SCRIPTS|\
    STANDALONE_REPLACED|RUNTIME_CUTOVER_APPLIED|RUNTIME_STATE_CUTOVER_FINALIZED|\
    HANDOFF_STARTED|HANDOFF_RECOVERY_COMPLETE|OPS_CURRENT_PREVIOUS_TARGET|\
    OPS_CURRENT_NEW_TARGET|OPS_CURRENT_SWITCHED|OPS_POINTER_SWITCH_INTENT|OPERATIONS_RELEASE_FINALIZED|\
    OPERATIONS_CRONTAB_BEFORE|OPERATIONS_CRONTAB_EXPECTED|OPERATIONS_CRONTAB_MUTATED|\
    OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR|OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT|\
    OPERATIONS_SYSTEM_CONFIG_SNAPSHOT|OPERATIONS_SYSTEM_CONFIG_APPLIED|\
    OPERATIONS_ACTIVATION_STARTED|GENESIS_ACTIVATION_DURABLE|OPERATIONS_CRONTAB_INTENT|OPERATIONS_SYSTEMD_UNITS|OPERATIONS_TIMERS|\
    OPERATIONS_BACKUP_LOCK_FD|OPERATIONS_SECRETS_LOCK_FD|\
    OPERATIONS_RUNTIME_FILES_LOCK_FD|OPERATIONS_LOG_LOCK_FD|\
    OPERATIONS_LOGROTATE_FILES|EVENT_PLATFORM_*|LOG_EVIDENCE_*|LOG_GENESIS_*|LOG_BOOTSTRAP_*|\
    REVIEWED_LOG_CURSOR_AWK_RE|BACKUP_EVIDENCE_ROOT|BACKUP_CUSTODY_MARKER|\
    BACKUP_OFFLINE_RESTORE_MARKER|BACKUP_BOOTSTRAP_RESTORE_MARKER|BACKUP_OFFLINE_ALLOWED_SIGNERS|BACKUP_SIGNED_EVIDENCE_DIR|\
    EXPECTED_SHARED_SERVER_IP|LEGACY_SHARED_SERVER_IP|\
    PATH|IFS|CDPATH|GLOBIGNORE|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|BASH_COMPAT|\
    LD_*|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_*|npm_config_*|\
    TAR_OPTIONS|CURL_HOME|XDG_CONFIG_HOME|HOME|TMPDIR|TMP|TEMP|PG*)
      fatal "$scope environment must not set deployment-control key: $key"
      ;;
  esac

  case "$scope" in
    app)
      case "$key" in
        MIGRATION_*) fatal "application environment must not contain migration-only key: $key" ;;
      esac
      ;;
    migration)
      case "$key" in
        MIGRATION_DATABASE_URL|MIGRATION_EXPECTED_DB_ROLE|MIGRATION_WINDOW_ATTEMPTS) ;;
        *) fatal "migration environment contains unsupported key: $key" ;;
      esac
      ;;
    *) fatal "unknown dotenv scope: $scope" ;;
  esac
}

load_dotenv_file() {
  local file="$1"
  local scope="${2:-app}"
  local line key value first last

  [ -f "$file" ] || return 0

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
    assert_dotenv_key_allowed "$scope" "$key"
    value="$(trim_value "${BASH_REMATCH[2]}")"
    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi

    export "$key=$value"
  done < "$file"
}

# Read one literal KEY=VALUE from a root-owned environment file without
# sourcing it. Deployment safety checks must never execute backup credentials
# as shell code merely to confirm that encryption is enabled.
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
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi
    resolved="$value"
  done < "$file"

  printf '%s' "$resolved"
}

# Run only the commissioned AWS CLI with credentials read literally from the
# root-owned backup configuration.  `env -i` prevents a deployment runner's
# profile, proxy, credential chain, or PATH from changing which immutable
# object is inspected during the Fund cutover.
run_pinned_backup_aws() {
  local timeout_seconds="$1"
  local endpoint region access_key secret_key
  shift

  endpoint="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" || return 2
  region="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" || return 2
  access_key="$(read_static_env_value /etc/leaddrive/backup.env AWS_ACCESS_KEY_ID)" || return 2
  secret_key="$(read_static_env_value /etc/leaddrive/backup.env AWS_SECRET_ACCESS_KEY)" || return 2
  [ -n "$endpoint" ] && [ -n "$region" ] && [ -n "$access_key" ] && [ -n "$secret_key" ] \
    || return 2

  env -i \
    PATH=/usr/bin:/bin HOME=/nonexistent \
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    timeout "$timeout_seconds" "$BACKUP_AWS_BIN" "$@"
}

require_absolute_path() {
  local name="$1"
  local value="$2"
  case "$value" in
    /*) ;;
    *) fatal "$name must be an absolute path" ;;
  esac
}

canonical_external_path() {
  local name="$1"
  local value="$2"
  local canonical

  require_absolute_path "$name" "$value"
  canonical="$(realpath -m -- "$value")" || fatal "$name cannot be canonicalized"
  case "$canonical" in
    /|/var|/var/lib|/var/log|/etc|/usr|/usr/local|/opt)
      fatal "$name must name a dedicated directory or file, not a host root" ;;
    /tmp|/tmp/*|/var/tmp|/var/tmp/*|/run|/run/*|/dev|/dev/*|/proc|/proc/*|/sys|/sys/*)
      fatal "$name must not use a transient or kernel-managed path" ;;
    "$APP_DIR"|"$APP_DIR"/*)
      fatal "$name must stay outside the Git checkout and release tree" ;;
  esac
  printf '%s' "$canonical"
}

# Canonical runtime paths are security boundaries. Do not silently repair a
# pre-existing insecure path: ownership or writable-mode drift can mean an
# untrusted local principal can replace secrets, media, or root-run code.
assert_root_owned_nonwritable_directory() {
  local label="$1"
  local directory="$2"
  local mode

  [ -d "$directory" ] && [ ! -L "$directory" ] || \
    fatal "$label must be a real directory, not a missing path or symlink: $directory"
  [ "$(stat -c '%u' "$directory")" = "0" ] || \
    fatal "$label must be owned by root: $directory"
  mode="$(stat -c '%a' "$directory")"
  if (( (8#$mode & 8#022) != 0 )); then
    fatal "$label must not be group- or world-writable: $directory"
  fi
}

assert_root_owned_nonwritable_file() {
  local label="$1"
  local file="$2"
  local mode

  [ -f "$file" ] && [ ! -L "$file" ] || \
    fatal "$label must be a regular file, not a missing path or symlink: $file"
  [ "$(stat -c '%u' "$file")" = "0" ] || \
    fatal "$label must be owned by root: $file"
  mode="$(stat -c '%a' "$file")"
  if (( (8#$mode & 8#022) != 0 )); then
    fatal "$label must not be group- or world-writable: $file"
  fi
}

validate_checkout_app_env_for_first_cutover() {
  local file="$1"

  assert_root_owned_nonwritable_directory "LeadDrive checkout before canonical app-environment migration" "$APP_DIR"
  assert_root_owned_nonwritable_file "checkout application environment before canonical migration" "$file"
  [ "$(stat -c '%a' "$file")" = "600" ] || \
    fatal "$file must have mode 0600 before canonical app-environment migration"
}

assert_secure_existing_or_parent() {
  local label="$1"
  local path="$2"
  local candidate parent

  if [ -e "$path" ] || [ -L "$path" ]; then
    assert_root_owned_nonwritable_directory "$label" "$path"
  else
    candidate="$(dirname -- "$path")"
    while [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; do
      parent="$(dirname -- "$candidate")"
      [ "$parent" != "$candidate" ] || fatal "cannot find an existing parent for $label: $path"
      candidate="$parent"
    done
    assert_root_owned_nonwritable_directory "$label parent" "$candidate"
  fi
}

ensure_secure_root_directory() {
  local label="$1"
  local directory="$2"
  local mode="$3"
  local candidate parent
  local -a pending=()

  if [ -e "$directory" ] || [ -L "$directory" ]; then
    assert_root_owned_nonwritable_directory "$label" "$directory"
    return 0
  fi

  candidate="$directory"
  while [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; do
    pending=("$candidate" "${pending[@]}")
    parent="$(dirname -- "$candidate")"
    [ "$parent" != "$candidate" ] || fatal "cannot find an existing parent for $label: $directory"
    candidate="$parent"
  done
  assert_root_owned_nonwritable_directory "$label parent" "$candidate"
  for candidate in "${pending[@]}"; do
    install -d -m "$mode" -- "$candidate" || fatal "cannot create $label: $candidate"
    assert_root_owned_nonwritable_directory "$label" "$candidate"
  done
  assert_root_owned_nonwritable_directory "$label" "$directory"
}

ensure_root_only_backup_directory() {
  local directory="$1"
  local mode

  if [ -e "$directory" ] || [ -L "$directory" ]; then
    assert_root_owned_nonwritable_directory "deployment backup root" "$directory"
    [ "$(stat -c '%U:%G' "$directory")" = "root:root" ] || \
      fatal "deployment backup root must be owned by root:root: $directory"
    mode="$(stat -c '%a' "$directory")"
    if [ "$mode" != "700" ]; then
      # This directory is deployment-owned and can contain full standalone and
      # media snapshots. Tightening an existing root-only root is deliberate
      # first-cutover hardening, not a broad checkout cleanup.
      chmod 0700 -- "$directory" || \
        fatal "cannot tighten deployment backup root to mode 0700: $directory"
      log "Hardened deployment backup root permissions to root-only: $directory"
    fi
  else
    install -d -m 0700 -- "$directory" || \
      fatal "cannot create deployment backup root: $directory"
  fi
  [ "$(stat -c '%U:%G:%a' "$directory")" = "root:root:700" ] || \
    fatal "deployment backup root must be root:root mode 0700: $directory"
}

assert_secure_operations_tree() {
  local label="$1"
  local root="$2"
  local unsafe

  assert_root_owned_nonwritable_directory "$label" "$root"
  unsafe="$(find "$root" -xdev \( -type l -o ! -uid 0 -o -perm /022 \) -print -quit)" \
    || fatal "cannot inspect $label ownership and permissions"
  [ -z "$unsafe" ] || \
    fatal "$label contains a symlink, non-root-owned path, or group/world-writable path: $unsafe"
}

acquire_host_locks() {
  require_absolute_path "DEPLOY_LOCK_FILE" "$DEPLOY_LOCK_FILE"
  require_absolute_path "APP_ENV_LOCK_FILE" "$APP_ENV_LOCK_FILE"
  [ -d "$(dirname -- "$DEPLOY_LOCK_FILE")" ] || fatal "deployment lock parent is missing"
  [ -d "$(dirname -- "$APP_ENV_LOCK_FILE")" ] || fatal "app-env lock parent is missing"

  exec 7>"$DEPLOY_LOCK_FILE"
  flock -n 7 || fatal "another LeadDrive deployment holds $DEPLOY_LOCK_FILE"
  exec 8>"$APP_ENV_LOCK_FILE"
  flock -w 120 8 || fatal "another canonical app-env update is running"
}

# The app environment is durable secret material, never source. Move it once
# before preflight, then retain a compatibility symlink only for old operator
# workflows while their callers are migrated. A matching regular file is not
# silently replaced: a partial/manual cutover must be investigated, not hidden.
ensure_canonical_app_env() {
  local app_env_parent

  APP_ENV_FILE="$(canonical_external_path "APP_ENV_FILE" "$APP_ENV_FILE")"
  export APP_ENV_FILE
  app_env_parent="$(dirname -- "$APP_ENV_FILE")"
  ensure_secure_root_directory "canonical app environment directory" "$app_env_parent" "0755"

  if [ -e "$APP_ENV_FILE" ] || [ -L "$APP_ENV_FILE" ]; then
    [ ! -L "$APP_ENV_FILE" ] && [ -f "$APP_ENV_FILE" ] || \
      fatal "$APP_ENV_FILE must be a regular file when it already exists"
  fi

  if [ ! -f "$APP_ENV_FILE" ]; then
    [ -f "$APP_DIR/.env" ] || fatal "neither $APP_ENV_FILE nor $APP_DIR/.env exists"
    validate_checkout_app_env_for_first_cutover "$APP_DIR/.env"
    [ "$(stat -c '%d' "$APP_DIR/.env")" = "$(stat -c '%d' "$app_env_parent")" ] || \
      fatal "refusing non-atomic app environment move across filesystems"
    mv -- "$APP_DIR/.env" "$APP_ENV_FILE"
    chmod 0600 "$APP_ENV_FILE"
    ln -s "$APP_ENV_FILE" "$APP_DIR/.env"
    log "Moved canonical application environment outside the checkout"
  else
    validate_canonical_app_env
    if [ ! -e "$APP_DIR/.env" ] && [ ! -L "$APP_DIR/.env" ]; then
      ln -s "$APP_ENV_FILE" "$APP_DIR/.env"
    fi
  fi

  validate_canonical_app_env
}

# This predicate has no side effects. DEPLOY_PREFLIGHT_ONLY uses it to prove a
# prior cutover is coherent without creating the compatibility link or moving
# any secret material.
validate_canonical_app_env() {
  assert_root_owned_nonwritable_directory "canonical app environment directory" "$(dirname -- "$APP_ENV_FILE")"
  [ ! -L "$APP_ENV_FILE" ] || fatal "$APP_ENV_FILE must be a regular root-owned file, not a symlink"
  [ -f "$APP_ENV_FILE" ] || fatal "$APP_ENV_FILE is missing or is not a regular file"
  [ "$(stat -c '%U' "$APP_ENV_FILE")" = "root" ] || fatal "$APP_ENV_FILE must be owned by root"
  [ "$(stat -c '%a' "$APP_ENV_FILE")" = "600" ] || fatal "$APP_ENV_FILE must have mode 0600"

  if [ -e "$APP_DIR/.env" ] || [ -L "$APP_DIR/.env" ]; then
    [ -L "$APP_DIR/.env" ] || \
      fatal "$APP_DIR/.env is a regular file while $APP_ENV_FILE exists; refusing to choose a secret authority"
    [ "$(readlink -f "$APP_DIR/.env")" = "$APP_ENV_FILE" ] || \
      fatal "$APP_DIR/.env points somewhere other than $APP_ENV_FILE"
  fi
}

append_env_if_missing() {
  local key="$1"
  local value="$2"
  local stage
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$APP_ENV_FILE" && return 0

  stage="$(mktemp "$(dirname -- "$APP_ENV_FILE")/.app.env.deploy.XXXXXX")" || \
    fatal "cannot create an atomic staging file for $APP_ENV_FILE"
  if ! cp --preserve=mode,ownership "$APP_ENV_FILE" "$stage" \
    || ! printf '\n%s=%s\n' "$key" "$value" >> "$stage" \
    || ! sync -f -- "$stage" \
    || ! mv -f -- "$stage" "$APP_ENV_FILE" \
    || ! sync -f -- "$(dirname -- "$APP_ENV_FILE")"; then
    rm -f -- "$stage"
    fatal "cannot atomically add $key to canonical app environment"
  fi
  log "Configured $key in canonical app environment"
}

normalize_exact_legacy_help_video_path() {
  # The former production default was inside the checkout. It is the only
  # checkout path that an approved first cutover may recognize: every other
  # checkout-derived runtime value still reaches canonical_external_path() and
  # fails closed. Preflight-only must remain truthful and therefore refuses to
  # claim success until an approved deploy atomically rewrites the file.
  [ "${HELP_VIDEO_ASSET_DIR:-}" = "$APP_DIR/help-videos/player" ] || return 0
  [ "${DEPLOY_PREFLIGHT_ONLY:-0}" != "1" ] || \
    fatal "legacy HELP_VIDEO_ASSET_DIR requires the approved deployment to migrate it outside the checkout"

  HELP_VIDEO_ASSET_DIR=""
  export HELP_VIDEO_ASSET_DIR
  if [ "$LEGACY_HELP_VIDEO_PATH_RECOGNIZED" != "true" ]; then
    LEGACY_HELP_VIDEO_PATH_RECOGNIZED=true
    log "Recognized the exact legacy help-video runtime path; it will be atomically migrated after artifact verification"
  fi
}

rewrite_exact_app_env_value() {
  local target_key="$1"
  local expected_value="$2"
  local replacement_value="$3"
  local stage line parsed_line env_key value first last
  local matches=0 changed=0

  stage="$(mktemp "$(dirname -- "$APP_ENV_FILE")/.app.env.deploy.XXXXXX")" || \
    fatal "cannot create an atomic staging file for $APP_ENV_FILE"
  if ! chown --reference="$APP_ENV_FILE" "$stage" \
    || ! chmod --reference="$APP_ENV_FILE" "$stage"; then
    rm -f -- "$stage"
    fatal "cannot preserve canonical app environment ownership and mode"
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    parsed_line="${line%$'\r'}"
    parsed_line="$(trim_value "$parsed_line")"
    if [ -n "$parsed_line" ] && [[ "$parsed_line" != \#* ]]; then
      if [[ "$parsed_line" == export[[:space:]]* ]]; then
        parsed_line="$(trim_value "${parsed_line#export}")"
      fi
      if [[ "$parsed_line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
        env_key="${BASH_REMATCH[1]}"
        value="$(trim_value "${BASH_REMATCH[2]}")"
        if [ "${#value}" -ge 2 ]; then
          first="${value:0:1}"
          last="${value: -1}"
          if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
            value="${value:1:${#value}-2}"
          fi
        fi
        if [ "$env_key" = "$target_key" ]; then
          matches=$((matches + 1))
          if [ "$value" = "$expected_value" ]; then
            printf '%s=%s\n' "$target_key" "$replacement_value" >> "$stage" || {
              rm -f -- "$stage"
              fatal "cannot stage canonical app environment migration"
            }
            changed=$((changed + 1))
            continue
          fi
        fi
      fi
    fi
    printf '%s\n' "$line" >> "$stage" || {
      rm -f -- "$stage"
      fatal "cannot stage canonical app environment migration"
    }
  done < "$APP_ENV_FILE"

  if [ "$matches" -gt 1 ]; then
    rm -f -- "$stage"
    fatal "canonical app environment has duplicate $target_key assignments"
  fi
  if [ "$changed" = "0" ]; then
    rm -f -- "$stage"
    return 0
  fi
  [ "$changed" = "1" ] || {
    rm -f -- "$stage"
    fatal "canonical app environment migration matched $target_key more than once"
  }
  if ! sync -f -- "$stage" \
    || ! mv -f -- "$stage" "$APP_ENV_FILE" \
    || ! sync -f -- "$(dirname -- "$APP_ENV_FILE")"; then
    rm -f -- "$stage"
    fatal "cannot atomically migrate $target_key in canonical app environment"
  fi
  log "Migrated exact legacy $target_key value in canonical app environment"
}

validate_shared_server_ip_source() {
  local file="$1"
  local configured

  configured="$(read_static_env_value "$file" "SHARED_SERVER_IP")" || \
    fatal "$file contains duplicate SHARED_SERVER_IP assignments"
  case "$configured" in
    "$EXPECTED_SHARED_SERVER_IP")
      log "Tenant DNS target matches the registered production host"
      ;;
    ""|"$LEGACY_SHARED_SERVER_IP")
      if [ "${DEPLOY_PREFLIGHT_ONLY:-0}" = "1" ]; then
        fatal "SHARED_SERVER_IP must be migrated to the registered production host before preflight can pass"
      fi
      log "Tenant DNS target requires the approved host-migration update before activation"
      ;;
    *)
      fatal "SHARED_SERVER_IP does not match the registered production host"
      ;;
  esac
}

migrate_registered_shared_server_ip() {
  local configured matches

  configured="$(read_static_env_value "$APP_ENV_FILE" "SHARED_SERVER_IP")" || \
    fatal "$APP_ENV_FILE contains duplicate SHARED_SERVER_IP assignments"
  case "$configured" in
    "$EXPECTED_SHARED_SERVER_IP") ;;
    "$LEGACY_SHARED_SERVER_IP")
      rewrite_exact_app_env_value \
        "SHARED_SERVER_IP" \
        "$LEGACY_SHARED_SERVER_IP" \
        "$EXPECTED_SHARED_SERVER_IP"
      ;;
    "")
      matches="$(grep -Ec '^[[:space:]]*(export[[:space:]]+)?SHARED_SERVER_IP[[:space:]]*=' "$APP_ENV_FILE" || true)"
      case "$matches" in
        0) append_env_if_missing "SHARED_SERVER_IP" "$EXPECTED_SHARED_SERVER_IP" ;;
        1) rewrite_exact_app_env_value "SHARED_SERVER_IP" "" "$EXPECTED_SHARED_SERVER_IP" ;;
        *) fatal "$APP_ENV_FILE contains duplicate SHARED_SERVER_IP assignments" ;;
      esac
      ;;
    *) fatal "SHARED_SERVER_IP does not match the registered production host" ;;
  esac

  configured="$(read_static_env_value "$APP_ENV_FILE" "SHARED_SERVER_IP")" || \
    fatal "$APP_ENV_FILE contains duplicate SHARED_SERVER_IP assignments after migration"
  [ "$configured" = "$EXPECTED_SHARED_SERVER_IP" ] || \
    fatal "SHARED_SERVER_IP migration did not produce the registered production host"
  log "Tenant DNS target is pinned to the registered production host"
}

migrate_exact_legacy_help_video_env_path() {
  rewrite_exact_app_env_value \
    "HELP_VIDEO_ASSET_DIR" \
    "$APP_DIR/help-videos/player" \
    "$RUNTIME_DIR/help-videos/player"
}

configure_runtime_paths() {
  local env_file="${1:-$APP_ENV_FILE}"
  load_dotenv_file "$env_file"
  normalize_exact_legacy_help_video_path
  RUNTIME_DIR="$(canonical_external_path "LEADDRIVE_RUNTIME_DIR" "${LEADDRIVE_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}")"
  LOG_DIR="$(canonical_external_path "LEADDRIVE_LOG_DIR" "${LEADDRIVE_LOG_DIR:-$DEFAULT_LOG_DIR}")"
  RUNTIME_UPLOADS_DIR="$(canonical_external_path "LEADDRIVE_RUNTIME_DIR/uploads" "$RUNTIME_DIR/uploads")"
  RUNTIME_STATE_DIR="$(canonical_external_path "LEADDRIVE_RUNTIME_DIR/state" "$RUNTIME_DIR/state")"
  RUNTIME_ARCHIVE_DIR="$(canonical_external_path "LEADDRIVE_RUNTIME_DIR/checkout-archive" "$RUNTIME_DIR/checkout-archive")"
  [ "$RUNTIME_UPLOADS_DIR" = "$RUNTIME_DIR/uploads" ] || \
    fatal "LEADDRIVE_RUNTIME_DIR/uploads must not resolve through a symlink"
  [ "$RUNTIME_STATE_DIR" = "$RUNTIME_DIR/state" ] || \
    fatal "LEADDRIVE_RUNTIME_DIR/state must not resolve through a symlink"
  [ "$RUNTIME_ARCHIVE_DIR" = "$RUNTIME_DIR/checkout-archive" ] || \
    fatal "LEADDRIVE_RUNTIME_DIR/checkout-archive must not resolve through a symlink"
  HELP_VIDEO_ASSET_DIR_DEFAULT="$(canonical_external_path "HELP_VIDEO_ASSET_DIR" "${HELP_VIDEO_ASSET_DIR:-$RUNTIME_DIR/help-videos/player}")"
  case "$HELP_VIDEO_ASSET_DIR_DEFAULT" in
    */player) ;;
    *) fatal "HELP_VIDEO_ASSET_DIR must end in /player so rollback uses the same asset root" ;;
  esac
  HELP_VIDEO_RUNTIME_ROOT="$(canonical_external_path "HELP_VIDEO_RUNTIME_ROOT" "$(dirname -- "$HELP_VIDEO_ASSET_DIR_DEFAULT")")"
  MTM_DOCUMENT_STORAGE_DIR_RESOLVED="$(canonical_external_path "MTM_DOCUMENT_STORAGE_DIR" "${MTM_DOCUMENT_STORAGE_DIR:-$RUNTIME_UPLOADS_DIR/mtm-documents}")"
  VOICE_OPERATOR_STATE_DIR_RESOLVED="$(canonical_external_path "VOICE_OPERATOR_STATE_DIR" "${VOICE_OPERATOR_STATE_DIR:-$RUNTIME_STATE_DIR/operator}")"
  OPS_ROOT="$(canonical_external_path "OPS_ROOT" "$OPS_ROOT")"
  OPS_RELEASES_DIR="$OPS_ROOT/releases"
  OPS_CURRENT_LINK="$OPS_ROOT/current"
  OPS_ACTIVATION_JOURNAL="$OPS_ROOT/activation.journal"
  case "$MTM_DOCUMENT_STORAGE_DIR_RESOLVED" in
    "$RUNTIME_UPLOADS_DIR"/*) ;;
    *) fatal "MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical runtime uploads root" ;;
  esac
  case "$VOICE_OPERATOR_STATE_DIR_RESOLVED" in
    "$RUNTIME_STATE_DIR"/*) ;;
    *) fatal "VOICE_OPERATOR_STATE_DIR must stay inside the canonical runtime state root" ;;
  esac
  runtime_paths_overlap "$LOG_DIR" "$RUNTIME_DIR" && \
    fatal "LEADDRIVE_LOG_DIR must not overlap LEADDRIVE_RUNTIME_DIR"
  runtime_paths_overlap "$HELP_VIDEO_RUNTIME_ROOT" "$RUNTIME_UPLOADS_DIR" && \
    fatal "HELP_VIDEO_ASSET_DIR must not overlap runtime uploads"
  runtime_paths_overlap "$HELP_VIDEO_RUNTIME_ROOT" "$RUNTIME_STATE_DIR" && \
    fatal "HELP_VIDEO_ASSET_DIR must not overlap runtime state"
  runtime_paths_overlap "$HELP_VIDEO_RUNTIME_ROOT" "$RUNTIME_ARCHIVE_DIR" && \
    fatal "HELP_VIDEO_ASSET_DIR must not overlap runtime archive"
  runtime_paths_overlap "$OPS_ROOT" "$RUNTIME_DIR" && \
    fatal "OPS_ROOT must not overlap LEADDRIVE_RUNTIME_DIR"
  runtime_paths_overlap "$OPS_ROOT" "$LOG_DIR" && \
    fatal "OPS_ROOT must not overlap LEADDRIVE_LOG_DIR"
  assert_secure_existing_or_parent "LEADDRIVE_RUNTIME_DIR" "$RUNTIME_DIR"
  assert_secure_existing_or_parent "runtime uploads directory" "$RUNTIME_UPLOADS_DIR"
  assert_secure_existing_or_parent "runtime state directory" "$RUNTIME_STATE_DIR"
  assert_secure_existing_or_parent "runtime checkout archive directory" "$RUNTIME_ARCHIVE_DIR"
  assert_secure_existing_or_parent "LEADDRIVE_LOG_DIR" "$LOG_DIR"
  assert_secure_existing_or_parent "help-video runtime directory" "$HELP_VIDEO_RUNTIME_ROOT"
  assert_secure_existing_or_parent "MTM document storage directory" "$MTM_DOCUMENT_STORAGE_DIR_RESOLVED"
  assert_secure_existing_or_parent "voice operator state directory" "$VOICE_OPERATOR_STATE_DIR_RESOLVED"
  assert_secure_existing_or_parent "OPS_ROOT" "$OPS_ROOT"
}

runtime_paths_overlap() {
  local left="$1"
  local right="$2"
  [ "$left" = "$right" ] || [[ "$left" = "$right"/* ]] || [[ "$right" = "$left"/* ]]
}

configure_runtime_env_defaults() {
  append_env_if_missing "LEADDRIVE_RUNTIME_DIR" "$RUNTIME_DIR"
  append_env_if_missing "LEADDRIVE_LOG_DIR" "$LOG_DIR"
  append_env_if_missing "HELP_VIDEO_ASSET_DIR" "$HELP_VIDEO_ASSET_DIR_DEFAULT"
  append_env_if_missing "MTM_DOCUMENT_STORAGE_DIR" "$MTM_DOCUMENT_STORAGE_DIR_RESOLVED"
  append_env_if_missing "VOICE_OPERATOR_STATE_DIR" "$VOICE_OPERATOR_STATE_DIR_RESOLVED"
  configure_runtime_paths
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  [ -n "$value" ] || fatal "$name is required in $APP_ENV_FILE"
}

validate_nextauth_secret() {
  local value="$NEXTAUTH_SECRET"
  local byte_count unique_character_count

  [[ "$value" != *[[:space:]]* ]] || \
    fatal "NEXTAUTH_SECRET must not contain whitespace"

  case "${value,,}" in
    change-me-in-production|changeme|dev-secret-change-in-production|ld-dev-fallback-secret-change-me|ld-fallback-secret-change-me|nextauth-secret|replace-me|replace-with-a-random-secret|secret|your-secret-here)
      fatal "NEXTAUTH_SECRET is a known placeholder"
      ;;
  esac

  byte_count=$(LC_ALL=C printf '%s' "$value" | wc -c | tr -d '[:space:]')
  [ "$byte_count" -ge 32 ] || \
    fatal "NEXTAUTH_SECRET must be at least 32 bytes in production"

  unique_character_count=$(LC_ALL=C printf '%s' "$value" | fold -w1 | sort -u | wc -l | tr -d '[:space:]')
  [ "$unique_character_count" -ge 8 ] || \
    fatal "NEXTAUTH_SECRET has insufficient character diversity for production"
}

validate_redis_connection() {
  command -v node >/dev/null 2>&1 || fatal "node is required for Redis connectivity validation"

  # Probe with Node's built-in net/tls modules so the preflight does not depend
  # on redis-cli or the currently installed application dependencies. The URL
  # remains in the environment and is never printed.
  node <<'NODE' || fatal "cannot connect and authenticate to REDIS_URL"
const net = require("node:net")
const tls = require("node:tls")

const timeoutMs = 2_000

function resp(args) {
  return `*${args.length}\r\n${args.map((value) => {
    const text = String(value)
    return `$${Buffer.byteLength(text)}\r\n${text}\r\n`
  }).join("")}`
}

async function probe() {
  const target = new URL(process.env.REDIS_URL || "")
  if (target.protocol !== "redis:" && target.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://")
  }

  const commands = []
  const username = decodeURIComponent(target.username || "")
  const password = decodeURIComponent(target.password || "")
  if (password) commands.push(username ? ["AUTH", username, password] : ["AUTH", password])

  const databaseText = target.pathname.replace(/^\//, "")
  if (databaseText) {
    if (!/^\d+$/.test(databaseText)) throw new Error("invalid Redis database")
    commands.push(["SELECT", databaseText])
  }
  commands.push(["PING"])

  await new Promise((resolve, reject) => {
    let settled = false
    let buffer = ""
    let successfulReplies = 0
    let timer
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    const onConnected = () => socket.write(commands.map(resp).join(""))
    const socket = target.protocol === "rediss:"
      ? tls.connect({ host: target.hostname, port: Number(target.port || 6380), servername: target.hostname }, onConnected)
      : net.createConnection({ host: target.hostname, port: Number(target.port || 6379) }, onConnected)
    timer = setTimeout(() => finish(new Error("Redis probe timeout")), timeoutMs)

    socket.setEncoding("utf8")
    socket.on("error", finish)
    socket.on("data", (chunk) => {
      buffer += chunk
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n")
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (line.startsWith("-")) return finish(new Error("Redis rejected the probe"))
        if (line.startsWith("+")) successfulReplies += 1
        if (successfulReplies >= commands.length) return finish()
      }
    })
  })
}

probe().catch(() => { process.exitCode = 1 })
NODE
}

validate_database_roles() {
  local app_role_state migration_role_state
  local app_role app_super app_bypass app_login
  local migration_role migration_super migration_bypass migration_login
  local app_database_identity migration_database_identity
  local inaccessible_owner_count
  local app_set_privileged_count

  command -v psql >/dev/null 2>&1 || fatal "psql is required for database role validation"

  # A valid app role and a valid migration role are not sufficient if their
  # URLs point at different databases. PostgreSQL's control-system identifier
  # plus database OID/name identifies the physical cluster/database without
  # exposing either URL. The recovery bit also rejects an app connection that
  # silently lands on a standby while migrations target the primary.
  app_database_identity=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT (pg_control_system()).system_identifier::text,
            current_database(),
            (SELECT oid::text FROM pg_database WHERE datname = current_database()),
            pg_is_in_recovery()::int" 2>/dev/null) || \
    fatal "cannot identify the application PostgreSQL database"
  migration_database_identity=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT (pg_control_system()).system_identifier::text,
            current_database(),
            (SELECT oid::text FROM pg_database WHERE datname = current_database()),
            pg_is_in_recovery()::int" 2>/dev/null) || \
    fatal "cannot identify the migration PostgreSQL database"
  [ -n "$app_database_identity" ] && [ "$app_database_identity" = "$migration_database_identity" ] || \
    fatal "application and migration URLs do not identify the same PostgreSQL cluster/database"
  [ "${app_database_identity##*|}" = "0" ] || \
    fatal "application and migration URLs must target the writable PostgreSQL primary"

  app_role_state=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT session_user, rolsuper::int, rolbypassrls::int, rolcanlogin::int
     FROM pg_roles WHERE rolname = session_user" 2>/dev/null) || \
    fatal "cannot validate the application database role"
  IFS='|' read -r app_role app_super app_bypass app_login <<<"$app_role_state"

  migration_role_state=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT session_user, rolsuper::int, rolbypassrls::int, rolcanlogin::int
     FROM pg_roles WHERE rolname = session_user" 2>/dev/null) || \
    fatal "cannot validate the migration database role"
  IFS='|' read -r migration_role migration_super migration_bypass migration_login <<<"$migration_role_state"

  [ "$migration_role" = "$MIGRATION_EXPECTED_DB_ROLE" ] || \
    fatal "connected as migration role $migration_role; expected $MIGRATION_EXPECTED_DB_ROLE"
  [ "$app_role" != "$migration_role" ] || \
    fatal "application and migration connections must use different database roles"
  [ "$app_super" = "0" ] || fatal "application database role must not be superuser"
  [ "$app_bypass" = "0" ] || fatal "application database role must not have BYPASSRLS"
  [ "$app_login" = "1" ] || fatal "application database role is not LOGIN-enabled"
  [ "$migration_super" = "0" ] || fatal "migration database role must not be superuser"
  [ "$migration_bypass" = "1" ] || \
    fatal "migration database role must have BYPASSRLS for FORCE RLS backfills"
  [ "$migration_login" = "1" ] || fatal "migration database role is not LOGIN-enabled"

  # PostgreSQL 16 separates SET from inherited membership. NOSUPERUSER and
  # NOBYPASSRLS on the login itself are meaningless if it can SET ROLE into a
  # superuser/BYPASSRLS membership (including the migration role).
  app_set_privileged_count=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At \
    -v app_role="$app_role" 2>/dev/null <<'SQL'
SELECT count(*)
  FROM pg_catalog.pg_roles privileged
 WHERE privileged.rolname <> :'app_role'
   AND (privileged.rolsuper OR privileged.rolbypassrls)
   AND pg_catalog.pg_has_role(:'app_role', privileged.oid, 'SET');
SQL
  ) || fatal "cannot validate effective application SET ROLE privileges"
  [ "$app_set_privileged_count" = "0" ] || \
    fatal "application database role can SET ROLE into $app_set_privileged_count superuser/BYPASSRLS role(s)"

  # A promoted physical clone can retain system_identifier, database OID and
  # name. Prove liveness against the same instance: hold a uniquely named app
  # backend open, then require the migration connection to observe that exact
  # backend in its current database. No credential or URL is written to disk.
  local live_probe_name live_probe_log live_probe_pid live_probe_count
  local live_probe_seen=false
  live_probe_name="leaddrive-db-identity-$(tr -d '-' </proc/sys/kernel/random/uuid)"
  live_probe_log="$(mktemp /tmp/leaddrive-db-identity.XXXXXX)" || \
    fatal "cannot create database identity probe log"
  PGCONNECT_TIMEOUT=10 timeout 30 psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -v app_name="$live_probe_name" >"$live_probe_log" 2>&1 <<'SQL' &
SELECT set_config('application_name', :'app_name', false);
SELECT pg_sleep(20);
SQL
  live_probe_pid=$!
  for _attempt in $(seq 1 15); do
    live_probe_count=$(psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -v app_name="$live_probe_name" -v app_role="$app_role" 2>/dev/null <<'SQL' || true
SELECT count(*)
  FROM pg_catalog.pg_stat_activity
 WHERE datname = current_database()
   AND application_name = :'app_name'
   AND usename = :'app_role'
   AND backend_type = 'client backend';
SQL
    )
    if [ "$live_probe_count" = "1" ]; then
      live_probe_seen=true
      break
    fi
    kill -0 "$live_probe_pid" 2>/dev/null || break
    sleep 1
  done
  kill "$live_probe_pid" 2>/dev/null || true
  wait "$live_probe_pid" 2>/dev/null || true
  rm -f -- "$live_probe_log"
  [ "$live_probe_seen" = "true" ] || \
    fatal "application and migration URLs do not share the same live PostgreSQL database"

  EVENT_PLATFORM_DATABASE_IDENTITY="$migration_database_identity"

  # ALTER/DROP privileges are inherited through membership in an owning role,
  # not through ordinary table grants. Fail before the live bundle is touched
  # if the migration role cannot act on every user-owned relation in public.
  inaccessible_owner_count=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT count(DISTINCT c.relowner)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
       AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = session_user)
       AND NOT pg_has_role(session_user, c.relowner, 'MEMBER')" 2>/dev/null) || \
    fatal "cannot validate migration ownership membership"
  [ "$inaccessible_owner_count" = "0" ] || \
    fatal "migration role lacks membership in $inaccessible_owner_count public relation owner role(s)"

  log "Database roles verified: app=$app_role, migrations=$migration_role (NOSUPERUSER, BYPASSRLS)"
}

wait_for_migration_window() {
  local attempt table_exists
  local active_transactions live_system_jobs live_collector_jobs live_outbound_jobs

  # Sixty seconds was not enough, and the file already knew it: the no-migration
  # path skips this window entirely with a comment saying a collector lease
  # "simply never drops to 0 within 60s". The migration path had no such escape
  # and simply failed the deploy instead.
  #
  # Observed on 2026-08-25: three consecutive deploys died here, every attempt
  # reporting tx=1 system=1..2 — and a check seconds later found NO non-idle
  # session and NO running lease at all. Nothing is stuck; ordinary periodic
  # jobs are simply never all absent during one particular minute.
  #
  # Five minutes of five-second polls instead. This waits for quiet, it does not
  # force it: a genuinely stuck lease still fails the deploy rather than letting
  # a migration run underneath live work.
  local attempts=${MIGRATION_WINDOW_ATTEMPTS:-60}

  for attempt in $(seq 1 "$attempts"); do
    active_transactions=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT count(*) FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND state <> 'idle'" 2>/dev/null) || fatal "cannot inspect active database transactions"

    live_system_jobs=0
    table_exists=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT to_regclass('public.system_job_leases') IS NOT NULL" 2>/dev/null) || \
      fatal "cannot inspect system job lease availability"
    if [ "$table_exists" = "t" ]; then
      live_system_jobs=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
        "SELECT count(*) FROM system_job_leases
         WHERE status = 'running' AND \"leaseUntil\" > now()" 2>/dev/null) || \
        fatal "cannot inspect system job leases"
    fi

    live_collector_jobs=0
    table_exists=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT to_regclass('public.collector_runs') IS NOT NULL" 2>/dev/null) || \
      fatal "cannot inspect collector lease availability"
    if [ "$table_exists" = "t" ]; then
      live_collector_jobs=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
        "SELECT count(*) FROM collector_runs
         WHERE status IN ('running', 'claimed')
           AND \"finishedAt\" IS NULL
           AND \"leaseExpiresAt\" > now()" 2>/dev/null) || \
        fatal "cannot inspect collector leases"
    fi

    live_outbound_jobs=0
    table_exists=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT to_regclass('public.outbound_social_replies') IS NOT NULL" 2>/dev/null) || \
      fatal "cannot inspect outbound lease availability"
    if [ "$table_exists" = "t" ]; then
      live_outbound_jobs=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
        "SELECT count(*) FROM outbound_social_replies
         WHERE state = 'SENDING' AND \"leaseExpiresAt\" > now()" 2>/dev/null) || \
        fatal "cannot inspect outbound leases"
    fi

    if [ "$active_transactions" = "0" ] && \
       [ "$live_system_jobs" = "0" ] && \
       [ "$live_collector_jobs" = "0" ] && \
       [ "$live_outbound_jobs" = "0" ]; then
      log "Migration quiet window verified: no active transactions or live job leases"
      return 0
    fi

    if [ "$attempt" -lt "$attempts" ]; then
      # Logged every sixth attempt rather than every one: thirty seconds apart
      # reads as progress, five seconds apart reads as a hang and buries the
      # line that matters.
      if [ $((attempt % 6)) -eq 1 ] || [ "$attempt" -eq 1 ]; then
        log "Waiting for migration quiet window (tx=$active_transactions system=$live_system_jobs collector=$live_collector_jobs outbound=$live_outbound_jobs; attempt $attempt/$attempts)"
      fi
      sleep 5
    fi
  done

  fatal "migration quiet window unavailable after $((attempts * 5)) seconds (tx=$active_transactions system=$live_system_jobs collector=$live_collector_jobs outbound=$live_outbound_jobs)"
}

cleanup_event_platform_cutover_lock() {
  if [ -n "${EVENT_PLATFORM_CUTOVER_LOCK_PID:-}" ]; then
    kill "$EVENT_PLATFORM_CUTOVER_LOCK_PID" 2>/dev/null || true
    wait "$EVENT_PLATFORM_CUTOVER_LOCK_PID" 2>/dev/null || true
    EVENT_PLATFORM_CUTOVER_LOCK_PID=""
  fi
  if [ -n "${EVENT_PLATFORM_CUTOVER_LOCK_LOG:-}" ]; then
    rm -f -- "$EVENT_PLATFORM_CUTOVER_LOCK_LOG"
    EVENT_PLATFORM_CUTOVER_LOCK_LOG=""
  fi
}

cleanup_event_platform_backup_transient() {
  local cleanup_failed=0 mask_path enabled_state
  mask_path="/run/systemd/system/leaddrive-postgres-backup.service"
  if [ -n "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" ]; then
    case "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" in
      leaddrive-event-platform-backup-[0-9a-f]*.service)
        systemctl stop "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" >/dev/null 2>&1 || cleanup_failed=1
        systemctl reset-failed "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" >/dev/null 2>&1 || true
        ;;
      *)
        log "REFUSED cleanup of unexpected transient backup unit: $EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT"
        cleanup_failed=1
        ;;
    esac
  fi
  if [ "$EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED" = "true" ]; then
    if ! systemctl unmask --runtime leaddrive-postgres-backup.service >/dev/null 2>&1; then
      log "FATAL: cannot release the journaled PostgreSQL backup service mask"
      cleanup_failed=1
    fi
    enabled_state="$(systemctl is-enabled leaddrive-postgres-backup.service 2>/dev/null || true)"
    if [ -e "$mask_path" ] || [ -L "$mask_path" ] \
      || [ "$enabled_state" = "masked" ] || [ "$enabled_state" = "masked-runtime" ]; then
      log "FATAL: PostgreSQL backup service remains masked; durable recovery journal retained"
      cleanup_failed=1
    else
      EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED=false
    fi
  fi
  if [ "$cleanup_failed" -eq 0 ]; then
    EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT=""
    if [ -f "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ] \
      && [ ! -L "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ]; then
      unlink -- "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" \
        && sync -f -- "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" \
        || cleanup_failed=1
    fi
  fi
  if [ -n "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE" ]; then
    case "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE" in
      "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"/.pre-pilot-backup-transient.stage.*)
        unlink -- "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE" >/dev/null 2>&1 || true
        ;;
    esac
    EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE=""
  fi
  [ "$cleanup_failed" -eq 0 ]
}

recover_orphaned_event_platform_backup_transient() {
  local journal="$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL"
  local unit journal_sha journal_script_sha load_state mask_path fragment
  mask_path="/run/systemd/system/leaddrive-postgres-backup.service"

  if [ ! -e "$journal" ] && [ ! -L "$journal" ]; then
    case "$(systemctl is-enabled leaddrive-postgres-backup.service 2>/dev/null || true)" in
      masked|masked-runtime)
        fatal_after_standalone_replacement "PostgreSQL backup service is masked without a durable cutover journal"
        ;;
    esac
    return 0
  fi
  assert_root_owned_nonwritable_file "orphan transient-backup journal" "$journal"
  [ "$(stat -c '%a' "$journal")" = "600" ] || \
    fatal_after_standalone_replacement "orphan transient-backup journal must use mode 0600"
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
    END { if (NR != 5 || bad) exit 1 }
  ' "$journal" || \
    fatal_after_standalone_replacement "orphan transient-backup journal is malformed"
  unit="$(read_static_env_value "$journal" UNIT)"
  journal_sha="$(read_static_env_value "$journal" ARTIFACT_SHA)"
  journal_script_sha="$(read_static_env_value "$journal" SCRIPT_SHA256)"
  [ "$(read_static_env_value "$journal" FORMAT_VERSION)" = "1" ] \
    && [ "$(read_static_env_value "$journal" STATUS)" = "started" ] \
    && [[ "$unit" =~ ^leaddrive-event-platform-backup-[0-9a-f]{32}\.service$ ]] \
    && [[ "$journal_sha" =~ ^[0-9a-f]{40}$ ]] \
    && [[ "$journal_script_sha" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "orphan transient-backup journal has an invalid identity"

  load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
  if [ -n "$load_state" ] && [ "$load_state" != "not-found" ]; then
    fragment="$(systemctl show --property=FragmentPath --value "$unit" 2>/dev/null || true)"
    [ "$fragment" = "/run/systemd/transient/$unit" ] || \
      fatal_after_standalone_replacement "orphan backup unit is not a systemd transient unit"
    systemctl stop "$unit" >/dev/null || \
      fatal_after_standalone_replacement "cannot stop orphan exact-candidate backup unit"
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  fi
  if [ -e "$mask_path" ] || [ -L "$mask_path" ]; then
    [ -L "$mask_path" ] && [ "$(readlink -- "$mask_path")" = /dev/null ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service runtime mask has an unexpected target"
    systemctl unmask --runtime leaddrive-postgres-backup.service >/dev/null || \
      fatal_after_standalone_replacement "cannot release journaled PostgreSQL backup service mask"
  fi
  unlink -- "$journal" || \
    fatal_after_standalone_replacement "cannot clear recovered transient-backup journal"
  sync -f -- "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot durably clear recovered transient-backup journal"
  log "Recovered a journaled orphan exact-candidate backup fence from an interrupted deployment"
}

event_platform_cutover_state() {
  local gate_table gate_row applied_count

  gate_table=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT COALESCE(to_regclass('public.event_platform_cutover_gates')::text, '');" 2>/dev/null) || \
    fatal_after_standalone_replacement "cannot inspect event-platform cutover-gate relation"
  if [ -n "$gate_table" ]; then
    gate_row=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' \
      -v gate_key="$EVENT_PLATFORM_PILOT_GATE_KEY" 2>/dev/null <<'SQL'
SELECT "status", "migrationName"
  FROM public.event_platform_cutover_gates
 WHERE "gateKey" = :'gate_key';
SQL
    ) || fatal_after_standalone_replacement "cannot inspect event-platform Fund cutover gate"
    if [ -n "$gate_row" ]; then
      case "$gate_row" in
        "migration_applied|$EVENT_PLATFORM_PILOT_MIGRATION") printf 'migration_applied'; return 0 ;;
        "verified|$EVENT_PLATFORM_PILOT_MIGRATION")
          applied_count=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
            "SELECT count(*) FROM public._prisma_migrations
              WHERE migration_name = '$EVENT_PLATFORM_PILOT_MIGRATION'
                AND finished_at IS NOT NULL AND rolled_back_at IS NULL;" 2>/dev/null) || \
            fatal_after_standalone_replacement "cannot verify the completed Fund migration ledger"
          [ "$applied_count" = "1" ] || \
            fatal_after_standalone_replacement "verified Fund cutover gate has no unique successful migration ledger row"
          printf 'verified'
          return 0
          ;;
        *) fatal_after_standalone_replacement "Fund cutover gate has an invalid status or migration identity" ;;
      esac
    fi
  fi

  applied_count=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name = '$EVENT_PLATFORM_PILOT_MIGRATION'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL;" 2>/dev/null) || \
    fatal_after_standalone_replacement "cannot inspect event-platform pilot migration state"
  [ "$applied_count" = "0" ] || \
    fatal_after_standalone_replacement "successful Fund migration has no durable cutover-gate evidence"
  printf 'migration_pending'
}

validate_event_platform_atomic_prerequisite_artifact() {
  local standalone="$1"
  local failure_mode="${2:-recovery}"
  local sha_file="$standalone/.deploy-sha"
  local marker_file="$standalone/$EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER"

  assert_root_owned_nonwritable_directory "Fund atomic prerequisite standalone" "$standalone"
  assert_root_owned_nonwritable_file "Fund atomic prerequisite artifact SHA" "$sha_file"
  assert_root_owned_nonwritable_file "Fund atomic prerequisite contract marker" "$marker_file"
  [ "$(stat -c '%a' "$marker_file")" = "444" ] || \
    fail_event_platform_atomic_prerequisite "$failure_mode" \
      "Fund atomic prerequisite contract marker must have mode 0444"
  cmp -s -- "$sha_file" <(printf '%s\n' "$EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA") || \
    fail_event_platform_atomic_prerequisite "$failure_mode" \
      "previous artifact is not the exact approved atomic Fund prerequisite SHA"
  cmp -s -- "$marker_file" <(printf 'CONTRACT=%s\nARTIFACT_SHA=%s\n' \
    "$EVENT_PLATFORM_ATOMIC_PREREQUISITE_CONTRACT" "$EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA") || \
    fail_event_platform_atomic_prerequisite "$failure_mode" \
      "previous artifact has no exact atomic Fund prerequisite contract proof"
}

fail_event_platform_atomic_prerequisite() {
  local failure_mode="$1"
  local message="$2"

  if [ "$failure_mode" = "pre_swap" ]; then
    fatal "$message"
  fi
  [ "$failure_mode" = "recovery" ] || fatal "unknown Fund prerequisite failure mode"
  fatal_after_standalone_replacement "$message"
}

validate_event_platform_atomic_prerequisite_live() {
  local live_sha

  live_sha=$(
    curl --fail --silent --show-error --max-time 15 \
      --header 'Cache-Control: no-cache' \
      "$HEALTH_URL/api/v1/public/build-info?fund-cutover=$ARTIFACT_DEPLOY_SHA" \
      | node -e 'let body=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => { body += chunk }); process.stdin.on("end", () => { try { const sha = JSON.parse(body).artifactSha; if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) process.exit(2); process.stdout.write(sha) } catch { process.exit(3) } })'
  ) || fatal "cannot prove the exact live Fund atomic prerequisite revision"
  [ "$live_sha" = "$EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA" ] || \
    fatal "live Fund writer is not the exact approved atomic prerequisite revision"
  log "Exact atomic Fund prerequisite is both backed up and live: ${live_sha:0:12}"
}

sync_event_platform_previous_standalone() {
  local previous_standalone="${EVENT_PLATFORM_PREVIOUS_STANDALONE_PATH:-$BACKUP_PATH/standalone}"
  [ -d "$previous_standalone" ] && [ ! -L "$previous_standalone" ] || \
    fatal_after_standalone_replacement "Fund cutover has no regular previous standalone backup to persist"
  # cp returning proves the page cache accepted the bytes, not that the full
  # rollback server/ecosystem tree survived a power loss. This one-time global
  # durability barrier precedes publication of the recovery manifest and the
  # PM2 stop fence.
  sync || fatal_after_standalone_replacement "cannot durably flush the full previous standalone backup"
  log "Durably flushed the full previous standalone rollback artifact"
}

validate_event_platform_recovery_state() {
  local manifest="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/manifest"
  local checksum="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/legacy-client.sha256"
  local stored_database_identity stored_migration stored_artifact_sha stored_standalone_path
  local canonical_backup_root canonical_standalone backup_leaf

  assert_secure_operations_tree "event-platform durable Fund recovery state" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"
  assert_root_owned_nonwritable_file "event-platform Fund recovery manifest" "$manifest"
  assert_root_owned_nonwritable_file "event-platform legacy-client checksum" "$checksum"
  [ -d "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/@prisma/client" ] \
    && [ ! -L "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/@prisma/client" ] \
    && [ -d "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/.prisma/client" ] \
    && [ ! -L "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/.prisma/client" ] || \
    fatal_after_standalone_replacement "durable Fund recovery state has no exact previous Prisma client"

  stored_database_identity=$(read_static_env_value "$manifest" DATABASE_IDENTITY) || \
    fatal_after_standalone_replacement "Fund recovery manifest contains duplicate DATABASE_IDENTITY keys"
  stored_migration=$(read_static_env_value "$manifest" MIGRATION_NAME) || \
    fatal_after_standalone_replacement "Fund recovery manifest contains duplicate MIGRATION_NAME keys"
  stored_artifact_sha=$(read_static_env_value "$manifest" PREVIOUS_ARTIFACT_SHA) || \
    fatal_after_standalone_replacement "Fund recovery manifest contains duplicate PREVIOUS_ARTIFACT_SHA keys"
  stored_standalone_path=$(read_static_env_value "$manifest" PREVIOUS_STANDALONE_PATH) || \
    fatal_after_standalone_replacement "Fund recovery manifest contains duplicate PREVIOUS_STANDALONE_PATH keys"
  [ "$stored_database_identity" = "$EVENT_PLATFORM_DATABASE_IDENTITY" ] || \
    fatal_after_standalone_replacement "durable Fund recovery state belongs to a different PostgreSQL database"
  [ "$stored_migration" = "$EVENT_PLATFORM_PILOT_MIGRATION" ] || \
    fatal_after_standalone_replacement "durable Fund recovery state names a different migration"
  [[ "$stored_artifact_sha" =~ ^[0-9a-f]{40}$ ]] || \
    fatal_after_standalone_replacement "durable Fund recovery state has an invalid previous artifact SHA"
  [ "$stored_artifact_sha" = "$EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA" ] || \
    fatal_after_standalone_replacement "durable Fund recovery state is not pinned to the approved atomic prerequisite"
  canonical_backup_root=$(realpath -e -- "$BACKUP_DIR") || \
    fatal_after_standalone_replacement "cannot resolve deployment backup root for Fund recovery"
  canonical_standalone=$(realpath -e -- "$stored_standalone_path") || \
    fatal_after_standalone_replacement "durable previous standalone backup is missing"
  backup_leaf="${canonical_standalone#"$canonical_backup_root"/}"
  [ "$canonical_standalone" != "$canonical_backup_root" ] \
    && [[ "$backup_leaf" =~ ^backup-[^/]+/standalone$ ]] || \
    fatal_after_standalone_replacement "durable previous standalone path is outside the deployment backup root"
  assert_root_owned_nonwritable_directory "durable previous standalone backup" "$canonical_standalone"
  validate_event_platform_atomic_prerequisite_artifact "$canonical_standalone"
  [ -f "$canonical_standalone/.deploy-sha" ] && [ ! -L "$canonical_standalone/.deploy-sha" ] \
    && [ "$(tr -d '\r\n' < "$canonical_standalone/.deploy-sha")" = "$stored_artifact_sha" ] || \
    fatal_after_standalone_replacement "durable previous standalone backup no longer matches its artifact SHA"

  (cd "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules" \
    && sha256sum --check ../legacy-client.sha256 >/dev/null) || \
    fatal_after_standalone_replacement "durable previous Prisma client changed after the cutover fence"
  EVENT_PLATFORM_PREVIOUS_ARTIFACT_SHA="$stored_artifact_sha"
  EVENT_PLATFORM_PREVIOUS_STANDALONE_PATH="$canonical_standalone"
  EVENT_PLATFORM_PREVIOUS_CLIENT_HASH=$(sha256sum "$checksum" | awk '{print $1}') || \
    fatal_after_standalone_replacement "cannot hash durable previous-client evidence"
  [[ "$EVENT_PLATFORM_PREVIOUS_CLIENT_HASH" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "durable previous-client evidence hash is invalid"
}

prepare_event_platform_recovery_state() {
  local source_root="$BACKUP_PATH/standalone/node_modules"
  local source_sha_file="$BACKUP_PATH/standalone/.deploy-sha"
  local source_sha parent stage unsafe

  if [ -e "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" ] || [ -L "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" ]; then
    validate_event_platform_recovery_state
    # A SIGKILL after extraction but before the migration leaves candidate
    # bytes at the generic standalone path. The durable copy, not the new
    # rotating BACKUP_PATH, remains the authoritative pre-pilot client.
    return 0
  fi

  validate_event_platform_atomic_prerequisite_artifact "$BACKUP_PATH/standalone" pre_swap
  [ -d "$source_root/@prisma/client" ] && [ ! -L "$source_root/@prisma/client" ] \
    && [ -d "$source_root/.prisma/client" ] && [ ! -L "$source_root/.prisma/client" ] || \
    fatal_after_standalone_replacement "previous standalone has no self-contained Prisma rollback client"
  [ -f "$source_sha_file" ] && [ ! -L "$source_sha_file" ] || \
    fatal_after_standalone_replacement "previous standalone has no immutable artifact SHA"
  source_sha=$(tr -d '\r\n' < "$source_sha_file")
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || \
    fatal_after_standalone_replacement "previous standalone artifact SHA is invalid"
  unsafe=$(find "$source_root/@prisma/client" "$source_root/.prisma/client" -xdev \
    \( -type l -o \( ! -type d -a ! -type f \) \) -print -quit) || \
    fatal_after_standalone_replacement "cannot inspect previous Prisma client tree"
  [ -z "$unsafe" ] || \
    fatal_after_standalone_replacement "previous Prisma client contains a symlink or special file: $unsafe"

  parent=$(dirname -- "$EVENT_PLATFORM_PILOT_RECOVERY_DIR")
  ensure_secure_root_directory "event-platform recovery parent" "$parent" "0700"
  stage=$(mktemp -d "$parent/.event-platform-fund-v1.XXXXXX") || \
    fatal_after_standalone_replacement "cannot stage durable Fund recovery state"
  # The directory MUST be called `node_modules`. `@prisma/client` is a thin
  # wrapper whose own code does `require(".prisma/client/default")`, and Node
  # resolves that bare specifier only through ancestor directories literally
  # named `node_modules`. Staged as `legacy-node_modules` the sibling `.prisma`
  # sits right there and is still invisible: the require throws
  # `Cannot find module '.prisma/client/default'`, the probe exits non-zero,
  # and the deploy reports "the exact previous Prisma client is incompatible
  # with the migrated Fund schema" — a schema verdict for a filename bug, after
  # the migration has already committed and PM2 is stopped. That is how
  # production stayed down on 2026-09-07. Renaming this back reintroduces it.
  install -d -m 0700 "$stage/node_modules/@prisma" "$stage/node_modules/.prisma"
  cp -a -- "$source_root/@prisma/client" "$stage/node_modules/@prisma/client"
  cp -a -- "$source_root/.prisma/client" "$stage/node_modules/.prisma/client"
  (
    cd "$stage/node_modules"
    find . -xdev -type f -print0 | sort -z | xargs -0 sha256sum > ../legacy-client.sha256
  ) || fatal_after_standalone_replacement "cannot hash staged previous Prisma client"
  umask 077
  printf 'DATABASE_IDENTITY=%s\nMIGRATION_NAME=%s\nPREVIOUS_ARTIFACT_SHA=%s\nPREVIOUS_STANDALONE_PATH=%s\n' \
    "$EVENT_PLATFORM_DATABASE_IDENTITY" "$EVENT_PLATFORM_PILOT_MIGRATION" "$source_sha" \
    "$BACKUP_PATH/standalone" > "$stage/manifest"
  chown -R root:root "$stage"
  find "$stage" -type d -exec chmod 0700 {} +
  find "$stage" -type f -exec chmod 0600 {} +
  assert_secure_operations_tree "staged event-platform Fund recovery state" "$stage"
  sync -f -- "$stage" "$parent" || \
    fatal_after_standalone_replacement "cannot persist staged Fund recovery state"
  mv -- "$stage" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot publish durable Fund recovery state"
  sync -f -- "$parent" || \
    fatal_after_standalone_replacement "cannot persist the Fund recovery-state directory entry"
  validate_event_platform_recovery_state
  log "Persisted exact previous Prisma client and artifact identity outside rotating deployment backups"
}

validate_event_platform_recovery_evidence() {
  local evidence_record evidence_file checksum_line_count source_identity_sha
  local format status object_bucket object_key object_version retention_tier retention_days
  local ciphertext_bytes ciphertext_sha retain_until invocation artifact_sha script_sha backup_env_sha created_at
  local migration_ledger_sha recovery_db_contract_sha
  local current_backup_env_sha object_created_at object_directory object_created_iso created_iso
  local object_created_epoch created_epoch
  local configured_bucket endpoint region monthly_policy
  local remote_head remote_bytes remote_version remote_sha remote_tier
  local remote_retention remote_mode remote_until evidence_until_epoch remote_until_epoch now_epoch

  if [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then
    validate_plain_recovery_point_evidence
    return 0
  fi

  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.log"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.env"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.sha256"
  evidence_record="$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD"
  for evidence_file in \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE" \
    "$evidence_record" \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM"; do
    assert_root_owned_nonwritable_file "pre-pilot PostgreSQL recovery-point evidence" "$evidence_file"
    [ "$(stat -c '%a' "$evidence_file")" = "600" ] || \
      fatal_after_standalone_replacement "pre-pilot PostgreSQL recovery-point evidence must use mode 0600"
  done
  checksum_line_count="$(wc -l <"$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" | tr -d '[:space:]')"
  [ "$checksum_line_count" = "2" ] \
    && [ "$(grep -Ec '^[0-9a-f]{64}  pre-pilot-backup\.log$' "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" || true)" = "1" ] \
    && [ "$(grep -Ec '^[0-9a-f]{64}  pre-pilot-backup\.env$' "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" || true)" = "1" ] \
    && (cd "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" \
      && sha256sum --check "$(basename -- "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM")" >/dev/null) || \
    fatal_after_standalone_replacement "verified pre-pilot PostgreSQL recovery-point evidence is missing or changed"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH=$(awk '$2 == "pre-pilot-backup.log" { print $1 }' \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM")
  [[ "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "pre-pilot PostgreSQL recovery-point evidence hash is invalid"

  format="$(read_static_env_value "$evidence_record" FORMAT_VERSION)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate FORMAT_VERSION"
  status="$(read_static_env_value "$evidence_record" STATUS)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate STATUS"
  object_bucket="$(read_static_env_value "$evidence_record" OBJECT_BUCKET)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate OBJECT_BUCKET"
  object_key="$(read_static_env_value "$evidence_record" OBJECT_KEY)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate OBJECT_KEY"
  object_version="$(read_static_env_value "$evidence_record" OBJECT_VERSION_ID)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate OBJECT_VERSION_ID"
  retention_tier="$(read_static_env_value "$evidence_record" RETENTION_TIER)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate RETENTION_TIER"
  retention_days="$(read_static_env_value "$evidence_record" RETENTION_DAYS)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate RETENTION_DAYS"
  ciphertext_bytes="$(read_static_env_value "$evidence_record" CIPHERTEXT_BYTES)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate CIPHERTEXT_BYTES"
  ciphertext_sha="$(read_static_env_value "$evidence_record" CIPHERTEXT_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate CIPHERTEXT_SHA256"
  retain_until="$(read_static_env_value "$evidence_record" RETAIN_UNTIL)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate RETAIN_UNTIL"
  invocation="$(read_static_env_value "$evidence_record" SYSTEMD_INVOCATION_ID)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate SYSTEMD_INVOCATION_ID"
  artifact_sha="$(read_static_env_value "$evidence_record" ARTIFACT_SHA)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate ARTIFACT_SHA"
  script_sha="$(read_static_env_value "$evidence_record" POSTGRES_BACKUP_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate POSTGRES_BACKUP_SHA256"
  backup_env_sha="$(read_static_env_value "$evidence_record" BACKUP_ENV_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate BACKUP_ENV_SHA256"
  source_identity_sha="$(read_static_env_value "$evidence_record" SOURCE_DATABASE_IDENTITY_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate SOURCE_DATABASE_IDENTITY_SHA256"
  migration_ledger_sha="$(read_static_env_value "$evidence_record" SOURCE_MIGRATION_LEDGER_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate SOURCE_MIGRATION_LEDGER_SHA256"
  recovery_db_contract_sha="$(read_static_env_value "$evidence_record" RECOVERY_DB_CONTRACT_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate RECOVERY_DB_CONTRACT_SHA256"
  created_at="$(read_static_env_value "$evidence_record" CREATED_AT_UTC)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate CREATED_AT_UTC"

  monthly_policy="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_RETENTION_MONTHLY_DAYS)" || \
    fatal_after_standalone_replacement "backup environment has duplicate monthly retention policy"
  monthly_policy="${monthly_policy:-400}"
  configured_bucket="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_BUCKET)" || \
    fatal_after_standalone_replacement "backup environment has duplicate object bucket"
  endpoint="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" || \
    fatal_after_standalone_replacement "backup environment has duplicate object endpoint"
  region="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" || \
    fatal_after_standalone_replacement "backup environment has duplicate object region"
  current_backup_env_sha="$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" || \
    fatal_after_standalone_replacement "cannot hash the current PostgreSQL backup environment"
  [ "$format:$status:$retention_tier" = "2:verified:monthly" ] \
    && [ -n "$configured_bucket" ] && [ "$object_bucket" = "$configured_bucket" ] \
    && [ "$endpoint" = "https://${region}.your-objectstorage.com" ] \
    && [[ "$object_key" =~ ^postgres/monthly/[0-9]{4}/[0-9]{2}/leaddrive-postgres-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.age$ ]] \
    && [[ "$object_version" =~ ^[^[:space:]]{1,1024}$ ]] \
    && [[ "$retention_days" =~ ^[0-9]+$ ]] && [[ "$monthly_policy" =~ ^[0-9]+$ ]] \
    && [ "$retention_days" -ge "$monthly_policy" ] \
    && [[ "$ciphertext_bytes" =~ ^[0-9]+$ ]] && [ "$ciphertext_bytes" -ge 1048576 ] \
    && [[ "$ciphertext_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$invocation" =~ ^[0-9a-f]{32}$ ]] \
    && [ "$artifact_sha" = "$ARTIFACT_DEPLOY_SHA" ] \
    && [ "$script_sha" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ] \
    && [ "$backup_env_sha" = "$current_backup_env_sha" ] \
    && [[ "$source_identity_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$migration_ledger_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$created_at" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || \
    fatal_after_standalone_replacement "pre-pilot recovery record is incomplete, stale for this artifact/configuration, or outside the reviewed monthly policy"
  object_created_at="${object_key##*/leaddrive-postgres-}"
  object_created_at="${object_created_at%%-*}"
  object_directory="${object_key%/*}"
  [ "$object_directory" = "postgres/monthly/${object_created_at:0:4}/${object_created_at:4:2}" ] \
    || fatal_after_standalone_replacement "pre-pilot recovery object path does not match its embedded creation time"
  object_created_iso="${object_created_at:0:4}-${object_created_at:4:2}-${object_created_at:6:2}T${object_created_at:9:2}:${object_created_at:11:2}:${object_created_at:13:2}Z"
  created_iso="${created_at:0:4}-${created_at:4:2}-${created_at:6:2}T${created_at:9:2}:${created_at:11:2}:${created_at:13:2}Z"
  object_created_epoch="$(date -u -d "$object_created_iso" '+%s' 2>/dev/null || true)"
  created_epoch="$(date -u -d "$created_iso" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  # A migration_applied retry may deliberately reuse this frozen recovery
  # point while writes remain fenced. Bind it to the exact candidate/config,
  # bound its original run to the four-hour transient unit, and independently
  # require active remote retention below instead of weakening the retry by age.
  [[ "$object_created_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$created_epoch" =~ ^[0-9]+$ ]] \
    && [ "$created_epoch" -ge "$object_created_epoch" ] \
    && [ "$created_epoch" -le $((object_created_epoch + 14700)) ] \
    && [ "$created_epoch" -le $((now_epoch + 300)) ] || \
    fatal_after_standalone_replacement "pre-pilot recovery timestamps are invalid or outside the reviewed backup run window"
  [ -n "$EVENT_PLATFORM_DATABASE_IDENTITY" ] \
    && [ "$(printf '%s' "$EVENT_PLATFORM_DATABASE_IDENTITY" | sha256sum | awk '{print $1}')" = "$source_identity_sha" ] || \
    fatal_after_standalone_replacement "pre-pilot recovery point belongs to another database instance"
  [ "$(read_static_env_value "$BACKUP_OFFLINE_RESTORE_MARKER" SOURCE_MIGRATION_LEDGER_SHA256)" = \
      "$migration_ledger_sha" ] \
    && [ "$(read_static_env_value "$BACKUP_OFFLINE_RESTORE_MARKER" RECOVERY_DB_CONTRACT_SHA256)" = \
      "$recovery_db_contract_sha" ] || \
    fatal_after_standalone_replacement \
      "pre-pilot recovery point does not match the signed migration ledger and DB contract"

  assert_root_owned_nonwritable_file "pinned AWS CLI resolved binary" "$BACKUP_AWS_REAL_BIN"
  assert_root_owned_nonwritable_file "pinned AWS CLI provenance" "$BACKUP_AWS_PROVENANCE"
  [ -x "$BACKUP_AWS_BIN" ] \
    && [ -L "$BACKUP_AWS_ROOT/v2/current" ] \
    && [ "$(readlink -- "$BACKUP_AWS_ROOT/v2/current")" = "$BACKUP_AWS_ROOT/v2/$BACKUP_AWS_VERSION" ] \
    && [ "$(readlink -f -- "$BACKUP_AWS_BIN")" = "$BACKUP_AWS_REAL_BIN" ] \
    && [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" VERSION)" = "$BACKUP_AWS_VERSION" ] \
    && [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" ARCHIVE_SHA256)" = "$BACKUP_AWS_ARCHIVE_SHA256" ] \
    && [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" SIGNING_FINGERPRINT)" = "$BACKUP_AWS_SIGNING_FINGERPRINT" ] || \
    fatal_after_standalone_replacement "commissioned AWS CLI is unavailable for immutable recovery-point validation"
  remote_head="$(run_pinned_backup_aws 45 s3api head-object \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --bucket "$object_bucket" --key "$object_key" --version-id="$object_version" \
    --query '[ContentLength,VersionId,Metadata.sha256,Metadata.tier]' --output text 2>/dev/null)" || \
    fatal_after_standalone_replacement "cannot re-read the exact pre-pilot PostgreSQL object version"
  read -r remote_bytes remote_version remote_sha remote_tier <<<"$remote_head"
  [ "$remote_bytes" = "$ciphertext_bytes" ] \
    && [ "$remote_version" = "$object_version" ] \
    && [ "$remote_sha" = "$ciphertext_sha" ] \
    && [ "$remote_tier" = "monthly" ] || \
    fatal_after_standalone_replacement "exact pre-pilot PostgreSQL object metadata changed or is incomplete"
  remote_retention="$(run_pinned_backup_aws 45 s3api get-object-retention \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --bucket "$object_bucket" --key "$object_key" --version-id="$object_version" \
    --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" || \
    fatal_after_standalone_replacement "cannot re-read retention for the exact pre-pilot PostgreSQL object version"
  read -r remote_mode remote_until <<<"$remote_retention"
  evidence_until_epoch="$(date -u -d "$retain_until" '+%s' 2>/dev/null || true)"
  remote_until_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null || true)"
  [ "$remote_mode" = "COMPLIANCE" ] \
    && [[ "$evidence_until_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$remote_until_epoch" =~ ^[0-9]+$ ]] \
    && [ "$remote_until_epoch" -ge "$evidence_until_epoch" ] \
    && [ "$remote_until_epoch" -gt "$now_epoch" ] || \
    fatal_after_standalone_replacement "exact pre-pilot PostgreSQL object no longer has the recorded active COMPLIANCE retention"
}

harden_pm2_reboot_dump() {
  local saved_dump="$PM2_HOME/dump.pm2"
  [ -f "$saved_dump" ] && [ ! -L "$saved_dump" ] \
    && [ "$(stat -c '%U:%G' "$saved_dump")" = "root:root" ] || {
    log "FATAL: PM2 reboot dump must be a root-owned regular file"
    return 1
  }
  chmod 0600 -- "$saved_dump" || {
    log "FATAL: cannot restrict PM2 reboot dump to root-only"
    return 1
  }
  [ "$(stat -c '%U:%G:%a' "$saved_dump")" = "root:root:600" ] || {
    log "FATAL: PM2 reboot dump must be root:root mode 0600"
    return 1
  }
  sync -f -- "$saved_dump" "$PM2_HOME" || {
    log "FATAL: cannot fsync the PM2 reboot state"
    return 1
  }
}

persist_event_platform_pm2_stop_fence() {
  local protected_ids live_processes saved_processes
  local live_state
  local saved_dump="$PM2_HOME/dump.pm2"

  live_state=$(mktemp /tmp/leaddrive-event-platform-pm2-live.XXXXXX) || \
    fatal_after_standalone_replacement "cannot create PM2 fence inspection file"
  pm2 jlist >"$live_state" || {
    rm -f -- "$live_state"
    fatal_after_standalone_replacement "cannot inspect live PM2 state before the Fund fence"
  }
  protected_ids=$(node - "$live_state" "$PM2_PROCESS" softphone-relay \
    "$APP_DIR/.next/standalone" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const [file, ...args] = process.argv.slice(2)
const standaloneRoot = path.resolve(args.pop())
const protectedNames = new Set(args)
const processes = JSON.parse(fs.readFileSync(file, "utf8"))
const underStandalone = (value) => {
  if (typeof value !== "string" || value.length === 0) return false
  const resolved = path.resolve(value)
  return resolved === standaloneRoot || resolved.startsWith(`${standaloneRoot}${path.sep}`)
}
const usesProtectedPort = (env) => String((env.env && env.env.PORT) ?? env.PORT ?? "") === "3001"
for (const item of processes) {
  const env = item && item.pm2_env ? item.pm2_env : (item || {})
  if (protectedNames.has(item.name || env.name)
      || underStandalone(env.pm_exec_path)
      || underStandalone(env.pm_cwd)
      || underStandalone(env.cwd)
      || usesProtectedPort(env)) {
    if (!Number.isInteger(item.pm_id) || item.pm_id < 0) throw new Error("protected PM2 entry has no numeric id")
    process.stdout.write(`${item.pm_id}\n`)
  }
}
NODE
  ) || {
    rm -f -- "$live_state"
    fatal_after_standalone_replacement "cannot classify live PM2 processes for the Fund fence"
  }
  rm -f -- "$live_state"
  # Everything above is read-only. Mark the handoff only immediately before
  # the first PM2 mutation so an inspection failure cannot restart a healthy
  # old process or rewrite its still-live standalone tree.
  HANDOFF_STARTED=true
  while IFS= read -r process_id; do
    [ -n "$process_id" ] || continue
    pm2 delete "$process_id" >/dev/null || \
      fatal_after_standalone_replacement "cannot delete standalone-backed PM2 process $process_id"
  done <<< "$protected_ids"
  pm2 delete "$PM2_PROCESS" 2>/dev/null || true
  pm2 delete softphone-relay 2>/dev/null || true
  fuser -k 3001/tcp 2>/dev/null || true
  if fuser 3001/tcp >/dev/null 2>&1; then
    fatal_after_standalone_replacement "a process still owns the protected web port after the Fund fence"
  fi

  live_state=$(mktemp /tmp/leaddrive-event-platform-pm2-live.XXXXXX) || \
    fatal_after_standalone_replacement "cannot create post-stop PM2 inspection file"
  pm2 jlist >"$live_state" || {
    rm -f -- "$live_state"
    fatal_after_standalone_replacement "cannot inspect live PM2 state after the Fund fence"
  }
  live_processes=$(node - "$live_state" "$PM2_PROCESS" softphone-relay \
    "$APP_DIR/.next/standalone" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const [file, ...args] = process.argv.slice(2)
const standaloneRoot = path.resolve(args.pop())
const protectedNames = new Set(args)
const processes = JSON.parse(fs.readFileSync(file, "utf8"))
const underStandalone = (value) => {
  if (typeof value !== "string" || value.length === 0) return false
  const resolved = path.resolve(value)
  return resolved === standaloneRoot || resolved.startsWith(`${standaloneRoot}${path.sep}`)
}
const usesProtectedPort = (env) => String((env.env && env.env.PORT) ?? env.PORT ?? "") === "3001"
process.stdout.write(String(processes.filter((item) => {
  const env = item && item.pm2_env ? item.pm2_env : (item || {})
  return protectedNames.has(item.name || env.name)
    || underStandalone(env.pm_exec_path)
    || underStandalone(env.pm_cwd)
    || underStandalone(env.cwd)
    || usesProtectedPort(env)
}).length))
NODE
  ) || {
    rm -f -- "$live_state"
    fatal_after_standalone_replacement "cannot verify live PM2 state after the Fund fence"
  }
  rm -f -- "$live_state"
  [ "$live_processes" = "0" ] || \
    fatal_after_standalone_replacement "PM2 still owns a named or standalone-backed process after Fund quiesce"

  pm2 save --force >/dev/null || \
    fatal_after_standalone_replacement "cannot persist the stopped PM2 state before replacing standalone"
  harden_pm2_reboot_dump || \
    fatal_after_standalone_replacement "cannot harden the stopped PM2 reboot fence"
  saved_processes=$(node - "$saved_dump" "$PM2_PROCESS" softphone-relay \
    "$APP_DIR/.next/standalone" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const [file, ...args] = process.argv.slice(2)
const standaloneRoot = path.resolve(args.pop())
const protectedNames = new Set(args)
const processes = JSON.parse(fs.readFileSync(file, "utf8"))
const underStandalone = (value) => {
  if (typeof value !== "string" || value.length === 0) return false
  const resolved = path.resolve(value)
  return resolved === standaloneRoot || resolved.startsWith(`${standaloneRoot}${path.sep}`)
}
const usesProtectedPort = (env) => String((env.env && env.env.PORT) ?? env.PORT ?? "") === "3001"
process.stdout.write(String(processes.filter((item) => {
  const env = item && item.pm2_env ? item.pm2_env : (item || {})
  return protectedNames.has(item.name || env.name)
    || underStandalone(env.pm_exec_path)
    || underStandalone(env.pm_cwd)
    || underStandalone(env.cwd)
    || usesProtectedPort(env)
}).length))
NODE
  ) || fatal_after_standalone_replacement "cannot parse persisted PM2 state after the Fund reboot fence"
  [ "$saved_processes" = "0" ] || \
    fatal_after_standalone_replacement "persisted PM2 state can resurrect a named or standalone-backed artifact"
  log "Persisted PM2 reboot fence: web and softphone processes cannot resurrect during Fund verification"
}

quiesce_event_platform_pilot() {
  local lock_count="0"
  local attempt

  case "$EVENT_PLATFORM_CUTOVER_STATE" in
    migration_pending|migration_applied) ;;
    *) fatal_after_standalone_replacement "invalid Fund cutover state before quiesce" ;;
  esac

  # The pinned expand artifact is INSERT-first and performs the ledger row plus
  # conditional Fund update in one transaction. ACCESS EXCLUSIVE on the ledger
  # therefore waits for every started money transaction to commit both writes,
  # and blocks every new request before it can touch funds. Taking the Fund lock
  # next drains direct metadata writes. Both granted locks are the proof; there
  # is deliberately no time-based request-drain heuristic.
  EVENT_PLATFORM_CUTOVER_LOCK_LOG=$(mktemp /tmp/leaddrive-event-platform-cutover-lock.XXXXXX) || \
    fatal_after_standalone_replacement "cannot create event-platform cutover evidence log"
  PGAPPNAME=leaddrive-event-platform-cutover-lock \
    timeout 360 psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 >"$EVENT_PLATFORM_CUTOVER_LOCK_LOG" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL lock_timeout = '120s';
LOCK TABLE public.fund_transactions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.funds IN ACCESS EXCLUSIVE MODE;
SELECT pg_sleep(180);
ROLLBACK;
SQL
  EVENT_PLATFORM_CUTOVER_LOCK_PID=$!

  for attempt in $(seq 1 150); do
    lock_count=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT count(DISTINCT c.relname) FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.application_name = 'leaddrive-event-platform-cutover-lock'
         AND n.nspname = 'public'
         AND c.relname IN ('fund_transactions', 'funds')
         AND l.mode = 'AccessExclusiveLock' AND l.granted" 2>/dev/null) || lock_count="0"
    [ "$lock_count" = "2" ] && break
    kill -0 "$EVENT_PLATFORM_CUTOVER_LOCK_PID" 2>/dev/null || {
      cat "$EVENT_PLATFORM_CUTOVER_LOCK_LOG" >&2 || true
      fatal_after_standalone_replacement "event-platform cutover could not lock both Fund tables"
    }
    sleep 1
  done
  [ "$lock_count" = "2" ] || {
    cleanup_event_platform_cutover_lock
    fatal_after_standalone_replacement "event-platform cutover timed out proving the atomic Fund drain"
  }

  # Stop only after both locks prove all old writes are either fully committed
  # or blocked before their first ledger statement. Killing blocked requests
  # rolls their whole interactive transaction back. A crash after the save
  # leaves a durable empty PM2 reboot target.
  persist_event_platform_pm2_stop_fence

  kill -0 "$EVENT_PLATFORM_CUTOVER_LOCK_PID" 2>/dev/null || {
    cat "$EVENT_PLATFORM_CUTOVER_LOCK_LOG" >&2 || true
    cleanup_event_platform_cutover_lock
    fatal_after_standalone_replacement "event-platform cutover lock holder exited during the PM2 fence"
  }

  cleanup_event_platform_cutover_lock
  wait_for_migration_window
  log "Event-platform cutover quiesced: atomic Fund locks proved and old web process stopped"
}

## A bootstrap certificate is a one-time genesis authorization, not a rolling
## recovery point.  Once a full certificate has been created, normal releases
## must be able to validate the original authorization even after its old
## DB/secrets/runtime payloads have naturally expired and the production
## recovery-set secrets have rotated.  This validator therefore proves the
## *historical record* end-to-end without consulting mutable current state.
##
## It is deliberately called only by validate_bootstrap_certificate_chain.  A
## first recovery-bootstrap deployment still uses the current profile below,
## which requires fresh evidence, current code, and live Object Lock objects.
validate_historical_bootstrap_genesis_record() {
  local marker="$1"
  local evidence_file="$2"
  local expected_recipient="$3"
  local reviewed_sha="$4"
  local evidence_epoch="$5"
  local candidate_sha candidate_file="" candidate_digest file candidate_matches=0
  local database_ciphertext secrets_ciphertext runtime_files_ciphertext integration_status
  local candidate_bucket database_key secrets_key runtime_files_key
  local database_version secrets_version runtime_files_version database_bytes secrets_bytes runtime_files_bytes
  local database_invocation secrets_invocation runtime_files_invocation
  local source_identity_sha source_migration_ledger_sha code_bundle_sha recovery_program_set_sha recovery_db_contract_sha
  local app_env_sha backup_env_sha migration_env_sha
  local database_tier runtime_files_tier database_retention_days secrets_retention_days runtime_files_retention_days
  local database_retain_until secrets_retain_until runtime_files_retain_until
  local candidate_created candidate_epoch database_retain_epoch secrets_retain_epoch runtime_files_retain_epoch
  local runtime_files_inventory runtime_files_count catalog_key

  assert_root_owned_nonwritable_directory "backup evidence root" "$BACKUP_EVIDENCE_ROOT"
  [ "$(stat -c '%a' "$BACKUP_EVIDENCE_ROOT")" = "700" ] || \
    fatal_after_standalone_replacement "backup evidence root must use mode 0700"
  assert_root_owned_nonwritable_file "historical bootstrap restore marker" "$marker"
  [ "$(stat -c '%a' "$marker")" = "600" ] || \
    fatal_after_standalone_replacement "historical bootstrap restore marker must use mode 0600"

  # A limited bootstrap certificate must never retrospectively claim a
  # committed log epoch.  That claim belongs only to the later full record.
  ! grep -q '^LOG_GENESIS_' "$marker" \
    && ! grep -q '^LOG_GENESIS_' "$evidence_file" || \
    fatal_after_standalone_replacement "historical bootstrap evidence may not claim a log-genesis proof"

  candidate_sha="$(read_static_env_value "$marker" CANDIDATE_SHA256)"
  database_ciphertext="$(read_static_env_value "$marker" DATABASE_CIPHERTEXT_SHA256)"
  secrets_ciphertext="$(read_static_env_value "$marker" SECRETS_CIPHERTEXT_SHA256)"
  runtime_files_ciphertext="$(read_static_env_value "$marker" RUNTIME_FILES_CIPHERTEXT_SHA256)"
  integration_status="$(read_static_env_value "$marker" INTEGRATION_TOKEN_DECRYPT_STATUS)"
  [[ "$candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$database_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$secrets_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$runtime_files_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_static_env_value "$marker" FORMAT_VERSION)" = "1" ] \
    && [ "$(read_static_env_value "$marker" EVIDENCE_TYPE)" = "archive-restore" ] \
    && [ "$(read_static_env_value "$marker" STATUS)" = "verified" ] \
    && [ "$(read_static_env_value "$marker" RECOVERY_SCOPE)" = "log-genesis-bootstrap-only" ] \
    && [ "$(read_static_env_value "$marker" RECIPIENT_SHA256)" = "$expected_recipient" ] \
    && [ "$(read_static_env_value "$marker" DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" INTERNAL_CHECKSUM_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" SCRATCH_RESTORE_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" TENANT_CANARY_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
    && [ "$(read_static_env_value "$marker" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
    && [[ "$(read_static_env_value "$marker" SOURCE_MIGRATION_LEDGER_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_static_env_value "$marker" RECOVERY_DB_CONTRACT_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_static_env_value "$marker" RLS_FORCE_RLS_CATALOG_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" FULL_AUTHORITY_RESTORE_STATUS)" = "not_tested" ] \
    && [[ "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_static_env_value "$marker" PII_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$marker" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$evidence_file" RECOVERY_SCOPE)" = "log-genesis-bootstrap-only" ] \
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
    && [ "$(read_static_env_value "$evidence_file" DATABASE_AUTHORITY_CATALOG_SHA256)" = \
      "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_SHA256)" ] \
    && [ "$(read_static_env_value "$evidence_file" PII_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$evidence_file" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$evidence_file" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$evidence_file" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
    && [ "$(read_static_env_value "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)" = "$integration_status" ] \
    && [ "$(read_static_env_value "$evidence_file" DATABASE_STORAGE_ATTESTATION)" = "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED" ] \
    && [[ "$(read_static_env_value "$evidence_file" ARCHIVE_VERIFIER_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_static_env_value "$evidence_file" RESTORE_CANARY_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_static_env_value "$evidence_file" PII_PROOF_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_static_env_value "$evidence_file" CANARY_SQL_SHA256)" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "historical bootstrap recovery proof is incomplete or unbound"
  case "$integration_status" in
    passed|not_applicable_no_persisted_ciphertext) ;;
    *) fatal_after_standalone_replacement "historical bootstrap integration-token recovery result is invalid" ;;
  esac

  assert_root_owned_nonwritable_directory "backup candidate directory" "$BACKUP_EVIDENCE_ROOT/candidates"
  for file in "$BACKUP_EVIDENCE_ROOT"/candidates/*.env; do
    [ -f "$file" ] && [ ! -L "$file" ] || continue
    candidate_digest="$(sha256sum "$file" | awk '{print $1}')"
    [ "$candidate_digest" = "$candidate_sha" ] || continue
    candidate_file="$file"
    candidate_matches=$((candidate_matches + 1))
  done
  [ "$candidate_matches" -eq 1 ] || \
    fatal_after_standalone_replacement "historical bootstrap marker does not identify one preserved backup candidate"
  assert_root_owned_nonwritable_file "historical bootstrap candidate" "$candidate_file"
  [ "$(stat -c '%a' "$candidate_file")" = "600" ] || \
    fatal_after_standalone_replacement "historical bootstrap candidate must use mode 0600"
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    {
      key=$0
      sub(/=.*/, "", key)
      if (seen[key]++) bad=1
    }
    END { if (NR < 1 || bad) exit 1 }
  ' "$candidate_file" || \
    fatal_after_standalone_replacement "historical bootstrap candidate is malformed or contains duplicate keys"
  ! grep -q '^LOG_GENESIS_' "$candidate_file" || \
    fatal_after_standalone_replacement "historical bootstrap candidate may not claim a log-genesis proof"

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
  code_bundle_sha="$(read_static_env_value "$candidate_file" COMMISSION_CODE_BUNDLE_SHA256)"
  recovery_program_set_sha="$(read_static_env_value "$candidate_file" RECOVERY_PROGRAM_SET_SHA256)"
  recovery_db_contract_sha="$(read_static_env_value "$candidate_file" RECOVERY_DB_CONTRACT_SHA256)"
  app_env_sha="$(read_static_env_value "$candidate_file" SOURCE_APP_ENV_SHA256)"
  backup_env_sha="$(read_static_env_value "$candidate_file" SOURCE_BACKUP_ENV_SHA256)"
  migration_env_sha="$(read_static_env_value "$candidate_file" SOURCE_MIGRATION_ENV_SHA256)"
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
  [ "$(read_static_env_value "$candidate_file" FORMAT_VERSION)" = "2" ] \
    && [ "$(read_static_env_value "$candidate_file" STATUS)" = "awaiting_offline_restore" ] \
    && [ "$(read_static_env_value "$candidate_file" RECOVERY_SCOPE)" = "log-genesis-bootstrap-only" ] \
    && [ "$(read_static_env_value "$candidate_file" RECIPIENT_SHA256)" = "$expected_recipient" ] \
    && [ "$(read_static_env_value "$candidate_file" WORKFLOW_SHA)" = "$reviewed_sha" ] \
    && [[ "$candidate_bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]] \
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
    && [[ "$code_bundle_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$recovery_program_set_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$app_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$backup_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$migration_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$database_tier" = "monthly" ] && [ "$runtime_files_tier" = "monthly" ] \
    && [[ "$database_retention_days" =~ ^[0-9]+$ ]] && [ "$database_retention_days" -ge 400 ] \
    && [[ "$secrets_retention_days" =~ ^[0-9]+$ ]] && [ "$secrets_retention_days" -ge 400 ] \
    && [[ "$runtime_files_retention_days" =~ ^[0-9]+$ ]] && [ "$runtime_files_retention_days" -ge 400 ] \
    && [[ "$runtime_files_inventory" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$runtime_files_count" =~ ^[0-9]+$ ]] \
    && [[ "$candidate_epoch" =~ ^[0-9]+$ ]] && [ "$candidate_epoch" -le "$evidence_epoch" ] \
    && [[ "$database_retain_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$secrets_retain_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$runtime_files_retain_epoch" =~ ^[0-9]+$ ]] \
    && [ "$database_retain_epoch" -ge $((candidate_epoch + database_retention_days * 86400 - 300)) ] \
    && [ "$secrets_retain_epoch" -ge $((candidate_epoch + secrets_retention_days * 86400 - 300)) ] \
    && [ "$runtime_files_retain_epoch" -ge $((candidate_epoch + runtime_files_retention_days * 86400 - 300)) ] \
    && [ "$(read_static_env_value "$candidate_file" DATABASE_CIPHERTEXT_SHA256)" = "$database_ciphertext" ] \
    && [ "$(read_static_env_value "$candidate_file" SECRETS_CIPHERTEXT_SHA256)" = "$secrets_ciphertext" ] \
    && [ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$runtime_files_ciphertext" ] \
    && [[ "$(read_static_env_value "$candidate_file" POSTGRES_BACKUP_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_static_env_value "$candidate_file" POSTGRES_RESTORE_CANARY_SHA256)" = \
      "$(read_static_env_value "$evidence_file" RESTORE_CANARY_SHA256)" ] \
    && [ "$(read_static_env_value "$candidate_file" CANARY_SQL_SHA256)" = \
      "$(read_static_env_value "$evidence_file" CANARY_SQL_SHA256)" ] \
    && [[ "$(read_static_env_value "$candidate_file" SECRETS_SNAPSHOT_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_SNAPSHOT_SHA256)" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "historical bootstrap candidate is incomplete or internally inconsistent"

  [ "$(read_static_env_value "$marker" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
    && [ "$(read_static_env_value "$marker" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
    && [ "$(read_static_env_value "$marker" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
    && [ "$(read_static_env_value "$evidence_file" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
    && [ "$(read_static_env_value "$evidence_file" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
    && [ "$(read_static_env_value "$evidence_file" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] || \
    fatal_after_standalone_replacement "historical bootstrap secrets identity is not bound across its records"
  for catalog_key in \
    OBJECT_BUCKET \
    DATABASE_OBJECT_KEY DATABASE_OBJECT_VERSION_ID DATABASE_RETAIN_UNTIL \
    SECRETS_OBJECT_KEY SECRETS_OBJECT_VERSION_ID SECRETS_RETAIN_UNTIL \
    RUNTIME_FILES_OBJECT_KEY RUNTIME_FILES_OBJECT_VERSION_ID RUNTIME_FILES_RETAIN_UNTIL \
    RUNTIME_FILES_INVENTORY_SHA256 RUNTIME_FILES_FILE_COUNT \
    SOURCE_DATABASE_IDENTITY_SHA256 COMMISSION_CODE_BUNDLE_SHA256 \
    SOURCE_MIGRATION_LEDGER_SHA256 RECOVERY_PROGRAM_SET_SHA256 \
    RECOVERY_DB_CONTRACT_SHA256; do
    [ "$(read_static_env_value "$marker" "$catalog_key")" = \
      "$(read_static_env_value "$candidate_file" "$catalog_key")" ] \
      && [ "$(read_static_env_value "$evidence_file" "$catalog_key")" = \
        "$(read_static_env_value "$candidate_file" "$catalog_key")" ] || \
      fatal_after_standalone_replacement \
        "historical bootstrap proof does not bind candidate catalog field $catalog_key"
  done
}

validate_preserved_backup_evidence() {
  local marker="$1"
  local expected_type="$2"
  local expected_recipient="$3"
  local expected_scope="${4:-}"
  local validation_profile="${5:-current}"
  local expected_marker_format=1 expected_candidate_format="" expected_evidence_format=1
  local evidence_sha signature_sha signers_sha operator evidence_ref evidence_at reviewed_sha marker_workflow_sha
  local evidence_dir evidence_file signature_file actual_signers_sha signer_count integration_status
  local candidate_sha candidate_file candidate_digest candidate_matches=0 file evidence_input
  local database_ciphertext secrets_ciphertext runtime_files_ciphertext candidate_bucket database_key secrets_key runtime_files_key
  local database_version secrets_version runtime_files_version database_bytes secrets_bytes runtime_files_bytes
  local database_invocation secrets_invocation runtime_files_invocation
  local source_identity_sha source_migration_ledger_sha code_bundle_sha recovery_program_set_sha recovery_db_contract_sha
  local app_env_sha backup_env_sha migration_env_sha
  local database_tier runtime_files_tier database_retention_days secrets_retention_days runtime_files_retention_days
  local database_retain_until secrets_retain_until runtime_files_retain_until
  local candidate_created candidate_epoch database_retain_epoch secrets_retain_epoch runtime_files_retain_epoch monthly_policy secrets_policy
  local runtime_files_inventory runtime_files_count catalog_key
  local log_key log_version log_bytes log_ciphertext log_retain_until log_anchor_sha log_anchor_bytes
  local log_anchor_file_sha log_anchor_file_bytes log_anchor_status log_anchor_field candidate_log_field
  local bootstrap_certificate_sha bootstrap_certificate_bytes bootstrap_certificate_candidate_sha
  local bootstrap_certificate_evidence_sha bootstrap_certificate_signature_sha bootstrap_certificate_signers_sha
  local recovery_payload_retain_until recovery_payload_retain_epoch
  local recovery_catalog_key recovery_catalog_version recovery_catalog_sha recovery_catalog_bytes
  local recovery_catalog_created_at recovery_catalog_created_epoch
  local recovery_catalog_retention_days
  local recovery_catalog_retain_until recovery_catalog_retain_epoch recovery_catalog_head
  local recovery_catalog_remote_bytes recovery_catalog_remote_sha recovery_catalog_remote_candidate
  local recovery_catalog_remote_evidence recovery_catalog_remote_signature recovery_catalog_remote_signers
  local recovery_catalog_remote_format recovery_catalog_remote_genesis
  local recovery_catalog_remote_bootstrap recovery_catalog_remote_bootstrap_evidence recovery_catalog_remote_bootstrap_signature
  local recovery_catalog_retention recovery_catalog_mode recovery_catalog_remote_until recovery_catalog_remote_epoch
  local recovery_catalog_file recovery_catalog_entries
  local payload_label payload_key payload_version payload_bytes payload_sha payload_retain_until
  local payload_head payload_remote_bytes payload_remote_sha payload_retention
  local payload_mode payload_remote_until payload_recorded_epoch payload_remote_epoch
  local evidence_now_epoch evidence_epoch evidence_maximum_age
  local -a recovery_payload_labels=(DATABASE SECRETS RUNTIME_FILES)

  case "$validation_profile" in
    current) ;;
    historical-genesis)
      [ "$expected_type" = archive-restore ] \
        && [ "$expected_scope" = log-genesis-bootstrap-only ] || \
        fatal_after_standalone_replacement \
          "historical backup validation is reserved for the limited bootstrap certificate"
      ;;
    *) fatal_after_standalone_replacement "backup evidence validation profile is unsupported" ;;
  esac

  for evidence_input in "$marker"; do
    awk '
      !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
      {
        key=$0
        sub(/=.*/, "", key)
        if (seen[key]++) bad=1
      }
      END { if (NR < 1 || bad) exit 1 }
    ' "$evidence_input" || \
      fatal_after_standalone_replacement "backup evidence marker is malformed or contains duplicate keys"
  done

  assert_root_owned_nonwritable_directory "signed backup evidence root" "$BACKUP_SIGNED_EVIDENCE_DIR"
  [ "$(stat -c '%a' "$BACKUP_SIGNED_EVIDENCE_DIR")" = "700" ] || \
    fatal_after_standalone_replacement "signed backup evidence root must use mode 0700"
  assert_root_owned_nonwritable_file "offline verifier allowlist" "$BACKUP_OFFLINE_ALLOWED_SIGNERS"
  [ "$(stat -c '%a' "$BACKUP_OFFLINE_ALLOWED_SIGNERS")" = "600" ] || \
    fatal_after_standalone_replacement "offline verifier allowlist must use mode 0600"

  evidence_sha="$(read_static_env_value "$marker" SIGNED_EVIDENCE_SHA256)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate evidence digest"
  signature_sha="$(read_static_env_value "$marker" SIGNED_SIGNATURE_SHA256)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate signature digest"
  signers_sha="$(read_static_env_value "$marker" ALLOWED_SIGNERS_SHA256)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate signer digest"
  operator="$(read_static_env_value "$marker" OFFLINE_OPERATOR)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate operator"
  evidence_ref="$(read_static_env_value "$marker" EVIDENCE_REF)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate evidence reference"
  evidence_at="$(read_static_env_value "$marker" EVIDENCE_AT_UTC)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate timestamp"
  reviewed_sha="$(read_static_env_value "$marker" REVIEWED_MAIN_SHA)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate reviewed SHA"
  marker_workflow_sha="$(read_static_env_value "$marker" WORKFLOW_SHA)" || \
    fatal_after_standalone_replacement "backup evidence marker contains duplicate workflow SHA"
  [[ "$evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signature_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signers_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$operator" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
    && [[ "$evidence_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]] \
    && [[ "$evidence_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [[ "$reviewed_sha" =~ ^[0-9a-f]{40}$ ]] \
    && [ "$marker_workflow_sha" = "$reviewed_sha" ] || \
    fatal_after_standalone_replacement "backup evidence has no internally consistent reviewed main revision"
  evidence_epoch="$(date -u -d "$evidence_at" '+%s' 2>/dev/null)" \
    || fatal_after_standalone_replacement "backup evidence timestamp is invalid"
  evidence_now_epoch="$(date -u '+%s')"
  if [ "$expected_type" = archive-restore ]; then
    case "$expected_scope" in
      log-genesis-bootstrap-only)
        expected_marker_format=1
        expected_candidate_format=2
        expected_evidence_format=1
        case "$validation_profile" in
          current) evidence_maximum_age=3024000 ;;
          historical-genesis) evidence_maximum_age=0 ;;
        esac
        ;;
      full-recovery)
        expected_marker_format=4
        expected_candidate_format=3
        expected_evidence_format=2
        evidence_maximum_age=3024000
        ;;
      *) fatal_after_standalone_replacement "archive evidence requires an explicit reviewed recovery scope" ;;
    esac
  elif [ "$expected_type" = age-key-custody ]; then
    evidence_maximum_age=7776000
  else
    fatal_after_standalone_replacement "backup evidence type is unsupported"
  fi
  [ "$evidence_epoch" -le $((evidence_now_epoch + 300)) ] \
    && { [ "$evidence_maximum_age" = 0 ] \
      || [ "$evidence_epoch" -ge $((evidence_now_epoch - evidence_maximum_age)) ]; } || \
    fatal_after_standalone_replacement "backup evidence is stale or future-dated"

  actual_signers_sha="$(sha256sum "$BACKUP_OFFLINE_ALLOWED_SIGNERS" | awk '{print $1}')"
  [ "$actual_signers_sha" = "$signers_sha" ] || \
    fatal_after_standalone_replacement "offline verifier allowlist drifted after commissioning"
  awk '
    NF != 3 || $1 !~ /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/ \
      || $2 != "ssh-ed25519" || $3 !~ /^AAAA[A-Za-z0-9+\/=]+$/ { bad=1 }
    END { if (NR < 1 || bad) exit 1 }
  ' "$BACKUP_OFFLINE_ALLOWED_SIGNERS" || \
    fatal_after_standalone_replacement "offline verifier allowlist has an unsafe record"
  signer_count="$(awk -v principal="$operator" '$1 == principal { count++ } END { print count+0 }' \
    "$BACKUP_OFFLINE_ALLOWED_SIGNERS")"
  [ "$signer_count" = "1" ] || \
    fatal_after_standalone_replacement "offline evidence operator has no unique trusted Ed25519 key"

  evidence_dir="$BACKUP_SIGNED_EVIDENCE_DIR/$evidence_sha"
  evidence_file="$evidence_dir/evidence.env"
  signature_file="$evidence_dir/evidence.env.sig"
  assert_root_owned_nonwritable_directory "preserved signed evidence directory" "$evidence_dir"
  assert_root_owned_nonwritable_file "preserved signed evidence" "$evidence_file"
  assert_root_owned_nonwritable_file "preserved signed evidence signature" "$signature_file"
  [ "$(stat -c '%a' "$evidence_dir")" = "700" ] \
    && [ "$(stat -c '%a' "$evidence_file")" = "600" ] \
    && [ "$(stat -c '%a' "$signature_file")" = "600" ] \
    && [ "$(sha256sum "$evidence_file" | awk '{print $1}')" = "$evidence_sha" ] \
    && [ "$(sha256sum "$signature_file" | awk '{print $1}')" = "$signature_sha" ] || \
    fatal_after_standalone_replacement "preserved signed evidence bytes or permissions drifted"
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    {
      key=$0
      sub(/=.*/, "", key)
      if (seen[key]++) bad=1
    }
    END { if (NR < 1 || bad) exit 1 }
  ' "$evidence_file" || \
    fatal_after_standalone_replacement "preserved signed evidence is malformed or contains duplicate keys"
  ssh-keygen -Y verify -f "$BACKUP_OFFLINE_ALLOWED_SIGNERS" \
    -I "$operator" -n leaddrive-backup-evidence \
    -s "$signature_file" <"$evidence_file" >/dev/null 2>&1 || \
    fatal_after_standalone_replacement "preserved offline recovery signature is invalid"
  [ "$(read_static_env_value "$evidence_file" FORMAT_VERSION)" = "$expected_evidence_format" ] \
    && [ "$(read_static_env_value "$evidence_file" EVIDENCE_TYPE)" = "$expected_type" ] \
    && [ "$(read_static_env_value "$evidence_file" STATUS)" = "verified" ] \
    && [ "$(read_static_env_value "$evidence_file" RECIPIENT_SHA256)" = "$expected_recipient" ] \
    && [ "$(read_static_env_value "$evidence_file" EVIDENCE_REF)" = "$evidence_ref" ] \
    && [ "$(read_static_env_value "$evidence_file" OFFLINE_OPERATOR)" = "$operator" ] \
    && [ "$(read_static_env_value "$evidence_file" VERIFIED_AT_UTC)" = "$evidence_at" ] \
    && [ "$(read_static_env_value "$evidence_file" REVIEWED_MAIN_SHA)" = "$reviewed_sha" ] || \
    fatal_after_standalone_replacement "preserved signed evidence does not match its server marker"

  if [ "$validation_profile" = historical-genesis ]; then
    validate_historical_bootstrap_genesis_record \
      "$marker" "$evidence_file" "$expected_recipient" "$reviewed_sha" "$evidence_epoch"
    return 0
  fi

  case "$expected_type" in
    age-key-custody)
      [ "$(read_static_env_value "$marker" FORMAT_VERSION)" = "1" ] \
        && [ "$(read_static_env_value "$marker" STATUS)" = "verified" ] \
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
        && [ "$(read_static_env_value "$evidence_file" CUSTODY_VERIFIER_SHA256)" = "$BACKUP_CUSTODY_VERIFIER_SHA256" ] || \
        fatal_after_standalone_replacement "signed age key-custody proof is incomplete or unreviewed"
      ;;
    archive-restore)
      database_ciphertext="$(read_static_env_value "$marker" DATABASE_CIPHERTEXT_SHA256)"
      secrets_ciphertext="$(read_static_env_value "$marker" SECRETS_CIPHERTEXT_SHA256)"
      runtime_files_ciphertext="$(read_static_env_value "$marker" RUNTIME_FILES_CIPHERTEXT_SHA256)"
      candidate_sha="$(read_static_env_value "$marker" CANDIDATE_SHA256)"
      integration_status="$(read_static_env_value "$marker" INTEGRATION_TOKEN_DECRYPT_STATUS)"
      [[ "$database_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$secrets_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$runtime_files_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$(read_static_env_value "$marker" FORMAT_VERSION)" = "$expected_marker_format" ] \
        && [ "$(read_static_env_value "$marker" RECOVERY_SCOPE)" = "$expected_scope" ] \
        && [ "$(read_static_env_value "$evidence_file" RECOVERY_SCOPE)" = "$expected_scope" ] \
        && [ "$(read_static_env_value "$marker" STATUS)" = "verified" ] \
        && [ "$(read_static_env_value "$marker" DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" INTERNAL_CHECKSUM_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" SCRATCH_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" TENANT_CANARY_STATUS)" = "passed" ] \
        && [ "$(read_static_env_value "$marker" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
        && [ "$(read_static_env_value "$marker" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
        && [[ "$(read_static_env_value "$marker" SOURCE_MIGRATION_LEDGER_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$(read_static_env_value "$marker" RECOVERY_DB_CONTRACT_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
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
        && [ "$(read_static_env_value "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)" = "$integration_status" ] \
        && [ "$(read_static_env_value "$evidence_file" DATABASE_STORAGE_ATTESTATION)" = "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED" ] \
        && [ "$(read_static_env_value "$evidence_file" ARCHIVE_VERIFIER_SHA256)" = "$BACKUP_ARCHIVE_VERIFIER_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" RESTORE_CANARY_SHA256)" = "$BACKUP_RESTORE_CANARY_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" PII_PROOF_SHA256)" = "$BACKUP_PII_PROOF_SHA256" ] \
        && [ "$(read_static_env_value "$evidence_file" CANARY_SQL_SHA256)" = "$BACKUP_CANARY_SQL_SHA256" ] || \
        fatal_after_standalone_replacement "signed DB, secrets and runtime-file recovery proof is incomplete or unreviewed"
      case "$integration_status" in
        passed|not_applicable_no_persisted_ciphertext) ;;
        *) fatal_after_standalone_replacement "integration-token recovery result is invalid" ;;
      esac
      if [ "$expected_scope" = full-recovery ]; then
        [ "$(read_static_env_value "$marker" LOG_GENESIS_ANCHOR_STATUS)" = COMMITTED ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_DECRYPT_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_ARCHIVE_LAYOUT_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_INTERNAL_CHECKSUM_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_RANGES_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_CURSOR_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_ANCHOR_BINDING_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_ANCHOR_STATUS)" = COMMITTED ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_DECRYPT_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_ARCHIVE_LAYOUT_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_INTERNAL_CHECKSUM_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_RANGES_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_CURSOR_STATUS)" = passed ] \
          && [ "$(read_static_env_value "$evidence_file" LOG_GENESIS_ANCHOR_BINDING_STATUS)" = passed ] \
          && [[ "$(read_static_env_value "$marker" LOG_GENESIS_MANIFEST_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_MANIFEST_SHA256)" = \
            "$(read_static_env_value "$evidence_file" LOG_GENESIS_MANIFEST_SHA256)" ] \
          && [[ "$(read_static_env_value "$marker" LOG_GENESIS_SHA256SUMS_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
          && [ "$(read_static_env_value "$marker" LOG_GENESIS_SHA256SUMS_SHA256)" = \
            "$(read_static_env_value "$evidence_file" LOG_GENESIS_SHA256SUMS_SHA256)" ] \
          || fatal_after_standalone_replacement "full-recovery evidence has no complete restored log-genesis proof"
      elif grep -q '^LOG_GENESIS_' "$marker" || grep -q '^LOG_GENESIS_' "$evidence_file"; then
        fatal_after_standalone_replacement "bootstrap-only recovery evidence may not claim a log-genesis proof"
      fi
      assert_root_owned_nonwritable_directory "backup candidate directory" "$BACKUP_EVIDENCE_ROOT/candidates"
      for file in "$BACKUP_EVIDENCE_ROOT"/candidates/*.env; do
        [ -f "$file" ] && [ ! -L "$file" ] || continue
        candidate_digest="$(sha256sum "$file" | awk '{print $1}')"
        [ "$candidate_digest" = "$candidate_sha" ] || continue
        candidate_file="$file"
        candidate_matches=$((candidate_matches + 1))
      done
      [ "$candidate_matches" -eq 1 ] || \
        fatal_after_standalone_replacement "restore marker does not identify one preserved backup candidate"
      assert_root_owned_nonwritable_file "preserved backup candidate" "$candidate_file"
      awk '
        !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
        {
          key=$0
          sub(/=.*/, "", key)
          if (seen[key]++) bad=1
        }
        END { if (NR < 1 || bad) exit 1 }
      ' "$candidate_file" || \
        fatal_after_standalone_replacement "preserved backup candidate is malformed or contains duplicate keys"
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
      code_bundle_sha="$(read_static_env_value "$candidate_file" COMMISSION_CODE_BUNDLE_SHA256)"
      app_env_sha="$(read_static_env_value "$candidate_file" SOURCE_APP_ENV_SHA256)"
      backup_env_sha="$(read_static_env_value "$candidate_file" SOURCE_BACKUP_ENV_SHA256)"
      migration_env_sha="$(read_static_env_value "$candidate_file" SOURCE_MIGRATION_ENV_SHA256)"
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
      recovery_program_set_sha="$(read_static_env_value "$candidate_file" RECOVERY_PROGRAM_SET_SHA256)"
      recovery_db_contract_sha="$(read_static_env_value "$candidate_file" RECOVERY_DB_CONTRACT_SHA256)"
      candidate_created="$(read_static_env_value "$candidate_file" CREATED_AT_UTC)"
      if [ "$expected_scope" = full-recovery ]; then
        log_key="$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_KEY)"
        log_version="$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_VERSION_ID)"
        log_bytes="$(read_static_env_value "$candidate_file" LOG_GENESIS_CIPHERTEXT_BYTES)"
        log_ciphertext="$(read_static_env_value "$candidate_file" LOG_GENESIS_CIPHERTEXT_SHA256)"
        log_retain_until="$(read_static_env_value "$candidate_file" LOG_GENESIS_RETAIN_UNTIL)"
        log_anchor_sha="$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_SHA256)"
        log_anchor_bytes="$(read_static_env_value "$candidate_file" LOG_GENESIS_ANCHOR_BYTES)"
        bootstrap_certificate_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)"
        bootstrap_certificate_bytes="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)"
        bootstrap_certificate_candidate_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)"
        bootstrap_certificate_evidence_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)"
        bootstrap_certificate_signature_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)"
        bootstrap_certificate_signers_sha="$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)"
        recovery_payload_retain_until="$(read_static_env_value "$marker" RECOVERY_PAYLOAD_RETAIN_UNTIL)"
        recovery_payload_retain_epoch="$(date -u -d "$recovery_payload_retain_until" '+%s' 2>/dev/null || true)"
      fi
      candidate_epoch="$(date -u -d "$candidate_created" '+%s' 2>/dev/null || true)"
      database_retain_epoch="$(date -u -d "$database_retain_until" '+%s' 2>/dev/null || true)"
      secrets_retain_epoch="$(date -u -d "$secrets_retain_until" '+%s' 2>/dev/null || true)"
      runtime_files_retain_epoch="$(date -u -d "$runtime_files_retain_until" '+%s' 2>/dev/null || true)"
      monthly_policy="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_RETENTION_MONTHLY_DAYS)"
      monthly_policy="${monthly_policy:-400}"
      secrets_policy="$(read_static_env_value /etc/leaddrive/backup.env SECRETS_RETENTION_DAYS)"
      secrets_policy="${secrets_policy:-400}"
      evidence_now_epoch="$(date -u '+%s')"
      [ "$(stat -c '%a' "$candidate_file")" = "600" ] \
        && [[ "$candidate_bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]] \
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
        && [[ "$code_bundle_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$app_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$backup_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$migration_env_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$database_tier" = "monthly" ] \
        && [ "$runtime_files_tier" = "monthly" ] \
        && [[ "$database_retention_days" =~ ^[0-9]+$ ]] \
        && [[ "$secrets_retention_days" =~ ^[0-9]+$ ]] \
        && [[ "$runtime_files_retention_days" =~ ^[0-9]+$ ]] \
        && [[ "$runtime_files_inventory" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$runtime_files_count" =~ ^[0-9]+$ ]] \
        && [[ "$recovery_program_set_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$candidate_epoch" =~ ^[0-9]+$ ]] \
        && [[ "$database_retain_epoch" =~ ^[0-9]+$ ]] \
        && [[ "$secrets_retain_epoch" =~ ^[0-9]+$ ]] \
        && [[ "$runtime_files_retain_epoch" =~ ^[0-9]+$ ]] \
        && [ "$database_retention_days" -ge "$monthly_policy" ] \
        && [ "$secrets_retention_days" -ge "$secrets_policy" ] \
        && [ "$runtime_files_retention_days" -ge "$monthly_policy" ] \
        && [ "$database_retain_epoch" -ge $((candidate_epoch + database_retention_days * 86400 - 300)) ] \
        && [ "$secrets_retain_epoch" -ge $((candidate_epoch + secrets_retention_days * 86400 - 300)) ] \
        && [ "$runtime_files_retain_epoch" -ge $((candidate_epoch + runtime_files_retention_days * 86400 - 300)) ] \
        && [ "$database_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$secrets_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$runtime_files_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$(read_static_env_value "$candidate_file" FORMAT_VERSION)" = "$expected_candidate_format" ] \
        && [ "$(read_static_env_value "$candidate_file" RECOVERY_SCOPE)" = "$expected_scope" ] \
        && [ "$(read_static_env_value "$candidate_file" STATUS)" = "awaiting_offline_restore" ] \
        && [ "$(read_static_env_value "$candidate_file" RECIPIENT_SHA256)" = "$expected_recipient" ] \
        && [ "$(read_static_env_value "$candidate_file" WORKFLOW_SHA)" = "$reviewed_sha" ] \
        && [ "$(read_static_env_value "$candidate_file" DATABASE_CIPHERTEXT_SHA256)" = "$database_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" SECRETS_CIPHERTEXT_SHA256)" = "$secrets_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$runtime_files_ciphertext" ] \
        && [ "$(read_static_env_value "$candidate_file" POSTGRES_BACKUP_SHA256)" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" POSTGRES_RESTORE_CANARY_SHA256)" = "$BACKUP_RESTORE_CANARY_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" CANARY_SQL_SHA256)" = "$BACKUP_CANARY_SQL_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" SECRETS_SNAPSHOT_SHA256)" = "$BACKUP_SECRETS_SCRIPT_SHA256" ] \
        && [ "$(read_static_env_value "$candidate_file" RUNTIME_FILES_SNAPSHOT_SHA256)" = "$BACKUP_RUNTIME_FILES_SCRIPT_SHA256" ] || \
        fatal_after_standalone_replacement "preserved backup candidate is incomplete or belongs to another recovery-program contract"
      if [ "$expected_scope" = full-recovery ]; then
        [[ "$log_key" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[A-Za-z0-9._-]+[.]tar[.]gz[.]age$ ]] \
          && [[ "$log_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
          && [ "$log_version" != None ] && [ "$log_version" != null ] \
          && [[ "$log_bytes" =~ ^[1-9][0-9]*$ ]] \
          && [[ "$log_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$log_anchor_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$log_anchor_bytes" =~ ^[1-9][0-9]*$ ]] \
          && [ "$(read_static_env_value "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)" = 1 ] \
          && [[ "$bootstrap_certificate_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$bootstrap_certificate_bytes" =~ ^[1-9][0-9]*$ ]] && [ "$bootstrap_certificate_bytes" -le 65536 ] \
          && [[ "$bootstrap_certificate_candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$bootstrap_certificate_evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$bootstrap_certificate_signature_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$bootstrap_certificate_signers_sha" =~ ^[0-9a-f]{64}$ ]] \
          && [ "$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" = "$recovery_program_set_sha" ] \
          && [[ "$recovery_payload_retain_epoch" =~ ^[0-9]+$ ]] \
          && [ "$recovery_payload_retain_epoch" -gt "$evidence_now_epoch" ] \
          || fatal_after_standalone_replacement "full-recovery candidate log-genesis identity or payload horizon is invalid"
      fi
      [ "$(read_static_env_value "$marker" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
        && [ "$(read_static_env_value "$marker" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
        && [ "$(read_static_env_value "$marker" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
        && [ "$(read_static_env_value "$evidence_file" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
        && [ "$(sha256sum /etc/leaddrive/app.env | awk '{print $1}')" = "$app_env_sha" ] \
        && [ "$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" = "$backup_env_sha" ] \
        && [ "$(sha256sum /etc/leaddrive/migration.env | awk '{print $1}')" = "$migration_env_sha" ] || \
        fatal_after_standalone_replacement "current production recovery-set secrets differ from the independently restored candidate"
      for catalog_key in \
        OBJECT_BUCKET \
        DATABASE_OBJECT_KEY DATABASE_OBJECT_VERSION_ID DATABASE_RETAIN_UNTIL \
        SECRETS_OBJECT_KEY SECRETS_OBJECT_VERSION_ID SECRETS_RETAIN_UNTIL \
        RUNTIME_FILES_OBJECT_KEY RUNTIME_FILES_OBJECT_VERSION_ID RUNTIME_FILES_RETAIN_UNTIL \
        RUNTIME_FILES_INVENTORY_SHA256 RUNTIME_FILES_FILE_COUNT \
        SOURCE_DATABASE_IDENTITY_SHA256 COMMISSION_CODE_BUNDLE_SHA256 \
        SOURCE_MIGRATION_LEDGER_SHA256 RECOVERY_PROGRAM_SET_SHA256 \
        RECOVERY_DB_CONTRACT_SHA256; do
        [ "$(read_static_env_value "$marker" "$catalog_key")" = \
          "$(read_static_env_value "$candidate_file" "$catalog_key")" ] \
          && [ "$(read_static_env_value "$evidence_file" "$catalog_key")" = \
            "$(read_static_env_value "$candidate_file" "$catalog_key")" ] \
          || fatal_after_standalone_replacement \
            "signed recovery proof does not bind candidate catalog field $catalog_key"
      done

      if [ "$expected_scope" = full-recovery ]; then
        for catalog_key in \
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
          candidate_log_field="$(read_static_env_value "$candidate_file" "$catalog_key")"
          [ "$(read_static_env_value "$marker" "$catalog_key")" = "$candidate_log_field" ] \
            && [ "$(read_static_env_value "$evidence_file" "$catalog_key")" = "$candidate_log_field" ] \
            || fatal_after_standalone_replacement \
              "signed recovery proof does not bind log-genesis field $catalog_key"
        done

        validate_log_evidence_genesis_anchor_file
        [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)" = COMMITTED ] \
          || fatal_after_standalone_replacement "normal deploy requires a committed root log-genesis anchor"
        log_anchor_file_sha="$(sha256sum "$LOG_EVIDENCE_GENESIS_ANCHOR" | awk '{print $1}')"
        log_anchor_file_bytes="$(stat -c '%s' "$LOG_EVIDENCE_GENESIS_ANCHOR")"
        [ "$log_anchor_file_sha" = "$log_anchor_sha" ] \
          && [ "$log_anchor_file_bytes" = "$log_anchor_bytes" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_EVIDENCE_START_AT)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)" = "$log_key" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)" = "$log_version" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_SHA256)" = "$log_ciphertext" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_BYTES)" = "$log_bytes" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_OBJECT_FORMAT_VERSION)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_FORMAT_VERSION)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RANGES_SHA256)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_RANGES_SHA256)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_COUNT)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_FILE_RANGE_COUNT)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_BYTES)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_FILE_RANGE_BYTES)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_JOURNAL_RANGE_COUNT)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_JOURNAL_RANGE_COUNT)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_CURSOR_SHA256)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_CURSOR_SHA256)" ] \
          && [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" OBJECT_CREATED_AT)" = \
            "$(read_static_env_value "$candidate_file" LOG_GENESIS_OBJECT_CREATED_AT)" ] \
          || fatal_after_standalone_replacement "live root anchor differs from the candidate and signed log-genesis chain"
        [ -x "$OPS_RELEASES_DIR/$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA)/backup/ship-logs.sh" ] \
          && [ "$(sha256sum "$OPS_RELEASES_DIR/$(read_static_env_value "$candidate_file" LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA)/backup/ship-logs.sh" | awk '{print $1}')" = \
          "$(read_static_env_value "$candidate_file" LOG_GENESIS_SHIP_LOGS_SHA256)" ] \
          || fatal_after_standalone_replacement "original immutable log-genesis shipper is missing or drifted"
        validate_bootstrap_certificate_chain "$candidate_file" "$expected_recipient"
        [ "$bootstrap_certificate_signers_sha" = "$signers_sha" ] \
          || fatal_after_standalone_replacement "full and bootstrap recovery certificates use different signer authorities"
      fi

      if [ "$expected_scope" = full-recovery ]; then
        recovery_payload_labels+=(LOG_GENESIS)
      fi
      for payload_label in "${recovery_payload_labels[@]}"; do
        case "$payload_label" in
          DATABASE)
            payload_key="$database_key"; payload_version="$database_version"
            payload_bytes="$database_bytes"; payload_sha="$database_ciphertext"
            payload_retain_until="$database_retain_until"
            ;;
          SECRETS)
            payload_key="$secrets_key"; payload_version="$secrets_version"
            payload_bytes="$secrets_bytes"; payload_sha="$secrets_ciphertext"
            payload_retain_until="$secrets_retain_until"
            ;;
          RUNTIME_FILES)
            payload_key="$runtime_files_key"; payload_version="$runtime_files_version"
            payload_bytes="$runtime_files_bytes"; payload_sha="$runtime_files_ciphertext"
            payload_retain_until="$runtime_files_retain_until"
            ;;
          LOG_GENESIS)
            payload_key="$log_key"; payload_version="$log_version"
            payload_bytes="$log_bytes"; payload_sha="$log_ciphertext"
            payload_retain_until="$log_retain_until"
            ;;
        esac
        payload_head="$(run_pinned_backup_aws 45 \
          s3api head-object --endpoint-url "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
            --region "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" --no-cli-pager \
            --bucket "$candidate_bucket" --key "$payload_key" --version-id="$payload_version" \
            --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null)" \
          || fatal_after_standalone_replacement "$payload_label recovery payload version is unreadable"
        read -r payload_remote_bytes payload_remote_sha <<<"$payload_head"
        [ "$payload_remote_bytes" = "$payload_bytes" ] && [ "$payload_remote_sha" = "$payload_sha" ] \
          || fatal_after_standalone_replacement "$payload_label recovery payload metadata drifted"
        payload_retention="$(run_pinned_backup_aws 45 \
          s3api get-object-retention --endpoint-url "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
            --region "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" --no-cli-pager \
            --bucket "$candidate_bucket" --key "$payload_key" --version-id="$payload_version" \
            --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
          || fatal_after_standalone_replacement "$payload_label recovery payload retention is unreadable"
        read -r payload_mode payload_remote_until <<<"$payload_retention"
        payload_recorded_epoch="$(date -u -d "$payload_retain_until" '+%s' 2>/dev/null || true)"
        payload_remote_epoch="$(date -u -d "$payload_remote_until" '+%s' 2>/dev/null || true)"
        [ "$payload_mode" = COMPLIANCE ] \
          && [[ "$payload_recorded_epoch" =~ ^[0-9]+$ ]] \
          && [[ "$payload_remote_epoch" =~ ^[0-9]+$ ]] \
          && [ "$payload_remote_epoch" -ge "$payload_recorded_epoch" ] \
          && [ "$payload_remote_epoch" -gt "$evidence_now_epoch" ] \
          || fatal_after_standalone_replacement "$payload_label recovery payload is not currently COMPLIANCE-locked"
        if [ "$expected_scope" = full-recovery ]; then
          [ "$payload_remote_epoch" -ge "$recovery_payload_retain_epoch" ] \
            || fatal_after_standalone_replacement "$payload_label recovery payload expires before its catalog"
        fi
      done

      # Object metadata is not a substitute for a body proof.  The catalog,
      # root anchor, candidate and signed evidence all name this exact version;
      # stream it once through a tmpfs FIFO to prove that its immutable bytes
      # still hash to that chain's ciphertext digest.
      if [ "$expected_scope" = full-recovery ]; then
        prove_remote_log_genesis_body \
          "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
          "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" \
          "$candidate_bucket" "$log_key" "$log_version" "$log_ciphertext"
      fi

      if [ "$expected_scope" = full-recovery ]; then
      recovery_catalog_key="$(read_static_env_value "$marker" RECOVERY_CATALOG_OBJECT_KEY)"
      recovery_catalog_version="$(read_static_env_value "$marker" RECOVERY_CATALOG_OBJECT_VERSION_ID)"
      recovery_catalog_sha="$(read_static_env_value "$marker" RECOVERY_CATALOG_SHA256)"
      recovery_catalog_bytes="$(read_static_env_value "$marker" RECOVERY_CATALOG_BYTES)"
      recovery_catalog_created_at="$(read_static_env_value "$marker" RECOVERY_CATALOG_CREATED_AT_UTC)"
      recovery_catalog_created_epoch="$(date -u -d "$recovery_catalog_created_at" '+%s' 2>/dev/null || true)"
      recovery_catalog_retention_days="$(read_static_env_value "$marker" RECOVERY_CATALOG_RETENTION_DAYS)"
      recovery_catalog_retain_until="$(read_static_env_value "$marker" RECOVERY_CATALOG_RETAIN_UNTIL)"
      recovery_catalog_retain_epoch="$(date -u -d "$recovery_catalog_retain_until" '+%s' 2>/dev/null || true)"
      [[ "$recovery_catalog_sha" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$recovery_catalog_bytes" =~ ^[0-9]+$ ]] && [ "$recovery_catalog_bytes" -gt 0 ] \
        && [[ "$recovery_catalog_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
        && [ "$(read_static_env_value "$marker" RECOVERY_CATALOG_FORMAT_VERSION)" = 3 ] \
        && [ "$recovery_catalog_key" = \
          "recovery-catalog/v3/archive-restore/$candidate_sha/$recovery_catalog_sha.tar" ] \
        && [[ "$recovery_catalog_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
        && [[ "$recovery_catalog_created_epoch" =~ ^[0-9]+$ ]] \
        && [ "$recovery_catalog_created_epoch" -ge "$evidence_epoch" ] \
        && [ "$recovery_catalog_created_epoch" -le $((evidence_now_epoch + 300)) ] \
        && [[ "$recovery_catalog_retention_days" =~ ^[0-9]+$ ]] \
        && [ "$recovery_catalog_retention_days" -ge 400 ] \
        && [[ "$recovery_catalog_retain_epoch" =~ ^[0-9]+$ ]] \
        && [ "$recovery_catalog_retain_epoch" -ge $((recovery_catalog_created_epoch + recovery_catalog_retention_days * 86400 - 300)) ] \
        && [ "$recovery_catalog_retain_epoch" -gt "$evidence_now_epoch" ] \
        && [ "$recovery_payload_retain_epoch" -ge "$recovery_catalog_retain_epoch" ] \
        || fatal_after_standalone_replacement "off-host recovery catalog marker is invalid or too short-lived"

      recovery_catalog_head="$(run_pinned_backup_aws 45 \
        s3api head-object --endpoint-url "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
          --region "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" --no-cli-pager \
          --bucket "$candidate_bucket" --key "$recovery_catalog_key" --version-id="$recovery_catalog_version" \
          --query '[ContentLength,Metadata.sha256,Metadata.candidate,Metadata.evidence,Metadata.signature,Metadata.signers,Metadata.catalog_format,Metadata.genesis,Metadata.bootstrap,Metadata.bootstrap_evidence,Metadata.bootstrap_signature]' \
          --output text 2>/dev/null)" \
        || fatal_after_standalone_replacement "exact off-host recovery catalog object version is unreadable"
      read -r recovery_catalog_remote_bytes recovery_catalog_remote_sha recovery_catalog_remote_candidate \
        recovery_catalog_remote_evidence recovery_catalog_remote_signature recovery_catalog_remote_signers \
        recovery_catalog_remote_format recovery_catalog_remote_genesis \
        recovery_catalog_remote_bootstrap recovery_catalog_remote_bootstrap_evidence recovery_catalog_remote_bootstrap_signature \
        <<<"$recovery_catalog_head"
      [ "$recovery_catalog_remote_bytes" = "$recovery_catalog_bytes" ] \
        && [ "$recovery_catalog_remote_sha" = "$recovery_catalog_sha" ] \
        && [ "$recovery_catalog_remote_candidate" = "$candidate_sha" ] \
        && [ "$recovery_catalog_remote_evidence" = "$evidence_sha" ] \
        && [ "$recovery_catalog_remote_signature" = "$signature_sha" ] \
        && [ "$recovery_catalog_remote_signers" = "$signers_sha" ] \
        && [ "$recovery_catalog_remote_format" = 3 ] \
        && [ "$recovery_catalog_remote_genesis" = "$log_anchor_sha" ] \
        && [ "$recovery_catalog_remote_bootstrap" = "$bootstrap_certificate_sha" ] \
        && [ "$recovery_catalog_remote_bootstrap_evidence" = "$bootstrap_certificate_evidence_sha" ] \
        && [ "$recovery_catalog_remote_bootstrap_signature" = "$bootstrap_certificate_signature_sha" ] \
        || fatal_after_standalone_replacement "off-host recovery catalog metadata drifted"
      recovery_catalog_retention="$(run_pinned_backup_aws 45 \
        s3api get-object-retention --endpoint-url "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
          --region "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" --no-cli-pager \
          --bucket "$candidate_bucket" --key "$recovery_catalog_key" --version-id="$recovery_catalog_version" \
          --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
        || fatal_after_standalone_replacement "off-host recovery catalog retention cannot be inspected"
      read -r recovery_catalog_mode recovery_catalog_remote_until <<<"$recovery_catalog_retention"
      recovery_catalog_remote_epoch="$(date -u -d "$recovery_catalog_remote_until" '+%s' 2>/dev/null || true)"
      [ "$recovery_catalog_mode" = COMPLIANCE ] \
        && [[ "$recovery_catalog_remote_epoch" =~ ^[0-9]+$ ]] \
        && [ "$recovery_catalog_remote_epoch" -ge "$recovery_catalog_retain_epoch" ] \
        || fatal_after_standalone_replacement "off-host recovery catalog is not COMPLIANCE-locked as recorded"

      recovery_catalog_file="$(mktemp /run/leaddrive-recovery-catalog.XXXXXX)" \
        || fatal_after_standalone_replacement "cannot allocate recovery catalog verification file"
      chmod 0600 "$recovery_catalog_file"
      run_pinned_backup_aws 120 \
        s3api get-object --endpoint-url "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
          --region "$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" --no-cli-pager \
          --bucket "$candidate_bucket" --key "$recovery_catalog_key" --version-id="$recovery_catalog_version" \
          "$recovery_catalog_file" >/dev/null \
        || fatal_after_standalone_replacement "exact off-host recovery catalog cannot be downloaded"
      [ "$(stat -c '%s' "$recovery_catalog_file")" = "$recovery_catalog_bytes" ] \
        && [ "$(sha256sum "$recovery_catalog_file" | awk '{print $1}')" = "$recovery_catalog_sha" ] \
        || fatal_after_standalone_replacement "off-host recovery catalog bytes drifted"
      recovery_catalog_entries="$(tar -tf "$recovery_catalog_file")" \
        || fatal_after_standalone_replacement "off-host recovery catalog is not a readable tar archive"
      [ "$recovery_catalog_entries" = \
        $'bootstrap-evidence.env\nbootstrap-evidence.env.sig\nbootstrap-offline-restore.env\ncandidate.env\nevidence.env\nevidence.env.sig\nlog-evidence-genesis.env\noffline-allowed-signers' ] \
        && tar -tvf "$recovery_catalog_file" \
          | awk '$1 !~ /^-/ { unsafe=1 } END { exit unsafe }' \
        && [ "$(tar -xOf "$recovery_catalog_file" bootstrap-offline-restore.env | sha256sum | awk '{print $1}')" = "$bootstrap_certificate_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" bootstrap-evidence.env | sha256sum | awk '{print $1}')" = "$bootstrap_certificate_evidence_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" bootstrap-evidence.env.sig | sha256sum | awk '{print $1}')" = "$bootstrap_certificate_signature_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" candidate.env | sha256sum | awk '{print $1}')" = "$candidate_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" evidence.env | sha256sum | awk '{print $1}')" = "$evidence_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" evidence.env.sig | sha256sum | awk '{print $1}')" = "$signature_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" log-evidence-genesis.env | sha256sum | awk '{print $1}')" = "$log_anchor_sha" ] \
        && [ "$(tar -xOf "$recovery_catalog_file" offline-allowed-signers | sha256sum | awk '{print $1}')" = "$signers_sha" ] \
        || fatal_after_standalone_replacement "off-host recovery catalog contents are incomplete or unsafe"
      unlink -- "$recovery_catalog_file"
      recovery_catalog_file=""
      fi
      ;;
    *) fatal_after_standalone_replacement "unknown preserved backup evidence type" ;;
  esac
}

# The full certificate is valid only when its genesis anchor can be traced back
# to the earlier limited bootstrap ceremony.  Re-validate that separate signed
# marker here rather than treating the existence of an anchor as authorization.
validate_bootstrap_certificate_chain() {
  local full_candidate="$1"
  local recipient_sha="$2"
  local marker_sha marker_bytes bootstrap_candidate_sha bootstrap_evidence_sha bootstrap_signature_sha bootstrap_signers_sha

  assert_root_owned_nonwritable_file "bootstrap offline restore marker" "$BACKUP_BOOTSTRAP_RESTORE_MARKER"
  [ "$(stat -c '%a' "$BACKUP_BOOTSTRAP_RESTORE_MARKER")" = 600 ] \
    || fatal_after_standalone_replacement "bootstrap offline restore marker must use mode 0600"
  validate_preserved_backup_evidence "$BACKUP_BOOTSTRAP_RESTORE_MARKER" archive-restore \
    "$recipient_sha" log-genesis-bootstrap-only historical-genesis
  marker_sha="$(sha256sum "$BACKUP_BOOTSTRAP_RESTORE_MARKER" | awk '{print $1}')"
  marker_bytes="$(stat -c '%s' "$BACKUP_BOOTSTRAP_RESTORE_MARKER")"
  bootstrap_candidate_sha="$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" CANDIDATE_SHA256)"
  bootstrap_evidence_sha="$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" SIGNED_EVIDENCE_SHA256)"
  bootstrap_signature_sha="$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" SIGNED_SIGNATURE_SHA256)"
  bootstrap_signers_sha="$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" ALLOWED_SIGNERS_SHA256)"
  [[ "$marker_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$marker_bytes" =~ ^[1-9][0-9]*$ ]] && [ "$marker_bytes" -le 65536 ] \
    && [[ "$bootstrap_candidate_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$bootstrap_evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$bootstrap_signature_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$bootstrap_signers_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)" = 1 ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)" = "$marker_sha" ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)" = "$marker_bytes" ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)" = "$bootstrap_candidate_sha" ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)" = "$bootstrap_evidence_sha" ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)" = "$bootstrap_signature_sha" ] \
    && [ "$(read_static_env_value "$full_candidate" BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)" = "$bootstrap_signers_sha" ] \
    || fatal_after_standalone_replacement "full recovery candidate is not bound to the verified limited bootstrap certificate"
}

probe_current_backup_database_state() {
  local backup_env_file="$1"
  local key value identity ledger_output
  local -a pg_env=()

  for key in PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGSSLMODE PGSSLROOTCERT PGCONNECT_TIMEOUT; do
    value="$(read_static_env_value "$backup_env_file" "$key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $key keys"
    if [ "$key" = PGPORT ]; then value="${value:-5432}"; fi
    if [ "$key" = PGCONNECT_TIMEOUT ]; then value="${value:-10}"; fi
    [ -n "$value" ] || \
      fatal_after_standalone_replacement "backup database state probe is missing $key"
    pg_env+=("$key=$value")
  done
  identity="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent "${pg_env[@]}" \
    timeout 45 psql -X -v ON_ERROR_STOP=1 -AtF '|' -c \
      "SELECT (pg_control_system()).system_identifier::text,
              current_database(),
              (SELECT oid::text FROM pg_database WHERE datname = current_database()),
              pg_is_in_recovery()::int" 2>/dev/null)" || \
    fatal_after_standalone_replacement "cannot probe current backup-source database identity"
  [[ "$identity" =~ ^[0-9]+\|[^\|[:space:]]+\|[0-9]+\|0$ ]] || \
    fatal_after_standalone_replacement "current backup-source database identity has an invalid shape"
  ledger_output="$(env -i PATH=/usr/bin:/bin HOME=/nonexistent "${pg_env[@]}" \
    timeout 45 psql -X -q -v ON_ERROR_STOP=1 -AtF $'\t' 2>/dev/null <<'SQL'
WITH encoded AS (
  SELECT
    CASE WHEN id IS NULL THEN 'n' ELSE 'x' || encode(convert_to(id::text, 'UTF8'), 'hex') END AS e1,
    CASE WHEN checksum IS NULL THEN 'n' ELSE 'x' || encode(convert_to(checksum::text, 'UTF8'), 'hex') END AS e2,
    CASE WHEN finished_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e3,
    CASE WHEN migration_name IS NULL THEN 'n' ELSE 'x' || encode(convert_to(migration_name::text, 'UTF8'), 'hex') END AS e4,
    CASE WHEN logs IS NULL THEN 'n' ELSE 'x' || encode(convert_to(logs::text, 'UTF8'), 'hex') END AS e5,
    CASE WHEN rolled_back_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e6,
    CASE WHEN started_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e7,
    CASE WHEN applied_steps_count IS NULL THEN 'n' ELSE 'x' || encode(convert_to(applied_steps_count::text, 'UTF8'), 'hex') END AS e8
  FROM public._prisma_migrations
)
SELECT e1, e2, e3, e4, e5, e6, e7, e8
  FROM encoded
 ORDER BY e4, e1;
SQL
)" || \
    fatal_after_standalone_replacement "cannot read the current Prisma migration ledger"
  [ -n "$ledger_output" ] && printf '%s\n' "$ledger_output" | awk -F '\t' '
    NF != 8 { bad=1; next }
    { for (i=1; i<=8; i++) if ($i !~ /^(n|x([0-9a-f][0-9a-f])*)$/) bad=1 }
    END { if (NR < 1 || bad) exit 1 }
  ' || fatal_after_standalone_replacement "current Prisma migration ledger is empty or malformed"

  CURRENT_BACKUP_DATABASE_IDENTITY_SHA256="$(printf '%s' "$identity" | sha256sum | awk '{print $1}')"
  CURRENT_BACKUP_MIGRATION_LEDGER_SHA256="$(printf '%s\n' "$ledger_output" | sha256sum | awk '{print $1}')"
}

# ── Recovery gate mode ───────────────────────────────────────────────────
# The encrypted, Object-Locked, restore-drilled recovery point below is the
# reviewed authority for a Fund cutover — once the host has been commissioned
# through docs/BACKUP_RUNBOOK.md. Until stage 2 of that ceremony sets
# BACKUP_ENCRYPTION=age, none of its inputs (pinned age/aws, signed custody
# markers, certified units, verify-full TLS) exist, and a gate that demands
# them on every release does not protect production: it makes production
# unreachable. From 2026-09-05 to 2026-09-07 that is exactly what happened —
# 102 merged commits sat undeployed behind "BACKUP_WORK_ROOT overrides the
# reviewed recovery authority" on a host that had never been commissioned.
#
# So the gate has two modes, chosen from the host, never from the artifact:
#   commissioned — BACKUP_ENCRYPTION=age: the full reviewed gate, unchanged.
#   plain        — anything else: the Fund cutover still gets a fresh recovery
#                  point, but a plain pg_dump that is proven restorable into a
#                  throwaway canary database on the same server, row-counted
#                  against the fenced source, kept root-only next to the
#                  standalone backup, and copied into the daily off-site
#                  backup directory when that exists.
# Starting the ceremony flips the mode automatically; nothing here weakens the
# commissioned path or lets a half-commissioned host pass as commissioned.
EVENT_PLATFORM_PLAIN_RECOVERY_POINT_KIND="plain-pg-dump"
EVENT_PLATFORM_PLAIN_RECOVERY_MIN_BYTES=1048576
EVENT_PLATFORM_PLAIN_RECOVERY_MIN_FREE_BYTES=2147483648
EVENT_PLATFORM_PLAIN_CANARY_PREFIX="leaddrive_precutover_canary_"
DAILY_PLAIN_BACKUP_DIR="/var/backups/leaddrive"

# Callers read this through $(...), so its stdout is the mode and NOTHING else.
# log() writes to stdout, so every diagnostic here must go to stderr — a log
# line leaking into the substitution makes the value "…plain" instead of
# "plain", every comparison fails, and the deploy silently walks into the
# commissioned path it cannot satisfy. That is not hypothetical: it is how the
# first run of this change failed, on "PGSSLMODE does not match the reviewed
# fail-closed policy".
event_platform_recovery_gate_mode() {
  local encryption
  if [ -z "$EVENT_PLATFORM_RECOVERY_GATE_MODE" ]; then
    if [ -f /etc/leaddrive/backup.env ] && [ ! -L /etc/leaddrive/backup.env ]; then
      encryption="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_ENCRYPTION)" || \
        fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate BACKUP_ENCRYPTION keys"
    else
      encryption=""
    fi
    if [ "$encryption" = "age" ]; then
      EVENT_PLATFORM_RECOVERY_GATE_MODE="commissioned"
    else
      EVENT_PLATFORM_RECOVERY_GATE_MODE="plain"
    fi
  fi
  printf '%s' "$EVENT_PLATFORM_RECOVERY_GATE_MODE"
}

# Announce the mode once, from a normal (non-substituted) call site, so the
# deploy log always states which recovery authority this release ran under.
announce_recovery_gate_mode() {
  local mode
  mode="$(event_platform_recovery_gate_mode)"
  if [ "$mode" = "plain" ]; then
    log "Recovery gate: plain mode — encrypted recovery-point commissioning (BACKUP_ENCRYPTION=age) is not active on this host; a Fund cutover will use a verified plain pg_dump recovery point instead of the reviewed age/Object-Lock ceremony"
  else
    log "Recovery gate: commissioned mode — the reviewed age/Object-Lock recovery ceremony applies to this release"
  fi
}

# Plain counterpart of validate_event_platform_backup_preconditions: proves the
# host can take AND restore a plain recovery point before the fence closes.
validate_plain_recovery_point_preconditions() {
  local mode="${1:-unfenced}"
  local command_name available_bytes database_bytes required_bytes

  case "$mode" in
    unfenced|fenced) ;;
    *) fatal_after_standalone_replacement "unknown PostgreSQL backup precondition mode" ;;
  esac
  for command_name in pg_dump pg_restore createdb dropdb runuser psql sha256sum stat df; do
    command -v "$command_name" >/dev/null 2>&1 || \
      fatal_after_standalone_replacement "plain recovery point requires $command_name"
  done
  id -u postgres >/dev/null 2>&1 || \
    fatal_after_standalone_replacement "plain recovery point requires the local postgres OS account"
  runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 -c 'SELECT 1;' >/dev/null 2>&1 || \
    fatal_after_standalone_replacement "plain recovery point requires peer-authenticated postgres superuser access"
  ensure_root_only_backup_directory "$BACKUP_DIR"

  available_bytes="$(df --output=avail -B1 "$BACKUP_DIR" 2>/dev/null | tail -n 1 | tr -d '[:space:]')"
  [[ "$available_bytes" =~ ^[0-9]+$ ]] || \
    fatal_after_standalone_replacement "cannot measure free space for the plain recovery point"
  required_bytes="$EVENT_PLATFORM_PLAIN_RECOVERY_MIN_FREE_BYTES"
  if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
    database_bytes="$(psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -c 'SELECT pg_database_size(current_database());' 2>/dev/null || true)"
    if [[ "$database_bytes" =~ ^[0-9]+$ ]]; then
      # dump + canary restore + headroom
      required_bytes=$((database_bytes * 3 + EVENT_PLATFORM_PLAIN_RECOVERY_MIN_FREE_BYTES))
    fi
  fi
  [ "$available_bytes" -ge "$required_bytes" ] || \
    fatal_after_standalone_replacement "plain recovery point needs $required_bytes free bytes under $BACKUP_DIR, only $available_bytes available"
}

drop_plain_recovery_canaries() {
  local canary
  for canary in $(runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 \
      -c "SELECT datname FROM pg_database WHERE datname LIKE '${EVENT_PLATFORM_PLAIN_CANARY_PREFIX}%';" 2>/dev/null || true); do
    [[ "$canary" =~ ^${EVENT_PLATFORM_PLAIN_CANARY_PREFIX}[0-9a-f]{12}$ ]] || continue
    runuser -u postgres -- dropdb --if-exists "$canary" >/dev/null 2>&1 || \
      log "WARNING: could not drop stale plain recovery canary database $canary"
  done
}

plain_recovery_point_row_counts() {
  # Fund tables are the ones the pilot migration rewrites; the ledger proves the
  # dump is from this schema generation. Superuser/BYPASSRLS on both sides so
  # FORCE RLS cannot hide rows from the comparison.
  printf '%s' "SELECT (SELECT count(*) FROM public.funds) || '|' || (SELECT count(*) FROM public.fund_transactions) || '|' || (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL);"
}

# Plain counterpart of the commissioned recovery point. Runs after the PM2
# fence and the Fund-table drain, so the dump is the exact pre-migration state.
backup_event_platform_pilot_database_plain() {
  local evidence_path evidence_record checksum_path dump_path dump_bytes dump_sha
  local db_name canary source_counts canary_counts toc_entries fund_toc created_at source_identity_sha
  local offsite_copy offsite_stamp

  evidence_path="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.log"
  evidence_record="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.env"
  checksum_path="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.sha256"
  rm -f -- "$evidence_path" "$evidence_record" "$checksum_path"

  assert_root_owned_nonwritable_directory "event-platform recovery root" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"
  [ "$(stat -c '%a' "$EVENT_PLATFORM_PILOT_RECOVERY_DIR")" = "700" ] || \
    fatal_after_standalone_replacement "event-platform recovery root must use mode 0700"
  [ -d "$BACKUP_PATH" ] && [ "$(stat -c '%U:%a' "$BACKUP_PATH")" = "root:700" ] || \
    fatal_after_standalone_replacement "plain recovery point needs the root-only deployment backup directory"

  db_name="$(psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c 'SELECT current_database();' 2>/dev/null)" || \
    fatal_after_standalone_replacement "cannot resolve the migration database name for the plain recovery point"
  [[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || \
    fatal_after_standalone_replacement "migration database name is not a plain identifier"
  source_counts="$(psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$(plain_recovery_point_row_counts)" 2>/dev/null)" || \
    fatal_after_standalone_replacement "cannot count Fund rows in the fenced source database"
  [[ "$source_counts" =~ ^[0-9]+\|[0-9]+\|[0-9]+$ ]] || \
    fatal_after_standalone_replacement "fenced source row counts are malformed"

  dump_path="$BACKUP_PATH/postgres-pre-fund-cutover-${db_name}.dump"
  umask 077
  log "Creating a plain pg_dump recovery point of $db_name before the Fund migration..."
  : >"$evidence_path"
  chmod 0600 "$evidence_path"
  printf '[plain-recovery-point] mode=plain database=%s artifact=%s source_counts=%s\n' \
    "$db_name" "$ARTIFACT_DEPLOY_SHA" "$source_counts" >>"$evidence_path"
  if ! runuser -u postgres -- pg_dump -Fc -Z6 --no-password "$db_name" >"$dump_path" 2>>"$evidence_path"; then
    fatal_after_standalone_replacement "plain pg_dump recovery point failed"
  fi
  dump_bytes="$(stat -c '%s' "$dump_path")"
  [[ "$dump_bytes" =~ ^[0-9]+$ ]] && [ "$dump_bytes" -ge "$EVENT_PLATFORM_PLAIN_RECOVERY_MIN_BYTES" ] || \
    fatal_after_standalone_replacement "plain recovery point is smaller than the reviewed minimum"
  dump_sha="$(sha256sum "$dump_path" | awk '{print $1}')"
  [[ "$dump_sha" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "cannot hash the plain recovery point"
  # The dump is root-only; postgres reads it through our stdin, never the path.
  toc_entries="$(pg_restore --list <"$dump_path" 2>>"$evidence_path" | grep -Ec '^[0-9]+; ' || true)"
  fund_toc="$(pg_restore --list <"$dump_path" 2>/dev/null | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public (funds|fund_transactions|_prisma_migrations) ' || true)"
  [ "$toc_entries" -gt 0 ] && [ "$fund_toc" = "3" ] || \
    fatal_after_standalone_replacement "plain recovery point does not contain the Fund tables and migration ledger"
  printf '[plain-recovery-point] dump=%s bytes=%s sha256=%s toc_entries=%s\n' \
    "$dump_path" "$dump_bytes" "$dump_sha" "$toc_entries" >>"$evidence_path"

  # Restore drill: the dump must come back as a database, and the Fund rows
  # and applied-migration ledger must count the same as the fenced source.
  drop_plain_recovery_canaries
  canary="${EVENT_PLATFORM_PLAIN_CANARY_PREFIX}$(tr -d '-' </proc/sys/kernel/random/uuid | cut -c1-12)"
  [[ "$canary" =~ ^${EVENT_PLATFORM_PLAIN_CANARY_PREFIX}[0-9a-f]{12}$ ]] || \
    fatal_after_standalone_replacement "cannot allocate a plain recovery canary database name"
  log "Restoring the plain recovery point into canary database $canary..."
  runuser -u postgres -- createdb --template=template0 --encoding=UTF8 "$canary" >>"$evidence_path" 2>&1 || \
    fatal_after_standalone_replacement "cannot create the plain recovery canary database"
  if ! runuser -u postgres -- pg_restore --no-owner --no-privileges --single-transaction \
      --dbname="$canary" <"$dump_path" >>"$evidence_path" 2>&1; then
    runuser -u postgres -- dropdb --if-exists "$canary" >/dev/null 2>&1 || true
    fatal_after_standalone_replacement "plain recovery point failed the canary restore drill"
  fi
  canary_counts="$(runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 --dbname="$canary" \
    -c "$(plain_recovery_point_row_counts)" 2>>"$evidence_path" || true)"
  runuser -u postgres -- dropdb --if-exists "$canary" >>"$evidence_path" 2>&1 || \
    log "WARNING: could not drop plain recovery canary database $canary"
  [ "$canary_counts" = "$source_counts" ] || \
    fatal_after_standalone_replacement "canary restore row counts ($canary_counts) differ from the fenced source ($source_counts)"
  printf '[plain-recovery-point] restore canary passed canary=%s counts=%s\n' "$canary" "$canary_counts" >>"$evidence_path"

  # Second copy into the daily off-site backup directory, when the host has
  # one: its nightly rsync ships it off the box with the ordinary dumps.
  offsite_copy=""
  if [ -d "$DAILY_PLAIN_BACKUP_DIR" ] && [ ! -L "$DAILY_PLAIN_BACKUP_DIR" ] \
      && [ "$(stat -c '%U' "$DAILY_PLAIN_BACKUP_DIR")" = "root" ]; then
    offsite_stamp="$(date -u '+%Y%m%d-%H%M%S')"
    offsite_copy="$DAILY_PLAIN_BACKUP_DIR/${db_name}-${offsite_stamp}-pre-fund-cutover-${ARTIFACT_DEPLOY_SHA:0:12}.dump"
    if cp -- "$dump_path" "$offsite_copy" \
        && sha256sum "$offsite_copy" >"$offsite_copy.sha256" \
        && chmod 0600 "$offsite_copy" "$offsite_copy.sha256"; then
      printf '[plain-recovery-point] offsite_copy=%s\n' "$offsite_copy" >>"$evidence_path"
    else
      rm -f -- "$offsite_copy" "$offsite_copy.sha256"
      offsite_copy=""
      log "WARNING: could not place the plain recovery point into $DAILY_PLAIN_BACKUP_DIR; the root-only copy under $BACKUP_PATH stands"
    fi
  fi

  source_identity_sha="$(printf '%s' "$EVENT_PLATFORM_DATABASE_IDENTITY" | sha256sum | awk '{print $1}')"
  created_at="$(date -u '+%Y%m%dT%H%M%SZ')"
  umask 077
  printf '%s\n' \
    'FORMAT_VERSION=3' \
    'STATUS=verified' \
    "RECOVERY_POINT_KIND=$EVENT_PLATFORM_PLAIN_RECOVERY_POINT_KIND" \
    "DATABASE_NAME=$db_name" \
    "DUMP_PATH=$dump_path" \
    "DUMP_BYTES=$dump_bytes" \
    "DUMP_SHA256=$dump_sha" \
    "DUMP_TOC_ENTRIES=$toc_entries" \
    "SOURCE_ROW_COUNTS=$source_counts" \
    "OFFSITE_COPY=$offsite_copy" \
    "ARTIFACT_SHA=$ARTIFACT_DEPLOY_SHA" \
    "SOURCE_DATABASE_IDENTITY_SHA256=$source_identity_sha" \
    "CREATED_AT_UTC=$created_at" \
    >"$evidence_record"
  chmod 0600 "$evidence_path" "$evidence_record" "$dump_path"
  (
    cd "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"
    sha256sum "$(basename -- "$evidence_path")" "$(basename -- "$evidence_record")" \
      >"$(basename -- "$checksum_path")"
    sha256sum --check "$(basename -- "$checksum_path")" >/dev/null
  ) || fatal_after_standalone_replacement "cannot checksum the plain recovery-point evidence"
  chmod 0600 "$checksum_path"

  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE="$evidence_path"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD="$evidence_record"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM="$checksum_path"
  sync -f -- "$dump_path" "$evidence_path" "$evidence_record" "$checksum_path" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot persist the plain recovery-point evidence"
  validate_event_platform_recovery_evidence
  validate_event_platform_backup_preconditions fenced
  log "Plain pre-pilot recovery point passed dump, canary-restore and row-count checks: $dump_path ($dump_bytes bytes)"
}

# Plain counterpart of validate_event_platform_recovery_evidence: the retry
# path must find the exact dump this evidence describes, byte for byte.
validate_plain_recovery_point_evidence() {
  local evidence_record evidence_file checksum_line_count
  local format status kind dump_path dump_bytes dump_sha artifact_sha source_identity_sha created_at
  local created_iso created_epoch now_epoch

  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.log"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.env"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.sha256"
  evidence_record="$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD"
  for evidence_file in \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE" \
    "$evidence_record" \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM"; do
    assert_root_owned_nonwritable_file "pre-pilot PostgreSQL recovery-point evidence" "$evidence_file"
    [ "$(stat -c '%a' "$evidence_file")" = "600" ] || \
      fatal_after_standalone_replacement "pre-pilot PostgreSQL recovery-point evidence must use mode 0600"
  done
  checksum_line_count="$(wc -l <"$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" | tr -d '[:space:]')"
  [ "$checksum_line_count" = "2" ] \
    && [ "$(grep -Ec '^[0-9a-f]{64}  pre-pilot-backup\.log$' "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" || true)" = "1" ] \
    && [ "$(grep -Ec '^[0-9a-f]{64}  pre-pilot-backup\.env$' "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM" || true)" = "1" ] \
    && (cd "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" \
      && sha256sum --check "$(basename -- "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM")" >/dev/null) || \
    fatal_after_standalone_replacement "verified pre-pilot PostgreSQL recovery-point evidence is missing or changed"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH=$(awk '$2 == "pre-pilot-backup.log" { print $1 }' \
    "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM")
  [[ "$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "pre-pilot PostgreSQL recovery-point evidence hash is invalid"

  format="$(read_static_env_value "$evidence_record" FORMAT_VERSION)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate FORMAT_VERSION"
  status="$(read_static_env_value "$evidence_record" STATUS)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate STATUS"
  kind="$(read_static_env_value "$evidence_record" RECOVERY_POINT_KIND)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate RECOVERY_POINT_KIND"
  dump_path="$(read_static_env_value "$evidence_record" DUMP_PATH)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate DUMP_PATH"
  dump_bytes="$(read_static_env_value "$evidence_record" DUMP_BYTES)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate DUMP_BYTES"
  dump_sha="$(read_static_env_value "$evidence_record" DUMP_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate DUMP_SHA256"
  artifact_sha="$(read_static_env_value "$evidence_record" ARTIFACT_SHA)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate ARTIFACT_SHA"
  source_identity_sha="$(read_static_env_value "$evidence_record" SOURCE_DATABASE_IDENTITY_SHA256)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate SOURCE_DATABASE_IDENTITY_SHA256"
  created_at="$(read_static_env_value "$evidence_record" CREATED_AT_UTC)" || \
    fatal_after_standalone_replacement "pre-pilot recovery record has duplicate CREATED_AT_UTC"
  [ "$format:$status:$kind" = "3:verified:$EVENT_PLATFORM_PLAIN_RECOVERY_POINT_KIND" ] || \
    fatal_after_standalone_replacement "pre-pilot recovery record is not a verified plain recovery point; a commissioned recovery point cannot be retried in plain mode"
  [[ "$dump_path" == "$BACKUP_DIR"/backup-*/postgres-pre-fund-cutover-*.dump ]] \
    && [[ "$dump_bytes" =~ ^[0-9]+$ ]] && [ "$dump_bytes" -ge "$EVENT_PLATFORM_PLAIN_RECOVERY_MIN_BYTES" ] \
    && [[ "$dump_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$artifact_sha" = "$ARTIFACT_DEPLOY_SHA" ] \
    && [[ "$source_identity_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$created_at" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || \
    fatal_after_standalone_replacement "plain pre-pilot recovery record is incomplete or stale for this artifact"
  created_iso="${created_at:0:4}-${created_at:4:2}-${created_at:6:2}T${created_at:9:2}:${created_at:11:2}:${created_at:13:2}Z"
  created_epoch="$(date -u -d "$created_iso" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  [[ "$created_epoch" =~ ^[0-9]+$ ]] && [ "$created_epoch" -le $((now_epoch + 300)) ] || \
    fatal_after_standalone_replacement "plain pre-pilot recovery timestamp is invalid"
  [ -n "$EVENT_PLATFORM_DATABASE_IDENTITY" ] \
    && [ "$(printf '%s' "$EVENT_PLATFORM_DATABASE_IDENTITY" | sha256sum | awk '{print $1}')" = "$source_identity_sha" ] || \
    fatal_after_standalone_replacement "plain pre-pilot recovery point belongs to another database instance"
  assert_root_owned_nonwritable_file "plain pre-pilot recovery point" "$dump_path"
  [ "$(stat -c '%a' "$dump_path")" = "600" ] \
    && [ "$(stat -c '%s' "$dump_path")" = "$dump_bytes" ] \
    && [ "$(sha256sum "$dump_path" | awk '{print $1}')" = "$dump_sha" ] || \
    fatal_after_standalone_replacement "plain pre-pilot recovery point changed or disappeared after it was verified"
}

validate_event_platform_backup_preconditions() {
  local postgres_service_mode="${1:-unfenced}"
  local backup_env_file="/etc/leaddrive/backup.env"
  local backup_encryption backup_recipient secrets_recipient backup_env_override backup_mode backup_group load_state
  local service_environment_files service_environment service_fragment service_dropins
  local service_user service_group service_pass_environment expected_exec_start_count
  local expected_service_fragment age_version age_hash aws_version recipient_hash
  local timer_load timer_enabled timer_active aws_real timer
  local active_timer_count=0 disabled_timer_count=0 absent_optional_timer_count=0
  local command_name policy policy_key policy_expected policy_value minimum default_value policy_label
  local monthly_retention secrets_retention
  local candidate_sha_marker candidate_postgres_script candidate_restore_script candidate_canary_sql
  local candidate_secrets_script candidate_runtime_files_script
  local candidate_program_set_helper candidate_program_set_sha certified_program_set_sha
  local candidate_db_contract_helper candidate_db_contract_sha certified_db_contract_sha
  local candidate_db_contract_manifest
  local certified_database_identity_sha certified_migration_ledger_sha
  local candidate_service_fragment candidate_secrets_fragment candidate_runtime_files_fragment
  local candidate_runtime_files_timer required_unit_line

  case "$postgres_service_mode" in
    unfenced|fenced) ;;
    *) fatal_after_standalone_replacement "unknown PostgreSQL backup precondition mode" ;;
  esac

  # An uncommissioned host cannot satisfy the reviewed ceremony below and must
  # not be asked to; see "Recovery gate mode" above.
  announce_recovery_gate_mode
  if [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then
    validate_plain_recovery_point_preconditions "$postgres_service_mode"
    return 0
  fi

  for command_name in cmp find findmnt journalctl mkfifo readlink sha256sum ssh-keygen systemctl systemd-run timeout; do
    command -v "$command_name" >/dev/null 2>&1 || \
      fatal_after_standalone_replacement "event-platform recovery-point gate requires $command_name"
  done

  assert_root_owned_nonwritable_file "PostgreSQL backup environment" "$backup_env_file"
  backup_mode="$(stat -c '%a' "$backup_env_file")"
  backup_group="$(stat -c '%G' "$backup_env_file")"
  case "$backup_mode" in
    600) ;;
    640)
      [ "$backup_group" = "leaddrive-backup" ] || \
        fatal_after_standalone_replacement "mode 0640 backup environment must belong to leaddrive-backup"
      ;;
    *) fatal_after_standalone_replacement "PostgreSQL backup environment must use mode 0600 or root:leaddrive-backup 0640" ;;
  esac

  backup_encryption="$(read_static_env_value "$backup_env_file" BACKUP_ENCRYPTION)" || \
    fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate BACKUP_ENCRYPTION keys"
  backup_recipient="$(read_static_env_value "$backup_env_file" BACKUP_AGE_RECIPIENT)" || \
    fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate BACKUP_AGE_RECIPIENT keys"
  secrets_recipient="$(read_static_env_value "$backup_env_file" SECRETS_AGE_RECIPIENT)" || \
    fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate SECRETS_AGE_RECIPIENT keys"
  backup_env_override="$(read_static_env_value "$backup_env_file" BACKUP_ENV_FILE)" || \
    fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate BACKUP_ENV_FILE keys"
  [ -z "$backup_env_override" ] || \
    fatal_after_standalone_replacement "PostgreSQL backup environment must not redirect BACKUP_ENV_FILE"
  for policy in \
    'BACKUP_WORK_ROOT:/run/leaddrive-postgres-backup' \
    'BACKUP_STATE_ROOT:/var/lib/leaddrive-postgres-backup' \
    'BACKUP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock' \
    'BACKUP_S3_PREFIX:postgres' \
    'APP_ENV_FILE:/etc/leaddrive/app.env' \
    'SECRETS_WORK_ROOT:/run/leaddrive-secrets-snapshot' \
    'SECRETS_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock' \
    'RUNTIME_FILES_SOURCE_ROOT:/var/lib/leaddrive-v2' \
    'RUNTIME_FILES_STATE_ROOT:/var/lib/leaddrive-runtime-files-snapshot' \
    'RUNTIME_FILES_WORK_ROOT:/run/leaddrive-runtime-files-snapshot' \
    'RUNTIME_FILES_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock' \
    'RUNTIME_FILES_S3_PREFIX:runtime-files' \
    'LOG_SHIP_SOURCE_DIRS:/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql' \
    'LOG_SHIP_SOURCE_FILES:/var/log/leaddrive-resilience-cron.log' \
    'LOG_SHIP_STATE_FILE:/var/lib/leaddrive-log-ship/log-ship-offsets' \
    'LOG_SHIP_WORK_ROOT:/run/leaddrive-log-ship' \
    'LOG_SHIP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/log-ship.lock' \
    'LOG_SHIP_S3_PREFIX:logs' \
    'LOG_SHIP_JOURNAL_UNITS:leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service' \
    'PGPASSFILE:/etc/leaddrive/backup.pgpass' \
    'PGSSLROOTCERT:/etc/leaddrive/managed-postgres-ca.crt' \
    'VERIFY_PGPASSFILE:/etc/leaddrive/restore-verifier.pgpass' \
    'VERIFY_PGSSLROOTCERT:/etc/leaddrive/restore-postgres-ca.crt' \
    'SECRETS_S3_PREFIX:secrets'; do
    policy_key="${policy%%:*}"
    policy_expected="${policy#*:}"
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    [ -z "$policy_value" ] || [ "$policy_value" = "$policy_expected" ] || \
      fatal_after_standalone_replacement "$policy_key overrides the reviewed recovery authority"
  done
  for policy_key in BACKUP_TIER_OVERRIDE SECRETS_FILES SECRETS_DRY_RUN RUNTIME_FILES_PATHS \
    LOG_SHIP_SOURCE_DIR LOG_SHIP_JOURNAL_SINCE; do
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    [ -z "$policy_value" ] || \
      fatal_after_standalone_replacement "$policy_key is forbidden in production backup configuration"
  done
  for policy in \
    'BACKUP_RETENTION_DAILY_DAYS:16:16:daily' \
    'BACKUP_RETENTION_WEEKLY_DAYS:63:63:weekly' \
    'BACKUP_RETENTION_MONTHLY_DAYS:400:400:monthly' \
    'BACKUP_MIN_DUMP_BYTES:1048576:1048576:minimum-dump' \
    'BACKUP_MIN_WORK_AVAILABLE_BYTES:1073741824:1073741824:minimum-tmpfs' \
    'BACKUP_WORK_CAPACITY_RATIO_PERCENT:250:250:tmpfs-capacity-ratio' \
    'RUNTIME_FILES_CAPACITY_RATIO_PERCENT:110:110:runtime-files-capacity-ratio' \
    'RUNTIME_FILES_MIN_FREE_BYTES:1073741824:1073741824:runtime-files-minimum-free' \
    'LOG_SHIP_RETENTION_DAYS:400:400:log-retention'; do
    IFS=: read -r policy_key default_value minimum policy_label <<<"$policy"
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    policy_value="${policy_value:-$default_value}"
    [[ "$policy_value" =~ ^[0-9]+$ ]] && [ "$policy_value" -ge "$minimum" ] || \
      fatal_after_standalone_replacement "$policy_label recovery policy is below its reviewed minimum"
  done
  monthly_retention="$(read_static_env_value "$backup_env_file" BACKUP_RETENTION_MONTHLY_DAYS)" || \
    fatal_after_standalone_replacement "backup environment contains duplicate monthly retention keys"
  monthly_retention="${monthly_retention:-400}"
  secrets_retention="$(read_static_env_value "$backup_env_file" SECRETS_RETENTION_DAYS)" || \
    fatal_after_standalone_replacement "backup environment contains duplicate secrets retention keys"
  secrets_retention="${secrets_retention:-400}"
  [[ "$secrets_retention" =~ ^[0-9]+$ ]] \
    && [ "$secrets_retention" -ge "$monthly_retention" ] || \
    fatal_after_standalone_replacement "secrets retention does not cover the longest database retention"
  for policy in \
    'PGSSLMODE:verify-full' \
    'VERIFY_PGSSLMODE:verify-full' \
    'BACKUP_REQUIRE_HEALTHCHECK:1'; do
    policy_key="${policy%%:*}"
    policy_expected="${policy#*:}"
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    [ "$policy_value" = "$policy_expected" ] || \
      fatal_after_standalone_replacement "$policy_key does not match the reviewed fail-closed policy"
  done
  for policy_key in PGCONNECT_TIMEOUT VERIFY_PGCONNECT_TIMEOUT; do
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    [[ "$policy_value" =~ ^[0-9]+$ ]] \
      && [ "$policy_value" -ge 1 ] && [ "$policy_value" -le 30 ] || \
      fatal_after_standalone_replacement "$policy_key must be between 1 and 30 seconds"
  done
  for policy_key in BACKUP_HEALTHCHECK_URL SECRETS_HEALTHCHECK_URL \
    RUNTIME_FILES_HEALTHCHECK_URL LOG_SHIP_HEALTHCHECK_URL; do
    policy_value="$(read_static_env_value "$backup_env_file" "$policy_key")" || \
      fatal_after_standalone_replacement "backup environment contains duplicate $policy_key keys"
    [[ "$policy_value" =~ ^https://[^[:space:]]{8,}$ ]] \
      && [[ "${policy_value,,}" != *replace* ]] \
      && [[ "${policy_value,,}" != *.example* ]] || \
      fatal_after_standalone_replacement "$policy_key is missing, unsafe, or still a placeholder"
  done
  for policy_value in /etc/leaddrive/app.env /etc/leaddrive/migration.env; do
    assert_root_owned_nonwritable_file "recovery-set secret" "$policy_value"
    [ "$(stat -c '%U:%G:%a' "$policy_value")" = "root:root:600" ] || \
      fatal_after_standalone_replacement "$policy_value must be root:root mode 0600"
  done
  for policy_value in /etc/leaddrive/backup.pgpass /etc/leaddrive/restore-verifier.pgpass; do
    assert_root_owned_nonwritable_file "PostgreSQL password file" "$policy_value"
    case "$(stat -c '%U:%G:%a' "$policy_value")" in
      root:leaddrive-backup:440|root:leaddrive-backup:640) ;;
      *) fatal_after_standalone_replacement "$policy_value must be root:leaddrive-backup mode 0440 or 0640" ;;
    esac
  done
  for policy_value in /etc/leaddrive/managed-postgres-ca.crt /etc/leaddrive/restore-postgres-ca.crt; do
    assert_root_owned_nonwritable_file "PostgreSQL CA file" "$policy_value"
    case "$(stat -c '%a' "$policy_value")" in
      400|440|444|600|640|644) ;;
      *) fatal_after_standalone_replacement "$policy_value has an unsafe mode" ;;
    esac
  done
  [ "$(findmnt -n -o FSTYPE --target /run 2>/dev/null || true)" = "tmpfs" ] || \
    fatal_after_standalone_replacement "production /run must be tmpfs for plaintext backup staging"
  if [ -d /var/lib/leaddrive-backup ] && \
      find /var/lib/leaddrive-backup -mindepth 1 -maxdepth 2 \
        \( -name 'run-*' -o -name 'secrets-*' -o -name 'logship-*' \
           -o -name '*.dump' -o -name '*.tar' -o -name '*.age' \) \
        -print -quit | grep -q .; then
    fatal_after_standalone_replacement "legacy backup root contains possible plaintext/ciphertext remnants"
  fi
  [ "$backup_encryption" = "age" ] || \
    fatal_after_standalone_replacement "Fund cutover requires age-encrypted PostgreSQL backups"
  [ -n "$backup_recipient" ] || \
    fatal_after_standalone_replacement "Fund cutover requires an offline BACKUP_AGE_RECIPIENT"
  [[ "$backup_recipient" =~ ^age1[0-9a-z]{58}$ ]] || \
    fatal_after_standalone_replacement "Fund cutover requires one native age X25519 recipient"
  [ -z "$secrets_recipient" ] || [ "$secrets_recipient" = "$backup_recipient" ] || \
    fatal_after_standalone_replacement "Fund cutover requires DB and secrets snapshots under the same commissioned recipient"

  # The first Fund cutover is not allowed to trust PATH, an unversioned tool,
  # or a claim that encryption works without an independently restored object.
  # These root-owned markers contain no private identity or database content.
  assert_root_owned_nonwritable_directory "backup evidence root" "$BACKUP_EVIDENCE_ROOT"
  [ "$(stat -c '%a' "$BACKUP_EVIDENCE_ROOT")" = "700" ] || \
    fatal_after_standalone_replacement "backup evidence root must use mode 0700"
  assert_root_owned_nonwritable_file "age key-custody marker" "$BACKUP_CUSTODY_MARKER"
  assert_root_owned_nonwritable_file "offline restore marker" "$BACKUP_OFFLINE_RESTORE_MARKER"
  [ "$(stat -c '%a' "$BACKUP_CUSTODY_MARKER")" = "600" ] \
    && [ "$(stat -c '%a' "$BACKUP_OFFLINE_RESTORE_MARKER")" = "600" ] || \
    fatal_after_standalone_replacement "backup custody and restore markers must use mode 0600"

  recipient_hash="$(printf '%s' "$backup_recipient" | sha256sum | awk '{print $1}')"
  [ "$(read_static_env_value "$BACKUP_CUSTODY_MARKER" RECIPIENT_SHA256)" = "$recipient_hash" ] \
    && [ "$(read_static_env_value "$BACKUP_OFFLINE_RESTORE_MARKER" RECIPIENT_SHA256)" = "$recipient_hash" ] || \
    fatal_after_standalone_replacement "backup evidence belongs to another age recipient"
  validate_preserved_backup_evidence "$BACKUP_CUSTODY_MARKER" age-key-custody "$recipient_hash"
  validate_preserved_backup_evidence "$BACKUP_OFFLINE_RESTORE_MARKER" archive-restore "$recipient_hash" full-recovery

  certified_database_identity_sha="$(read_static_env_value \
    "$BACKUP_OFFLINE_RESTORE_MARKER" SOURCE_DATABASE_IDENTITY_SHA256)"
  certified_migration_ledger_sha="$(read_static_env_value \
    "$BACKUP_OFFLINE_RESTORE_MARKER" SOURCE_MIGRATION_LEDGER_SHA256)"
  probe_current_backup_database_state "$backup_env_file"
  [ "$CURRENT_BACKUP_DATABASE_IDENTITY_SHA256" = "$certified_database_identity_sha" ] \
    && [ "$CURRENT_BACKUP_MIGRATION_LEDGER_SHA256" = "$certified_migration_ledger_sha" ] || \
    fatal_after_standalone_replacement \
      "current database identity or migration ledger differs from the signed recovery point; run a new post-migration restore drill"

  for policy_value in \
    /usr/local \
    /usr/local/bin \
    /usr/local/lib \
    /usr/local/lib/leaddrive-backup \
    /usr/local/lib/leaddrive-backup/tools \
    /usr/local/lib/leaddrive-backup/tools/age \
    "/usr/local/lib/leaddrive-backup/tools/age/$BACKUP_AGE_VERSION" \
    /usr/local/lib/leaddrive-backup/tools/aws-cli \
    "$BACKUP_AWS_ROOT" \
    "$BACKUP_AWS_ROOT/v2" \
    "$BACKUP_AWS_ROOT/v2/$BACKUP_AWS_VERSION"; do
    assert_root_owned_nonwritable_directory "backup tool ancestor" "$policy_value"
  done
  assert_root_owned_nonwritable_file "pinned age binary" "$BACKUP_AGE_BIN"
  assert_root_owned_nonwritable_file "pinned age provenance" "$BACKUP_AGE_PROVENANCE"
  [ "$(read_static_env_value "$BACKUP_AGE_PROVENANCE" VERSION)" = "$BACKUP_AGE_VERSION" ] \
    && [ "$(read_static_env_value "$BACKUP_AGE_PROVENANCE" ARCHIVE_SHA256)" = "$BACKUP_AGE_ARCHIVE_SHA256" ] \
    && [ "$(read_static_env_value "$BACKUP_AGE_PROVENANCE" BINARY_SHA256)" = "$BACKUP_AGE_BINARY_SHA256" ] || \
    fatal_after_standalone_replacement "pinned age provenance is incomplete or drifted"
  age_hash="$(sha256sum "$BACKUP_AGE_BIN" | awk '{print $1}')"
  [ "$age_hash" = "$BACKUP_AGE_BINARY_SHA256" ] || \
    fatal_after_standalone_replacement "pinned age binary digest drifted"
  age_version="$("$BACKUP_AGE_BIN" --version 2>&1 || true)"
  [[ "$age_version" =~ ^v?1\.3\.2$ ]] || \
    fatal_after_standalone_replacement "Fund cutover requires exact age $BACKUP_AGE_VERSION"
  [ -L /usr/local/bin/age ] \
    && [ "$(readlink -- /usr/local/bin/age)" = "$BACKUP_AGE_BIN" ] \
    && [ "$(readlink -f -- /usr/local/bin/age)" = "$BACKUP_AGE_BIN" ] || \
    fatal_after_standalone_replacement "age command does not resolve to the pinned versioned binary"

  assert_root_owned_nonwritable_file "pinned AWS CLI resolved binary" "$BACKUP_AWS_REAL_BIN"
  assert_root_owned_nonwritable_file "pinned AWS CLI provenance" "$BACKUP_AWS_PROVENANCE"
  [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" VERSION)" = "$BACKUP_AWS_VERSION" ] \
    && [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" ARCHIVE_SHA256)" = "$BACKUP_AWS_ARCHIVE_SHA256" ] \
    && [ "$(read_static_env_value "$BACKUP_AWS_PROVENANCE" SIGNING_FINGERPRINT)" = "$BACKUP_AWS_SIGNING_FINGERPRINT" ] || \
    fatal_after_standalone_replacement "pinned AWS CLI provenance is incomplete or drifted"
  [ -L "$BACKUP_AWS_ROOT/v2/current" ] \
    && [ "$(readlink -- "$BACKUP_AWS_ROOT/v2/current")" = "$BACKUP_AWS_ROOT/v2/$BACKUP_AWS_VERSION" ] || \
    fatal_after_standalone_replacement "AWS CLI current link does not select the pinned version"
  [ -L "$BACKUP_AWS_BIN" ] || \
    fatal_after_standalone_replacement "AWS CLI command inside the pinned installation is not a symlink"
  aws_real="$(readlink -f -- "$BACKUP_AWS_BIN")"
  [ "$aws_real" = "$BACKUP_AWS_REAL_BIN" ] || \
    fatal_after_standalone_replacement "AWS CLI binary resolves outside the pinned installation"
  aws_version="$("$BACKUP_AWS_BIN" --version 2>&1 || true)"
  [ "${aws_version%% *}" = "aws-cli/$BACKUP_AWS_VERSION" ] || \
    fatal_after_standalone_replacement "Fund cutover requires exact AWS CLI $BACKUP_AWS_VERSION"
  [ -L /usr/local/bin/aws ] \
    && [ "$(readlink -- /usr/local/bin/aws)" = "$BACKUP_AWS_BIN" ] \
    && [ "$(readlink -f -- /usr/local/bin/aws)" = "$aws_real" ] || \
    fatal_after_standalone_replacement "aws command does not resolve to the pinned versioned binary"

  if [ "$postgres_service_mode" = "fenced" ]; then
    [ "$EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED" = "true" ] \
      && [ -L /run/systemd/system/leaddrive-postgres-backup.service ] \
      && [ "$(readlink -- /run/systemd/system/leaddrive-postgres-backup.service)" = /dev/null ] \
      && [ -f "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ] \
      && [ ! -L "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ] \
      && [ "$(stat -c '%U:%G:%a' "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL")" = "root:root:600" ] \
      && [ "$(read_static_env_value "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" STATUS)" = started ] \
      && [ "$(read_static_env_value "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ARTIFACT_SHA)" = "$ARTIFACT_DEPLOY_SHA" ] \
      && [ "$(read_static_env_value "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" SCRIPT_SHA256)" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ] \
      && ! systemctl is-active --quiet leaddrive-postgres-backup.service || \
      fatal_after_standalone_replacement "PostgreSQL backup service is not protected by the journaled cutover fence"
  else
    load_state="$(systemctl show --property=LoadState --value leaddrive-postgres-backup.service 2>/dev/null || true)"
    [ "$load_state" = "loaded" ] || \
      fatal_after_standalone_replacement "verified PostgreSQL backup service is not loaded"
  fi
  for timer in leaddrive-postgres-backup.timer leaddrive-secrets-snapshot.timer \
    leaddrive-runtime-files-snapshot.timer leaddrive-log-ship.timer; do
    timer_load="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"
    timer_enabled="$(systemctl is-enabled "$timer" 2>/dev/null || true)"
    timer_active="$(systemctl is-active "$timer" 2>/dev/null || true)"
    case "$timer_load:$timer_enabled:$timer_active" in
      loaded:enabled:active) active_timer_count=$((active_timer_count + 1)) ;;
      loaded:disabled:inactive) disabled_timer_count=$((disabled_timer_count + 1)) ;;
      not-found:not-found:inactive|not-found:not-found:unknown)
        case "$timer" in
          leaddrive-runtime-files-snapshot.timer|leaddrive-log-ship.timer)
            absent_optional_timer_count=$((absent_optional_timer_count + 1))
            ;;
          *) fatal_after_standalone_replacement "$timer is a required bootstrap timer but is absent" ;;
        esac
        ;;
      *) fatal_after_standalone_replacement "$timer has a mixed or unsafe certification state" ;;
    esac
  done
  if [ "$active_timer_count" -eq 4 ]; then
    : # A previously activated immutable operations release is healthy.
  elif [ "$active_timer_count" -eq 0 ] \
    && [ $((disabled_timer_count + absent_optional_timer_count)) -eq 4 ] \
    && [ "$disabled_timer_count" -ge 2 ]; then
    : # Initial signed certification deliberately leaves every available timer disabled.
  else
    fatal_after_standalone_replacement "recovery timers are partially activated across releases"
  fi

  # The live service and the transient identity probe below must read exactly
  # the same root-owned source configuration. Reject unit overrides that add a
  # second EnvironmentFile or directly replace libpq's PG* values.
  if [ "$postgres_service_mode" = "unfenced" ]; then
    service_environment_files="$(systemctl show --property=EnvironmentFiles --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    [[ "$service_environment_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] || \
      fatal_after_standalone_replacement "PostgreSQL backup service must use only /etc/leaddrive/backup.env"
    service_environment="$(systemctl show --property=Environment --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    [ -z "$service_environment" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service must not define Environment overrides"
    service_pass_environment="$(systemctl show --property=PassEnvironment --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    [ -z "$service_pass_environment" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service must not import system-manager environment"

    service_fragment="$(systemctl show --property=FragmentPath --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    service_dropins="$(systemctl show --property=DropInPaths --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    service_user="$(systemctl show --property=User --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    service_group="$(systemctl show --property=Group --value \
      leaddrive-postgres-backup.service 2>/dev/null || true)"
    [ "$service_fragment" = "/etc/systemd/system/leaddrive-postgres-backup.service" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service has an unexpected fragment path"
    [ -z "$service_dropins" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service must not have systemd drop-ins at Fund cutover"
    [ "$service_user" = "leaddrive-backup" ] && [ "$service_group" = "leaddrive-backup" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service must run as leaddrive-backup"
    assert_root_owned_nonwritable_file "PostgreSQL backup systemd unit" "$service_fragment"
    expected_service_fragment="$OPS_CURRENT_LINK/systemd/leaddrive-postgres-backup.service"
    [ -f "$expected_service_fragment" ] && [ ! -L "$expected_service_fragment" ] || \
      fatal_after_standalone_replacement "active immutable operations release is missing the PostgreSQL backup unit"
    cmp -s -- "$expected_service_fragment" "$service_fragment" || \
      fatal_after_standalone_replacement "live PostgreSQL backup unit differs from the active immutable operations release"
    expected_exec_start_count="$(grep -Fxc \
      'ExecStart=/usr/local/lib/leaddrive-v2/ops/current/backup/postgres-backup.sh' \
      "$service_fragment" || true)"
    [ "$expected_exec_start_count" = "1" ] \
      && [ "$(grep -c '^[[:space:]]*ExecStart=' "$service_fragment" || true)" = "1" ] || \
      fatal_after_standalone_replacement "PostgreSQL backup service ExecStart is not the exact immutable backup program"
  fi

  load_state="$(systemctl show --property=LoadState --value leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  [ "$load_state" = "loaded" ] || \
    fatal_after_standalone_replacement "verified secrets snapshot service is not loaded"
  service_environment_files="$(systemctl show --property=EnvironmentFiles --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_environment="$(systemctl show --property=Environment --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_pass_environment="$(systemctl show --property=PassEnvironment --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_fragment="$(systemctl show --property=FragmentPath --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_dropins="$(systemctl show --property=DropInPaths --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_user="$(systemctl show --property=User --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  service_group="$(systemctl show --property=Group --value \
    leaddrive-secrets-snapshot.service 2>/dev/null || true)"
  [[ "$service_environment_files" =~ ^/etc/leaddrive/backup\.env([[:space:]]+\(ignore_errors=no\))?$ ]] \
    && [ -z "$service_environment" ] && [ -z "$service_pass_environment" ] \
    && [ "$service_fragment" = "/etc/systemd/system/leaddrive-secrets-snapshot.service" ] \
    && [ -z "$service_dropins" ] && [ "$service_user" = "root" ] \
    && { [ -z "$service_group" ] || [ "$service_group" = "root" ]; } || \
    fatal_after_standalone_replacement "secrets snapshot service has an unreviewed authority or override channel"
  assert_root_owned_nonwritable_file "secrets snapshot systemd unit" "$service_fragment"
  expected_service_fragment="$OPS_CURRENT_LINK/systemd/leaddrive-secrets-snapshot.service"
  [ -f "$expected_service_fragment" ] && [ ! -L "$expected_service_fragment" ] \
    && cmp -s -- "$expected_service_fragment" "$service_fragment" || \
    fatal_after_standalone_replacement "live secrets snapshot unit differs from the active immutable operations release"
  expected_exec_start_count="$(grep -Fxc \
    'ExecStart=/usr/local/lib/leaddrive-v2/ops/current/backup/snapshot-secrets.sh' \
    "$service_fragment" || true)"
  [ "$expected_exec_start_count" = "1" ] \
    && [ "$(grep -c '^[[:space:]]*ExecStart=' "$service_fragment" || true)" = "1" ] || \
    fatal_after_standalone_replacement "secrets snapshot service ExecStart is not the exact immutable program"

  candidate_sha_marker="$(tr -d '\r\n' <"$APP_DIR/.next/standalone/.deploy-sha" 2>/dev/null || true)"
  if [ "$candidate_sha_marker" = "$ARTIFACT_DEPLOY_SHA" ]; then
    candidate_postgres_script="$APP_DIR/.next/standalone/scripts/backup/postgres-backup.sh"
    candidate_restore_script="$APP_DIR/.next/standalone/scripts/backup/postgres-restore-canary.sh"
    candidate_canary_sql="$APP_DIR/.next/standalone/scripts/backup/canary.sql"
    candidate_secrets_script="$APP_DIR/.next/standalone/scripts/backup/snapshot-secrets.sh"
    candidate_runtime_files_script="$APP_DIR/.next/standalone/scripts/backup/snapshot-runtime-files.sh"
    candidate_program_set_helper="$APP_DIR/.next/standalone/scripts/backup/hash-recovery-program-set.sh"
    candidate_db_contract_helper="$APP_DIR/.next/standalone/scripts/backup/hash-recovery-db-contract.sh"
    candidate_db_contract_manifest="$APP_DIR/.next/standalone/scripts/backup/recovery-db-contract.tsv"
    candidate_service_fragment="$APP_DIR/.next/standalone/ops/systemd/leaddrive-postgres-backup.service"
    candidate_secrets_fragment="$APP_DIR/.next/standalone/ops/systemd/leaddrive-secrets-snapshot.service"
    candidate_runtime_files_fragment="$APP_DIR/.next/standalone/ops/systemd/leaddrive-runtime-files-snapshot.service"
    candidate_runtime_files_timer="$APP_DIR/.next/standalone/ops/systemd/leaddrive-runtime-files-snapshot.timer"
    [ -x "$candidate_postgres_script" ] && [ ! -L "$candidate_postgres_script" ] \
      && [ -x "$candidate_restore_script" ] && [ ! -L "$candidate_restore_script" ] \
      && [ -f "$candidate_canary_sql" ] && [ ! -L "$candidate_canary_sql" ] \
      && [ -x "$candidate_secrets_script" ] && [ ! -L "$candidate_secrets_script" ] \
      && [ -x "$candidate_runtime_files_script" ] && [ ! -L "$candidate_runtime_files_script" ] \
      && [ -x "$candidate_program_set_helper" ] && [ ! -L "$candidate_program_set_helper" ] \
      && [ -x "$candidate_db_contract_helper" ] && [ ! -L "$candidate_db_contract_helper" ] \
      && [ -f "$candidate_db_contract_manifest" ] && [ ! -L "$candidate_db_contract_manifest" ] \
      && [ -f "$candidate_service_fragment" ] && [ ! -L "$candidate_service_fragment" ] \
      && [ -f "$candidate_secrets_fragment" ] && [ ! -L "$candidate_secrets_fragment" ] \
      && [ -f "$candidate_runtime_files_fragment" ] && [ ! -L "$candidate_runtime_files_fragment" ] \
      && [ -f "$candidate_runtime_files_timer" ] && [ ! -L "$candidate_runtime_files_timer" ] || \
      fatal_after_standalone_replacement "candidate artifact is missing the exact backup recovery program"
    [ "$(sha256sum "$candidate_postgres_script" | awk '{print $1}')" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ] \
      && [ "$(sha256sum "$candidate_restore_script" | awk '{print $1}')" = "$BACKUP_RESTORE_CANARY_SHA256" ] \
      && [ "$(sha256sum "$candidate_canary_sql" | awk '{print $1}')" = "$BACKUP_CANARY_SQL_SHA256" ] \
      && [ "$(sha256sum "$candidate_secrets_script" | awk '{print $1}')" = "$BACKUP_SECRETS_SCRIPT_SHA256" ] \
      && [ "$(sha256sum "$candidate_runtime_files_script" | awk '{print $1}')" = "$BACKUP_RUNTIME_FILES_SCRIPT_SHA256" ] || \
      fatal_after_standalone_replacement "candidate backup helpers differ from the digest-pinned commissioned bytes"
    candidate_program_set_sha="$("$candidate_program_set_helper" "$APP_DIR/.next/standalone")" || \
      fatal_after_standalone_replacement "candidate recovery-program set cannot be hashed"
    certified_program_set_sha="$(read_static_env_value \
      "$BACKUP_OFFLINE_RESTORE_MARKER" RECOVERY_PROGRAM_SET_SHA256)" || \
      fatal_after_standalone_replacement "offline restore marker has duplicate recovery-program set digests"
    [[ "$candidate_program_set_sha" =~ ^[0-9a-f]{64}$ ]] \
      && [ "$candidate_program_set_sha" = "$certified_program_set_sha" ] || \
      fatal_after_standalone_replacement "candidate recovery-program set differs from the signed commissioned digest"
    candidate_db_contract_sha="$("$candidate_db_contract_helper" "$APP_DIR/.next/standalone")" || \
      fatal_after_standalone_replacement "candidate recovery DB contract cannot be hashed"
    certified_db_contract_sha="$(read_static_env_value \
      "$BACKUP_OFFLINE_RESTORE_MARKER" RECOVERY_DB_CONTRACT_SHA256)" || \
      fatal_after_standalone_replacement "offline restore marker has duplicate recovery DB contract digests"
    [[ "$candidate_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
      && [ "$candidate_db_contract_sha" = "$certified_db_contract_sha" ] \
      && [ "$(sha256sum "$candidate_db_contract_manifest" | awk '{print $1}')" = \
        "$certified_db_contract_sha" ] || \
      fatal_after_standalone_replacement "candidate Prisma schema/migration contract differs from the signed commissioned digest"
    for required_unit_line in \
      'User=leaddrive-backup' \
      'Group=leaddrive-backup' \
      'EnvironmentFile=/etc/leaddrive/backup.env' \
      'ExecStart=/usr/local/lib/leaddrive-v2/ops/current/backup/postgres-backup.sh' \
      'StateDirectory=leaddrive-postgres-backup' \
      'RuntimeDirectory=leaddrive-postgres-backup' \
      'MemorySwapMax=0' \
      'ProtectSystem=strict'; do
      [ "$(grep -Fxc "$required_unit_line" "$candidate_service_fragment" || true)" = "1" ] || \
        fatal_after_standalone_replacement "candidate backup unit is missing one exact reviewed authority line"
    done
    [ "$(grep -c '^[[:space:]]*ExecStart=' "$candidate_service_fragment" || true)" = "1" ] || \
      fatal_after_standalone_replacement "candidate backup unit has an unexpected ExecStart override"
    for required_unit_line in \
      'User=root' \
      'EnvironmentFile=/etc/leaddrive/backup.env' \
      'ExecStart=/usr/local/lib/leaddrive-v2/ops/current/backup/snapshot-secrets.sh' \
      'StateDirectory=leaddrive-secrets-snapshot' \
      'StateDirectoryMode=0700' \
      'RuntimeDirectory=leaddrive-secrets-snapshot' \
      'RuntimeDirectoryMode=0700' \
      'MemorySwapMax=0' \
      'ProtectSystem=strict'; do
      [ "$(grep -Fxc "$required_unit_line" "$candidate_secrets_fragment" || true)" = "1" ] || \
        fatal_after_standalone_replacement "candidate secrets unit is missing one exact reviewed authority line"
    done
    [ "$(grep -c '^[[:space:]]*ExecStart=' "$candidate_secrets_fragment" || true)" = "1" ] || \
      fatal_after_standalone_replacement "candidate secrets unit has an unexpected ExecStart override"
    for required_unit_line in \
      'User=root' \
      'EnvironmentFile=/etc/leaddrive/backup.env' \
      'ExecStart=/usr/local/lib/leaddrive-v2/ops/current/backup/snapshot-runtime-files.sh' \
      'StateDirectory=leaddrive-runtime-files-snapshot' \
      'StateDirectoryMode=0700' \
      'RuntimeDirectory=leaddrive-runtime-files-snapshot' \
      'RuntimeDirectoryMode=0700' \
      'MemorySwapMax=0' \
      'ProtectSystem=strict' \
      'ReadOnlyPaths=-/etc/leaddrive /var/lib/leaddrive-v2' \
      'ReadWritePaths=/var/lib/leaddrive-runtime-files-snapshot /run/leaddrive-runtime-files-snapshot'; do
      [ "$(grep -Fxc "$required_unit_line" "$candidate_runtime_files_fragment" || true)" = "1" ] || \
        fatal_after_standalone_replacement "candidate runtime-files unit is missing one exact reviewed authority line"
    done
    [ "$(grep -c '^[[:space:]]*ExecStart=' "$candidate_runtime_files_fragment" || true)" = "1" ] || \
      fatal_after_standalone_replacement "candidate runtime-files unit has an unexpected ExecStart override"
    for required_unit_line in \
      'OnCalendar=*-*-* 04:15:00 UTC' \
      'RandomizedDelaySec=30m' \
      'Persistent=true' \
      'AccuracySec=5m' \
      'Unit=leaddrive-runtime-files-snapshot.service'; do
      [ "$(grep -Fxc "$required_unit_line" "$candidate_runtime_files_timer" || true)" = "1" ] || \
        fatal_after_standalone_replacement "candidate runtime-files timer is missing one exact reviewed schedule line"
    done
  fi
}

backup_event_platform_pilot_database() {
  local service="leaddrive-postgres-backup.service"
  local evidence_path evidence_record checksum_path invocation result exec_status command_name service_state sub_state
  local backup_app_name backup_role source_connection_count probe_pid probe_unit probe_log probe_script
  local backup_env_hash_before backup_env_hash_after
  local candidate_script candidate_script_sha launch_status deadline unit_suffix
  local summary_count summary_line summary_payload summary_extra
  local key_field version_field tier_field retention_field bytes_field sha_field retain_until_field
  local migration_ledger_field recovery_db_contract_field migration_ledger_sha recovery_db_contract_sha
  local object_key object_version retention_tier retention_days ciphertext_bytes ciphertext_sha retain_until
  local source_identity_sha created_at
  local source_connection_proved=false
  local attempt

  [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_pending" ] || \
    fatal_after_standalone_replacement "a pre-pilot recovery point may only be created before the Fund migration"
  validate_event_platform_recovery_state
  validate_event_platform_backup_preconditions
  if [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then
    backup_event_platform_pilot_database_plain
    return 0
  fi

  evidence_path="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.log"
  evidence_record="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.env"
  checksum_path="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/pre-pilot-backup.sha256"
  # A failed pre-migration attempt may have restarted the old application, so
  # its earlier backup is no longer the immediate recovery point. The schema is
  # still provably pending here and PM2 is fenced; replace only these three
  # fixed evidence files with the new post-drain backup proof.
  rm -f -- "$evidence_path" "$evidence_record" "$checksum_path"

  # Never mistake a timer invocation that began before the write drain for the
  # cutover recovery point. Wait for it to finish, record the journal cursor,
  # then start a new run while the old application remains stopped.
  for attempt in $(seq 1 120); do
    systemctl is-active --quiet "$service" || break
    [ "$attempt" -lt 120 ] || \
      fatal_after_standalone_replacement "existing PostgreSQL backup did not finish within 10 minutes"
    sleep 5
  done

  # Run a uniquely named, read-only psql session as the real backup OS/DB role
  # with the real service EnvironmentFile. The migration connection must see
  # that backend live in its own database. This works on the first release even
  # though the service's immutable ops/current pointer still names the previous
  # reviewed backup script, and excludes a same-named physical clone.
  backup_app_name="leaddrive-cutover-backup-$(tr -d '-' </proc/sys/kernel/random/uuid)"
  backup_role="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_EXPECTED_DB_ROLE)" || \
    fatal_after_standalone_replacement "PostgreSQL backup environment contains duplicate BACKUP_EXPECTED_DB_ROLE keys"
  [ -n "$backup_role" ] || \
    fatal_after_standalone_replacement "PostgreSQL backup environment has no BACKUP_EXPECTED_DB_ROLE"
  probe_script="$APP_DIR/.next/standalone/scripts/backup/prove-source-database.sh"
  [ -x "$probe_script" ] || \
    fatal_after_standalone_replacement "immutable artifact is missing the backup source-identity probe"
  probe_unit="leaddrive-event-platform-backup-probe-${backup_app_name##*-}"
  probe_log="$(mktemp /tmp/leaddrive-backup-source-probe.XXXXXX)" || \
    fatal_after_standalone_replacement "cannot create backup source-identity probe log"
  backup_env_hash_before="$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" || \
    fatal_after_standalone_replacement "cannot hash PostgreSQL backup environment"

  systemd-run --wait --pipe --collect --quiet \
    --unit="$probe_unit" \
    --uid=leaddrive-backup --gid=leaddrive-backup \
    --property=EnvironmentFile=/etc/leaddrive/backup.env \
    --property=NoNewPrivileges=yes \
    "$probe_script" "$backup_app_name" >"$probe_log" 2>&1 &
  probe_pid=$!
  for attempt in $(seq 1 60); do
    source_connection_count=$(psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -v app_name="$backup_app_name" -v backup_role="$backup_role" 2>/dev/null <<'SQL' || true
SELECT count(*)
  FROM pg_catalog.pg_stat_activity
 WHERE datname = current_database()
   AND application_name = :'app_name'
   AND usename = :'backup_role'
   AND backend_type = 'client backend';
SQL
    )
    if [ "$source_connection_count" = "1" ]; then
      source_connection_proved=true
      break
    fi
    kill -0 "$probe_pid" 2>/dev/null || break
    sleep 1
  done
  systemctl stop "$probe_unit.service" >/dev/null 2>&1 || true
  wait "$probe_pid" 2>/dev/null || true
  rm -f -- "$probe_log"
  [ "$source_connection_proved" = "true" ] || \
    fatal_after_standalone_replacement "backup service configuration does not target the migration database instance"

  # A timer may have fired while the transient identity probe was running.
  # Drain it too, then mask only the predecessor service at runtime. Its timer
  # may remain scheduled, but cannot race the exact-candidate transient unit.
  for attempt in $(seq 1 120); do
    systemctl is-active --quiet "$service" || break
    [ "$attempt" -lt 120 ] || \
      fatal_after_standalone_replacement "concurrent PostgreSQL backup did not finish within 10 minutes"
    sleep 5
  done
  case "$(systemctl is-enabled "$service" 2>/dev/null || true)" in
    masked|masked-runtime) fatal_after_standalone_replacement "predecessor PostgreSQL backup service is unexpectedly masked" ;;
  esac
  candidate_script="$APP_DIR/.next/standalone/scripts/backup/postgres-backup.sh"
  [ -x "$candidate_script" ] && [ ! -L "$candidate_script" ] || \
    fatal_after_standalone_replacement "candidate PostgreSQL backup program is missing"
  candidate_script_sha="$(sha256sum "$candidate_script" | awk '{print $1}')"
  [ "$candidate_script_sha" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ] || \
    fatal_after_standalone_replacement "candidate PostgreSQL backup program is not the commissioned reviewed bytes"
  unit_suffix="$(tr -d '-' </proc/sys/kernel/random/uuid)"
  [[ "$unit_suffix" =~ ^[0-9a-f]{32}$ ]] || \
    fatal_after_standalone_replacement "cannot allocate a transient backup unit identity"
  EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT="leaddrive-event-platform-backup-${unit_suffix}.service"

  assert_root_owned_nonwritable_directory "event-platform recovery root" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"
  [ "$(stat -c '%a' "$EVENT_PLATFORM_PILOT_RECOVERY_DIR")" = "700" ] || \
    fatal_after_standalone_replacement "event-platform recovery root must use mode 0700"
  [ ! -e "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ] \
    && [ ! -L "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" ] || \
    fatal_after_standalone_replacement "a transient backup journal already exists"
  EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE="$(mktemp \
    "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/.pre-pilot-backup-transient.stage.XXXXXX")" || \
    fatal_after_standalone_replacement "cannot stage the transient backup journal"
  printf '%s\n' \
    'FORMAT_VERSION=1' \
    'STATUS=started' \
    "UNIT=$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" \
    "ARTIFACT_SHA=$ARTIFACT_DEPLOY_SHA" \
    "SCRIPT_SHA256=$candidate_script_sha" \
    >"$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE"
  chown root:root "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE"
  chmod 0600 "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE"
  sync -f -- "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot flush the transient backup journal stage"
  mv -- "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE" "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL"
  EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL_STAGE=""
  sync -f -- "$EVENT_PLATFORM_BACKUP_TRANSIENT_JOURNAL" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot durably publish the transient backup journal"

  systemctl mask --runtime "$service" >/dev/null || \
    fatal_after_standalone_replacement "cannot fence the predecessor PostgreSQL backup service"
  EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED=true

  log "Creating a fresh exact-artifact encrypted, restore-drilled, immutable recovery point before the Fund migration..."
  set +e
  systemd-run --quiet \
    --unit="$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" \
    --uid=leaddrive-backup --gid=leaddrive-backup \
    --property=EnvironmentFile=/etc/leaddrive/backup.env \
    --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
    --property=RemainAfterExit=yes \
    --property=StandardOutput=journal \
    --property=StandardError=journal \
    --property=TimeoutStartSec=4h \
    --property=MemorySwapMax=0 \
    --property=UMask=0077 \
    --property=StateDirectory=leaddrive-postgres-backup \
    --property=StateDirectoryMode=0750 \
    --property=RuntimeDirectory=leaddrive-postgres-backup \
    --property=RuntimeDirectoryMode=0750 \
    --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes \
    --property=PrivateTmp=yes \
    --property=ProtectSystem=strict \
    --property=ReadOnlyPaths=/etc/leaddrive \
    --property=ReadWritePaths=/var/lib/leaddrive-postgres-backup \
    --property=ReadWritePaths=/run/leaddrive-postgres-backup \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=RestrictNamespaces=yes \
    --property=RestrictRealtime=yes \
    --property=RestrictSUIDSGID=yes \
    --property=LockPersonality=yes \
    --property=SystemCallArchitectures=native \
    "$candidate_script" --commission-monthly >/dev/null
  launch_status=$?
  set -e
  [ "$launch_status" -eq 0 ] || \
    fatal_after_standalone_replacement "exact-candidate PostgreSQL backup could not be started"
  invocation=""
  deadline=$((SECONDS + 14400))
  while [ "$SECONDS" -lt "$deadline" ]; do
    invocation="$(systemctl show --property=InvocationID --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
    service_state="$(systemctl show --property=ActiveState --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
    sub_state="$(systemctl show --property=SubState --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
    case "$service_state:$sub_state" in
      active:exited|failed:*|inactive:dead) break ;;
    esac
    sleep 1
  done
  [[ "$invocation" =~ ^[0-9a-f]{32}$ ]] || \
    fatal_after_standalone_replacement "exact-candidate backup has no unique systemd invocation id"
  backup_env_hash_after="$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" || \
    fatal_after_standalone_replacement "cannot re-hash PostgreSQL backup environment"
  [ "$backup_env_hash_after" = "$backup_env_hash_before" ] || \
    fatal_after_standalone_replacement "PostgreSQL backup environment changed between identity proof and backup"
  result="$(systemctl show --property=Result --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
  exec_status="$(systemctl show --property=ExecMainStatus --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
  service_state="$(systemctl show --property=ActiveState --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
  sub_state="$(systemctl show --property=SubState --value "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" 2>/dev/null || true)"
  [ "$service_state:$sub_state:$result:$exec_status" = "active:exited:success:0" ] || \
    fatal_after_standalone_replacement "exact-candidate PostgreSQL backup failed or exceeded four hours"

  umask 077
  journalctl --sync >/dev/null 2>&1 || true
  journalctl --unit "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" "_SYSTEMD_INVOCATION_ID=$invocation" --no-pager -o cat >"$evidence_path" || \
    fatal_after_standalone_replacement "cannot capture PostgreSQL backup evidence"
  systemctl stop "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" >/dev/null || \
    fatal_after_standalone_replacement "cannot retire exact-candidate backup unit"
  systemctl reset-failed "$EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT" >/dev/null 2>&1 || true
  EVENT_PLATFORM_BACKUP_TRANSIENT_UNIT=""
  # Keep the ordinary timer target fenced until the complete migration,
  # compatibility probe, deep postconditions and application handoff finish.
  # The EXIT trap unsets the runtime mask and clears the durable journal; an
  # interrupted run is recovered from that journal at the next deployment.
  for command_name in \
    "[restore-canary] restore canary passed" \
    "[restore-canary] restored Prisma migration ledger proof passed" \
    "[restore-canary] restored applied migrations match the recovery DB contract" \
    "[restore-canary] restored RLS/FORCE RLS catalog proof passed" \
    "[postgres-backup] encrypting backup with offline age recipient" \
    "[postgres-backup] backup verified and locked until"; do
    grep -Fq -- "$command_name" "$evidence_path" || \
      fatal_after_standalone_replacement "PostgreSQL backup evidence is missing: $command_name"
  done
  if grep -Fq -- "UNENCRYPTED" "$evidence_path"; then
    fatal_after_standalone_replacement "PostgreSQL cutover recovery point was not encrypted"
  fi
  grep -Fq -- "[postgres-backup] source database identity $EVENT_PLATFORM_DATABASE_IDENTITY" "$evidence_path" || \
    fatal_after_standalone_replacement "exact-candidate backup does not identify the migration database"
  summary_count="$(grep -Fc -- '[postgres-backup] SUMMARY key=' "$evidence_path" || true)"
  [ "$summary_count" = "1" ] || \
    fatal_after_standalone_replacement "PostgreSQL backup evidence must contain one machine-readable object summary"
  summary_line="$(grep -F -- '[postgres-backup] SUMMARY key=' "$evidence_path")"
  summary_payload="${summary_line#'[postgres-backup] SUMMARY '}"
  read -r key_field version_field tier_field retention_field bytes_field sha_field retain_until_field \
    migration_ledger_field recovery_db_contract_field summary_extra \
    <<<"$summary_payload"
  [ -z "$summary_extra" ] || \
    fatal_after_standalone_replacement "PostgreSQL backup object summary has unexpected fields"
  object_key="${key_field#key=}"
  object_version="${version_field#version=}"
  retention_tier="${tier_field#tier=}"
  retention_days="${retention_field#retention_days=}"
  ciphertext_bytes="${bytes_field#bytes=}"
  ciphertext_sha="${sha_field#sha256=}"
  retain_until="${retain_until_field#retain_until=}"
  migration_ledger_sha="${migration_ledger_field#migration_ledger_sha256=}"
  recovery_db_contract_sha="${recovery_db_contract_field#recovery_db_contract_sha256=}"
  [ "$key_field" = "key=$object_key" ] \
    && [ "$version_field" = "version=$object_version" ] \
    && [ "$tier_field" = "tier=$retention_tier" ] \
    && [ "$retention_field" = "retention_days=$retention_days" ] \
    && [ "$bytes_field" = "bytes=$ciphertext_bytes" ] \
    && [ "$sha_field" = "sha256=$ciphertext_sha" ] \
    && [ "$retain_until_field" = "retain_until=$retain_until" ] \
    && [ "$migration_ledger_field" = "migration_ledger_sha256=$migration_ledger_sha" ] \
    && [[ "$migration_ledger_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$recovery_db_contract_field" = "recovery_db_contract_sha256=$recovery_db_contract_sha" ] \
    && [[ "$recovery_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "PostgreSQL backup object summary is malformed"
  source_identity_sha="$(printf '%s' "$EVENT_PLATFORM_DATABASE_IDENTITY" | sha256sum | awk '{print $1}')"
  created_at="$(date -u '+%Y%m%dT%H%M%SZ')"
  umask 077
  printf '%s\n' \
    'FORMAT_VERSION=2' \
    'STATUS=verified' \
    "OBJECT_BUCKET=$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_BUCKET)" \
    "OBJECT_KEY=$object_key" \
    "OBJECT_VERSION_ID=$object_version" \
    "RETENTION_TIER=$retention_tier" \
    "RETENTION_DAYS=$retention_days" \
    "CIPHERTEXT_BYTES=$ciphertext_bytes" \
    "CIPHERTEXT_SHA256=$ciphertext_sha" \
    "RETAIN_UNTIL=$retain_until" \
    "SYSTEMD_INVOCATION_ID=$invocation" \
    "ARTIFACT_SHA=$ARTIFACT_DEPLOY_SHA" \
    "POSTGRES_BACKUP_SHA256=$candidate_script_sha" \
    "BACKUP_ENV_SHA256=$backup_env_hash_after" \
    "SOURCE_DATABASE_IDENTITY_SHA256=$source_identity_sha" \
    "SOURCE_MIGRATION_LEDGER_SHA256=$migration_ledger_sha" \
    "RECOVERY_DB_CONTRACT_SHA256=$recovery_db_contract_sha" \
    "CREATED_AT_UTC=$created_at" \
    >"$evidence_record"
  chmod 0600 "$evidence_path" "$evidence_record"
  (
    cd "$EVENT_PLATFORM_PILOT_RECOVERY_DIR"
    sha256sum "$(basename -- "$evidence_path")" "$(basename -- "$evidence_record")" \
      >"$(basename -- "$checksum_path")"
    sha256sum --check "$(basename -- "$checksum_path")" >/dev/null
  ) || fatal_after_standalone_replacement "cannot checksum PostgreSQL backup evidence"
  chmod 0600 "$checksum_path"

  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE="$evidence_path"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_RECORD="$evidence_record"
  EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_CHECKSUM="$checksum_path"
  sync -f -- "$evidence_path" "$evidence_record" "$checksum_path" "$EVENT_PLATFORM_PILOT_RECOVERY_DIR" || \
    fatal_after_standalone_replacement "cannot persist PostgreSQL cutover recovery-point evidence"
  validate_event_platform_recovery_evidence
  # Recheck the signed secrets generation and all recovery policy immediately
  # after the fresh backup and immediately before the schema transaction.
  validate_event_platform_backup_preconditions fenced
  log "Fresh pre-pilot recovery point passed restore, age-encryption, upload and immutable-retention checks"
}

mark_event_platform_cutover_verified() {
  local migration_file migration_checksum ledger_checksum advanced

  [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_applied" ] || \
    fatal_after_standalone_replacement "Fund cutover verification attempted from an invalid durable state"
  [ "$EVENT_PLATFORM_PREVIOUS_CLIENT_COMPATIBLE" = "true" ] || \
    fatal_after_standalone_replacement "Fund cutover cannot be verified before the exact previous client passes"
  [[ "$ARTIFACT_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || \
    fatal_after_standalone_replacement "Fund cutover has no valid candidate artifact SHA"
  validate_event_platform_recovery_state
  validate_event_platform_recovery_evidence

  migration_file="$APP_DIR/.next/standalone/prisma/migrations/$EVENT_PLATFORM_PILOT_MIGRATION/migration.sql"
  [ -f "$migration_file" ] && [ ! -L "$migration_file" ] || \
    fatal_after_standalone_replacement "immutable candidate has no Fund pilot migration artifact"
  migration_checksum=$(sha256sum "$migration_file" | awk '{print $1}') || \
    fatal_after_standalone_replacement "cannot hash the Fund pilot migration artifact"
  [[ "$migration_checksum" =~ ^[0-9a-f]{64}$ ]] || \
    fatal_after_standalone_replacement "Fund pilot migration checksum is invalid"
  ledger_checksum=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At \
    -v migration_name="$EVENT_PLATFORM_PILOT_MIGRATION" 2>/dev/null <<'SQL'
SELECT checksum
  FROM public._prisma_migrations
 WHERE migration_name = :'migration_name'
   AND finished_at IS NOT NULL
   AND rolled_back_at IS NULL;
SQL
  ) || fatal_after_standalone_replacement "cannot read the successful Fund migration checksum"
  [ "$ledger_checksum" = "$migration_checksum" ] || \
    fatal_after_standalone_replacement "successful Fund migration checksum differs from the immutable candidate"

  advanced=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' \
    -v gate_key="$EVENT_PLATFORM_PILOT_GATE_KEY" \
    -v migration_name="$EVENT_PLATFORM_PILOT_MIGRATION" \
    -v candidate_sha="$ARTIFACT_DEPLOY_SHA" \
    -v previous_sha="$EVENT_PLATFORM_PREVIOUS_ARTIFACT_SHA" \
    -v previous_client_hash="$EVENT_PLATFORM_PREVIOUS_CLIENT_HASH" \
    -v migration_checksum="$migration_checksum" \
    -v backup_hash="$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH" 2>/dev/null <<'SQL'
WITH advanced AS (
  UPDATE public.event_platform_cutover_gates
     SET "status" = 'verified',
         "verifiedAt" = CURRENT_TIMESTAMP,
         "verifiedArtifactSha" = :'candidate_sha',
         "previousArtifactSha" = :'previous_sha',
         "previousClientHash" = :'previous_client_hash',
         "migrationChecksum" = :'migration_checksum',
         "backupEvidenceHash" = :'backup_hash'
   WHERE "gateKey" = :'gate_key'
     AND "migrationName" = :'migration_name'
     AND "status" = 'migration_applied'
  RETURNING "status", "verifiedArtifactSha", "previousArtifactSha",
            "previousClientHash", "migrationChecksum", "backupEvidenceHash"
)
SELECT count(*), max("status"), max("verifiedArtifactSha"),
       max("previousArtifactSha"), max("previousClientHash"),
       max("migrationChecksum"), max("backupEvidenceHash")
  FROM advanced;
SQL
  ) || fatal_after_standalone_replacement "cannot durably verify the Fund cutover gate"
  [ "$advanced" = "1|verified|$ARTIFACT_DEPLOY_SHA|$EVENT_PLATFORM_PREVIOUS_ARTIFACT_SHA|$EVENT_PLATFORM_PREVIOUS_CLIENT_HASH|$migration_checksum|$EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE_HASH" ] || \
    fatal_after_standalone_replacement "Fund cutover gate did not advance exactly once with bound evidence"
  EVENT_PLATFORM_CUTOVER_STATE="verified"
  EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=false
  log "Durably verified Fund cutover gate with candidate, previous-client, migration and backup evidence"
}

# Does the NEW build (its tarball) ship a migration that is NOT yet applied?
# Returns 0 (pending -> caller must wait for a quiet window) if any shipped
# migration is unapplied OR if we cannot determine cleanly (conservative:
# unreadable tarball / DB -> wait, exactly as before). Returns 1 (no pending ->
# safe to SKIP the wait) only when every shipped migration is positively
# confirmed already applied. This lets the common no-migration deploy skip the
# collector-sensitive quiet window entirely — `prisma migrate deploy` would be a
# no-op anyway — instead of failing the whole deploy when a social collector
# lease simply never drops to 0 within 60s. The window is still enforced in full
# whenever there IS a migration to apply.
new_build_has_pending_migrations() {
  local build_migs applied m
  [ -f "$DEPLOY_TAR" ] || { log "migration precheck: $DEPLOY_TAR not found — will wait for quiet window"; return 0; }
  # Migration dir names shipped in the tarball (./prisma/migrations/<name>/migration.sql).
  # tar|sed|sort in a pipefail-off subshell (mirrors the tarball checks below).
  build_migs=$( { set +o pipefail; tar -tzf "$DEPLOY_TAR" 2>/dev/null \
    | sed -nE 's#.*prisma/migrations/([^/]+)/migration\.sql$#\1#p' | sort -u; } ) \
    || { log "migration precheck: cannot read tarball — will wait for quiet window"; return 0; }
  if [ -z "$build_migs" ]; then
    log "migration precheck: new build ships no migrations"
    return 1
  fi
  applied=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null) \
    || { log "migration precheck: cannot read _prisma_migrations — will wait for quiet window"; return 0; }
  # here-string (no subshell) so `return` exits the function, not just a loop
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    printf '%s\n' "$applied" | grep -qxF -- "$m" || {
      log "migration precheck: pending migration in new build: $m"
      return 0
    }
  done <<< "$build_migs"
  log "migration precheck: all shipped migration(s) already applied — skipping quiet window"
  return 1
}

CALL_TARGET_MIGRATION="20260810123000_call_log_target_phone_e164"
CALL_TARGET_FAILED_CHECKSUM="5915860b3846bd59b33483345e98eed5c750e80c6a1b77ae5e9b3c94291352fe"
CALL_TARGET_FIXED_CHECKSUM="c7e995cd1face931faffa4760ef0fdd9055eb023c0ebde6e2997607b4a2572e3"
VOICE_PERMISSION_MIGRATION="20260810124500_voice_permission_idempotency_audit"
VOICE_PERMISSION_FIXED_CHECKSUM="20d7bd3ec9967673bb1ea049beeef9571a55f30b79ce631e5aa882cddb0efebd"
TENANT_CASCADE_MIGRATION="20260827090000_tenant_delete_cascades"
TENANT_CASCADE_SUCCESS_CHECKSUM="28e3ceba5dbace8e53b66e4faf304ebad1a1618452bfe9e5b3c7a60e92be0dff"
TENANT_CASCADE_STATE_SQL="prisma/verification/tenant-delete-cascade-artifact-state.sql"
TENANT_CASCADE_STATE_SQL_CHECKSUM="a94bc671d8e15ae69b670a20006cfe39fd7008ea98f6a88f9a1f5bf2d0354b98"
TENANT_CASCADE_EXPECTED_CONSTRAINTS=73
TENANT_CASCADE_PREFLIGHT_STATE=""
TENANT_CASCADE_SCHEMA_STATE=""

tenant_cascade_ledger_state() {
  psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT
       (SELECT count(*) FROM _prisma_migrations
         WHERE migration_name = '$TENANT_CASCADE_MIGRATION'
           AND checksum = '$TENANT_CASCADE_SUCCESS_CHECKSUM'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL)::text,
       (SELECT count(*) FROM _prisma_migrations
         WHERE migration_name = '$TENANT_CASCADE_MIGRATION'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL)::text,
       (SELECT count(*) FROM _prisma_migrations
         WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text;" \
    2>/dev/null
}

validate_tenant_cascade_catalog_state() {
  local state="$1"
  local target_count metadata_count exact_count incompatible_count unvalidated_count

  [[ "$state" =~ ^([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]+)$ ]] || return 1
  target_count="${BASH_REMATCH[1]}"
  metadata_count="${BASH_REMATCH[2]}"
  exact_count="${BASH_REMATCH[3]}"
  incompatible_count="${BASH_REMATCH[4]}"
  unvalidated_count="${BASH_REMATCH[5]}"
  [ "$target_count" -eq "$TENANT_CASCADE_EXPECTED_CONSTRAINTS" ] || return 1
  [ "$metadata_count" -eq "$TENANT_CASCADE_EXPECTED_CONSTRAINTS" ] || return 1
  [ "$exact_count" -eq "$TENANT_CASCADE_EXPECTED_CONSTRAINTS" ] || return 1
  [ "$incompatible_count" -eq 0 ] || return 1
  [ "$unvalidated_count" -le "$exact_count" ] || return 1
}

# Read-only proof for an already-successful, immutable migration. The staged
# aggregate query reads PostgreSQL catalogs only and never emits tenant rows.
preflight_successful_tenant_cascade() {
  local migration_checksum state_sql_checksum ledger_state catalog_state

  migration_checksum=$(
    tar -xOzf "$DEPLOY_TAR" "./prisma/migrations/$TENANT_CASCADE_MIGRATION/migration.sql" 2>/dev/null \
      | sha256sum | awk '{print $1}'
  ) || fatal "cannot hash the successful tenant-cascade migration from the staged artifact"
  [ "$migration_checksum" = "$TENANT_CASCADE_SUCCESS_CHECKSUM" ] || \
    fatal "staged tenant-cascade migration differs from the successful immutable artifact"

  state_sql_checksum=$(
    tar -xOzf "$DEPLOY_TAR" "./$TENANT_CASCADE_STATE_SQL" 2>/dev/null \
      | sha256sum | awk '{print $1}'
  ) || fatal "cannot hash the tenant-cascade catalog query from the staged artifact"
  [ "$state_sql_checksum" = "$TENANT_CASCADE_STATE_SQL_CHECKSUM" ] || \
    fatal "staged tenant-cascade catalog query differs from the reviewed artifact"

  ledger_state=$(tenant_cascade_ledger_state) || \
    fatal "cannot inspect the successful tenant-cascade migration ledger state"
  [ "$ledger_state" = "1|1|0" ] || \
    fatal "successful tenant-cascade migration ledger state is incomplete"

  catalog_state=$(
    tar -xOzf "$DEPLOY_TAR" "./$TENANT_CASCADE_STATE_SQL" 2>/dev/null \
      | psql "$MIGRATION_DATABASE_URL" -X -qAtF '|' -v ON_ERROR_STOP=1 \
          -c "BEGIN TRANSACTION READ ONLY;" -f - -c "COMMIT;" 2>/dev/null
  ) || fatal "cannot inspect tenant-cascade catalog state"
  validate_tenant_cascade_catalog_state "$catalog_state" || \
    fatal "tenant-cascade catalog state is incomplete"

  TENANT_CASCADE_PREFLIGHT_STATE="$ledger_state|$catalog_state"
  log "Successful tenant-cascade ledger and aggregate catalog state verified before extraction"
}

# Read-only proof before backup/extraction. The later post-extract block repeats
# the database and artifact checks before changing the migration ledger.
preflight_known_voice_safety_recovery() {
  local unresolved_count target_state target_artifacts permission_prestate
  local target_tar_checksum permission_tar_checksum

  unresolved_count=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null
  ) || fatal "cannot inspect unresolved migration count"

  target_state=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
      "SELECT migration_name,
              checksum,
              applied_steps_count,
              (SELECT count(*) FROM _prisma_migrations successful
               WHERE successful.migration_name = '$CALL_TARGET_MIGRATION'
                 AND successful.finished_at IS NOT NULL),
              CASE
                WHEN COALESCE(logs, '') LIKE '%CREATE INDEX CONCURRENTLY cannot run inside a transaction block%'
                 AND COALESCE(logs, '') LIKE '%25001%'
                THEN 'known_concurrent_index_transaction_failure'
                ELSE 'unknown_failure'
              END
       FROM _prisma_migrations
       WHERE migration_name = '$CALL_TARGET_MIGRATION'
         AND finished_at IS NULL
         AND rolled_back_at IS NULL;" 2>/dev/null
  ) || fatal "cannot inspect $CALL_TARGET_MIGRATION migration state"

  if [ -z "$target_state" ]; then
    [ "$unresolved_count" = "0" ] || fatal "migration ledger contains an unrelated unresolved failure"
    return 0
  fi

  [ "$unresolved_count" = "1" ] || \
    fatal "migration ledger has $unresolved_count unresolved rows; refusing automatic recovery"
  [ "$target_state" = "$CALL_TARGET_MIGRATION|$CALL_TARGET_FAILED_CHECKSUM|0|0|known_concurrent_index_transaction_failure" ] || \
    fatal "$CALL_TARGET_MIGRATION failure identity does not match the reviewed production attempt"

  target_artifacts=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "WITH artifacts(name) AS (
         SELECT 'column' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'call_logs' AND column_name = 'targetPhoneE164'
         UNION ALL
         SELECT 'constraint' FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = 'public' AND r.relname = 'call_logs'
            AND c.conname = 'call_logs_target_phone_e164_check'
         UNION ALL
         SELECT 'call_index' WHERE to_regclass('public.call_logs_org_target_phone_e164_idx') IS NOT NULL
         UNION ALL
         SELECT 'audit_index' WHERE to_regclass('public.audit_logs_voice_permission_request_key') IS NOT NULL
         UNION ALL
         SELECT 'audit_function' WHERE to_regprocedure('public.protect_voice_permission_audit_row()') IS NOT NULL
         UNION ALL
         SELECT 'audit_trigger' FROM pg_trigger t
          JOIN pg_class r ON r.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
            AND t.tgname = 'audit_logs_voice_permission_append_only'
       ) SELECT COALESCE(string_agg(name, ',' ORDER BY name), '') FROM artifacts;" 2>/dev/null
  ) || fatal "cannot verify voice safety migration pre-state"
  [ -z "$target_artifacts" ] || fatal "voice safety migration pre-state contains unexpected schema artifacts"

  permission_prestate=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
      "SELECT
         count(*)::text,
         (SELECT count(*) FROM (
            SELECT 1 FROM audit_logs
             WHERE \"entityType\" = 'lead_voice_permission' AND \"entityId\" IS NOT NULL
             GROUP BY \"organizationId\", \"entityType\", \"entityId\"
             HAVING count(*) > 1
          ) duplicates)::text
       FROM audit_logs WHERE \"entityType\" = 'lead_voice_permission';" 2>/dev/null
  ) || fatal "cannot verify voice-permission audit pre-state"
  [ "$permission_prestate" = "0|0" ] || fatal "voice-permission audit namespace is not empty before its first migration"

  target_tar_checksum=$(
    tar -xOzf "$DEPLOY_TAR" "./prisma/migrations/$CALL_TARGET_MIGRATION/migration.sql" 2>/dev/null \
      | sha256sum | awk '{print $1}'
  ) || fatal "cannot hash corrected $CALL_TARGET_MIGRATION from the staged artifact"
  permission_tar_checksum=$(
    tar -xOzf "$DEPLOY_TAR" "./prisma/migrations/$VOICE_PERMISSION_MIGRATION/migration.sql" 2>/dev/null \
      | sha256sum | awk '{print $1}'
  ) || fatal "cannot hash corrected $VOICE_PERMISSION_MIGRATION from the staged artifact"
  [ "$target_tar_checksum" = "$CALL_TARGET_FIXED_CHECKSUM" ] || fatal "staged call-history migration does not match the reviewed correction"
  [ "$permission_tar_checksum" = "$VOICE_PERMISSION_FIXED_CHECKSUM" ] || fatal "staged voice-permission migration does not match the reviewed correction"

  log "Known voice-safety migration failure and corrected artifact verified before extraction"
}

validate_deploy_artifact_identity() {
  local archive_sha
  [ -s "$DEPLOY_TAR" ] || fatal "$DEPLOY_TAR is missing or empty"
  tar -tzf "$DEPLOY_TAR" >/dev/null 2>&1 || fatal "$DEPLOY_TAR is not a valid gzipped tarball"
  ( set +o pipefail; tar -tzf "$DEPLOY_TAR" 2>/dev/null | grep -qE '(^|/)server[.]js$' ) \
    || fatal "$DEPLOY_TAR has no server.js entry"
  archive_sha="$(tar -xOzf "$DEPLOY_TAR" ./.deploy-sha 2>/dev/null | tr -d '\r\n' || true)"
  [[ "$archive_sha" =~ ^[0-9a-f]{40}$ ]] || fatal "artifact has no valid .deploy-sha"
  [ "$archive_sha" = "$EXPECTED_DEPLOY_SHA_ARG" ] \
    || fatal "artifact revision does not match the workflow-bound expected SHA"
  ARTIFACT_DEPLOY_SHA="$archive_sha"
  DEPLOY_SHA="$archive_sha"
  log "Artifact invocation bound before recovery handling: mode=$DEPLOY_MODE sha=${DEPLOY_SHA:0:12}"
}

# Lock the host before even reading the deployment environment. GitHub Actions
# concurrency does not cover the documented on-box build or a manual recovery.
acquire_host_locks
assert_root_owned_nonwritable_directory "LeadDrive checkout" "$APP_DIR"
validate_deploy_artifact_identity

if [ "$DEPLOY_MODE" = normal ]; then
  APP_ENV_FILE="$(canonical_external_path "APP_ENV_FILE" "$APP_ENV_FILE")"
  MIGRATION_ENV_FILE="$(canonical_external_path "MIGRATION_ENV_FILE" "$MIGRATION_ENV_FILE")"
  export APP_ENV_FILE

# A preflight is intentionally read-only. On a first cutover it reports the
# missing canonical secret store instead of moving it as a side effect; the
# approved deployment performs that reversible move only after artifact
# validation below.
if [ "${DEPLOY_PREFLIGHT_ONLY:-0}" = "1" ] && [ ! -f "$APP_ENV_FILE" ]; then
  fatal "canonical app environment migration is required at $APP_ENV_FILE; run the approved deployment, not preflight-only"
fi

if [ -f "$APP_ENV_FILE" ]; then
  validate_canonical_app_env
  APP_ENV_SOURCE_FILE="$APP_ENV_FILE"
else
  [ -f "$APP_DIR/.env" ] || fatal "neither $APP_ENV_FILE nor $APP_DIR/.env exists"
  validate_checkout_app_env_for_first_cutover "$APP_DIR/.env"
  APP_ENV_SOURCE_FILE="$APP_DIR/.env"
fi
configure_runtime_paths "$APP_ENV_SOURCE_FILE"
load_dotenv_file "$APP_ENV_SOURCE_FILE"
normalize_exact_legacy_help_video_path
validate_shared_server_ip_source "$APP_ENV_SOURCE_FILE"

require_env DATABASE_URL
require_env REDIS_URL
validate_redis_connection
require_env NEXTAUTH_SECRET
validate_nextauth_secret
require_env NEXTAUTH_URL
require_env TENANT_PII_MASTER_KEY

# Phase 1 of the cutover intentionally deploys with Gemini absent so the new
# code is fail-closed before the activation workflow runs. Once either Gemini
# variable is present, however, partial or mismatched configuration is fatal.
if [ -n "${VOICE_REALTIME_PROVIDER:-}" ] || [ -n "${GEMINI_API_KEY:-}" ]; then
  [ "${VOICE_REALTIME_PROVIDER:-}" = "gemini_live" ] || \
    fatal "VOICE_REALTIME_PROVIDER must be gemini_live when Gemini voice is configured"
  require_env GEMINI_API_KEY
fi

# Migration credentials are intentionally isolated from the application env.
# The Next.js process sources $APP_ENV_FILE, so placing a BYPASSRLS URL there
# would hand tenant-bypass privileges to the web process.
[ -f "$MIGRATION_ENV_FILE" ] || fatal "$MIGRATION_ENV_FILE is missing"
assert_root_owned_nonwritable_directory "migration environment directory" "$(dirname -- "$MIGRATION_ENV_FILE")"
[ "$(stat -c '%U' "$MIGRATION_ENV_FILE")" = "root" ] || \
  fatal "$MIGRATION_ENV_FILE must be owned by root"
[ "$(stat -c '%a' "$MIGRATION_ENV_FILE")" = "600" ] || \
  fatal "$MIGRATION_ENV_FILE must have mode 0600"
load_dotenv_file "$MIGRATION_ENV_FILE" migration
require_env MIGRATION_DATABASE_URL
require_env MIGRATION_EXPECTED_DB_ROLE
validate_database_roles

# A browser-to-provider socket outlives a PM2 restart. Refuse activation while
# any recently heartbeating browser session is active, so an old provider
# connection cannot survive a provider cutover or ordinary release.
if [ "${VOICE_REALTIME_PROVIDER:-}" != "gemini_live" ]; then
  VOICE_SESSIONS_TABLE=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT coalesce(to_regclass('public.voice_sessions')::text, '');" 2>/dev/null) \
    || fatal "cannot check browser voice session table"
  RECENT_BROWSER_VOICE_COUNT=0
  if [ -n "$VOICE_SESSIONS_TABLE" ]; then
    RECENT_BROWSER_VOICE_COUNT=$(psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT count(*) FROM voice_sessions
        WHERE status = 'active'
          AND \"lastHeartbeatAt\" > CURRENT_TIMESTAMP - interval '90 seconds';" 2>/dev/null) \
      || fatal "cannot check active browser voice sessions"
  fi
  [ "$RECENT_BROWSER_VOICE_COUNT" = "0" ] || \
    fatal "recent active browser voice sessions must drain before deployment"
fi
# Only gate on the collector-sensitive quiet window when the new build actually
# has a migration to apply. A no-migration deploy skips it (migrate deploy is a
# no-op) so a busy social-monitoring collector lease can't fail-safe-abort an
# otherwise-safe rollout. The full window is still enforced whenever there IS a
# pending migration, and the precheck falls back to waiting if it can't tell.
if new_build_has_pending_migrations; then
  wait_for_migration_window
else
  log "Skipping migration quiet window — new build has no pending migrations"
fi
preflight_successful_tenant_cascade
preflight_known_voice_safety_recovery
unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE MIGRATION_WINDOW_ATTEMPTS

if [ "${DEPLOY_PREFLIGHT_ONLY:-0}" = "1" ]; then
  if [ -e "$OPS_ACTIVATION_JOURNAL" ] || [ -L "$OPS_ACTIVATION_JOURNAL" ]; then
    fatal "an immutable operations activation recovery is pending; run the approved deployment so it can recover before taking a new baseline"
  fi
  log "Deploy preflight passed; exiting before backup, extraction, migrations, or PM2 changes"
  exit 0
fi

[ "${APP_HOSTNAME:-127.0.0.1}" != "0.0.0.0" ] || fatal "APP_HOSTNAME=0.0.0.0 would expose the Next.js upstream directly"
else
  [ "${DEPLOY_PREFLIGHT_ONLY:-0}" != 1 ] \
    || fatal "recovery-bootstrap is a mutating ceremony and has no preflight-only mode"
  log "Recovery-bootstrap mode skipped application, Prisma, Kafka/Fund, and PM2 preconditions"
fi

safe_remove_tree() {
  local path="$1"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then
    return 0
  fi

  if rm -rf "$path" 2>/dev/null; then
    return 0
  fi

  local trash="${path}.delete-$(date '+%Y%m%d-%H%M%S')-$$"
  log "WARNING: direct remove failed for $path; moving old tree to $trash"
  if [ -e "$path" ] || [ -L "$path" ]; then
    mv "$path" "$trash"
    rm -rf "$trash" 2>/dev/null || log "WARNING: deferred cleanup left $trash"
  fi
}

runtime_tree_summary() {
  local root="$1"
  local files bytes links special
  [ -d "$root" ] || { printf 'missing'; return 0; }
  files=$(find "$root" -xdev -type f -printf . | wc -c | tr -d '[:space:]')
  bytes=$(find "$root" -xdev -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')
  links=$(find "$root" -xdev -type l -printf . | wc -c | tr -d '[:space:]')
  special=$(find "$root" -xdev \( -type b -o -type c -o -type p -o -type s \) -printf . | wc -c | tr -d '[:space:]')
  printf 'files=%s bytes=%s symlinks=%s special=%s' "$files" "$bytes" "$links" "$special"
}

record_runtime_tree() {
  local label="$1"
  local root="$2"
  if [ -d "$root" ]; then
    # Do not walk/hash customer media after PM2 stops. A same-filesystem
    # rename preserves inode and bytes atomically; these constant-time facts
    # plus the pre-handoff inventory are the rollback audit record.
    printf 'tree=%s path=%s device=%s inode=%s mode=%s\n' \
      "$label" "$root" "$(stat -c '%d' "$root")" "$(stat -c '%i' "$root")" \
      "$(stat -c '%a' "$root")" >> "$RUNTIME_CUTOVER_MANIFEST"
  else
    printf 'tree=%s path=%s status=missing\n' "$label" "$root" >> "$RUNTIME_CUTOVER_MANIFEST"
  fi
}

require_same_filesystem() {
  local source="$1"
  local target_parent="$2"
  [ "$(stat -c '%d' "$source")" = "$(stat -c '%d' "$target_parent")" ] || \
    fatal "refusing non-atomic runtime move from $source to $target_parent across filesystems"
}

nearest_existing_directory() {
  local candidate
  candidate="$(realpath -m -- "$1")" || fatal "cannot resolve runtime target parent: $1"
  while [ ! -e "$candidate" ]; do
    [ "$candidate" != "/" ] || fatal "no existing parent found for runtime target: $1"
    candidate="$(dirname -- "$candidate")"
  done
  [ -d "$candidate" ] || fatal "runtime target parent is not a directory: $candidate"
  printf '%s' "$candidate"
}

assert_safe_runtime_tree() {
  local label="$1"
  local root="$2"
  local links special
  [ -d "$root" ] || return 0
  links=$(find "$root" -xdev -type l -printf . | wc -c | tr -d '[:space:]')
  special=$(find "$root" -xdev \( -type b -o -type c -o -type p -o -type s \) -printf . | wc -c | tr -d '[:space:]')
  [ "$links" = "0" ] || fatal "$label contains symlinks; refusing an ambiguous runtime migration"
  [ "$special" = "0" ] || fatal "$label contains special filesystem nodes; refusing an ambiguous runtime migration"
}

assert_directory_move_preflight() {
  local source="$1"
  local target="$2"
  local label="$3"
  local existing_target_parent

  if [ -L "$source" ]; then
    [ "$(readlink -f "$source")" = "$target" ] || \
      fatal "$source is a runtime symlink to an unexpected target"
    [ -d "$target" ] || fatal "$source points to missing runtime directory $target"
    return 0
  fi

  # A future clean checkout deliberately has no runtime directory at all.
  # That is a valid first deploy: the handoff creates the external directory
  # and an old-path compatibility link, without inventing a second authority.
  if [ ! -e "$source" ]; then
    if [ -e "$target" ] || [ -L "$target" ]; then
      [ ! -L "$target" ] && [ -d "$target" ] || \
        fatal "$label runtime target must be a real directory: $target"
      log "No checkout $label directory; existing external runtime target will be linked"
    else
      [ -d "$(dirname -- "$source")" ] || \
        fatal "$label checkout parent is not a directory: $(dirname -- "$source")"
      nearest_existing_directory "$(dirname -- "$target")" >/dev/null
      log "No checkout $label directory; external runtime target will be created"
    fi
    return 0
  fi

  [ -d "$source" ] || fatal "$label source is not a directory: $source"
  [ ! -e "$target" ] && [ ! -L "$target" ] || \
    fatal "both source and target exist for runtime directory $label; manual reconciliation is required before PM2 handoff"
  assert_safe_runtime_tree "$label" "$source"
  existing_target_parent="$(nearest_existing_directory "$(dirname -- "$target")")"
  require_same_filesystem "$source" "$existing_target_parent"
}

move_runtime_directory_and_link() {
  local source="$1"
  local target="$2"
  local label="$3"
  local action_var="$4"
  local source_identity target_identity

  [[ "$action_var" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || \
    fatal "invalid runtime cutover action variable for $label"
  printf -v "$action_var" '%s' "none"

  ensure_secure_root_directory "$label runtime target parent" "$(dirname -- "$target")" "0750"
  [ ! -L "$target" ] || fatal "$label runtime target must not be a symlink: $target"
  if [ -L "$source" ]; then
    [ "$(readlink -f "$source")" = "$target" ] || \
      fatal "$source is a runtime symlink to an unexpected target"
    [ -d "$target" ] || fatal "$source points to missing runtime directory $target"
    printf -v "$action_var" '%s' "reused"
    assert_root_owned_nonwritable_directory "$label runtime target" "$target"
    record_runtime_tree "$label.reused" "$target"
    return 0
  fi

  if [ -e "$source" ]; then
    [ ! -e "$target" ] && [ ! -L "$target" ] || \
      fatal "both source and target exist for runtime directory $label; refusing an implicit merge"
    [ -d "$source" ] || fatal "$label source is not a directory"
    require_same_filesystem "$source" "$(dirname -- "$target")"
    source_identity="$(stat -c '%d:%i' "$source")"
    mv -- "$source" "$target"
    printf -v "$action_var" '%s' "moved"
    if ! ln -s "$target" "$source"; then
      if mv -- "$target" "$source"; then
        printf -v "$action_var" '%s' "none"
      else
        log "FATAL: failed to restore $source after compatibility-link failure"
      fi
      fatal "failed to create rollback-compatible runtime symlink for $label"
    fi
    target_identity="$(stat -c '%d:%i' "$target")"
    [ "$source_identity" = "$target_identity" ] || fatal "runtime directory identity changed while moving $label"
    assert_root_owned_nonwritable_directory "$label runtime target" "$target"
    record_runtime_tree "$label.moved" "$target"
  elif [ ! -e "$target" ]; then
    install -d -m 0750 "$target"
    printf -v "$action_var" '%s' "created"
    if ! ln -s "$target" "$source"; then
      if rmdir "$target" 2>/dev/null; then
        printf -v "$action_var" '%s' "none"
      else
        log "FATAL: failed to remove newly-created $target after compatibility-link failure"
      fi
      fatal "failed to create runtime directory $label"
    fi
    assert_root_owned_nonwritable_directory "$label runtime target" "$target"
    record_runtime_tree "$label.created" "$target"
  else
    [ -d "$target" ] || fatal "$label target is not a directory"
    ln -s "$target" "$source" || fatal "failed to create compatibility symlink for $label"
    printf -v "$action_var" '%s' "linked"
    assert_root_owned_nonwritable_directory "$label runtime target" "$target"
    record_runtime_tree "$label.reused" "$target"
  fi
}

# A runtime handoff is a transaction while PM2 is stopped. If any later move,
# copy, permission change, or PM2 start fails, put the old artifact back behind
# exactly the layout it had before this attempt. Existing canonical roots are
# never removed; only paths created or moved by this process are reversible.
rollback_runtime_directory_and_link() {
  local source="$1"
  local target="$2"
  local label="$3"
  local action="$4"

  case "$action" in
    none|reused)
      return 0
      ;;
    moved)
      if [ ! -L "$source" ] || [ "$(readlink -f "$source")" != "$target" ] || [ ! -d "$target" ]; then
        log "FATAL: cannot prove moved $label runtime path is safe to roll back"
        return 1
      fi
      if ! unlink "$source"; then
        log "FATAL: cannot remove $label compatibility symlink during rollback"
        return 1
      fi
      if ! mv -- "$target" "$source"; then
        ln -s "$target" "$source" || log "FATAL: cannot restore $label compatibility symlink after failed rollback move"
        log "FATAL: cannot move $label runtime directory back into the checkout"
        return 1
      fi
      return 0
      ;;
    created)
      if [ -L "$source" ]; then
        [ "$(readlink -f "$source")" = "$target" ] || {
          log "FATAL: $label compatibility symlink changed before rollback"
          return 1
        }
        unlink "$source" || {
          log "FATAL: cannot remove newly-created $label compatibility symlink"
          return 1
        }
      fi
      safe_remove_tree "$target"
      if [ -e "$target" ] || [ -L "$target" ]; then
        log "FATAL: cannot remove newly-created $label runtime target"
        return 1
      fi
      return 0
      ;;
    linked)
      if [ -L "$source" ]; then
        [ "$(readlink -f "$source")" = "$target" ] || {
          log "FATAL: $label compatibility symlink changed before rollback"
          return 1
        }
        unlink "$source" || {
          log "FATAL: cannot remove $label compatibility symlink during rollback"
          return 1
        }
      fi
      return 0
      ;;
    *)
      log "FATAL: unknown $label runtime cutover action: $action"
      return 1
      ;;
  esac
}

rollback_legacy_public_merge_copies() {
  local target failures=0

  [ -n "$RUNTIME_PUBLIC_MERGE_JOURNAL" ] || return 0
  [ -f "$RUNTIME_PUBLIC_MERGE_JOURNAL" ] || return 0
  while IFS= read -r -d '' target; do
    case "$target" in
      "$RUNTIME_UPLOADS_DIR"/*) ;;
      *)
        log "FATAL: runtime merge journal contains an unsafe path"
        failures=1
        continue
        ;;
    esac
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ ! -f "$target" ] || [ -L "$target" ] || ! unlink "$target"; then
        log "FATAL: cannot remove copied legacy public upload during rollback: $target"
        failures=1
      fi
    fi
  done < "$RUNTIME_PUBLIC_MERGE_JOURNAL"
  [ "$failures" = "0" ]
}

rollback_legacy_public_uploads() {
  local legacy="$APP_DIR/public/uploads"

  case "$LEGACY_PUBLIC_UPLOADS_ACTION" in
    none|reused)
      return 0
      ;;
    linked-empty)
      if [ -L "$legacy" ]; then
        [ "$(readlink -f "$legacy")" = "$RUNTIME_UPLOADS_DIR" ] || {
          log "FATAL: legacy public upload link changed before rollback"
          return 1
        }
        unlink "$legacy" || {
          log "FATAL: cannot remove empty legacy public upload link during rollback"
          return 1
        }
      fi
      return 0
      ;;
    archived)
      [ -n "$LEGACY_PUBLIC_UPLOADS_ARCHIVE" ] && [ -d "$LEGACY_PUBLIC_UPLOADS_ARCHIVE" ] || {
        log "FATAL: legacy public upload archive is missing during rollback"
        return 1
      }
      [ -L "$legacy" ] && [ "$(readlink -f "$legacy")" = "$RUNTIME_UPLOADS_DIR" ] || {
        log "FATAL: legacy public upload link changed before rollback"
        return 1
      }
      unlink "$legacy" || {
        log "FATAL: cannot remove legacy public upload link during rollback"
        return 1
      }
      if ! mv -- "$LEGACY_PUBLIC_UPLOADS_ARCHIVE" "$legacy"; then
        ln -s "$RUNTIME_UPLOADS_DIR" "$legacy" || log "FATAL: cannot restore legacy public upload compatibility link"
        log "FATAL: cannot restore archived legacy public uploads"
        return 1
      fi
      return 0
      ;;
    *)
      log "FATAL: unknown legacy public upload cutover action: $LEGACY_PUBLIC_UPLOADS_ACTION"
      return 1
      ;;
  esac
}

rollback_incomplete_runtime_cutover() {
  local failures=0

  [ "$RUNTIME_CUTOVER_APPLIED" != "true" ] || return 0
  rollback_legacy_public_merge_copies || failures=1
  rollback_legacy_public_uploads || failures=1
  rollback_runtime_directory_and_link "$APP_DIR/help-videos" "$HELP_VIDEO_RUNTIME_ROOT" \
    "help-videos" "$RUNTIME_HELP_VIDEOS_CUTOVER_ACTION" || failures=1
  rollback_runtime_directory_and_link "$APP_DIR/logs" "$LOG_DIR" \
    "pm2-logs" "$RUNTIME_LOGS_CUTOVER_ACTION" || failures=1
  rollback_runtime_directory_and_link "$APP_DIR/uploads" "$RUNTIME_UPLOADS_DIR" \
    "uploads" "$RUNTIME_UPLOADS_CUTOVER_ACTION" || failures=1

  [ "$failures" = "0" ] || return 1
  log "Rolled back incomplete runtime cutover before restarting the previous artifact"
}

move_runtime_file_and_link() {
  local source="$1"
  local target="$2"
  local label="$3"
  local action_var="$4"
  local source_identity target_identity digest

  [[ "$action_var" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || \
    fatal "invalid runtime state cutover action variable for $label"
  printf -v "$action_var" '%s' "none"
  ensure_secure_root_directory "$label state target parent" "$(dirname -- "$target")" "0750"
  if [ -L "$source" ]; then
    [ "$(readlink -f "$source")" = "$target" ] || \
      fatal "$source is a state symlink to an unexpected target"
    assert_root_owned_nonwritable_file "$label state target" "$target"
    printf -v "$action_var" '%s' "reused"
    digest="$(sha256sum "$target" | awk '{ print $1 }')"
    printf 'state=%s status=reused sha256=%s\n' "$label" "$digest" >> "$RUNTIME_CUTOVER_MANIFEST"
    return 0
  fi

  if [ -e "$source" ]; then
    assert_root_owned_nonwritable_file "$label state source" "$source"
    [ ! -e "$target" ] && [ ! -L "$target" ] || \
      fatal "both source and target exist for deployment state $label; refusing an implicit merge"
    if [ "$label" = "voice-provider-lock" ]; then
      exec 6>>"$source"
      if ! flock -n 6; then
        exec 6>&-
        fatal "voice provider cutover lock is active; refusing to move its runtime state"
      fi
      flock -u 6
      exec 6>&-
    fi
    require_same_filesystem "$source" "$(dirname -- "$target")"
    source_identity="$(stat -c '%d:%i' "$source")"
    digest="$(sha256sum "$source" | awk '{ print $1 }')"
    mv -- "$source" "$target"
    printf -v "$action_var" '%s' "moved"
    if ! ln -s "$target" "$source"; then
      if mv -- "$target" "$source"; then
        printf -v "$action_var" '%s' "none"
      else
        log "FATAL: failed to restore $source after compatibility-link failure"
      fi
      fatal "failed to create rollback-compatible state symlink for $label"
    fi
    target_identity="$(stat -c '%d:%i' "$target")"
    [ "$source_identity" = "$target_identity" ] || fatal "deployment state identity changed while moving $label"
    [ "$digest" = "$(sha256sum "$target" | awk '{ print $1 }')" ] || \
      fatal "deployment state hash changed while moving $label"
    assert_root_owned_nonwritable_file "$label state target" "$target"
    printf 'state=%s status=moved sha256=%s\n' "$label" "$digest" >> "$RUNTIME_CUTOVER_MANIFEST"
  elif [ ! -e "$target" ]; then
    return 0
  else
    assert_root_owned_nonwritable_file "$label state target" "$target"
    ln -s "$target" "$source" || fatal "failed to create compatibility state symlink for $label"
    printf -v "$action_var" '%s' "linked"
    printf 'state=%s status=linked sha256=%s\n' "$label" "$(sha256sum "$target" | awk '{ print $1 }')" >> "$RUNTIME_CUTOVER_MANIFEST"
  fi
}

rollback_runtime_file_and_link() {
  local source="$1"
  local target="$2"
  local label="$3"
  local action="$4"

  case "$action" in
    none|reused)
      return 0
      ;;
    moved)
      if [ ! -L "$source" ] || [ "$(readlink -f "$source")" != "$target" ] || [ ! -f "$target" ]; then
        log "FATAL: cannot prove moved $label state is safe to roll back"
        return 1
      fi
      unlink "$source" || {
        log "FATAL: cannot remove $label state compatibility symlink during rollback"
        return 1
      }
      if ! mv -- "$target" "$source"; then
        ln -s "$target" "$source" || log "FATAL: cannot restore $label state compatibility symlink after failed rollback move"
        log "FATAL: cannot move $label state file back into the checkout"
        return 1
      fi
      return 0
      ;;
    linked)
      if [ -L "$source" ]; then
        [ "$(readlink -f "$source")" = "$target" ] || {
          log "FATAL: $label state compatibility symlink changed before rollback"
          return 1
        }
        unlink "$source" || {
          log "FATAL: cannot remove $label state compatibility symlink during rollback"
          return 1
        }
      fi
      return 0
      ;;
    *)
      log "FATAL: unknown $label state cutover action: $action"
      return 1
      ;;
  esac
}

rollback_incomplete_runtime_state_cutover() {
  local failures=0

  [ "$RUNTIME_STATE_CUTOVER_FINALIZED" != "true" ] || return 0
  rollback_runtime_file_and_link "$APP_DIR/.voice-provider-registry-cutover.lock" \
    "$VOICE_OPERATOR_STATE_DIR_RESOLVED/voice-provider-registry-cutover.lock" \
    "voice-provider-lock" "$RUNTIME_VOICE_PROVIDER_LOCK_STATE_ACTION" || failures=1
  rollback_runtime_file_and_link "$APP_DIR/.backfill-base-modules-v2-done" \
    "$RUNTIME_STATE_DIR/backfills/base-modules-v2.done" \
    "base-modules-v2" "$RUNTIME_BASE_MODULES_V2_STATE_ACTION" || failures=1
  rollback_runtime_file_and_link "$APP_DIR/.backfill-base-modules.log" \
    "$RUNTIME_STATE_DIR/backfills/base-modules.log" \
    "base-modules-ledger" "$RUNTIME_BASE_MODULES_LEDGER_STATE_ACTION" || failures=1
  rollback_runtime_file_and_link "$APP_DIR/.backfill-plan-features-v1-done" \
    "$RUNTIME_STATE_DIR/backfills/plan-features-v1.done" \
    "plan-features-v1" "$RUNTIME_PLAN_FEATURES_STATE_ACTION" || failures=1

  [ "$failures" = "0" ] || return 1
  log "Rolled back incomplete runtime state cutover before restoring the previous artifact"
}

legacy_public_uploads_merge_preflight() {
  local canonical="$APP_DIR/uploads"
  local legacy="$APP_DIR/public/uploads"
  local source target files bytes max_files max_bytes same different missing type_conflict

  [ -L "$legacy" ] && {
    [ "$(readlink -f "$legacy")" = "$RUNTIME_UPLOADS_DIR" ] || fatal "legacy public upload path points to an unexpected target"
    [ -d "$RUNTIME_UPLOADS_DIR" ] || fatal "legacy public upload path points to missing runtime storage"
    return 0
  }
  if [ ! -e "$legacy" ]; then
    log "No legacy public upload directory; a compatibility symlink will be created after cutover"
    return 0
  fi
  [ -d "$legacy" ] || fatal "legacy public upload source is not a directory"
  assert_safe_runtime_tree "legacy public uploads" "$legacy"
  assert_safe_runtime_tree "canonical upload source" "$canonical"

  files=$(find "$legacy" -xdev -type f -printf . | wc -c | tr -d '[:space:]')
  bytes=$(find "$legacy" -xdev -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')
  max_files="${RUNTIME_LEGACY_PUBLIC_MERGE_MAX_FILES:-1000}"
  max_bytes="${RUNTIME_LEGACY_PUBLIC_MERGE_MAX_BYTES:-536870912}"
  case "$max_files" in ''|*[!0-9]*) fatal "RUNTIME_LEGACY_PUBLIC_MERGE_MAX_FILES must be an integer";; esac
  case "$max_bytes" in ''|*[!0-9]*) fatal "RUNTIME_LEGACY_PUBLIC_MERGE_MAX_BYTES must be an integer";; esac
  [ "$files" -le "$max_files" ] || fatal "legacy public upload migration has $files files (limit $max_files); schedule a dedicated maintenance migration"
  [ "$bytes" -le "$max_bytes" ] || fatal "legacy public upload migration has $bytes bytes (limit $max_bytes); schedule a dedicated maintenance migration"

  same=0; different=0; missing=0; type_conflict=0
  while IFS= read -r -d '' source; do
    target="$canonical/${source#"$legacy"/}"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ -f "$target" ]; then
        if cmp -s -- "$source" "$target"; then same=$((same + 1)); else different=$((different + 1)); fi
      else
        type_conflict=$((type_conflict + 1))
      fi
    else
      missing=$((missing + 1))
    fi
  done < <(find "$legacy" -xdev -type f -print0)
  [ "$different" = "0" ] && [ "$type_conflict" = "0" ] || \
    fatal "legacy public upload collision audit found divergent or incompatible paths; refusing an implicit merge"
  log "Legacy public upload merge preflight: files=$files same=$same missing=$missing bytes=$bytes"
}

verify_runtime_cutover_preflight() {
  assert_directory_move_preflight "$APP_DIR/uploads" "$RUNTIME_UPLOADS_DIR" "uploads"
  assert_directory_move_preflight "$APP_DIR/logs" "$LOG_DIR" "pm2 logs"
  assert_directory_move_preflight "$APP_DIR/help-videos" "$HELP_VIDEO_RUNTIME_ROOT" "help videos"
  legacy_public_uploads_merge_preflight
  log "Runtime cutover inventory: uploads $(runtime_tree_summary "$APP_DIR/uploads"); logs $(runtime_tree_summary "$APP_DIR/logs"); help-videos $(runtime_tree_summary "$APP_DIR/help-videos")"
}

prepare_runtime_state_cutover() {
  RUNTIME_CUTOVER_MANIFEST="$BACKUP_PATH/runtime-cutover-manifest.txt"
  RUNTIME_PUBLIC_MERGE_JOURNAL="$BACKUP_PATH/runtime-public-merge-created.nul"
  ( umask 077; : > "$RUNTIME_CUTOVER_MANIFEST" )
  ( umask 077; : > "$RUNTIME_PUBLIC_MERGE_JOURNAL" )
  chmod 0600 "$RUNTIME_CUTOVER_MANIFEST"
  chmod 0600 "$RUNTIME_PUBLIC_MERGE_JOURNAL"
  printf 'format=2 runtime_dir=%s log_dir=%s\n' "$RUNTIME_DIR" "$LOG_DIR" >> "$RUNTIME_CUTOVER_MANIFEST"

  ensure_secure_root_directory "LEADDRIVE_RUNTIME_DIR" "$RUNTIME_DIR" "0750"
  ensure_secure_root_directory "runtime state directory" "$RUNTIME_STATE_DIR" "0750"
  ensure_secure_root_directory "runtime checkout archive directory" "$RUNTIME_ARCHIVE_DIR" "0750"
  ensure_secure_root_directory "runtime backfill state directory" "$RUNTIME_STATE_DIR/backfills" "0750"
  ensure_secure_root_directory "voice operator state directory" "$VOICE_OPERATOR_STATE_DIR_RESOLVED" "0750"
  ensure_secure_root_directory "runtime recovery state directory" "$RUNTIME_STATE_DIR/recovery" "0750"
  move_runtime_file_and_link "$APP_DIR/.backfill-plan-features-v1-done" \
    "$RUNTIME_STATE_DIR/backfills/plan-features-v1.done" "plan-features-v1" \
    RUNTIME_PLAN_FEATURES_STATE_ACTION
  move_runtime_file_and_link "$APP_DIR/.backfill-base-modules.log" \
    "$RUNTIME_STATE_DIR/backfills/base-modules.log" "base-modules-ledger" \
    RUNTIME_BASE_MODULES_LEDGER_STATE_ACTION
  move_runtime_file_and_link "$APP_DIR/.backfill-base-modules-v2-done" \
    "$RUNTIME_STATE_DIR/backfills/base-modules-v2.done" "base-modules-v2" \
    RUNTIME_BASE_MODULES_V2_STATE_ACTION
  move_runtime_file_and_link "$APP_DIR/.voice-provider-registry-cutover.lock" \
    "$VOICE_OPERATOR_STATE_DIR_RESOLVED/voice-provider-registry-cutover.lock" "voice-provider-lock" \
    RUNTIME_VOICE_PROVIDER_LOCK_STATE_ACTION
}

merge_legacy_public_uploads_into_canonical_root() {
  local legacy="$APP_DIR/public/uploads"
  local canonical="$RUNTIME_UPLOADS_DIR"
  local source target archive stage file_count byte_count max_files max_bytes file_size

  if [ -L "$legacy" ]; then
    [ "$(readlink -f "$legacy")" = "$canonical" ] || fatal "legacy public upload path points to an unexpected target"
    [ -d "$canonical" ] || fatal "legacy public upload path points to missing runtime storage"
    LEGACY_PUBLIC_UPLOADS_ACTION="reused"
    return 0
  fi

  if [ ! -e "$legacy" ]; then
    install -d -m 0755 "$(dirname -- "$legacy")"
    ln -s "$canonical" "$legacy" || fatal "failed to create compatibility public upload symlink"
    LEGACY_PUBLIC_UPLOADS_ACTION="linked-empty"
    printf 'legacy-public-merge status=linked-empty\n' >> "$RUNTIME_CUTOVER_MANIFEST"
    return 0
  fi

  [ -d "$legacy" ] || fatal "legacy public upload source is not a directory"
  max_files="${RUNTIME_LEGACY_PUBLIC_MERGE_MAX_FILES:-1000}"
  max_bytes="${RUNTIME_LEGACY_PUBLIC_MERGE_MAX_BYTES:-536870912}"
  case "$max_files" in ''|*[!0-9]*) fatal "RUNTIME_LEGACY_PUBLIC_MERGE_MAX_FILES must be an integer";; esac
  case "$max_bytes" in ''|*[!0-9]*) fatal "RUNTIME_LEGACY_PUBLIC_MERGE_MAX_BYTES must be an integer";; esac
  file_count=0
  byte_count=0

  # Copy and byte-verify first while the legacy directory remains intact. This
  # gives an old artifact a complete read path if a later handoff step fails;
  # the legacy tree is never handed to the new app as a writer.
  while IFS= read -r -d '' source; do
    file_count=$((file_count + 1))
    file_size="$(stat -c '%s' "$source")"
    byte_count=$((byte_count + file_size))
    [ "$file_count" -le "$max_files" ] || fatal "legacy public upload grew beyond its verified file limit during handoff"
    [ "$byte_count" -le "$max_bytes" ] || fatal "legacy public upload grew beyond its verified byte limit during handoff"
    target="$canonical/${source#"$legacy"/}"
    if [ -e "$target" ] || [ -L "$target" ]; then
      [ -f "$target" ] && cmp -s -- "$source" "$target" || \
        fatal "legacy public upload changed after preflight; refusing a non-idempotent merge"
    else
      install -d -m 0750 "$(dirname -- "$target")"
      stage="$(mktemp "$(dirname -- "$target")/.legacy-public-stage.XXXXXX")" || \
        fatal "cannot stage legacy upload copy outside its final name"
      if ! cp --preserve=timestamps -- "$source" "$stage" \
        || ! chown root:root "$stage" \
        || ! chmod 0640 "$stage" \
        || ! cmp -s -- "$source" "$stage"; then
        rm -f -- "$stage"
        fatal "cannot copy and verify legacy upload into canonical runtime root"
      fi
      [ -n "$RUNTIME_PUBLIC_MERGE_JOURNAL" ] && [ -f "$RUNTIME_PUBLIC_MERGE_JOURNAL" ] || \
        fatal "runtime public-upload merge journal is missing"
      printf '%s\0' "$target" >> "$RUNTIME_PUBLIC_MERGE_JOURNAL" || {
        rm -f -- "$stage"
        fatal "cannot record legacy public upload before publishing it"
      }
      if ! mv -- "$stage" "$target"; then
        rm -f -- "$stage"
        fatal "cannot atomically publish copied legacy upload"
      fi
    fi
  done < <(find "$legacy" -xdev -type f -print0)

  archive="$RUNTIME_ARCHIVE_DIR/legacy-public-uploads-$TIMESTAMP"
  [ ! -e "$archive" ] && [ ! -L "$archive" ] || fatal "legacy upload archive target already exists"
  require_same_filesystem "$legacy" "$RUNTIME_ARCHIVE_DIR"
  mv -- "$legacy" "$archive"
  LEGACY_PUBLIC_UPLOADS_ACTION="archived"
  LEGACY_PUBLIC_UPLOADS_ARCHIVE="$archive"
  if ! ln -s "$canonical" "$legacy"; then
    if mv -- "$archive" "$legacy"; then
      LEGACY_PUBLIC_UPLOADS_ACTION="none"
      LEGACY_PUBLIC_UPLOADS_ARCHIVE=""
    else
      log "FATAL: failed to restore legacy public upload path after link failure"
    fi
    fatal "failed to create rollback-compatible public upload symlink"
  fi
  record_runtime_tree "legacy-public-uploads.archive" "$archive"
  printf 'archive=legacy-public-uploads path=%s authority=%s\n' "$archive" "$canonical" >> "$RUNTIME_CUTOVER_MANIFEST"
  printf 'legacy-public-merge files=%s bytes=%s\n' "$file_count" "$byte_count" >> "$RUNTIME_CUTOVER_MANIFEST"
}

finalize_runtime_data_cutover() {
  # PM2 has been stopped before this point. The first migration is a
  # collision-audited copy into one canonical root, followed by source-path
  # symlinks, never two live writable authorities.
  move_runtime_directory_and_link "$APP_DIR/uploads" "$RUNTIME_UPLOADS_DIR" "uploads" \
    RUNTIME_UPLOADS_CUTOVER_ACTION
  merge_legacy_public_uploads_into_canonical_root
  move_runtime_directory_and_link "$APP_DIR/logs" "$LOG_DIR" "pm2-logs" \
    RUNTIME_LOGS_CUTOVER_ACTION
  move_runtime_directory_and_link "$APP_DIR/help-videos" "$HELP_VIDEO_RUNTIME_ROOT" "help-videos" \
    RUNTIME_HELP_VIDEOS_CUTOVER_ACTION

  # From this point every legacy path is a compatibility symlink to exactly
  # one canonical root. Permission hardening below may still fail, but it must
  # not make rollback recreate separate writable trees for the old artifact.
  RUNTIME_CUTOVER_APPLIED=true
  RUNTIME_STATE_CUTOVER_FINALIZED=true
  printf 'cutover=layout-complete\n' >> "$RUNTIME_CUTOVER_MANIFEST"
  if [ "$LEGACY_PUBLIC_UPLOADS_ACTION" = "archived" ]; then
    chown root:root "$LEGACY_PUBLIC_UPLOADS_ARCHIVE"
    chmod 0700 "$LEGACY_PUBLIC_UPLOADS_ARCHIVE"
    record_runtime_tree "legacy-public-uploads.archive.secured" "$LEGACY_PUBLIC_UPLOADS_ARCHIVE"
  fi
  getent group leaddrive-backup >/dev/null || fatal "leaddrive-backup group is required for log shipping"
  chown root:leaddrive-backup "$LOG_DIR"
  chmod 2750 "$LOG_DIR"
  chmod 0750 "$RUNTIME_DIR" "$RUNTIME_UPLOADS_DIR" "$RUNTIME_STATE_DIR" "$HELP_VIDEO_RUNTIME_ROOT"
  printf 'cutover=complete\n' >> "$RUNTIME_CUTOVER_MANIFEST"
  log "Runtime data moved outside the checkout; manifest=$RUNTIME_CUTOVER_MANIFEST"
}

backup_runtime_directory() {
  local source="$1"
  local destination="$2"
  local label="$3"
  local resolved_source

  [ -e "$source" ] || [ -L "$source" ] || {
    log "No $label runtime directory to back up"
    return 0
  }
  resolved_source="$(readlink -f -- "$source")" || fatal "cannot resolve $label backup source"
  [ -d "$resolved_source" ] || fatal "$label backup source is not a directory: $source"
  [ ! -e "$destination" ] && [ ! -L "$destination" ] || \
    fatal "$label backup destination already exists: $destination"
  cp -a -- "$resolved_source" "$destination" || \
    fatal "cannot create verified pre-cutover backup for $label"
  [ -d "$destination" ] || fatal "$label backup did not produce a directory"
  log "Backed up $label runtime data"
}

validate_release_owned_operations_artifact() {
  local artifact_root="$1"
  local script helper unit rotate manifest name
  local -a backup_scripts=(hash-recovery-db-contract.sh hash-recovery-program-set.sh postgres-backup.sh postgres-restore-canary.sh prove-source-database.sh ship-logs.sh snapshot-runtime-files.sh snapshot-secrets.sh)
  local -a backup_helpers=(
    bootstrap-backup-role.sql canary.sql migration-ledger.sql prove-restored-pii.mjs
    recovery-db-contract.tsv
  )
  local -a units=(
    leaddrive-log-ship.service
    leaddrive-log-ship.timer
    leaddrive-postgres-backup.service
    leaddrive-postgres-backup.timer
    leaddrive-runtime-files-snapshot.service
    leaddrive-runtime-files-snapshot.timer
    leaddrive-secrets-snapshot.service
    leaddrive-secrets-snapshot.timer
  )
  local -a rotate_files=(leaddrive-v2 leaddrive-cron-logs)

  for script in "${backup_scripts[@]}"; do
    [ -x "$artifact_root/scripts/backup/$script" ] && [ ! -L "$artifact_root/scripts/backup/$script" ] || \
      fatal "release artifact is missing executable backup script: $script"
  done
  for helper in "${backup_helpers[@]}"; do
    [ -f "$artifact_root/scripts/backup/$helper" ] && [ ! -L "$artifact_root/scripts/backup/$helper" ] || \
      fatal "release artifact is missing regular backup helper: $helper"
  done
  for unit in "${units[@]}"; do
    [ -f "$artifact_root/ops/systemd/$unit" ] || \
      fatal "release artifact is missing systemd unit: $unit"
  done
  for rotate in "${rotate_files[@]}"; do
    [ -f "$artifact_root/ops/logrotate/$rotate" ] || \
      fatal "release artifact is missing logrotate definition: $rotate"
  done
  [ -f "$artifact_root/ops/backup/backup.env.example" ] \
    && [ ! -L "$artifact_root/ops/backup/backup.env.example" ] \
    && [ -f "$artifact_root/ops/backup/recovery-program-set.files" ] \
    && [ ! -L "$artifact_root/ops/backup/recovery-program-set.files" ] || \
    fatal "release artifact is missing the recovery-program contract"

  manifest="$artifact_root/scripts/release-cron-script-manifest.txt"
  [ -s "$manifest" ] || fatal "release artifact is missing its cron-script manifest"
  LC_ALL=C sort -cu "$manifest" || \
    fatal "release cron-script manifest must be sorted and unique"
  while IFS= read -r name || [ -n "$name" ]; do
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.sh$ ]] || \
      fatal "release cron-script manifest contains an unsafe entry"
    [ -x "$artifact_root/scripts/$name" ] || \
      fatal "release cron-script manifest names a missing executable: $name"
  done < "$manifest"
}

validate_certified_recovery_program_set() {
  local artifact_root="$1"
  local marker="$2"
  local expected_scope="$3"
  local helper="$artifact_root/scripts/backup/hash-recovery-program-set.sh"
  local certified_sha artifact_sha certified_db_contract_sha artifact_db_contract_sha computed_db_contract_sha

  [ -x "$helper" ] && [ ! -L "$helper" ] || \
    fatal "release artifact is missing its executable recovery-program set verifier"

  # The signed marker is produced by the offline `certify-offline-restore`
  # ceremony (docs/BACKUP_RUNBOOK.md): a private age identity, an independent
  # offline host and an Ed25519 principal that is deliberately not this server.
  # An uncommissioned host therefore cannot have one and cannot obtain one, and
  # demanding it on every release does not make the recovery programs
  # trustworthy. What it actually did, from 2026-09-05 onward: the application
  # deployed and health-checked green, then this gate exited 1, so
  # `install_release_owned_operations` never ran. The cron scripts, systemd
  # units and logrotate rules under $OPS_CURRENT_LINK stayed frozen at
  # 8fbd00c410c6 while the application moved on — and every deploy reported
  # failure after a successful cutover. A permanently red deploy is not a
  # safety property; it is how the next real failure goes unread.
  #
  # So on an uncommissioned host the release-owned operations are installed
  # without a certificate, and the deployment says so in its log rather than
  # implying an offline drill that never happened. The recovery programs stay
  # inert regardless: the backup service has no `age` binary and the log timer
  # is disabled. Completing the ceremony flips this back by itself, because the
  # mode is read from BACKUP_ENCRYPTION on the host.
  #
  # The bootstrap ceremony keeps its certificate unconditionally: creating a
  # genesis anchor is the one operation whose whole purpose is the signed
  # chain, and it only runs when an operator dispatches it.
  if [ "$expected_scope" = "full-recovery" ] \
     && [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then
    log "Recovery gate: plain mode — installing release-owned operations without an offline commissioning certificate; recovery programs remain inert until docs/BACKUP_RUNBOOK.md is completed"
    return 0
  fi

  assert_root_owned_nonwritable_file "offline restore marker" "$marker"
  [ "$(read_static_env_value "$marker" RECOVERY_SCOPE)" = "$expected_scope" ] \
    || fatal "offline restore marker belongs to another recovery scope"
  case "$expected_scope:$(read_static_env_value "$marker" FORMAT_VERSION)" in
    log-genesis-bootstrap-only:1|full-recovery:4) ;;
    *) fatal "offline restore marker format is invalid for its recovery scope" ;;
  esac
  certified_sha="$(read_static_env_value "$marker" RECOVERY_PROGRAM_SET_SHA256)" || \
    fatal "offline restore marker has duplicate recovery-program set digests"
  artifact_sha="$("$helper" "$artifact_root")" || \
    fatal "release recovery-program set cannot be hashed"
  [[ "$certified_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$artifact_sha" = "$certified_sha" ] || \
    fatal "release recovery-program set differs from the signed commissioned digest"
  certified_db_contract_sha="$(read_static_env_value "$marker" RECOVERY_DB_CONTRACT_SHA256)" || \
    fatal "offline restore marker has duplicate recovery DB contract digests"
  artifact_db_contract_sha="$(sha256sum "$artifact_root/scripts/backup/recovery-db-contract.tsv" | awk '{print $1}')" || \
    fatal "release artifact recovery DB contract manifest cannot be hashed"
  computed_db_contract_sha="$(
    "$artifact_root/scripts/backup/hash-recovery-db-contract.sh" "$artifact_root"
  )" || fatal "release Prisma schema/migration contract cannot be hashed"
  [[ "$certified_db_contract_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$artifact_db_contract_sha" = "$certified_db_contract_sha" ] \
    && [ "$computed_db_contract_sha" = "$certified_db_contract_sha" ] || \
    fatal "release Prisma schema/migrations or DB contract manifest differ from the signed commissioned digest"
}

validate_installed_release_operations() {
  local release_root="$1"
  local artifact_root="$2"
  local script helper unit rotate manifest name expected_program_set_sha installed_program_set_sha
  local expected_db_contract_sha installed_db_contract_sha
  local -a backup_scripts=(hash-recovery-db-contract.sh hash-recovery-program-set.sh postgres-backup.sh postgres-restore-canary.sh prove-source-database.sh ship-logs.sh snapshot-runtime-files.sh snapshot-secrets.sh)
  local -a backup_helpers=(
    bootstrap-backup-role.sql canary.sql migration-ledger.sql prove-restored-pii.mjs
    recovery-db-contract.tsv
  )
  local -a units=(
    leaddrive-log-ship.service
    leaddrive-log-ship.timer
    leaddrive-postgres-backup.service
    leaddrive-postgres-backup.timer
    leaddrive-runtime-files-snapshot.service
    leaddrive-runtime-files-snapshot.timer
    leaddrive-secrets-snapshot.service
    leaddrive-secrets-snapshot.timer
  )
  local -a rotate_files=(leaddrive-v2 leaddrive-cron-logs)

  expected_program_set_sha="$(
    "$artifact_root/scripts/backup/hash-recovery-program-set.sh" "$artifact_root"
  )" || fatal "cannot hash the artifact recovery-program set"
  installed_program_set_sha="$release_root/recovery-program-set.sha256"
  [ -f "$installed_program_set_sha" ] && [ ! -L "$installed_program_set_sha" ] \
    && [ "$(stat -c '%U:%G:%a' "$installed_program_set_sha" 2>/dev/null || true)" = "root:root:444" ] \
    && cmp -s -- "$installed_program_set_sha" <(printf '%s\n' "$expected_program_set_sha") || \
    fatal "installed release recovery-program digest differs from the immutable artifact"
  expected_db_contract_sha="$(sha256sum "$artifact_root/scripts/backup/recovery-db-contract.tsv" | awk '{print $1}')" \
    || fatal "cannot hash the artifact recovery DB contract"
  installed_db_contract_sha="$release_root/recovery-db-contract.sha256"
  [ -f "$installed_db_contract_sha" ] && [ ! -L "$installed_db_contract_sha" ] \
    && [ "$(stat -c '%U:%G:%a' "$installed_db_contract_sha" 2>/dev/null || true)" = "root:root:444" ] \
    && cmp -s -- "$installed_db_contract_sha" <(printf '%s\n' "$expected_db_contract_sha") || \
    fatal "installed release recovery DB contract digest differs from the immutable artifact"

  for script in "${backup_scripts[@]}"; do
    [ -x "$release_root/backup/$script" ] && [ ! -L "$release_root/backup/$script" ] \
      || fatal "installed release backup script is missing: $script"
    cmp -s -- "$artifact_root/scripts/backup/$script" "$release_root/backup/$script" || \
      fatal "installed release backup script differs from the immutable artifact: $script"
  done
  for helper in "${backup_helpers[@]}"; do
    [ -f "$release_root/backup/$helper" ] && [ ! -L "$release_root/backup/$helper" ] \
      || fatal "installed release backup helper is missing: $helper"
    cmp -s -- "$artifact_root/scripts/backup/$helper" "$release_root/backup/$helper" || \
      fatal "installed release backup helper differs from the immutable artifact: $helper"
  done
  for unit in "${units[@]}"; do
    [ -f "$release_root/systemd/$unit" ] || fatal "installed release unit is missing: $unit"
    cmp -s -- "$artifact_root/ops/systemd/$unit" "$release_root/systemd/$unit" || \
      fatal "installed release unit differs from the immutable artifact: $unit"
  done
  for rotate in "${rotate_files[@]}"; do
    [ -f "$release_root/logrotate/$rotate" ] || fatal "installed release logrotate file is missing: $rotate"
    cmp -s -- "$artifact_root/ops/logrotate/$rotate" "$release_root/logrotate/$rotate" || \
      fatal "installed release logrotate file differs from the immutable artifact: $rotate"
  done
  manifest="$release_root/cron-script-manifest.txt"
  cmp -s -- "$artifact_root/scripts/release-cron-script-manifest.txt" "$manifest" || \
    fatal "installed release cron-script manifest differs from the immutable artifact"
  while IFS= read -r name || [ -n "$name" ]; do
    [ -x "$release_root/cron-scripts/$name" ] || \
      fatal "installed release cron script is missing: $name"
    cmp -s -- "$artifact_root/scripts/$name" "$release_root/cron-scripts/$name" || \
      fatal "installed release cron script differs from the immutable artifact: $name"
  done < "$manifest"
}

validate_log_evidence_genesis_anchor_file() {
  local file="$LOG_EVIDENCE_GENESIS_ANCHOR" status

  assert_root_owned_nonwritable_file "log-evidence genesis anchor" "$file"
  [ "$(realpath -e -- "$file" 2>/dev/null || true)" = "$file" ] \
    && [ "$(stat -c '%a' "$file")" = 600 ] \
    && [ "$(wc -c <"$file" | tr -d '[:space:]')" -le 16384 ] \
    || fatal "log-evidence genesis anchor is non-canonical, oversized, or not mode 0600"
  status="$(read_static_env_value "$file" STATUS)" \
    || fatal "log-evidence genesis anchor has no unique status"
  case "$status" in
    PENDING)
      awk '
        NR == 1 { if ($0 != "FORMAT_VERSION=1") bad=1; next }
        NR == 2 { if ($0 != "STATUS=PENDING") bad=1; next }
        NR == 3 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
        NR == 4 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\/[0-9]{4}\/[0-9]{2}\/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$/) bad=1; next }
        NR == 5 { if ($0 !~ /^BOOTSTRAP_DEPLOY_SHA=[0-9a-f]{40}$/) bad=1; next }
        NR == 6 { if ($0 !~ /^BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
        { bad=1 }
        END { if (NR != 6 || bad) exit 1 }
      ' "$file" || fatal "pending log-evidence genesis anchor is malformed"
      ;;
    COMMITTED)
      awk '
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
        NR == 16 { if ($0 !~ /^OBJECT_CREATED_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|\+00:00)$/) bad=1; next }
        { bad=1 }
        END { if (NR != 16 || bad) exit 1 }
      ' "$file" || fatal "committed log-evidence genesis anchor is malformed"
      ;;
    *) fatal "log-evidence genesis anchor has an unknown status" ;;
  esac
}

prepare_reviewed_log_source_authorities() {
  local directory file_count stage

  getent group adm >/dev/null \
    || fatal "adm group is required for exact nginx/postgresql/resilience log access"
  for directory in /var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql; do
    [ -d "$directory" ] && [ ! -L "$directory" ] \
      && [ "$(realpath -e -- "$directory" 2>/dev/null || true)" = "$directory" ] \
      || fatal "reviewed log source directory is absent, symlinked, or non-canonical: $directory"
    file_count="$(find "$directory" -xdev -mindepth 1 -maxdepth 1 -type f -name '*.log' -printf '.' | wc -c | tr -d '[:space:]')"
    [[ "$file_count" =~ ^[1-9][0-9]*$ ]] \
      || fatal "reviewed log source directory has no active .log authority: $directory"
  done
  if [ ! -e /var/log/leaddrive-resilience-cron.log ] \
      && [ ! -L /var/log/leaddrive-resilience-cron.log ]; then
    stage="$(mktemp /var/log/.leaddrive-resilience-cron.log.stage.XXXXXX)" \
      || fatal "cannot stage exact resilience log authority"
    chown root:adm "$stage"
    chmod 0640 "$stage"
    sync -f -- "$stage" /var/log \
      || { rm -f -- "$stage"; fatal "cannot persist staged resilience log authority"; }
    if ! ln -- "$stage" /var/log/leaddrive-resilience-cron.log 2>/dev/null; then
      rm -f -- "$stage"
      fatal "cannot no-clobber create exact resilience log authority"
    fi
    rm -f -- "$stage" \
      || fatal "cannot remove staged resilience log authority hard link"
  fi
  [ -f /var/log/leaddrive-resilience-cron.log ] \
    && [ ! -L /var/log/leaddrive-resilience-cron.log ] \
    && [ "$(realpath -e -- /var/log/leaddrive-resilience-cron.log 2>/dev/null || true)" = /var/log/leaddrive-resilience-cron.log ] \
    || fatal "exact resilience log authority is unsafe"
  chown root:adm /var/log/leaddrive-resilience-cron.log
  chmod 0640 /var/log/leaddrive-resilience-cron.log
  sync -f -- /var/log/leaddrive-resilience-cron.log /var/log \
    || fatal "cannot persist exact resilience log authority"
}

prepare_log_evidence_genesis_anchor() {
  local stage start_at nonce object_key program_sha status

  assert_root_owned_nonwritable_directory "backup evidence root" "$BACKUP_EVIDENCE_ROOT"
  [ "$(stat -c '%a' "$BACKUP_EVIDENCE_ROOT")" = 700 ] \
    || fatal "backup evidence root must remain mode 0700"
  if [ -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] || [ -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ]; then
    validate_log_evidence_genesis_anchor_file
    status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)"
    if [ "$status" = PENDING ]; then
      [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)" = "$DEPLOY_SHA" ] \
        || fatal "pending log genesis belongs to another deployment; resume that exact release or run the discontinuity procedure"
      program_sha="$(tr -d '\r\n' <"$OPS_CURRENT_LINK/recovery-program-set.sha256")"
      [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" = "$program_sha" ] \
        || fatal "pending log genesis belongs to another recovery-program set"
    fi
    return 0
  fi
  if [ -e "$LOG_EVIDENCE_STATE_DIR" ] || [ -L "$LOG_EVIDENCE_STATE_DIR" ]; then
    [ -d "$LOG_EVIDENCE_STATE_DIR" ] && [ ! -L "$LOG_EVIDENCE_STATE_DIR" ] \
      && [ "$(realpath -e -- "$LOG_EVIDENCE_STATE_DIR" 2>/dev/null || true)" = "$LOG_EVIDENCE_STATE_DIR" ] \
      && [ "$(stat -c '%U:%G:%a' "$LOG_EVIDENCE_STATE_DIR" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:750 ] \
      || fatal "unanchored log cursor directory exists with unsafe ownership or mode"
  fi
  if [ -e "$LOG_EVIDENCE_STATE_FILE" ] || [ -L "$LOG_EVIDENCE_STATE_FILE" ]; then
    [ -f "$LOG_EVIDENCE_STATE_FILE" ] && [ ! -L "$LOG_EVIDENCE_STATE_FILE" ] \
      && [ "$(realpath -e -- "$LOG_EVIDENCE_STATE_FILE" 2>/dev/null || true)" = "$LOG_EVIDENCE_STATE_FILE" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$LOG_EVIDENCE_STATE_FILE" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600:1 ] \
      && [ ! -s "$LOG_EVIDENCE_STATE_FILE" ] \
      || fatal "unanchored log cursor exists and is unsafe or nonempty; explicit discontinuity approval is required"
  fi
  [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] \
    && [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
    || fatal "unanchored log cursor/transaction already exists; automatic genesis adoption is forbidden"
  program_sha="$(tr -d '\r\n' <"$OPS_CURRENT_LINK/recovery-program-set.sha256")"
  [[ "$program_sha" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "active recovery-program identity is malformed before log bootstrap"
  start_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  IFS= read -r nonce </proc/sys/kernel/random/uuid \
    || fatal "cannot allocate the root-prescribed log genesis nonce"
  [[ "$nonce" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fatal "root-prescribed log genesis nonce has an unexpected format"
  object_key="logs/$(date -u '+%Y/%m')/leaddrive-logs-$(date -u '+%Y%m%dT%H%M%SZ')-$nonce.tar.gz.age"
  stage="$(mktemp "$BACKUP_EVIDENCE_ROOT/.log-evidence-genesis.stage.XXXXXX")" \
    || fatal "cannot stage the root log-evidence genesis authority"
  printf '%s\n' \
    'FORMAT_VERSION=1' \
    'STATUS=PENDING' \
    "LOG_EVIDENCE_START_AT=$start_at" \
    "LOG_EVIDENCE_FIRST_OBJECT_KEY=$object_key" \
    "BOOTSTRAP_DEPLOY_SHA=$DEPLOY_SHA" \
    "BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=$program_sha" \
    >"$stage"
  chown root:root "$stage"
  chmod 0600 "$stage"
  sync -f -- "$stage" "$BACKUP_EVIDENCE_ROOT" \
    || fatal "cannot persist the staged root log-evidence genesis authority"
  if ! ln -- "$stage" "$LOG_EVIDENCE_GENESIS_ANCHOR" 2>/dev/null; then
    rm -f -- "$stage"
    fatal "cannot no-clobber publish the pending root log-evidence genesis authority"
  fi
  rm -f -- "$stage" \
    || fatal "cannot remove the staged root log-evidence genesis hard link"
  sync -f -- "$LOG_EVIDENCE_GENESIS_ANCHOR" "$BACKUP_EVIDENCE_ROOT" \
    || fatal "cannot persist the pending root log-evidence genesis authority"
  validate_log_evidence_genesis_anchor_file
}

validate_log_bootstrap_transaction() {
  local state_file="$1" active_script_sha="$2" active_program_sha="$3"
  local evidence_start="$4" evidence_key="$5" evidence_version="$6" evidence_sha="$7"
  local transaction_dir="${8:-$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION}"
  local require_live_cursor="${9:-1}"
  local transaction_env="$transaction_dir/transaction.env"
  local offsets_file="$transaction_dir/offsets.next"
  local payload_file="$transaction_dir/payload.age"
  local transaction_members nested_mount member transaction_bytes transaction_rows
  local tx_start tx_key tx_ciphertext_sha tx_ciphertext_bytes tx_script tx_program tx_ranges
  local tx_file_count tx_file_bytes tx_journal_count tx_cursor tx_retention configured_retention

  LOG_BOOTSTRAP_TX_PRESENT=false
  LOG_BOOTSTRAP_TX_PAYLOAD=""
  if [ ! -e "$transaction_dir" ] && [ ! -L "$transaction_dir" ]; then
    return 0
  fi
  case "$transaction_dir" in
    "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION")
      [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
        || fatal "published and preparing log-bootstrap transactions coexist"
      ;;
    "$LOG_EVIDENCE_BOOTSTRAP_PREPARING")
      [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] \
        || fatal "preparing and published log-bootstrap transactions coexist"
      ;;
    *) fatal "unreviewed log-bootstrap transaction path" ;;
  esac
  [ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] \
    && [ "$(realpath -e -- "$transaction_dir" 2>/dev/null || true)" = "$transaction_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$transaction_dir" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:700 ] \
    || fatal "durable log-bootstrap transaction directory is unsafe"
  transaction_members="$(find "$transaction_dir" -xdev -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" \
    || fatal "cannot inventory durable log-bootstrap transaction"
  [ "$transaction_members" = $'offsets.next\npayload.age\ntransaction.env' ] \
    && [ -z "$(find "$transaction_dir" -xdev -mindepth 2 -print -quit)" ] \
    || fatal "durable log-bootstrap transaction has unexpected or nested members"
  nested_mount="$(findmnt -rn -o TARGET | awk -v root="$transaction_dir/" 'index($0, root) == 1 { print; exit }')"
  [ -z "$nested_mount" ] \
    || fatal "durable log-bootstrap transaction contains a nested mount"
  for member in "$transaction_env" "$offsets_file" "$payload_file"; do
    [ -f "$member" ] && [ ! -L "$member" ] \
      && [ "$(realpath -e -- "$member" 2>/dev/null || true)" = "$member" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$member" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600:1 ] \
      || fatal "durable log-bootstrap transaction member is unsafe"
  done
  transaction_bytes="$(wc -c <"$transaction_env" | tr -d '[:space:]')"
  transaction_rows="$(wc -l <"$transaction_env" | tr -d '[:space:]')"
  [ "$transaction_bytes" -le 16384 ] && [ "$transaction_rows" -eq 14 ] \
    || fatal "durable log-bootstrap manifest exceeds its exact bound"
  awk '
    NR == 1 { if ($0 != "FORMAT_VERSION=1") bad=1; next }
    NR == 2 { if ($0 != "STATUS=PREPARED") bad=1; next }
    NR == 3 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
    NR == 4 { if ($0 !~ /^OBJECT_KEY=logs\// || length($0) > 1200) bad=1; next }
    NR == 5 { if ($0 !~ /^CIPHERTEXT_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 6 { if ($0 !~ /^CIPHERTEXT_BYTES=[1-9][0-9]*$/) bad=1; next }
    NR == 7 { if ($0 !~ /^SHIP_LOGS_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 8 { if ($0 !~ /^RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 9 { if ($0 !~ /^RANGES_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 10 { if ($0 !~ /^FILE_RANGE_COUNT=[0-9]+$/) bad=1; next }
    NR == 11 { if ($0 !~ /^FILE_RANGE_BYTES=[0-9]+$/) bad=1; next }
    NR == 12 { if ($0 !~ /^JOURNAL_RANGE_COUNT=[0-9]+$/) bad=1; next }
    NR == 13 { if ($0 !~ /^CURSOR_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 14 { if ($0 !~ /^RETENTION_DAYS=[0-9]+$/) bad=1; next }
    { bad=1 }
    END { if (NR != 14 || bad) exit 1 }
  ' "$transaction_env" || fatal "durable log-bootstrap manifest is malformed"
  tx_start="$(read_static_env_value "$transaction_env" LOG_EVIDENCE_START_AT)"
  tx_key="$(read_static_env_value "$transaction_env" OBJECT_KEY)"
  tx_ciphertext_sha="$(read_static_env_value "$transaction_env" CIPHERTEXT_SHA256)"
  tx_ciphertext_bytes="$(read_static_env_value "$transaction_env" CIPHERTEXT_BYTES)"
  tx_script="$(read_static_env_value "$transaction_env" SHIP_LOGS_SHA256)"
  tx_program="$(read_static_env_value "$transaction_env" RECOVERY_PROGRAM_SET_SHA256)"
  tx_ranges="$(read_static_env_value "$transaction_env" RANGES_SHA256)"
  tx_file_count="$(read_static_env_value "$transaction_env" FILE_RANGE_COUNT)"
  tx_file_bytes="$(read_static_env_value "$transaction_env" FILE_RANGE_BYTES)"
  tx_journal_count="$(read_static_env_value "$transaction_env" JOURNAL_RANGE_COUNT)"
  tx_cursor="$(read_static_env_value "$transaction_env" CURSOR_SHA256)"
  tx_retention="$(read_static_env_value "$transaction_env" RETENTION_DAYS)"
  configured_retention="$(read_static_env_value /etc/leaddrive/backup.env LOG_SHIP_RETENTION_DAYS)" \
    || fatal "backup environment has no unique log retention policy"
  [ "$tx_start" = "$evidence_start" ] && [ "$tx_key" = "$evidence_key" ] \
    && [ "$tx_script" = "$active_script_sha" ] \
    && [ "$tx_program" = "$active_program_sha" ] \
    && [ "$tx_retention" = "$configured_retention" ] \
    || fatal "durable log-bootstrap transaction diverges from root/program/policy authority"
  if [ "$require_live_cursor" = 1 ]; then
    [ "$tx_ciphertext_sha" = "$evidence_sha" ] \
      || fatal "durable log-bootstrap ciphertext diverges from the finalized live cursor"
  elif [ "$require_live_cursor" != 0 ]; then
    fatal "invalid log-bootstrap live-cursor validation mode"
  fi
  [[ "$tx_ciphertext_bytes" =~ ^[1-9][0-9]*$ ]] && [ "$tx_ciphertext_bytes" -le 2199023255552 ] \
    && [[ "$tx_file_count" =~ ^[0-9]+$ ]] && [ "$tx_file_count" -le 100000 ] \
    && [[ "$tx_file_bytes" =~ ^[0-9]+$ ]] && [ "$tx_file_bytes" -le 1099511627776 ] \
    && [[ "$tx_journal_count" =~ ^[0-9]+$ ]] && [ "$tx_journal_count" -le 1000 ] \
    && [ $((tx_file_count + tx_journal_count)) -ge 1 ] \
    || fatal "durable log-bootstrap transaction exceeds reviewed bounds"
  [ "$(stat -c '%s' "$payload_file")" = "$tx_ciphertext_bytes" ] \
    && [ "$(sha256sum "$payload_file" | awk '{print $1}')" = "$tx_ciphertext_sha" ] \
    && [ "$(sha256sum "$offsets_file" | awk '{print $1}')" = "$tx_cursor" ] \
    && [ "$(wc -c <"$offsets_file" | tr -d '[:space:]')" -le 4194304 ] \
    && [ "$(wc -l <"$offsets_file" | tr -d '[:space:]')" -le 100000 ] \
    || fatal "durable log-bootstrap payload or cursor digest is invalid"
  awk -F '\t' -v expected="leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service" \
    -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" -v script_sha="$active_script_sha" \
    -v program_sha="$active_program_sha" -v start="$evidence_start" '
    BEGIN { count=split(expected, units, " "); for (i=1; i<=count; i++) allowed[units[i]]=1 }
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 != "SHIP_LOGS_SHA256=" script_sha) bad=1; next }
    NR == 3 { if ($0 != "RECOVERY_PROGRAM_SET_SHA256=" program_sha) bad=1; next }
    NR == 4 { if ($0 != "LOG_EVIDENCE_START_AT=" start) bad=1; next }
    NR == 5 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_KEY=PENDING") bad=1; next }
    NR == 6 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=PENDING") bad=1; next }
    NR == 7 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_SHA256=PENDING") bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || $2 !~ reviewed || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ ||
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
      if (NF != 3 || !allowed[$2] || ($3 != "NO_CURSOR" && ($3 !~ /^[!-~]+$/ || length($3) > 2048))) bad=1
      if (seen_journal[$2]++) bad=1
      next
    }
    { bad=1 }
    END {
      for (unit in allowed) if (seen_journal[unit] != 1) bad=1
      if (!saw_pm2 || !saw_nginx || !saw_postgres || !saw_resilience) bad=1
      if (NR < 11 || bad) exit 1
    }
  ' "$offsets_file" || fatal "durable log-bootstrap cursor is malformed or incomplete"
  if [ "$require_live_cursor" = 1 ]; then
    cmp -s -- "$state_file" <(
      awk -v key="$evidence_key" -v version="$evidence_version" -v digest="$evidence_sha" '
        NR == 5 { print "LOG_EVIDENCE_FIRST_OBJECT_KEY=" key; next }
        NR == 6 { print "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=" version; next }
        NR == 7 { print "LOG_EVIDENCE_FIRST_OBJECT_SHA256=" digest; next }
        { print }
      ' "$offsets_file"
    ) || fatal "live log cursor is not the exact finalized durable bootstrap cursor"
  fi

  LOG_BOOTSTRAP_TX_PRESENT=true
  LOG_BOOTSTRAP_TX_PAYLOAD="$payload_file"
  LOG_BOOTSTRAP_TX_CIPHERTEXT_SHA256="$tx_ciphertext_sha"
  LOG_BOOTSTRAP_TX_CIPHERTEXT_BYTES="$tx_ciphertext_bytes"
  LOG_BOOTSTRAP_TX_CURSOR_SHA256="$tx_cursor"
  LOG_BOOTSTRAP_TX_RANGES_SHA256="$tx_ranges"
  LOG_BOOTSTRAP_TX_FILE_RANGE_COUNT="$tx_file_count"
  LOG_BOOTSTRAP_TX_FILE_RANGE_BYTES="$tx_file_bytes"
  LOG_BOOTSTRAP_TX_JOURNAL_RANGE_COUNT="$tx_journal_count"
}

prove_remote_log_genesis_body() {
  local endpoint="$1" region="$2" bucket="$3" key="$4" version="$5" expected_sha="$6"
  local proof_dir fifo digest_file reader_pid aws_status reader_status actual_sha
  proof_dir="$(mktemp -d /run/leaddrive-log-genesis-proof.XXXXXX)" \
    || fatal "cannot create tmpfs log-genesis body proof directory"
  [ "$(findmnt -n -o FSTYPE --target "$proof_dir" 2>/dev/null || true)" = tmpfs ] \
    || { rmdir -- "$proof_dir"; fatal "log-genesis body proof directory is not tmpfs"; }
  fifo="$proof_dir/object.pipe"
  digest_file="$proof_dir/object.sha256"
  mkfifo -m 0600 -- "$fifo" \
    || { rmdir -- "$proof_dir"; fatal "cannot create log-genesis body proof pipe"; }
  sha256sum "$fifo" >"$digest_file" &
  reader_pid=$!
  set +e
  run_pinned_backup_aws 1800 s3api get-object \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --bucket "$bucket" --key "$key" --version-id="$version" "$fifo" >/dev/null
  aws_status=$?
  set -e
  if [ "$aws_status" -ne 0 ]; then
    kill "$reader_pid" >/dev/null 2>&1 || true
    wait "$reader_pid" >/dev/null 2>&1 || true
    rm -f -- "$fifo" "$digest_file"
    rmdir -- "$proof_dir" || true
    fatal "cannot stream the exact remote log-genesis object version for body proof"
  fi
  set +e
  wait "$reader_pid"
  reader_status=$?
  set -e
  actual_sha="$(awk 'NR == 1 { print $1 }' "$digest_file" 2>/dev/null || true)"
  rm -f -- "$fifo" "$digest_file"
  rmdir -- "$proof_dir" \
    || fatal "cannot remove tmpfs log-genesis body proof directory"
  [ "$reader_status" -eq 0 ] && [ "$actual_sha" = "$expected_sha" ] \
    || fatal "exact remote log-genesis body digest differs from its durable transaction"
}

validate_active_log_ship_state() {
  local state_dir="/var/lib/leaddrive-log-ship"
  local state_file="$state_dir/log-ship-offsets"
  local active_script="$OPS_CURRENT_LINK/backup/ship-logs.sh"
  local program_record="$OPS_CURRENT_LINK/recovery-program-set.sha256"
  local state_bytes state_rows state_script_sha state_program_sha active_script_sha active_program_sha
  local unit cursor retained journal_status terminal_line
  local evidence_start evidence_key evidence_version evidence_sha
  local anchor_status anchor_start anchor_key anchor_deploy_sha anchor_program anchor_version anchor_sha
  local anchor_bytes anchor_format anchor_ranges anchor_file_count anchor_file_bytes anchor_journal_count
  local anchor_cursor anchor_created endpoint region bucket retention_days head_state retention_state
  local remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges
  local remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_created
  local retention_mode retention_until retention_epoch minimum_retention_epoch start_epoch created_epoch now_epoch
  local expected_units="leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service"

  validate_log_evidence_genesis_anchor_file
  anchor_status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)"
  anchor_start="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT)"
  anchor_key="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)"
  anchor_deploy_sha="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)"
  anchor_program="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)"

  [ -d "$state_dir" ] && [ ! -L "$state_dir" ] \
    && [ "$(realpath -e -- "$state_dir")" = "$state_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$state_dir" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:750 ] \
    && [ -f "$state_file" ] && [ ! -L "$state_file" ] \
    && [ "$(realpath -e -- "$state_file" 2>/dev/null || true)" = "$state_file" ] \
    && [ "$(stat -c '%U:%G:%a' "$state_file" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600 ] || \
    fatal "active log-shipping cursor authority is missing or unsafe"
  state_bytes="$(wc -c <"$state_file" | tr -d '[:space:]')"
  state_rows="$(wc -l <"$state_file" | tr -d '[:space:]')"
  [[ "$state_bytes" =~ ^[0-9]+$ ]] && [ "$state_bytes" -le 4194304 ] \
    && [[ "$state_rows" =~ ^[0-9]+$ ]] && [ "$state_rows" -le 100000 ] || \
    fatal "active log-shipping cursor exceeds the reviewed bound"
  awk -F '\t' -v expected="$expected_units" -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    BEGIN { count=split(expected, units, " "); for (i=1; i<=count; i++) allowed[units[i]]=1 }
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 !~ /^SHIP_LOGS_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 3 { if ($0 !~ /^RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 4 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
    NR == 5 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\// || length($0) > 1200) bad=1; next }
    NR == 6 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=[-A-Za-z0-9._~+\/=]+$/ || $0 ~ /=None$/ || $0 ~ /=null$/ || length($0) > 1100) bad=1; next }
    NR == 7 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_SHA256=[0-9a-f]{64}$/) bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || $2 !~ reviewed ||
          $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ ||
          $6 !~ /^[0-9]+$/ || $7 !~ /^[0-9a-f]{64}$/ ||
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
  ' "$state_file" || fatal "active log-shipping cursor is malformed, incomplete, or duplicated"
  state_script_sha="$(read_static_env_value "$state_file" SHIP_LOGS_SHA256)" || \
    fatal "active log cursor contains duplicate script identity"
  state_program_sha="$(read_static_env_value "$state_file" RECOVERY_PROGRAM_SET_SHA256)" || \
    fatal "active log cursor contains duplicate recovery-program identity"
  active_script_sha="$(sha256sum "$active_script" | awk '{print $1}')"
  active_program_sha="$(tr -d '\r\n' <"$program_record")"
  [ "$state_script_sha" = "$active_script_sha" ] \
    && [ "$state_program_sha" = "$active_program_sha" ] \
    || fatal "active log cursor was not committed by this immutable operations release"
  evidence_start="$(read_static_env_value "$state_file" LOG_EVIDENCE_START_AT)" \
    || fatal "active log cursor has a duplicate evidence-start watermark"
  evidence_key="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_KEY)" \
    || fatal "active log cursor has a duplicate first-object key"
  evidence_version="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)" \
    || fatal "active log cursor has a duplicate first-object version"
  evidence_sha="$(read_static_env_value "$state_file" LOG_EVIDENCE_FIRST_OBJECT_SHA256)" \
    || fatal "active log cursor has a duplicate first-object digest"
  [[ "$evidence_start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [[ "$evidence_key" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$ ]] \
    && [[ "$evidence_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [ "$evidence_version" != None ] && [ "$evidence_version" != null ] \
    && [[ "$evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "active log cursor has a malformed immutable evidence authority"
  [ "$evidence_start" = "$anchor_start" ] && [ "$evidence_key" = "$anchor_key" ] \
    || fatal "active log cursor diverges from the root genesis start/key authority"
  validate_log_bootstrap_transaction "$state_file" "$active_script_sha" "$active_program_sha" \
    "$evidence_start" "$evidence_key" "$evidence_version" "$evidence_sha"
  if [ "$anchor_status" = PENDING ]; then
    [ "$anchor_deploy_sha" = "$DEPLOY_SHA" ] && [ "$anchor_program" = "$active_program_sha" ] \
      || fatal "pending root log genesis is not bound to this deployment/program"
    [ "$LOG_BOOTSTRAP_TX_PRESENT" = true ] \
      || fatal "pending root log genesis has no complete durable bootstrap transaction"
  else
    anchor_version="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)"
    anchor_sha="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_SHA256)"
    anchor_bytes="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_BYTES)"
    anchor_format="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_OBJECT_FORMAT_VERSION)"
    anchor_ranges="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RANGES_SHA256)"
    anchor_file_count="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_COUNT)"
    anchor_file_bytes="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_BYTES)"
    anchor_journal_count="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_JOURNAL_RANGE_COUNT)"
    anchor_cursor="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_CURSOR_SHA256)"
    anchor_created="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" OBJECT_CREATED_AT)"
    [ "$evidence_version" = "$anchor_version" ] && [ "$evidence_sha" = "$anchor_sha" ] \
      || fatal "active log cursor diverges from the committed root object authority"
  fi

  endpoint="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_ENDPOINT)" \
    || fatal "backup environment has no unique S3 endpoint for log-genesis proof"
  region="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_REGION)" \
    || fatal "backup environment has no unique S3 region for log-genesis proof"
  bucket="$(read_static_env_value /etc/leaddrive/backup.env BACKUP_S3_BUCKET)" \
    || fatal "backup environment has no unique S3 bucket for log-genesis proof"
  retention_days="$(read_static_env_value /etc/leaddrive/backup.env LOG_SHIP_RETENTION_DAYS)" \
    || fatal "backup environment has no unique log retention policy"
  [[ "$retention_days" =~ ^[0-9]+$ ]] && [ "$retention_days" -ge 400 ] \
    || fatal "log retention policy is below the reviewed minimum"
  head_state="$(run_pinned_backup_aws 45 s3api head-object \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --bucket "$bucket" --key "$evidence_key" --version-id="$evidence_version" \
    --query '[ContentLength,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256,LastModified]' \
    --output text)" || fatal "cannot prove the exact first log-evidence object version"
  read -r remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges \
    remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_created <<<"$head_state"
  start_epoch="$(date -u -d "$evidence_start" '+%s' 2>/dev/null || true)"
  created_epoch="$(date -u -d "$remote_created" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  [[ "$remote_bytes" =~ ^[1-9][0-9]*$ ]] && [ "$remote_bytes" -le 2199023255552 ] \
    && [ "$remote_sha" = "$evidence_sha" ] && [ "$remote_format" = 4 ] \
    && [ "$remote_start" = "$evidence_start" ] && [ "$remote_bootstrap" = 1 ] \
    && [ "$remote_program" = "$anchor_program" ] \
    && [[ "$remote_ranges" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$remote_file_count" =~ ^[0-9]+$ ]] && [ "$remote_file_count" -le 100000 ] \
    && [[ "$remote_file_bytes" =~ ^[0-9]+$ ]] && [ "$remote_file_bytes" -le 1099511627776 ] \
    && [[ "$remote_journal_count" =~ ^[0-9]+$ ]] && [ "$remote_journal_count" -le 1000 ] \
    && [ $((remote_file_count + remote_journal_count)) -ge 1 ] \
    && [[ "$remote_cursor" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$start_epoch" =~ ^[0-9]+$ ]] && [[ "$created_epoch" =~ ^[0-9]+$ ]] \
    && [ "$created_epoch" -ge $((start_epoch - 60)) ] \
    && [ "$created_epoch" -le $((now_epoch + 300)) ] \
    || fatal "first log-evidence object metadata or creation authority is invalid"
  retention_state="$(run_pinned_backup_aws 45 s3api get-object-retention \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --bucket "$bucket" --key "$evidence_key" --version-id="$evidence_version" \
    --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)" \
    || fatal "cannot prove first log-evidence COMPLIANCE retention"
  read -r retention_mode retention_until <<<"$retention_state"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)"
  minimum_retention_epoch="$(date -u -d "+$((retention_days - 30)) days" '+%s' 2>/dev/null || true)"
  [ "$retention_mode" = COMPLIANCE ] && [[ "$retention_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$minimum_retention_epoch" =~ ^[0-9]+$ ]] \
    && [ "$retention_epoch" -ge "$minimum_retention_epoch" ] \
    || fatal "first log-evidence version is below the rolling COMPLIANCE retention horizon"
  if [ "$anchor_status" = COMMITTED ]; then
    [ "$remote_bytes" = "$anchor_bytes" ] && [ "$remote_format" = "$anchor_format" ] \
      && [ "$remote_ranges" = "$anchor_ranges" ] \
      && [ "$remote_file_count" = "$anchor_file_count" ] \
      && [ "$remote_file_bytes" = "$anchor_file_bytes" ] \
      && [ "$remote_journal_count" = "$anchor_journal_count" ] \
      && [ "$remote_cursor" = "$anchor_cursor" ] \
      && [ "$remote_created" = "$anchor_created" ] \
      || fatal "remote genesis metadata diverges from the committed root anchor"
  fi
  if [ "$LOG_BOOTSTRAP_TX_PRESENT" = true ]; then
    [ "$remote_bytes" = "$LOG_BOOTSTRAP_TX_CIPHERTEXT_BYTES" ] \
      && [ "$remote_sha" = "$LOG_BOOTSTRAP_TX_CIPHERTEXT_SHA256" ] \
      && [ "$remote_ranges" = "$LOG_BOOTSTRAP_TX_RANGES_SHA256" ] \
      && [ "$remote_file_count" = "$LOG_BOOTSTRAP_TX_FILE_RANGE_COUNT" ] \
      && [ "$remote_file_bytes" = "$LOG_BOOTSTRAP_TX_FILE_RANGE_BYTES" ] \
      && [ "$remote_journal_count" = "$LOG_BOOTSTRAP_TX_JOURNAL_RANGE_COUNT" ] \
      && [ "$remote_cursor" = "$LOG_BOOTSTRAP_TX_CURSOR_SHA256" ] \
      || fatal "remote log genesis metadata diverges from its durable transaction"
    prove_remote_log_genesis_body "$endpoint" "$region" "$bucket" \
      "$evidence_key" "$evidence_version" "$LOG_BOOTSTRAP_TX_CIPHERTEXT_SHA256"
  fi
  LOG_GENESIS_REMOTE_BYTES="$remote_bytes"
  LOG_GENESIS_REMOTE_SHA256="$remote_sha"
  LOG_GENESIS_REMOTE_FORMAT="$remote_format"
  LOG_GENESIS_REMOTE_RANGES_SHA256="$remote_ranges"
  LOG_GENESIS_REMOTE_FILE_RANGE_COUNT="$remote_file_count"
  LOG_GENESIS_REMOTE_FILE_RANGE_BYTES="$remote_file_bytes"
  LOG_GENESIS_REMOTE_JOURNAL_RANGE_COUNT="$remote_journal_count"
  LOG_GENESIS_REMOTE_CURSOR_SHA256="$remote_cursor"
  LOG_GENESIS_REMOTE_CREATED_AT="$remote_created"
  LOG_GENESIS_REMOTE_VERSION_ID="$evidence_version"
  LOG_GENESIS_REMOTE_START_AT="$evidence_start"
  LOG_GENESIS_REMOTE_KEY="$evidence_key"
  for unit in $expected_units; do
    cursor="$(awk -F '\t' -v want="$unit" '$1 == "JOURNAL" && $2 == want { print $3 }' "$state_file")"
    set +e
    if [ "$cursor" = NO_CURSOR ]; then
      retained="$(LC_ALL=C journalctl -q -u "$unit" -n 1 --show-cursor --no-pager 2>&1)"
      journal_status=$?
      set -e
      [ "$journal_status" -eq 0 ] && [ "$retained" = "-- No entries --" ] \
        || fatal "active log cursor has not captured retained journal evidence for $unit"
      continue
    fi
    retained="$(LC_ALL=C journalctl -q -u "$unit" --after-cursor="$cursor" \
      --show-cursor --no-pager 2>&1)"
    journal_status=$?
    set -e
    terminal_line="$(printf '%s\n' "$retained" | tail -n 1)"
    [ "$journal_status" -eq 0 ] \
      && [[ "$terminal_line" =~ ^--\ cursor:\ [!-~]{1,2048}$ ]] \
      || fatal "active log cursor is no longer seekable for $unit"
  done
}

commit_log_evidence_genesis_anchor() {
  local status start_at object_key deploy_sha program_sha pending_sha stage

  validate_log_evidence_genesis_anchor_file
  status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)"
  [ "$status" = PENDING ] \
    || fatal "only a pending log-evidence genesis anchor may be committed"
  [ "$LOG_BOOTSTRAP_TX_PRESENT" = true ] \
    || fatal "log-evidence genesis cannot commit without a validated durable transaction"
  [ "$LOG_GENESIS_REMOTE_SHA256" = "$LOG_BOOTSTRAP_TX_CIPHERTEXT_SHA256" ] \
    && [ "$LOG_GENESIS_REMOTE_BYTES" = "$LOG_BOOTSTRAP_TX_CIPHERTEXT_BYTES" ] \
    && [ "$LOG_GENESIS_REMOTE_CURSOR_SHA256" = "$LOG_BOOTSTRAP_TX_CURSOR_SHA256" ] \
    || fatal "log-evidence genesis remote proof is incomplete before commit"
  start_at="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT)"
  object_key="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)"
  deploy_sha="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)"
  program_sha="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)"
  pending_sha="$(sha256sum "$LOG_EVIDENCE_GENESIS_ANCHOR" | awk '{print $1}')"
  stage="$(mktemp "$BACKUP_EVIDENCE_ROOT/.log-evidence-genesis.commit.XXXXXX")" \
    || fatal "cannot stage committed root log-evidence genesis anchor"
  printf '%s\n' \
    'FORMAT_VERSION=1' \
    'STATUS=COMMITTED' \
    "LOG_EVIDENCE_START_AT=$start_at" \
    "LOG_EVIDENCE_FIRST_OBJECT_KEY=$object_key" \
    "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=$LOG_GENESIS_REMOTE_VERSION_ID" \
    "LOG_EVIDENCE_FIRST_OBJECT_SHA256=$LOG_GENESIS_REMOTE_SHA256" \
    "LOG_EVIDENCE_FIRST_OBJECT_BYTES=$LOG_GENESIS_REMOTE_BYTES" \
    "LOG_EVIDENCE_OBJECT_FORMAT_VERSION=$LOG_GENESIS_REMOTE_FORMAT" \
    "BOOTSTRAP_DEPLOY_SHA=$deploy_sha" \
    "BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=$program_sha" \
    "BOOTSTRAP_RANGES_SHA256=$LOG_GENESIS_REMOTE_RANGES_SHA256" \
    "BOOTSTRAP_FILE_RANGE_COUNT=$LOG_GENESIS_REMOTE_FILE_RANGE_COUNT" \
    "BOOTSTRAP_FILE_RANGE_BYTES=$LOG_GENESIS_REMOTE_FILE_RANGE_BYTES" \
    "BOOTSTRAP_JOURNAL_RANGE_COUNT=$LOG_GENESIS_REMOTE_JOURNAL_RANGE_COUNT" \
    "BOOTSTRAP_CURSOR_SHA256=$LOG_GENESIS_REMOTE_CURSOR_SHA256" \
    "OBJECT_CREATED_AT=$LOG_GENESIS_REMOTE_CREATED_AT" \
    >"$stage"
  chown root:root "$stage"
  chmod 0600 "$stage"
  sync -f -- "$stage" "$BACKUP_EVIDENCE_ROOT" \
    || { rm -f -- "$stage"; fatal "cannot persist staged committed log-evidence anchor"; }
  [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS 2>/dev/null || true)" = PENDING ] \
    && [ "$(sha256sum "$LOG_EVIDENCE_GENESIS_ANCHOR" 2>/dev/null | awk '{print $1}')" = "$pending_sha" ] \
    || { rm -f -- "$stage"; fatal "pending log-evidence anchor changed during promotion"; }
  mv -Tf -- "$stage" "$LOG_EVIDENCE_GENESIS_ANCHOR" \
    || fatal "cannot atomically promote root log-evidence genesis anchor"
  sync -f -- "$LOG_EVIDENCE_GENESIS_ANCHOR" "$BACKUP_EVIDENCE_ROOT" \
    || fatal "cannot persist committed root log-evidence genesis anchor"
  validate_log_evidence_genesis_anchor_file
  [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)" = COMMITTED ] \
    || fatal "root log-evidence genesis promotion did not commit"
}

cleanup_log_bootstrap_transaction() {
  local transaction_dir="$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION"
  local tombstone="$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE"
  local lock_file="/var/lib/leaddrive-recovery-runner-locks/log-ship.lock"
  local lock_fd members member nested_mount

  validate_log_evidence_genesis_anchor_file
  [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)" = COMMITTED ] \
    || fatal "durable log-bootstrap transaction may only be cleaned after root commit"
  systemctl is-active --quiet leaddrive-log-ship.service \
    && fatal "cannot clean log-bootstrap transaction while the service is active" \
    || true
  systemctl is-active --quiet leaddrive-log-ship.timer \
    && fatal "cannot clean log-bootstrap transaction while the timer is active" \
    || true
  [ -f "$lock_file" ] && [ ! -L "$lock_file" ] \
    && [ "$(realpath -e -- "$lock_file" 2>/dev/null || true)" = "$lock_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$lock_file" 2>/dev/null || true)" = root:leaddrive-backup:660:1 ] \
    || fatal "log runner lock authority is unsafe before bootstrap cleanup"
  exec {lock_fd}<"$lock_file"
  flock -n "$lock_fd" \
    || fatal "log runner lock is busy during bootstrap cleanup"
  if [ -e "$transaction_dir" ] || [ -L "$transaction_dir" ]; then
    [ "$LOG_BOOTSTRAP_TX_PRESENT" = true ] \
      || fatal "published log-bootstrap transaction was not independently validated"
    [ ! -e "$tombstone" ] && [ ! -L "$tombstone" ] \
      || fatal "published and committed log-bootstrap transaction directories coexist"
    mv -T -- "$transaction_dir" "$tombstone" \
      || fatal "cannot atomically retire committed log-bootstrap transaction"
    sync -f -- "$tombstone" "$LOG_EVIDENCE_STATE_DIR" \
      || fatal "cannot persist committed log-bootstrap transaction retirement"
  fi
  if [ -e "$tombstone" ] || [ -L "$tombstone" ]; then
    [ -d "$tombstone" ] && [ ! -L "$tombstone" ] \
      && [ "$(realpath -e -- "$tombstone" 2>/dev/null || true)" = "$tombstone" ] \
      && [ "$(stat -c '%U:%G:%a' "$tombstone" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:700 ] \
      || fatal "committed log-bootstrap tombstone is unsafe"
    nested_mount="$(findmnt -rn -o TARGET | awk -v root="$tombstone/" 'index($0, root) == 1 { print; exit }')"
    [ -z "$nested_mount" ] \
      || fatal "committed log-bootstrap tombstone contains a nested mount"
    members="$(find "$tombstone" -xdev -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" \
      || fatal "cannot inventory committed log-bootstrap tombstone"
    [ -z "$(find "$tombstone" -xdev -mindepth 2 -print -quit)" ] \
      || fatal "committed log-bootstrap tombstone contains nested members"
    while IFS= read -r member; do
      [ -n "$member" ] || continue
      case "$member" in
        offsets.next|payload.age|transaction.env) ;;
        *) fatal "committed log-bootstrap tombstone contains an unexpected member" ;;
      esac
      [ -f "$tombstone/$member" ] && [ ! -L "$tombstone/$member" ] \
        && [ "$(realpath -e -- "$tombstone/$member" 2>/dev/null || true)" = "$tombstone/$member" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$tombstone/$member" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600:1 ] \
        || fatal "committed log-bootstrap tombstone member is unsafe"
    done <<<"$members"
    for member in transaction.env offsets.next payload.age; do
      [ ! -e "$tombstone/$member" ] && [ ! -L "$tombstone/$member" ] \
        || rm -f -- "$tombstone/$member" \
        || fatal "cannot unlink committed log-bootstrap tombstone member"
    done
    rmdir -- "$tombstone" \
      || fatal "cannot remove empty committed log-bootstrap tombstone"
    sync -f -- "$LOG_EVIDENCE_STATE_DIR" \
      || fatal "cannot persist committed log-bootstrap tombstone cleanup"
  fi
  exec {lock_fd}<&-
  LOG_BOOTSTRAP_TX_PRESENT=false
  LOG_BOOTSTRAP_TX_PAYLOAD=""
}

validate_unpublished_log_bootstrap_preparing() {
  local active_script active_script_sha active_program_sha anchor_start anchor_key

  [ -e "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
    || [ -L "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
    || return 0
  [ -x "$OPS_CURRENT_LINK/backup/ship-logs.sh" ] \
    || fatal "cannot validate prepared log bootstrap without its active operations release"
  active_script="$OPS_CURRENT_LINK/backup/ship-logs.sh"
  active_script_sha="$(sha256sum "$active_script" | awk '{print $1}')"
  active_program_sha="$(tr -d '\r\n' <"$OPS_CURRENT_LINK/recovery-program-set.sha256")"
  anchor_start="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT)"
  anchor_key="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)"
  # A complete, fsynced .preparing directory is safe to let the same shipper
  # atomically publish and resume.  Any partial stage fails closed: deleting it
  # while retaining the old root start watermark could hide logs that rotated
  # or were vacuumed after the frozen slice was created.
  validate_log_bootstrap_transaction "$LOG_EVIDENCE_STATE_FILE" \
    "$active_script_sha" "$active_program_sha" "$anchor_start" "$anchor_key" \
    PENDING '' "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" 0
  LOG_BOOTSTRAP_TX_PRESENT=false
  LOG_BOOTSTRAP_TX_PAYLOAD=""
  log "Validated complete unpublished log-bootstrap staging for exact resume"
}

reconcile_log_genesis_before_operations_switch() {
  local status pending_deploy

  if [ ! -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] && [ ! -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ]; then
    if [ -e "$LOG_EVIDENCE_STATE_FILE" ] || [ -L "$LOG_EVIDENCE_STATE_FILE" ]; then
      [ -f "$LOG_EVIDENCE_STATE_FILE" ] && [ ! -L "$LOG_EVIDENCE_STATE_FILE" ] \
        && [ "$(realpath -e -- "$LOG_EVIDENCE_STATE_FILE" 2>/dev/null || true)" = "$LOG_EVIDENCE_STATE_FILE" ] \
        && [ "$(stat -c '%U:%G:%a:%h' "$LOG_EVIDENCE_STATE_FILE" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600:1 ] \
        && [ ! -s "$LOG_EVIDENCE_STATE_FILE" ] \
        || fatal "nonempty or unsafe legacy log cursor has no root genesis anchor; explicit discontinuity approval is required"
    fi
    [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] \
      && [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
      && [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ] \
      || fatal "log-bootstrap transaction exists without root genesis authority"
    systemctl is-enabled --quiet leaddrive-log-ship.timer \
      && fatal "first root-anchored cutover requires the legacy log timer to be disabled before deployment" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.timer \
      && fatal "first root-anchored cutover requires the legacy log timer to be inactive before deployment" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.service \
      && fatal "first root-anchored cutover cannot begin while the legacy log service is active" \
      || true
    return 0
  fi
  validate_log_evidence_genesis_anchor_file
  status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)"
  if [ "$status" = PENDING ]; then
    # The journal is written before a PENDING anchor. If it is absent, changed,
    # or not in its durable genesis phase, there is no safe rollback baseline
    # nor proof that this host still owns the exact operations release. Do not
    # treat a bare PENDING anchor as a fresh bootstrap or a normal deployment.
    [ "$DEPLOY_MODE" = recovery-bootstrap-resume ] \
      && [ "$GENESIS_ACTIVATION_DURABLE" = true ] || \
      fatal "pending root log genesis requires its exact durable genesis-pending journal and bootstrap-resume mode"
    pending_deploy="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)"
    [ "$pending_deploy" = "$DEPLOY_SHA" ] \
      || fatal "pending log genesis belongs to another release; redeploy that exact SHA before advancing main"
    [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ] \
      || fatal "pending root log genesis coexists with a committed tombstone"
    systemctl is-enabled --quiet leaddrive-log-ship.timer \
      && fatal "pending root log genesis must keep the log timer disabled" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.timer \
      && fatal "pending root log genesis must keep the log timer inactive" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.service \
      && fatal "pending root log genesis cannot be reconciled while the service is active" \
      || true
    validate_unpublished_log_bootstrap_preparing
    return 0
  fi
  [ ! -e "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] && [ ! -L "$LOG_EVIDENCE_BOOTSTRAP_PREPARING" ] \
    || fatal "committed root log genesis coexists with an incomplete preparing transaction"
  if [ -e "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] || [ -L "$LOG_EVIDENCE_BOOTSTRAP_TRANSACTION" ] \
      || [ -e "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ] || [ -L "$LOG_EVIDENCE_BOOTSTRAP_TOMBSTONE" ]; then
    systemctl is-active --quiet leaddrive-log-ship.timer \
      && fatal "committed bootstrap cleanup requires the log timer to remain inactive" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.service \
      && fatal "committed bootstrap cleanup cannot run while the service is active" \
      || true
    [ -x "$OPS_CURRENT_LINK/backup/ship-logs.sh" ] \
      || fatal "cannot reconcile committed bootstrap transaction without the active operations release"
    validate_active_log_ship_state
    cleanup_log_bootstrap_transaction
    validate_active_log_ship_state
  fi
}

validate_staged_operations_systemd_units() {
  local release_root="$1"
  local stage unit source rendered script

  # The release-owned service units intentionally execute through the stable
  # `current` pointer.  On the first installation that pointer does not exist
  # yet, so validating the literal unit files would incorrectly reject their
  # otherwise present staged executables.  Render only ephemeral validation
  # copies against this immutable release; the real unit files remain pointed
  # at `current` and are re-validated after the journalled pointer switch.
  stage="$(mktemp -d "$OPS_ROOT/.systemd-verify-${DEPLOY_SHA}.XXXXXX")" || \
    fatal "cannot create staged systemd validation directory"
  for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
    source="$release_root/systemd/$unit"
    rendered="$stage/$unit"
    case "$unit" in
      leaddrive-log-ship.service) script="ship-logs.sh" ;;
      leaddrive-postgres-backup.service) script="postgres-backup.sh" ;;
      leaddrive-runtime-files-snapshot.service) script="snapshot-runtime-files.sh" ;;
      leaddrive-secrets-snapshot.service) script="snapshot-secrets.sh" ;;
      *.timer)
        install -m 0644 -- "$source" "$rendered" || {
          rm -rf -- "$stage"
          fatal "cannot stage immutable operations timer for systemd validation: $unit"
        }
        continue
        ;;
      *)
        rm -rf -- "$stage"
        fatal "unexpected immutable operations systemd unit: $unit"
        ;;
    esac

    # Do not permit an accidental SHA-bound or checkout-bound service path.
    # Each service has exactly one expected ExecStart and only that literal
    # stable-pointer path is rebound in the throwaway validation copy.
    if ! awk \
      -v expected="ExecStart=$OPS_CURRENT_LINK/backup/$script" \
      -v replacement="ExecStart=$release_root/backup/$script" '
        $0 == expected { matches += 1; print replacement; next }
        /^[[:space:]]*ExecStart[[:space:]]*=/ { unexpected += 1 }
        { print }
        END { exit matches != 1 || unexpected != 0 }
      ' "$source" > "$rendered"; then
      rm -rf -- "$stage"
      fatal "immutable operations service must contain exactly one stable-pointer ExecStart: $unit"
    fi
    chmod 0644 -- "$rendered" || {
      rm -rf -- "$stage"
      fatal "cannot secure staged immutable operations service validation copy: $unit"
    }
  done

  if ! systemd-analyze verify "${OPERATIONS_SYSTEMD_UNITS[@]/#/$stage/}"; then
    rm -rf -- "$stage"
    fatal "staged systemd unit validation failed for the immutable operations release"
  fi
  rm -rf -- "$stage" || fatal "cannot remove staged systemd validation directory"
}

capture_root_crontab() {
  local destination="$1"
  local label="$2"
  local stderr_file="${destination}.stderr"

  if ! crontab -l > "$destination" 2>"$stderr_file"; then
    if grep -qiE 'no crontab for' "$stderr_file"; then
      : > "$destination"
    else
      fatal "cannot read root crontab for $label"
    fi
  fi
  rm -f -- "$stderr_file"
}

capture_root_crontab_for_rollback() {
  local destination="$1"
  local stderr_file="${destination}.stderr"

  if ! crontab -l > "$destination" 2>"$stderr_file"; then
    if grep -qiE 'no crontab for' "$stderr_file"; then
      : > "$destination"
    else
      rm -f -- "$stderr_file"
      return 1
    fi
  fi
  rm -f -- "$stderr_file"
}

prepare_operations_crontab_rollback() {
  OPERATIONS_CRONTAB_BEFORE="$BACKUP_PATH/root-crontab.before-operations-release"
  capture_root_crontab "$OPERATIONS_CRONTAB_BEFORE" "immutable operations activation"
  OPERATIONS_CRONTAB_EXPECTED="$OPERATIONS_CRONTAB_BEFORE"
}

write_operations_activation_journal() {
  local phase="$1"
  local stage

  case "$phase" in
    system-config-intent|pointer-intent|pointer-switched|genesis-pending|cron-migration-intent|\
    cron-migration-applied|resilience-intent|resilience-applied|finalized) ;;
    *) fatal "invalid immutable operations activation journal phase: $phase" ;;
  esac
  [ "$OPERATIONS_ACTIVATION_STARTED" = "true" ] || \
    fatal "cannot journal an operations activation before it starts"
  [ -n "${BACKUP_PATH:-}" ] && [ -d "$BACKUP_PATH" ] || \
    fatal "cannot journal operations activation without its deployment backup"
  [ -n "$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT" ] || \
    fatal "cannot journal operations activation without an immutable release root"
  assert_root_owned_nonwritable_directory "immutable operations root" "$OPS_ROOT"
  assert_root_owned_nonwritable_directory "operations activation backup" "$BACKUP_PATH"
  assert_secure_operations_tree "journaled immutable operations release" "$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT"

  stage="$(mktemp "$OPS_ROOT/.activation-journal.XXXXXX")" || \
    fatal "cannot stage immutable operations activation journal"
  if ! {
    printf 'version=1\n'
    printf 'phase=%s\n' "$phase"
    printf 'backup_path=%s\n' "$BACKUP_PATH"
    printf 'release_root=%s\n' "$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT"
    printf 'pointer_previous_target=%s\n' "$OPS_CURRENT_PREVIOUS_TARGET"
    printf 'pointer_new_target=%s\n' "$OPS_CURRENT_NEW_TARGET"
    printf 'pointer_switch_intent=%s\n' "$OPS_POINTER_SWITCH_INTENT"
    printf 'pointer_switched=%s\n' "$OPS_CURRENT_SWITCHED"
    printf 'system_config_applied=%s\n' "$OPERATIONS_SYSTEM_CONFIG_APPLIED"
    printf 'cron_before=%s\n' "$OPERATIONS_CRONTAB_BEFORE"
    printf 'cron_expected=%s\n' "$OPERATIONS_CRONTAB_EXPECTED"
    printf 'cron_intent=%s\n' "$OPERATIONS_CRONTAB_INTENT"
    printf 'cron_mutated=%s\n' "$OPERATIONS_CRONTAB_MUTATED"
  } > "$stage" \
    || ! chmod 0600 "$stage" \
    || ! sync -f -- "$stage" \
    || ! mv -Tf -- "$stage" "$OPS_ACTIVATION_JOURNAL"; then
    rm -f -- "$stage"
    fatal "cannot atomically write immutable operations activation journal"
  fi
  [ -f "$OPS_ACTIVATION_JOURNAL" ] && [ ! -L "$OPS_ACTIVATION_JOURNAL" ] \
    && [ "$(stat -c '%U:%G:%a' "$OPS_ACTIVATION_JOURNAL")" = "root:root:600" ] || \
    fatal "immutable operations activation journal did not become root-only"
  sync -f -- "$OPS_ACTIVATION_JOURNAL" "$OPS_ROOT" || \
    fatal "cannot persist immutable operations activation journal before continuing"
}

clear_operations_activation_journal() {
  if [ ! -e "$OPS_ACTIVATION_JOURNAL" ] && [ ! -L "$OPS_ACTIVATION_JOURNAL" ]; then
    return 0
  fi
  if [ ! -f "$OPS_ACTIVATION_JOURNAL" ] || [ -L "$OPS_ACTIVATION_JOURNAL" ] \
    || [ "$(stat -c '%U:%G:%a' "$OPS_ACTIVATION_JOURNAL" 2>/dev/null)" != "root:root:600" ]; then
    log "FATAL: immutable operations activation journal changed outside this deployment; refusing to remove it"
    return 1
  fi
  if ! unlink -- "$OPS_ACTIVATION_JOURNAL" \
    || [ -e "$OPS_ACTIVATION_JOURNAL" ] || [ -L "$OPS_ACTIVATION_JOURNAL" ]; then
    log "FATAL: cannot remove completed immutable operations activation journal"
    return 1
  fi
  if ! sync -f -- "$OPS_ROOT"; then
    log "FATAL: cannot persist immutable operations activation journal removal"
    return 1
  fi
}

operations_activation_boolean_is_valid() {
  [ "$1" = "true" ] || [ "$1" = "false" ]
}

assert_operations_activation_release_path() {
  local label="$1"
  local value="$2"
  local canonical leaf

  [ -n "$value" ] || fatal "$label is empty in the immutable operations activation journal"
  canonical="$(realpath -e -- "$value")" || \
    fatal "$label cannot be resolved from the immutable operations activation journal"
  [ "$canonical" = "$value" ] || \
    fatal "$label must be canonical in the immutable operations activation journal"
  case "$canonical" in
    "$OPS_RELEASES_DIR"/*) ;;
    *) fatal "$label is outside the immutable operations release root" ;;
  esac
  leaf="${canonical#"$OPS_RELEASES_DIR"/}"
  [[ "$leaf" =~ ^[0-9a-f]{40}$ ]] || \
    fatal "$label is not a SHA-named immutable operations release"
  assert_secure_operations_tree "$label" "$canonical"
}

assert_operations_activation_crontab_snapshot() {
  local label="$1"
  local value="$2"
  local allow_missing="$3"
  local canonical leaf

  [ -n "$value" ] || fatal "$label is empty in the immutable operations activation journal"
  canonical="$(realpath -m -- "$value")" || \
    fatal "$label cannot be canonicalized from the immutable operations activation journal"
  [ "$canonical" = "$value" ] || \
    fatal "$label must be canonical in the immutable operations activation journal"
  case "$canonical" in
    "$BACKUP_PATH"/root-crontab.*) ;;
    *) fatal "$label is outside this activation backup" ;;
  esac
  leaf="${canonical#"$BACKUP_PATH"/}"
  case "$leaf" in
    */*|root-crontab.) fatal "$label has an unsafe activation-backup name" ;;
  esac

  if [ -e "$canonical" ] || [ -L "$canonical" ]; then
    assert_root_owned_nonwritable_file "$label" "$canonical"
  elif [ "$allow_missing" != "true" ]; then
    fatal "$label is missing from the immutable operations activation backup"
  fi
}

validate_operations_system_config_snapshot() {
  local unit rotate state state_file snapshot timer states_count

  [ -d "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR" ] && [ ! -L "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR" ] || \
    fatal "operations system configuration recovery snapshot is missing"
  assert_secure_operations_tree \
    "operations system configuration recovery snapshot" \
    "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR"

  for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
    state_file="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/systemd/$unit.state"
    snapshot="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/systemd/$unit"
    [ -f "$state_file" ] && [ ! -L "$state_file" ] || \
      fatal "operations systemd recovery state is missing for $unit"
    IFS= read -r state < "$state_file" || fatal "cannot read operations systemd recovery state for $unit"
    case "$state" in
      present) assert_root_owned_nonwritable_file "operations systemd recovery snapshot for $unit" "$snapshot" ;;
      absent) [ ! -e "$snapshot" ] && [ ! -L "$snapshot" ] || \
        fatal "operations systemd recovery snapshot unexpectedly exists for $unit" ;;
      *) fatal "invalid operations systemd recovery state for $unit" ;;
    esac
  done
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    state_file="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/logrotate/$rotate.state"
    snapshot="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/logrotate/$rotate"
    [ -f "$state_file" ] && [ ! -L "$state_file" ] || \
      fatal "operations logrotate recovery state is missing for $rotate"
    IFS= read -r state < "$state_file" || fatal "cannot read operations logrotate recovery state for $rotate"
    case "$state" in
      present) assert_root_owned_nonwritable_file "operations logrotate recovery snapshot for $rotate" "$snapshot" ;;
      absent) [ ! -e "$snapshot" ] && [ ! -L "$snapshot" ] || \
        fatal "operations logrotate recovery snapshot unexpectedly exists for $rotate" ;;
      *) fatal "invalid operations logrotate recovery state for $rotate" ;;
    esac
  done

  states_count=0
  for timer in "${OPERATIONS_TIMERS[@]}"; do
    states_count="$(awk -F '|' -v expected="$timer" '
      $1 == expected && ($2 == "enabled" || $2 == "disabled") && ($3 == "active" || $3 == "inactive") { count += 1 }
      END { print count + 0 }
    ' "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states")" || \
      fatal "cannot read operations timer recovery state for $timer"
    [ "$states_count" = "1" ] || \
      fatal "operations timer recovery state is missing or duplicated for $timer"
  done
}

recover_pending_operations_activation() {
  local line key value field
  local version="" phase="" journal_backup_path="" journal_release_root=""
  local journal_pointer_previous="" journal_pointer_new=""
  local journal_pointer_intent="" journal_pointer_switched=""
  local journal_system_config_applied="" journal_cron_before="" journal_cron_expected=""
  local journal_cron_intent="" journal_cron_mutated=""
  local backup_root backup_leaf actual_pointer="" allow_missing_expected=false
  local -A seen=()

  if [ ! -e "$OPS_ACTIVATION_JOURNAL" ] && [ ! -L "$OPS_ACTIVATION_JOURNAL" ]; then
    return 0
  fi

  assert_root_owned_nonwritable_directory "immutable operations root" "$OPS_ROOT"
  assert_root_owned_nonwritable_directory "immutable operations releases root" "$OPS_RELEASES_DIR"
  assert_root_owned_nonwritable_directory "deployment backup root" "$BACKUP_DIR"
  [ -f "$OPS_ACTIVATION_JOURNAL" ] && [ ! -L "$OPS_ACTIVATION_JOURNAL" ] \
    && [ "$(stat -c '%U:%G:%a' "$OPS_ACTIVATION_JOURNAL" 2>/dev/null)" = "root:root:600" ] || \
    fatal "immutable operations activation journal is not a root-only regular file"

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *=*) ;;
      *) fatal "malformed immutable operations activation journal" ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      version|phase|backup_path|release_root|pointer_previous_target|pointer_new_target|\
      pointer_switch_intent|pointer_switched|system_config_applied|cron_before|\
      cron_expected|cron_intent|cron_mutated) ;;
      *) fatal "unknown immutable operations activation journal field: $key" ;;
    esac
    [ -z "${seen[$key]+x}" ] || \
      fatal "duplicate immutable operations activation journal field: $key"
    seen["$key"]=true
    case "$key" in
      version) version="$value" ;;
      phase) phase="$value" ;;
      backup_path) journal_backup_path="$value" ;;
      release_root) journal_release_root="$value" ;;
      pointer_previous_target) journal_pointer_previous="$value" ;;
      pointer_new_target) journal_pointer_new="$value" ;;
      pointer_switch_intent) journal_pointer_intent="$value" ;;
      pointer_switched) journal_pointer_switched="$value" ;;
      system_config_applied) journal_system_config_applied="$value" ;;
      cron_before) journal_cron_before="$value" ;;
      cron_expected) journal_cron_expected="$value" ;;
      cron_intent) journal_cron_intent="$value" ;;
      cron_mutated) journal_cron_mutated="$value" ;;
    esac
  done < "$OPS_ACTIVATION_JOURNAL"

  for field in version phase backup_path release_root pointer_previous_target pointer_new_target \
    pointer_switch_intent pointer_switched system_config_applied cron_before cron_expected \
    cron_intent cron_mutated; do
    [ -n "${seen[$field]+x}" ] || \
      fatal "missing immutable operations activation journal field: $field"
  done
  [ "$version" = "1" ] || fatal "unsupported immutable operations activation journal version"
  case "$phase" in
    system-config-intent|pointer-intent|pointer-switched|genesis-pending|cron-migration-intent|\
    cron-migration-applied|resilience-intent|resilience-applied|finalized) ;;
    *) fatal "invalid immutable operations activation journal phase" ;;
  esac
  # A PENDING root anchor can only have been created after this exact
  # activation wrote genesis-pending. Fail before the generic rollback path
  # can restore an unrelated/stale pointer journal beneath that anchor.
  if [ -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] || [ -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ]; then
    validate_log_evidence_genesis_anchor_file
    if [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)" = PENDING ]; then
      [ "$phase" = genesis-pending ] || \
        fatal "pending root log genesis is incompatible with the interrupted operations activation phase"
    fi
  fi
  for value in "$journal_pointer_intent" "$journal_pointer_switched" \
    "$journal_system_config_applied" "$journal_cron_intent" "$journal_cron_mutated"; do
    operations_activation_boolean_is_valid "$value" || \
      fatal "invalid boolean in immutable operations activation journal"
  done
  [ "$journal_system_config_applied" = "true" ] || \
    fatal "immutable operations activation journal has no system-configuration recovery state"

  backup_root="$(realpath -e -- "$BACKUP_DIR")" || fatal "cannot resolve deployment backup root"
  journal_backup_path="$(realpath -e -- "$journal_backup_path")" || \
    fatal "cannot resolve immutable operations activation backup"
  backup_leaf="${journal_backup_path#"$backup_root"/}"
  [ "$journal_backup_path" != "$backup_root" ] && [[ "$backup_leaf" =~ ^backup-[^/]+$ ]] || \
    fatal "immutable operations activation backup is outside the backup root"
  BACKUP_PATH="$journal_backup_path"
  assert_root_owned_nonwritable_directory "immutable operations activation backup" "$BACKUP_PATH"

  assert_operations_activation_release_path \
    "immutable operations activation release" "$journal_release_root"
  OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT="$journal_release_root"
  OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR="$BACKUP_PATH/operations-system-config.before"
  validate_operations_system_config_snapshot

  if [ -n "$journal_pointer_previous" ]; then
    assert_operations_activation_release_path \
      "previous immutable operations release" "$journal_pointer_previous"
  fi
  if [ "$journal_pointer_intent" = "true" ]; then
    [ "$journal_pointer_new" = "$journal_release_root" ] || \
      fatal "immutable operations activation pointer target does not match its release"
    if [ -e "$OPS_CURRENT_LINK" ] || [ -L "$OPS_CURRENT_LINK" ]; then
      [ -L "$OPS_CURRENT_LINK" ] || fatal "immutable operations current path is not a symlink"
      actual_pointer="$(readlink -f -- "$OPS_CURRENT_LINK")" || \
        fatal "cannot resolve immutable operations current pointer during recovery"
      assert_operations_activation_release_path \
        "actual immutable operations current release" "$actual_pointer"
    fi
    if [ "$actual_pointer" = "$journal_pointer_new" ]; then
      OPS_CURRENT_SWITCHED=true
    elif [ "$actual_pointer" = "$journal_pointer_previous" ]; then
      OPS_CURRENT_SWITCHED=false
    elif [ -z "$actual_pointer" ] && [ -z "$journal_pointer_previous" ]; then
      OPS_CURRENT_SWITCHED=false
    else
      fatal "immutable operations current pointer changed outside the interrupted activation"
    fi
  else
    [ -z "$journal_pointer_previous" ] && [ -z "$journal_pointer_new" ] \
      && [ "$journal_pointer_switched" = "false" ] || \
      fatal "immutable operations activation journal has an inconsistent pointer state"
    OPS_CURRENT_SWITCHED=false
  fi

  if [ "$phase" = "resilience-intent" ] && [ "$journal_cron_intent" = "true" ]; then
    allow_missing_expected=true
  fi
  assert_operations_activation_crontab_snapshot \
    "operations crontab recovery baseline" "$journal_cron_before" false
  assert_operations_activation_crontab_snapshot \
    "operations crontab recovery expected state" "$journal_cron_expected" "$allow_missing_expected"

  case "$phase" in
    system-config-intent)
      [ "$journal_pointer_intent" = "false" ] && [ "$journal_cron_intent" = "false" ] || \
        fatal "system-configuration journal phase has later activation state"
      ;;
    pointer-intent)
      [ "$journal_pointer_intent" = "true" ] && [ "$journal_pointer_switched" = "false" ] || \
        fatal "pointer-intent journal phase has inconsistent pointer state"
      ;;
    pointer-switched|genesis-pending)
      [ "$journal_pointer_intent" = "true" ] && [ "$journal_pointer_switched" = "true" ] || \
        fatal "pointer/genesis journal phase has inconsistent pointer state"
      [ "$journal_cron_intent" = "false" ] && [ "$journal_cron_mutated" = "false" ] || \
        fatal "pointer/genesis journal phase must not contain crontab mutation"
      ;;
    cron-migration-intent|resilience-intent)
      [ "$journal_cron_intent" = "true" ] && [ "$journal_cron_mutated" = "true" ] || \
        fatal "cron-intent journal phase has inconsistent crontab state"
      ;;
    cron-migration-applied|resilience-applied)
      [ "$journal_cron_intent" = "false" ] && [ "$journal_cron_mutated" = "true" ] || \
        fatal "completed-cron journal phase has inconsistent crontab state"
      ;;
  esac

  OPS_CURRENT_PREVIOUS_TARGET="$journal_pointer_previous"
  OPS_CURRENT_NEW_TARGET="$journal_pointer_new"
  OPS_POINTER_SWITCH_INTENT="$journal_pointer_intent"
  OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=true
  OPERATIONS_SYSTEM_CONFIG_APPLIED=true
  OPERATIONS_CRONTAB_BEFORE="$journal_cron_before"
  OPERATIONS_CRONTAB_EXPECTED="$journal_cron_expected"
  OPERATIONS_CRONTAB_INTENT="$journal_cron_intent"
  OPERATIONS_CRONTAB_MUTATED="$journal_cron_mutated"
  OPERATIONS_ACTIVATION_STARTED=true
  OPERATIONS_RELEASE_FINALIZED=false

  if [ "$phase" = "finalized" ]; then
    clear_operations_activation_journal || \
      fatal "cannot clear a finalized immutable operations activation journal"
    OPERATIONS_ACTIVATION_STARTED=false
    OPERATIONS_RELEASE_FINALIZED=true
    log "Cleared finalized immutable operations activation journal"
    return 0
  fi

  if [ "$phase" = "genesis-pending" ]; then
    [ "$actual_pointer" = "$journal_release_root" ] \
      || fatal "genesis-bound operations release is not the active immutable pointer"
    GENESIS_ACTIVATION_DURABLE=true
    log "Resuming genesis-bound immutable operations activation without rollback"
    return 0
  fi

  log "Recovering interrupted immutable operations activation (phase=$phase)..."
  rollback_operations_activation_on_exit || \
    fatal "immutable operations activation recovery could not prove a safe rollback"
  release_operations_runner_locks || \
    fatal "immutable operations activation recovery could not release runner locks"

  # The rollback above undid everything the adopted journal described, so the
  # host is back in its pre-activation state — but this function has been
  # holding the journal's values since it read them, and they say the opposite:
  # a snapshot exists, /etc has been written, an activation is in flight. Left
  # standing, they make THIS deployment's own activation refuse to start with
  # "operations system configuration was already snapshotted", which is how a
  # successful recovery turned into a failed release on 2026-09-07.
  #
  # The `finalized` branch above already resets what its outcome invalidates.
  # This is the same idea for the other terminal outcome: a proven rollback
  # leaves nothing behind, so it must claim nothing.
  OPS_CURRENT_PREVIOUS_TARGET=""
  OPS_CURRENT_NEW_TARGET=""
  OPS_CURRENT_SWITCHED=false
  OPS_POINTER_SWITCH_INTENT=false
  OPERATIONS_CRONTAB_BEFORE=""
  OPERATIONS_CRONTAB_EXPECTED=""
  OPERATIONS_CRONTAB_INTENT=false
  OPERATIONS_CRONTAB_MUTATED=false
  OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR=""
  OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT=""
  OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=false
  OPERATIONS_SYSTEM_CONFIG_APPLIED=false
  OPERATIONS_ACTIVATION_STARTED=false
  OPERATIONS_RELEASE_FINALIZED=false
  log "Recovered interrupted immutable operations activation"
}

operations_config_file_matches() {
  local left="$1"
  local right="$2"
  local left_metadata right_metadata

  [ -f "$left" ] && [ ! -L "$left" ] || return 1
  [ -f "$right" ] && [ ! -L "$right" ] || return 1
  cmp -s -- "$left" "$right" || return 1
  left_metadata="$(stat -c '%u:%g:%a' -- "$left" 2>/dev/null)" || return 1
  right_metadata="$(stat -c '%u:%g:%a' -- "$right" 2>/dev/null)" || return 1
  [ "$left_metadata" = "$right_metadata" ]
}

snapshot_operations_config_file() {
  local label="$1"
  local target="$2"
  local snapshot="$3"
  local state_file="${snapshot}.state"

  if [ -e "$target" ] || [ -L "$target" ]; then
    assert_root_owned_nonwritable_file "$label" "$target"
    cp -a -- "$target" "$snapshot" || \
      fatal "cannot snapshot $label before immutable operations activation"
    printf '%s\n' present > "$state_file"
  else
    printf '%s\n' absent > "$state_file"
  fi
  chmod 0600 "$state_file" || fatal "cannot secure $label activation snapshot"
}

snapshot_operations_system_config() {
  local release_root="$1"
  local unit rotate timer enabled active

  [ "$OPERATIONS_SYSTEM_CONFIG_SNAPSHOT" = "false" ] || \
    fatal "operations system configuration was already snapshotted"
  [ -n "${BACKUP_PATH:-}" ] && [ -d "$BACKUP_PATH" ] || \
    fatal "operations system configuration cannot be snapshotted before the deployment backup exists"
  assert_root_owned_nonwritable_directory "deployment backup directory" "$BACKUP_PATH"
  assert_root_owned_nonwritable_directory "systemd unit directory" "$SYSTEMD_UNIT_DIR"
  assert_root_owned_nonwritable_directory "logrotate directory" "$LOGROTATE_DIR"
  assert_secure_operations_tree "immutable operations release before system configuration activation" "$release_root"

  OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR="$BACKUP_PATH/operations-system-config.before"
  OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT="$release_root"
  install -d -m 0700 \
    "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/systemd" \
    "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/logrotate" || \
    fatal "cannot create operations system configuration snapshot"

  for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
    snapshot_operations_config_file \
      "systemd unit $unit" \
      "$SYSTEMD_UNIT_DIR/$unit" \
      "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/systemd/$unit"
  done
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    snapshot_operations_config_file \
      "logrotate definition $rotate" \
      "$LOGROTATE_DIR/$rotate" \
      "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/logrotate/$rotate"
  done

  : > "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states" || \
    fatal "cannot record operations timer states"
  for timer in "${OPERATIONS_TIMERS[@]}"; do
    enabled=disabled
    active=inactive
    systemctl is-enabled --quiet "$timer" && enabled=enabled
    systemctl is-active --quiet "$timer" && active=active
    printf '%s|%s|%s\n' "$timer" "$enabled" "$active" \
      >> "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states" || \
      fatal "cannot record state for $timer"
  done
  chmod 0600 "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states" || \
    fatal "cannot secure operations timer-state snapshot"
  sync -f -- "$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR" "$BACKUP_PATH" || \
    fatal "cannot persist operations system-configuration snapshot before activation"
  OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=true
}

install_operations_config_file_atomically() {
  local label="$1"
  local source="$2"
  local target="$3"
  local parent target_name stage

  [ -f "$source" ] && [ ! -L "$source" ] || \
    fatal "$label source is not a regular immutable release file"
  parent="$(dirname -- "$target")"
  target_name="$(basename -- "$target")"
  assert_root_owned_nonwritable_directory "$label target parent" "$parent"
  stage="$(mktemp "$parent/.${target_name}.activation.XXXXXX")" || \
    fatal "cannot stage $label activation"
  if ! install -m 0644 -- "$source" "$stage" \
    || ! sync -f -- "$stage" \
    || ! mv -Tf -- "$stage" "$target" \
    || ! sync -f -- "$target" "$parent" \
    || ! cmp -s -- "$source" "$target"; then
    rm -f -- "$stage"
    fatal "cannot atomically install $label from the immutable operations release"
  fi
  assert_root_owned_nonwritable_file "$label target" "$target"
}

operations_config_file_matches_rollback_state() {
  local kind="$1"
  local name="$2"
  local target="$3"
  local snapshot="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/$kind/$name"
  local state_file="${snapshot}.state"
  local release_file="$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT/$kind/$name"
  local state

  [ -r "$state_file" ] && IFS= read -r state < "$state_file" || return 1
  [ -f "$release_file" ] && [ ! -L "$release_file" ] || return 1
  case "$state" in
    present)
      [ -f "$snapshot" ] && [ ! -L "$snapshot" ] || return 1
      operations_config_file_matches "$target" "$snapshot" || \
        operations_config_file_matches "$target" "$release_file"
      ;;
    absent)
      if [ ! -e "$target" ] && [ ! -L "$target" ]; then
        return 0
      fi
      operations_config_file_matches "$target" "$release_file"
      ;;
    *) return 1 ;;
  esac
}

verify_operations_system_config_rollback_state() {
  local unit rotate failures=0

  [ "$OPERATIONS_SYSTEM_CONFIG_SNAPSHOT" = "true" ] || return 1
  for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
    if ! operations_config_file_matches_rollback_state \
      systemd "$unit" "$SYSTEMD_UNIT_DIR/$unit"; then
      log "FATAL: systemd unit $unit changed outside this operations activation; refusing rollback overwrite"
      failures=1
    fi
  done
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    if ! operations_config_file_matches_rollback_state \
      logrotate "$rotate" "$LOGROTATE_DIR/$rotate"; then
      log "FATAL: logrotate definition $rotate changed outside this operations activation; refusing rollback overwrite"
      failures=1
    fi
  done
  [ "$failures" = "0" ]
}

restore_operations_config_file() {
  local kind="$1"
  local name="$2"
  local target="$3"
  local snapshot="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/$kind/$name"
  local state_file="${snapshot}.state"
  local release_file="$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT/$kind/$name"
  local state stage

  [ -r "$state_file" ] && IFS= read -r state < "$state_file" || {
    log "FATAL: missing rollback state for $kind $name"
    return 1
  }
  [ -f "$release_file" ] && [ ! -L "$release_file" ] || {
    log "FATAL: immutable release file is unavailable during rollback: $release_file"
    return 1
  }

  case "$state" in
    present)
      [ -f "$snapshot" ] && [ ! -L "$snapshot" ] || {
        log "FATAL: missing original $kind snapshot for $name"
        return 1
      }
      if operations_config_file_matches "$target" "$snapshot"; then
        return 0
      fi
      if ! operations_config_file_matches "$target" "$release_file"; then
        log "FATAL: $kind $name changed outside this activation; refusing rollback overwrite"
        return 1
      fi
      stage="$(mktemp "$(dirname -- "$target")/.${name}.rollback.XXXXXX")" || {
        log "FATAL: cannot stage rollback for $kind $name"
        return 1
      }
      if ! cp --preserve=mode,ownership,timestamps -- "$snapshot" "$stage" \
        || ! mv -Tf -- "$stage" "$target" \
        || ! operations_config_file_matches "$target" "$snapshot"; then
        rm -f -- "$stage"
        log "FATAL: cannot restore original $kind $name"
        return 1
      fi
      ;;
    absent)
      if [ ! -e "$target" ] && [ ! -L "$target" ]; then
        return 0
      fi
      if ! operations_config_file_matches "$target" "$release_file"; then
        log "FATAL: $kind $name changed outside this activation; refusing rollback removal"
        return 1
      fi
      if ! unlink -- "$target" || [ -e "$target" ] || [ -L "$target" ]; then
        log "FATAL: cannot remove newly installed $kind $name during rollback"
        return 1
      fi
      ;;
    *)
      log "FATAL: invalid rollback state for $kind $name"
      return 1
      ;;
  esac
}

restore_operations_system_config_files() {
  local unit rotate failures=0

  for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
    restore_operations_config_file systemd "$unit" "$SYSTEMD_UNIT_DIR/$unit" || failures=1
  done
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    restore_operations_config_file logrotate "$rotate" "$LOGROTATE_DIR/$rotate" || failures=1
  done
  [ "$failures" = "0" ]
}

quiesce_operations_timers_for_rollback() {
  local timer failures=0

  # Stop timer units only. Do not stop an already-running backup/log service:
  # the previous schedule must be restored without interrupting its in-flight
  # durable work.
  for timer in "${OPERATIONS_TIMERS[@]}"; do
    if ! systemctl stop "$timer" 2>/dev/null && systemctl is-active --quiet "$timer"; then
      log "FATAL: cannot stop $timer before operations rollback"
      failures=1
    fi
    if ! systemctl disable "$timer" 2>/dev/null && systemctl is-enabled --quiet "$timer"; then
      log "FATAL: cannot disable $timer before operations rollback"
      failures=1
    fi
  done
  [ "$failures" = "0" ]
}

open_operations_runner_lock() {
  local label="$1"
  local path="$2"
  local expected_identity="$3"
  local expected_parent_identity="$4"
  local destination_var="$5"
  local lock_fd parent path_identity fd_identity

  parent="$(dirname -- "$path")"
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    && [ "$(realpath -e -- "$parent" 2>/dev/null || true)" = "$parent" ] \
    && [ "$(stat -c '%U:%G:%a' "$parent" 2>/dev/null || true)" = "$expected_parent_identity" ] \
    && [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(realpath -e -- "$path" 2>/dev/null || true)" = "$path" ] \
    && [ "$(stat -c '%U:%G:%a' "$path" 2>/dev/null || true)" = "$expected_identity" ] || {
      log "FATAL: $label persistent lock authority is missing, non-canonical, or unsafe"
      return 1
    }
  exec {lock_fd}<>"$path" || {
    log "FATAL: cannot open $label persistent lock"
    return 1
  }
  if ! flock -w 600 "$lock_fd"; then
    exec {lock_fd}>&-
    log "FATAL: $label runner did not release its persistent lock within 10 minutes"
    return 1
  fi
  path_identity="$(stat -Lc '%d:%i' "$path" 2>/dev/null || true)"
  fd_identity="$(stat -Lc '%d:%i' "/proc/$$/fd/$lock_fd" 2>/dev/null || true)"
  if [ -z "$path_identity" ] || [ "$path_identity" != "$fd_identity" ] \
      || [ "$(stat -c '%U:%G:%a' "$path" 2>/dev/null || true)" != "$expected_identity" ]; then
    exec {lock_fd}>&-
    log "FATAL: $label persistent lock inode changed while the deploy fence was acquired"
    return 1
  fi
  printf -v "$destination_var" '%s' "$lock_fd"
}

# The four recovery runners exist only on a host commissioned through
# docs/BACKUP_RUNBOOK.md. This reads the same host-side authority the recovery
# gate already uses (BACKUP_ENCRYPTION=age in /etc/leaddrive/backup.env), so
# there is one source of truth for "is this subsystem live here", never two.
operations_backup_subsystem_is_commissioned() {
  [ "$(event_platform_recovery_gate_mode)" = "commissioned" ]
}

acquire_operations_runner_locks() {
  # Nothing to fence when the subsystem was never commissioned: the backup,
  # secrets, runtime-files and log-ship programs are not installed and their
  # timers are inert, so there is no runner a deploy could collide with. The
  # locks are mutexes against those runners, not evidence of anything, and
  # demanding them on such a host does not protect production — it makes
  # production unreachable, exactly as the recovery gate above records for
  # 2026-09-05..07, when 102 merged commits sat undeployed behind a gate whose
  # inputs the host had never been given.
  if ! operations_backup_subsystem_is_commissioned; then
    log "Recovery-runner locks: skipped — the backup subsystem is not commissioned on this host, so no runner can race this activation"
    return 0
  fi
  if [ -n "$OPERATIONS_BACKUP_LOCK_FD" ] \
    && [ -n "$OPERATIONS_SECRETS_LOCK_FD" ] \
    && [ -n "$OPERATIONS_RUNTIME_FILES_LOCK_FD" ] \
    && [ -n "$OPERATIONS_LOG_LOCK_FD" ]; then
    return 0
  fi
  [ -z "$OPERATIONS_BACKUP_LOCK_FD$OPERATIONS_SECRETS_LOCK_FD$OPERATIONS_RUNTIME_FILES_LOCK_FD$OPERATIONS_LOG_LOCK_FD" ] || {
    log "FATAL: immutable operations runner-lock set is only partially held"
    return 1
  }
  open_operations_runner_lock "PostgreSQL backup" \
    /var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock \
    root:leaddrive-backup:660 root:root:755 \
    OPERATIONS_BACKUP_LOCK_FD || return 1
  open_operations_runner_lock "secrets snapshot" \
    /var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock \
    root:root:600 root:root:755 OPERATIONS_SECRETS_LOCK_FD || return 1
  open_operations_runner_lock "runtime-files snapshot" \
    /var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock \
    root:root:600 root:root:755 OPERATIONS_RUNTIME_FILES_LOCK_FD || return 1
  open_operations_runner_lock "log shipping" \
    /var/lib/leaddrive-recovery-runner-locks/log-ship.lock \
    root:leaddrive-backup:660 root:root:755 \
    OPERATIONS_LOG_LOCK_FD || return 1
  log "All four recovery runners are quiesced behind their canonical persistent locks"
}

release_operations_runner_locks() {
  local failures=0
  if [ -n "$OPERATIONS_LOG_LOCK_FD" ]; then
    exec {OPERATIONS_LOG_LOCK_FD}>&- || failures=1
    OPERATIONS_LOG_LOCK_FD=""
  fi
  if [ -n "$OPERATIONS_RUNTIME_FILES_LOCK_FD" ]; then
    exec {OPERATIONS_RUNTIME_FILES_LOCK_FD}>&- || failures=1
    OPERATIONS_RUNTIME_FILES_LOCK_FD=""
  fi
  if [ -n "$OPERATIONS_SECRETS_LOCK_FD" ]; then
    exec {OPERATIONS_SECRETS_LOCK_FD}>&- || failures=1
    OPERATIONS_SECRETS_LOCK_FD=""
  fi
  if [ -n "$OPERATIONS_BACKUP_LOCK_FD" ]; then
    exec {OPERATIONS_BACKUP_LOCK_FD}>&- || failures=1
    OPERATIONS_BACKUP_LOCK_FD=""
  fi
  [ "$failures" -eq 0 ]
}

restore_operations_timer_states() {
  local excluded_timer="${1:-}"
  local timer enabled active failures=0
  local states="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states"

  [ -r "$states" ] || {
    log "FATAL: operations timer-state snapshot is missing"
    return 1
  }
  while IFS='|' read -r timer enabled active; do
    # A bootstrap genesis must keep the log shipper fenced until its root
    # anchor is durable.  All other schedules must return to the exact state
    # observed before the bounded operations activation; bootstrap is not
    # allowed to silently turn off the normal DB/secrets/runtime protection.
    if [ -n "$excluded_timer" ] && [ "$timer" = "$excluded_timer" ]; then
      continue
    fi
    case "$enabled:$active" in
      enabled:active|enabled:inactive|disabled:active|disabled:inactive) ;;
      *)
        log "FATAL: invalid recorded timer state for $timer"
        failures=1
        continue
        ;;
    esac
    if [ "$enabled" = enabled ]; then
      if ! systemctl enable "$timer" || ! systemctl is-enabled --quiet "$timer"; then
        log "FATAL: cannot restore enabled state for $timer"
        failures=1
      fi
    elif ! systemctl disable "$timer" 2>/dev/null && systemctl is-enabled --quiet "$timer"; then
      log "FATAL: cannot restore disabled state for $timer"
      failures=1
    fi

    if [ "$active" = active ]; then
      if ! systemctl start "$timer" || ! systemctl is-active --quiet "$timer"; then
        log "FATAL: cannot restore active state for $timer"
        failures=1
      fi
    elif ! systemctl stop "$timer" 2>/dev/null && systemctl is-active --quiet "$timer"; then
      log "FATAL: cannot restore inactive state for $timer"
      failures=1
    fi
  done < "$states"
  [ "$failures" = "0" ]
}

assert_operations_timer_states_except() {
  local excluded_timer="${1:-}"
  local timer expected_enabled expected_active actual_enabled actual_active failures=0
  local states="$OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR/timer-states"

  [ -r "$states" ] || {
    log "FATAL: operations timer-state snapshot is missing"
    return 1
  }
  while IFS='|' read -r timer expected_enabled expected_active; do
    if [ -n "$excluded_timer" ] && [ "$timer" = "$excluded_timer" ]; then
      continue
    fi
    case "$expected_enabled:$expected_active" in
      enabled:active|enabled:inactive|disabled:active|disabled:inactive) ;;
      *)
        log "FATAL: invalid recorded timer state for $timer"
        failures=1
        continue
        ;;
    esac
    actual_enabled=disabled
    actual_active=inactive
    systemctl is-enabled --quiet "$timer" && actual_enabled=enabled
    systemctl is-active --quiet "$timer" && actual_active=active
    if [ "$actual_enabled:$actual_active" != "$expected_enabled:$expected_active" ]; then
      log "FATAL: $timer differs from its durable pre-activation state ($actual_enabled:$actual_active != $expected_enabled:$expected_active)"
      failures=1
    fi
  done < "$states"
  [ "$failures" = "0" ]
}

switch_release_owned_operations_current() {
  local release_root="$1"
  local current_target=""
  local next_link

  [ "$OPS_CURRENT_SWITCHED" != "true" ] || fatal "immutable operations current link was already switched"
  assert_secure_operations_tree "new immutable operations release" "$release_root"
  if [ -e "$OPS_CURRENT_LINK" ] || [ -L "$OPS_CURRENT_LINK" ]; then
    [ -L "$OPS_CURRENT_LINK" ] || fatal "$OPS_CURRENT_LINK must be a symlink"
    current_target="$(readlink -f -- "$OPS_CURRENT_LINK")" || fatal "cannot resolve $OPS_CURRENT_LINK"
    case "$current_target" in
      "$OPS_RELEASES_DIR"/*)
        assert_secure_operations_tree "current immutable operations release" "$current_target"
        ;;
      *)
        fatal "$OPS_CURRENT_LINK points outside the immutable operations release root"
        ;;
    esac
  fi

  if [ "$current_target" = "$release_root" ]; then
    log "Immutable operations current link already names this release"
    return 0
  fi

  OPS_CURRENT_PREVIOUS_TARGET="$current_target"
  OPS_CURRENT_NEW_TARGET="$release_root"
  OPS_POINTER_SWITCH_INTENT=true
  write_operations_activation_journal "pointer-intent"
  next_link="$OPS_ROOT/.current-${DEPLOY_SHA}-$$"
  [ ! -e "$next_link" ] && [ ! -L "$next_link" ] || fatal "temporary operations link already exists"
  ln -s "releases/$DEPLOY_SHA" "$next_link" || fatal "cannot stage immutable operations current link"
  mv -Tf -- "$next_link" "$OPS_CURRENT_LINK" || fatal "cannot atomically switch immutable operations current link"
  sync -f -- "$OPS_ROOT" || \
    fatal "cannot persist immutable operations current pointer before continuing"
  OPS_CURRENT_SWITCHED=true
  [ "$(readlink -f -- "$OPS_CURRENT_LINK")" = "$release_root" ] || \
    fatal "immutable operations current link did not resolve to this deployment"
  write_operations_activation_journal "pointer-switched"
}

rollback_operations_activation_on_exit() {
  local observed stage current_target="" failures=0
  local pointer_restored=true
  local system_config_safe=true
  local timers_quiesced=true
  local runner_locks_ready=true
  local system_config_restored=true
  local restore_crontab=false

  [ "$OPERATIONS_ACTIVATION_STARTED" = "true" ] || return 0
  [ "$OPERATIONS_RELEASE_FINALIZED" != "true" ] || return 0
  log "Reverting incomplete immutable operations activation..."

  if [ "$OPERATIONS_SYSTEM_CONFIG_APPLIED" = "true" ]; then
    if ! verify_operations_system_config_rollback_state; then
      failures=1
      system_config_safe=false
    elif ! quiesce_operations_timers_for_rollback; then
      failures=1
      timers_quiesced=false
    elif ! acquire_operations_runner_locks; then
      failures=1
      runner_locks_ready=false
    fi
  fi

  # Never move the stable program pointer or restore sibling helper files while
  # an old runner can still resolve them through `ops/current`.
  [ "$runner_locks_ready" = "true" ] || return 1

  if [ "$OPERATIONS_CRONTAB_MUTATED" = "true" ] || [ "$OPERATIONS_CRONTAB_INTENT" = "true" ]; then
    observed="$BACKUP_PATH/root-crontab.rollback-observed"
    if ! capture_root_crontab_for_rollback "$observed"; then
      log "FATAL: cannot read root crontab before operations rollback"
      failures=1
    else
      if [ "$OPERATIONS_CRONTAB_INTENT" = "true" ]; then
        if [ -f "$OPERATIONS_CRONTAB_EXPECTED" ] \
          && cmp -s "$OPERATIONS_CRONTAB_EXPECTED" "$observed"; then
          restore_crontab=true
        elif cmp -s "$OPERATIONS_CRONTAB_BEFORE" "$observed"; then
          log "Root crontab write had not reached the active crontab; no cron rollback is needed"
        else
          log "FATAL: root crontab changed outside this activation; refusing to overwrite it during rollback"
          failures=1
        fi
      elif [ -f "$OPERATIONS_CRONTAB_EXPECTED" ] \
        && cmp -s "$OPERATIONS_CRONTAB_EXPECTED" "$observed"; then
        restore_crontab=true
      elif cmp -s "$OPERATIONS_CRONTAB_BEFORE" "$observed"; then
        # A prior recovery may have restored cron and then lost power before
        # it could durably unlink the journal. Treat that exact baseline as an
        # idempotent no-op, not as an unrelated operator edit.
        log "Root crontab was already restored by an earlier recovery; no cron rollback is needed"
      else
        log "FATAL: root crontab changed outside this activation; refusing to overwrite it during rollback"
        failures=1
      fi

      if [ "$restore_crontab" = "true" ]; then
        if ! crontab "$OPERATIONS_CRONTAB_BEFORE"; then
          log "FATAL: cannot restore root crontab during operations rollback"
          failures=1
        elif ! crontab -l > "$observed" 2>/dev/null \
          || ! cmp -s "$OPERATIONS_CRONTAB_BEFORE" "$observed"; then
          log "FATAL: root crontab restore verification failed"
          failures=1
        fi
      fi
    fi
  fi

  # The durable pointer-intent journal closes the small interval after the
  # atomic rename but before the in-memory switched flag is set.  Never
  # overwrite a pointer that is no longer exactly the one this activation
  # intended to publish.
  if [ "$OPS_CURRENT_SWITCHED" = "true" ] || [ "$OPS_POINTER_SWITCH_INTENT" = "true" ]; then
    if [ -e "$OPS_CURRENT_LINK" ] || [ -L "$OPS_CURRENT_LINK" ]; then
      if [ ! -L "$OPS_CURRENT_LINK" ]; then
        log "FATAL: immutable operations current path is not a symlink during rollback"
        failures=1
        pointer_restored=false
      else
        current_target="$(readlink -f -- "$OPS_CURRENT_LINK" 2>/dev/null || true)"
      fi
    fi

    if [ "$pointer_restored" = "true" ] && [ "$current_target" = "$OPS_CURRENT_NEW_TARGET" ]; then
      if [ -n "$OPS_CURRENT_PREVIOUS_TARGET" ]; then
        case "$OPS_CURRENT_PREVIOUS_TARGET" in
          "$OPS_RELEASES_DIR"/*)
            if [ ! -d "$OPS_CURRENT_PREVIOUS_TARGET" ]; then
              log "FATAL: previous immutable operations release is missing"
              failures=1
              pointer_restored=false
            else
              stage="$OPS_ROOT/.current-rollback-$$"
              if [ -e "$stage" ] || [ -L "$stage" ]; then
                log "FATAL: operations rollback link staging path already exists"
                failures=1
                pointer_restored=false
              elif ! ln -s "$OPS_CURRENT_PREVIOUS_TARGET" "$stage" \
                || ! mv -Tf -- "$stage" "$OPS_CURRENT_LINK" \
                || [ "$(readlink -f -- "$OPS_CURRENT_LINK")" != "$OPS_CURRENT_PREVIOUS_TARGET" ]; then
                log "FATAL: cannot restore the previous immutable operations current link"
                failures=1
                pointer_restored=false
              fi
            fi
            ;;
          *)
            log "FATAL: recorded previous immutable operations release is unsafe"
            failures=1
            pointer_restored=false
            ;;
        esac
      elif ! unlink "$OPS_CURRENT_LINK"; then
        log "FATAL: cannot remove first immutable operations current link during rollback"
        failures=1
        pointer_restored=false
      fi
    elif [ "$pointer_restored" = "true" ] \
      && { [ "$current_target" = "$OPS_CURRENT_PREVIOUS_TARGET" ] \
        || { [ -z "$current_target" ] && [ -z "$OPS_CURRENT_PREVIOUS_TARGET" ]; }; }; then
      log "Immutable operations current pointer had not switched; no pointer rollback is needed"
    elif [ "$pointer_restored" = "true" ]; then
      log "FATAL: immutable operations current link changed outside this activation before rollback"
      failures=1
      pointer_restored=false
    fi
  fi

  if [ "$OPERATIONS_SYSTEM_CONFIG_APPLIED" = "true" ] && [ "$system_config_safe" = "true" ]; then
    if ! restore_operations_system_config_files; then
      failures=1
      system_config_restored=false
    fi
    if ! systemctl daemon-reload; then
      log "FATAL: cannot reload systemd after operations configuration rollback"
      failures=1
      system_config_restored=false
    fi
    # Do not reactivate a timer until the pointer and its exact previous
    # system configuration are both back. Leaving the known timers disabled is
    # safer than scheduling a job through an ambiguous release path.
    if [ "$pointer_restored" = "true" ] && [ "$timers_quiesced" = "true" ] \
      && [ "$system_config_restored" = "true" ]; then
      if ! restore_operations_timer_states; then
        failures=1
      fi
    else
      log "FATAL: leaving operations timers quiesced because rollback state is incomplete"
      failures=1
    fi
  fi

  [ "$failures" = "0" ] || return 1
  OPS_CURRENT_SWITCHED=false
  OPS_POINTER_SWITCH_INTENT=false
  OPERATIONS_SYSTEM_CONFIG_APPLIED=false
  OPERATIONS_CRONTAB_INTENT=false
  OPERATIONS_ACTIVATION_STARTED=false
  clear_operations_activation_journal || return 1
  log "Rolled back incomplete immutable operations activation"
}

migrate_legacy_cron_paths() {
  local manifest="$OPS_CURRENT_LINK/cron-script-manifest.txt"
  local cron_root="$OPS_CURRENT_LINK/cron-scripts"
  local current next verify name

  [ -n "$OPERATIONS_CRONTAB_BEFORE" ] && [ -f "$OPERATIONS_CRONTAB_BEFORE" ] || \
    fatal "root crontab activation snapshot is missing"
  [ -s "$manifest" ] || fatal "immutable operations release has no cron-script manifest"
  while IFS= read -r name || [ -n "$name" ]; do
    [ -x "$cron_root/$name" ] || fatal "immutable operations cron script is missing: $name"
  done < "$manifest"
  current="$BACKUP_PATH/root-crontab.current-before-runtime-release"
  next="$BACKUP_PATH/root-crontab.after-runtime-release"
  verify="$BACKUP_PATH/root-crontab.verify-runtime-release"
  capture_root_crontab "$current" "release-owned path migration"
  cmp -s "$OPERATIONS_CRONTAB_BEFORE" "$current" || \
    fatal "root crontab changed while immutable operations activation was being prepared"

  if ! awk \
    -v manifest="$manifest" \
    -v new_prefix="$cron_root/" '
      BEGIN {
        while ((getline entry < manifest) > 0) {
          allowed[entry] = 1
        }
        close(manifest)
      }
      /^[[:space:]]*#/ { print; next }
      {
        line = $0
        while (match(line, /\/opt\/leaddrive-v2(\/\.next\/standalone)?\/scripts\/[A-Za-z0-9._-]+/)) {
          old = substr(line, RSTART, RLENGTH)
          name = old
          sub(/^.*\//, "", name)
          if (!(name in allowed)) {
            printf "active crontab references an unshipped mutable script: %s\\n", old > "/dev/stderr"
            invalid = 1
            break
          }
          line = substr(line, 1, RSTART - 1) new_prefix name substr(line, RSTART + RLENGTH)
        }
        print line
      }
      END { exit invalid }
    ' "$current" > "$next"; then
    fatal "root crontab contains an active mutable script outside the immutable release manifest"
  fi

  if ! cmp -s "$current" "$next"; then
    OPERATIONS_CRONTAB_EXPECTED="$next"
    OPERATIONS_CRONTAB_MUTATED=true
    OPERATIONS_CRONTAB_INTENT=true
    write_operations_activation_journal "cron-migration-intent"
    crontab "$next" || fatal "cannot install the migrated root crontab"
  else
    OPERATIONS_CRONTAB_EXPECTED="$current"
  fi
  capture_root_crontab "$verify" "release-owned path migration verification"
  cmp -s "$next" "$verify" || fatal "root crontab changed while installing immutable release paths"
  if awk '!/^[[:space:]]*#/ && /\/opt\/leaddrive-v2(\/\.next\/standalone)?\/scripts\// { found = 1 } END { exit found }' "$verify"; then
    :
  else
    fatal "active root crontab still references a checkout or standalone script after migration"
  fi
  if [ "$OPERATIONS_CRONTAB_INTENT" = "true" ]; then
    OPERATIONS_CRONTAB_INTENT=false
    write_operations_activation_journal "cron-migration-applied"
  fi
  log "Migrated active root crontab paths to immutable external operations scripts"
}

run_resilience_cron_installer() {
  local installer="$1"
  local before="$BACKUP_PATH/root-crontab.before-resilience-installer"
  local expected="$BACKUP_PATH/root-crontab.after-resilience-release"
  local observed="$BACKUP_PATH/root-crontab.after-resilience-observed"
  local installer_status

  [ -n "$OPERATIONS_CRONTAB_EXPECTED" ] && [ -f "$OPERATIONS_CRONTAB_EXPECTED" ] || \
    fatal "root crontab activation snapshot is missing before resilience installer"
  capture_root_crontab "$before" "resilience schedule installation"
  cmp -s "$OPERATIONS_CRONTAB_EXPECTED" "$before" || \
    fatal "root crontab changed before resilience schedule installation"

  # Persist the intended crontab before entering the child. The child writes
  # this exact snapshot immediately before its atomic `crontab` call, so a
  # reboot can distinguish a write that never reached cron from one that did.
  OPERATIONS_CRONTAB_EXPECTED="$expected"
  OPERATIONS_CRONTAB_MUTATED=true
  OPERATIONS_CRONTAB_INTENT=true
  write_operations_activation_journal "resilience-intent"

  # The installer writes root's crontab atomically, but its reporting step can
  # still fail after that write (for example when CI output disappears). Always
  # capture the observed result before propagating its status so the EXIT
  # transaction can prove and restore a partial activation.
  if SCRIPTS="$OPS_CURRENT_LINK/cron-scripts" \
    LEADDRIVE_CRON_EXPECTED_PATH="$expected" \
    "$installer"; then
    installer_status=0
  else
    installer_status=$?
  fi
  capture_root_crontab "$observed" "resilience schedule installation result"
  [ -f "$expected" ] && [ ! -L "$expected" ] || \
    fatal "resilience installer did not persist its expected root crontab before activation"
  cmp -s "$expected" "$observed" || \
    fatal "root crontab changed outside the resilience installer activation"
  OPERATIONS_CRONTAB_INTENT=false
  write_operations_activation_journal "resilience-applied"
  return "$installer_status"
}

install_release_owned_operations() {
  local artifact_root="$1"
  local recovery_scope="$2"
  local certification_marker
  local release_root="$OPS_RELEASES_DIR/$DEPLOY_SHA"
  local stage unit rotate timer manifest cron_script

  case "$recovery_scope" in
    log-genesis-bootstrap-only) certification_marker="$BACKUP_BOOTSTRAP_RESTORE_MARKER" ;;
    full-recovery) certification_marker="$BACKUP_OFFLINE_RESTORE_MARKER" ;;
    *) fatal "unsupported immutable operations recovery scope" ;;
  esac
  validate_release_owned_operations_artifact "$artifact_root"
  # Re-hash at the activation boundary. A changed unit, logrotate rule, backup
  # helper or recovery contract cannot mutate /etc or the stable operations
  # pointer until an independent operator has signed a new commissioning
  # digest. The offline drill proves the backup payloads; this digest binds the
  # exact recovery program bytes without claiming every helper was executed.
  validate_certified_recovery_program_set "$artifact_root" "$certification_marker" "$recovery_scope"
  manifest="$artifact_root/scripts/release-cron-script-manifest.txt"
  ensure_secure_root_directory "immutable operations root" "$OPS_ROOT" "0755"
  ensure_secure_root_directory "immutable operations releases directory" "$OPS_RELEASES_DIR" "0755"

  if [ -e "$release_root" ] || [ -L "$release_root" ]; then
    [ -d "$release_root" ] && [ ! -L "$release_root" ] || \
      fatal "release-owned operations target is not a real directory: $release_root"
  else
    stage="$(mktemp -d "$OPS_ROOT/.release-stage-${DEPLOY_SHA}.XXXXXX")" || \
      fatal "cannot create a release-owned operations staging directory"
    install -d -m 0755 "$stage/backup" "$stage/cron-scripts" "$stage/systemd" "$stage/logrotate"
    cp -a -- "$artifact_root/scripts/backup/." "$stage/backup/"
    cp -- "$artifact_root/ops/backup/backup.env.example" \
      "$artifact_root/ops/backup/recovery-program-set.files" "$stage/backup/"
    while IFS= read -r cron_script || [ -n "$cron_script" ]; do
      install -m 0755 -- "$artifact_root/scripts/$cron_script" "$stage/cron-scripts/$cron_script"
    done < "$manifest"
    cp -a -- "$artifact_root/ops/systemd/." "$stage/systemd/"
    cp -a -- "$artifact_root/ops/logrotate/." "$stage/logrotate/"
    cp -- "$artifact_root/scripts/release-cron-script-manifest.txt" "$stage/cron-script-manifest.txt"
    "$artifact_root/scripts/backup/hash-recovery-program-set.sh" "$artifact_root" \
      >"$stage/recovery-program-set.sha256" || \
      fatal "cannot record the immutable operations recovery-program digest"
    sha256sum "$artifact_root/scripts/backup/recovery-db-contract.tsv" \
      | awk '{print $1}' >"$stage/recovery-db-contract.sha256" || \
      fatal "cannot record the immutable operations recovery DB contract digest"
    chown -R root:root "$stage"
    find "$stage" -type d -exec chmod 0755 {} +
    find "$stage/backup" -type f -exec chmod 0755 {} +
    find "$stage/cron-scripts" -type f -exec chmod 0755 {} +
    find "$stage/systemd" "$stage/logrotate" -type f -exec chmod 0644 {} +
    chmod 0444 "$stage/recovery-program-set.sha256" "$stage/recovery-db-contract.sha256"
    assert_secure_operations_tree "staged immutable operations release" "$stage"
    validate_installed_release_operations "$stage" "$artifact_root"
    mv -- "$stage" "$release_root" || fatal "cannot atomically publish release-owned operations"
  fi
  assert_secure_operations_tree "immutable operations release" "$release_root"
  validate_installed_release_operations "$release_root" "$artifact_root"

  # Validate synthetic copies against the staged release before it can become
  # reachable through the stable pointer. This supports the first bootstrap,
  # where the literal `current` ExecStart target deliberately does not exist.
  validate_staged_operations_systemd_units "$release_root"
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    logrotate -d "$release_root/logrotate/$rotate" >/dev/null || \
      fatal "staged logrotate syntax validation failed for $rotate"
  done

  # A pointer rollback alone cannot undo files that have already been copied
  # into /etc. Snapshot all bounded targets and timer states, persist the
  # rollback journal, then quiesce schedules before the first write. This
  # keeps a reboot from consuming a mixed old-pointer/new-unit configuration.
  snapshot_operations_system_config "$release_root"
  OPERATIONS_ACTIVATION_STARTED=true
  OPERATIONS_SYSTEM_CONFIG_APPLIED=true
  write_operations_activation_journal "system-config-intent"
  quiesce_operations_timers_for_rollback || \
    fatal "cannot quiesce immutable operations timers before activation"
  acquire_operations_runner_locks || \
    fatal "cannot acquire every recovery-runner lock before operations activation"
  # The eight unit files belong to the backup subsystem. Installing them on a
  # host that was never commissioned would put four timers on the clock whose
  # programs are absent and whose off-site destination no longer exists, so
  # every fire would be a guaranteed failure and a daily false alarm. The
  # release tree, the logrotate policy and the application's own cron scripts
  # below are installed in both modes — they are not part of that subsystem.
  if operations_backup_subsystem_is_commissioned; then
    for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"; do
      install_operations_config_file_atomically \
        "systemd-$unit" \
        "$release_root/systemd/$unit" \
        "$SYSTEMD_UNIT_DIR/$unit"
    done
  fi
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    install_operations_config_file_atomically \
      "logrotate-$rotate" \
      "$release_root/logrotate/$rotate" \
      "$LOGROTATE_DIR/$rotate"
  done
  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"; do
    logrotate -d "$LOGROTATE_DIR/$rotate" >/dev/null || \
      fatal "logrotate syntax validation failed for $rotate"
  done
  # From here on the pointer rollback trap owns any failure. Switching before
  # the final literal-unit validation makes the stable ExecStart target exist,
  # while the timer quiesce and journal guarantee a failed validation restores
  # the prior pointer, unit files, and timer state.
  switch_release_owned_operations_current "$release_root"
  if operations_backup_subsystem_is_commissioned; then
    systemd-analyze verify "${OPERATIONS_SYSTEMD_UNITS[@]/#/$SYSTEMD_UNIT_DIR/}" || \
      fatal "systemd unit validation failed for the immutable operations release"
  fi
  systemctl daemon-reload
  release_operations_runner_locks || \
    fatal "cannot release recovery-runner locks after atomic operations activation"
  if [ "$recovery_scope" = log-genesis-bootstrap-only ]; then
    # Do not convert an operations-only genesis ceremony into a backup outage.
    # The first log object has not been root-anchored yet, so only its timer
    # remains fenced; every other timer is restored precisely from the durable
    # pre-activation snapshot.
    systemctl disable --now leaddrive-log-ship.timer >/dev/null 2>&1 || true
    systemctl is-enabled --quiet leaddrive-log-ship.timer \
      && fatal "log-shipping timer must remain disabled before genesis commits" \
      || true
    systemctl is-active --quiet leaddrive-log-ship.timer \
      && fatal "log-shipping timer must remain inactive before genesis commits" \
      || true
    restore_operations_timer_states leaddrive-log-ship.timer || \
      fatal "cannot restore the pre-bootstrap DB, secrets, and runtime timer states"
    log "Installed immutable bootstrap operations; only log shipping remains fenced before genesis"
    return 0
  fi
  if ! operations_backup_subsystem_is_commissioned; then
    # Leave the machine in the state the operator actually asked for: the
    # subsystem is not commissioned here, so its timers must not be running.
    # A host that carried them from an earlier, commissioned life keeps the
    # unit files — removing files this release did not install is not this
    # function's business — but the schedules are stopped, so nothing fires
    # at a destination that no longer exists.
    for timer in "${OPERATIONS_TIMERS[@]}"; do
      systemctl disable --now "$timer" >/dev/null 2>&1 || true
      if systemctl is-enabled --quiet "$timer" 2>/dev/null \
        || systemctl is-active --quiet "$timer" 2>/dev/null; then
        fatal "$timer is still scheduled on a host where the backup subsystem is not commissioned"
      fi
    done
    log "Installed immutable release-owned operations for $recovery_scope; the backup subsystem is not commissioned on this host, so its four timers stay stopped (docs/BACKUP_RUNBOOK.md commissions them)"
    return 0
  fi
  for timer in "${OPERATIONS_TIMERS[@]}"; do
    if [ "$timer" = leaddrive-log-ship.timer ]; then
      systemctl disable --now "$timer" >/dev/null 2>&1 || true
      systemctl is-enabled --quiet "$timer" \
        && fatal "$timer must remain disabled at the current recovery activation stage" \
        || true
      systemctl is-active --quiet "$timer" \
        && fatal "$timer must remain inactive at the current recovery activation stage" \
        || true
      continue
    fi
    systemctl enable --now "$timer"
    systemctl is-enabled --quiet "$timer" || fatal "$timer is not enabled after installation"
    systemctl is-active --quiet "$timer" || fatal "$timer is not active after installation"
  done
  log "Installed immutable release-owned operations for $recovery_scope; stage-ineligible timers remain fenced"
}

validate_bootstrap_recovery_authority() {
  local backup_env backup_recipient recipient_hash

  backup_env="/etc/leaddrive/backup.env"
  assert_root_owned_nonwritable_directory "backup evidence root" "$BACKUP_EVIDENCE_ROOT"
  [ "$(stat -c '%a' "$BACKUP_EVIDENCE_ROOT")" = 700 ] || \
    fatal "backup evidence root must use mode 0700"
  assert_root_owned_nonwritable_file "bootstrap offline restore marker" "$BACKUP_BOOTSTRAP_RESTORE_MARKER"
  [ "$(stat -c '%a' "$BACKUP_BOOTSTRAP_RESTORE_MARKER")" = 600 ] || \
    fatal "bootstrap offline restore marker must use mode 0600"
  assert_root_owned_nonwritable_file "backup environment" "$backup_env"
  [ "$(read_static_env_value "$backup_env" BACKUP_ENCRYPTION)" = age ] || \
    fatal "bootstrap recovery operations require age-encrypted backup authority"
  backup_recipient="$(read_static_env_value "$backup_env" BACKUP_AGE_RECIPIENT)" || \
    fatal "backup environment has duplicate age-recipient entries"
  [[ "$backup_recipient" =~ ^age1[0-9a-z]{58}$ ]] || \
    fatal "bootstrap recovery operations require one native age recipient"
  recipient_hash="$(printf '%s' "$backup_recipient" | sha256sum | awk '{print $1}')"
  assert_root_owned_nonwritable_file "age key-custody marker" "$BACKUP_CUSTODY_MARKER"
  validate_preserved_backup_evidence "$BACKUP_CUSTODY_MARKER" age-key-custody "$recipient_hash"
  validate_preserved_backup_evidence "$BACKUP_BOOTSTRAP_RESTORE_MARKER" archive-restore \
    "$recipient_hash" log-genesis-bootstrap-only
  [ "$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" REVIEWED_MAIN_SHA)" = "$DEPLOY_SHA" ] \
    && [ "$(read_static_env_value "$BACKUP_BOOTSTRAP_RESTORE_MARKER" WORKFLOW_SHA)" = "$DEPLOY_SHA" ] || \
    fatal "bootstrap recovery certificate must be bound to the exact bootstrap deployment SHA"
}

complete_log_evidence_genesis() {
  local log_genesis_status

  # The first evidence epoch is a root-coordinated transaction. The
  # unprivileged shipper freezes/uploads/finalizes its cursor, while this
  # deployment stream-proves the exact immutable object and commits the root
  # anchor before enabling its timer.
  prepare_reviewed_log_source_authorities
  prepare_log_evidence_genesis_anchor
  log_genesis_status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS)"
  log "Running immutable log-shipping genesis proof..."
  if [ "$log_genesis_status" = PENDING ]; then
    systemctl start leaddrive-log-ship.service || \
      fatal "new immutable log-shipping service failed its root-prescribed bootstrap run"
    [ "$(systemctl show --property=Result --value leaddrive-log-ship.service 2>/dev/null || true)" = success ] \
      && [ "$(systemctl show --property=ExecMainStatus --value leaddrive-log-ship.service 2>/dev/null || true)" = 0 ] || \
      fatal "new immutable log-shipping bootstrap did not complete successfully"
    validate_active_log_ship_state
    commit_log_evidence_genesis_anchor
    cleanup_log_bootstrap_transaction
    validate_active_log_ship_state
  else
    [ "$log_genesis_status" = COMMITTED ] \
      || fatal "root log-evidence genesis has an unexpected lifecycle state"
    systemctl start leaddrive-log-ship.service || \
      fatal "new immutable log-shipping service failed its post-activation run"
    [ "$(systemctl show --property=Result --value leaddrive-log-ship.service 2>/dev/null || true)" = success ] \
      && [ "$(systemctl show --property=ExecMainStatus --value leaddrive-log-ship.service 2>/dev/null || true)" = 0 ] || \
      fatal "new immutable log-shipping service did not complete successfully"
    validate_active_log_ship_state
  fi
  systemctl enable --now leaddrive-log-ship.timer
  systemctl is-enabled --quiet leaddrive-log-ship.timer \
    || fatal "log-shipping timer is not enabled after three-way genesis proof"
  systemctl is-active --quiet leaddrive-log-ship.timer \
    || fatal "log-shipping timer is not active after three-way genesis proof"
  log "Immutable log shipping is release-bound, root-anchored, remotely proved, and scheduled"
}

finalize_operations_activation_after_genesis() {
  write_operations_activation_journal "finalized"
  OPERATIONS_RELEASE_FINALIZED=true
  clear_operations_activation_journal || \
    fatal "cannot clear finalized immutable operations activation journal"
  GENESIS_ACTIVATION_DURABLE=false
}

run_recovery_bootstrap_deploy() {
  local stage release_root timer bootstrap_status

  stage="$(mktemp -d "/var/tmp/leaddrive-recovery-bootstrap-${DEPLOY_SHA}.XXXXXX")" || \
    fatal "cannot create isolated bootstrap artifact stage"
  [ "$(stat -c '%U:%a' "$stage")" = root:700 ] || \
    fatal "bootstrap artifact stage is not root-only"
  if ! tar --no-same-owner --no-same-permissions -xzf "$DEPLOY_TAR" -C "$stage"; then
    safe_remove_tree "$stage"
    fatal "cannot extract the SHA-bound bootstrap artifact"
  fi
  [ "$(tr -d '\r\n' <"$stage/.deploy-sha" 2>/dev/null || true)" = "$DEPLOY_SHA" ] || {
    safe_remove_tree "$stage"
    fatal "bootstrap artifact staging lost its SHA binding"
  }
  validate_release_owned_operations_artifact "$stage"
  validate_certified_recovery_program_set "$stage" "$BACKUP_BOOTSTRAP_RESTORE_MARKER" \
    log-genesis-bootstrap-only
  release_root="$OPS_RELEASES_DIR/$DEPLOY_SHA"

  case "$DEPLOY_MODE" in
    recovery-bootstrap)
      [ "$OPERATIONS_ACTIVATION_STARTED" != true ] || {
        safe_remove_tree "$stage"
        fatal "an unfinished genesis activation exists; use recovery-bootstrap-resume with its exact SHA"
      }
      [ ! -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] && [ ! -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ] || {
        safe_remove_tree "$stage"
        fatal "initial bootstrap refuses an existing root anchor; it is a one-time genesis ceremony"
      }
      ;;
    recovery-bootstrap-resume)
      [ "$OPERATIONS_ACTIVATION_STARTED" = true ] \
        && [ "$GENESIS_ACTIVATION_DURABLE" = true ] \
        && [ "$OPERATIONS_RELEASE_FINALIZED" != true ] \
        && [ "$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT" = "$release_root" ] \
        && [ -L "$OPS_CURRENT_LINK" ] \
        && [ "$(readlink -f -- "$OPS_CURRENT_LINK")" = "$release_root" ] || {
          safe_remove_tree "$stage"
          fatal "bootstrap resume requires the exact durable genesis-pending journal and active immutable release"
        }
      if [ -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] || [ -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ]; then
        validate_log_evidence_genesis_anchor_file
        [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)" = "$DEPLOY_SHA" ] || {
          safe_remove_tree "$stage"
          fatal "bootstrap resume anchor belongs to another deployment SHA"
        }
      fi
      ;;
    *) safe_remove_tree "$stage"; fatal "unsupported bootstrap deployment mode" ;;
  esac

  if [ "$OPERATIONS_ACTIVATION_STARTED" = true ]; then
    [ "$OPERATIONS_RELEASE_FINALIZED" != true ] \
      && [ -L "$OPS_CURRENT_LINK" ] \
      && [ "$(readlink -f -- "$OPS_CURRENT_LINK")" = "$release_root" ] || {
        safe_remove_tree "$stage"
        fatal "bootstrap resume has no matching active immutable operations release"
      }
    validate_installed_release_operations "$release_root" "$stage"
    bootstrap_status="$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" STATUS 2>/dev/null || true)"
    # A resumed bootstrap is allowed to see the original DB/secrets/runtime
    # schedules active: the initial activation restores those exact states.
    # Only the log timer is special, and `complete_log_evidence_genesis` owns
    # its final state after it validates/commits the root anchor.
    assert_operations_timer_states_except leaddrive-log-ship.timer || {
      safe_remove_tree "$stage"
      fatal "bootstrap resume found a DB, secrets, or runtime timer state different from the durable pre-bootstrap snapshot"
    }
    log "Resuming the exact genesis-bound immutable operations release"
  else
    ensure_root_only_backup_directory "$BACKUP_DIR"
    BACKUP_PATH="$BACKUP_DIR/backup-$(date '+%Y%m%d-%H%M%S')"
    install -d -m 0700 "$BACKUP_PATH"
    [ "$(stat -c '%U:%a' "$BACKUP_PATH")" = root:700 ] || {
      safe_remove_tree "$stage"
      fatal "bootstrap operations backup path is not root-only"
    }
    prepare_operations_crontab_rollback
    install_release_owned_operations "$stage" log-genesis-bootstrap-only
    # Persist this phase before creating the PENDING root anchor. A retry of
    # this exact SHA resumes the immutable release; it must never roll it back
    # beneath an anchor that can become durable in the next instruction.
    write_operations_activation_journal genesis-pending
    GENESIS_ACTIVATION_DURABLE=true
  fi

  complete_log_evidence_genesis
  finalize_operations_activation_after_genesis
  safe_remove_tree "$stage"
  log "Recovery bootstrap completed: application, Prisma, Fund/Kafka and normal timers were not touched"
}

# Bootstrap admission is deliberately after the immutable artifact identity is
# bound but before recovery reconciliation. In particular, reconciliation can
# retire a COMMITTED bootstrap transaction/tombstone, so it must never run for
# an unproven or stale bootstrap certificate.
if [ "$DEPLOY_MODE" = recovery-bootstrap ] || [ "$DEPLOY_MODE" = recovery-bootstrap-resume ]; then
  validate_bootstrap_recovery_authority
fi

# ── Step 1: Recover any interrupted operations activation, then back up ──
# A pending journal is always resolved before this deployment creates a new
# backup baseline. Otherwise a SIGKILL/reboot could turn a partial /etc,
# pointer, or crontab transition into the next release's accepted state.
recover_pending_operations_activation
if [ "$OPERATIONS_ACTIVATION_STARTED" = true ] && [ "$OPERATIONS_RELEASE_FINALIZED" != true ]; then
  [ "$DEPLOY_MODE" = recovery-bootstrap-resume ] \
    || fatal "unfinished genesis activation blocks normal or initial bootstrap deployment; resume its exact SHA"
fi
# Recheck the SHA-bound immutable release before reconciliation can clean a
# COMMITTED bootstrap transaction. The journal is the authority for a resume,
# but any durable anchor must name that same release before this run mutates
# its cursor/tombstone state.
if [ "$GENESIS_ACTIVATION_DURABLE" = true ]; then
  expected_genesis_release="$OPS_RELEASES_DIR/$DEPLOY_SHA"
  [ "$OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT" = "$expected_genesis_release" ] \
    && [ -L "$OPS_CURRENT_LINK" ] \
    && [ "$(readlink -f -- "$OPS_CURRENT_LINK")" = "$expected_genesis_release" ] || \
    fatal "durable genesis resume does not match the exact active immutable operations release"
  if [ -e "$LOG_EVIDENCE_GENESIS_ANCHOR" ] || [ -L "$LOG_EVIDENCE_GENESIS_ANCHOR" ]; then
    validate_log_evidence_genesis_anchor_file
    [ "$(read_static_env_value "$LOG_EVIDENCE_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)" = "$DEPLOY_SHA" ] || \
      fatal "durable genesis resume anchor does not match the exact bootstrap deployment SHA"
  fi
fi
reconcile_log_genesis_before_operations_switch

if [ "$DEPLOY_MODE" = recovery-bootstrap ] || [ "$DEPLOY_MODE" = recovery-bootstrap-resume ]; then
  run_recovery_bootstrap_deploy
  rm -f -- "$DEPLOY_TAR" /tmp/server-deploy.sh
  log "Recovery-bootstrap deployment complete for ${DEPLOY_SHA:0:7} (mode=$DEPLOY_MODE)"
  exit 0
fi

log "Creating backup..."
ensure_root_only_backup_directory "$BACKUP_DIR"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_PATH="$BACKUP_DIR/backup-$TIMESTAMP"
install -d -m 0700 "$BACKUP_PATH"
[ "$(stat -c '%U:%a' "$BACKUP_PATH")" = "root:700" ] || \
  fatal "$BACKUP_PATH must be root-owned with mode 0700 before customer runtime data is copied"

if [ -d "$APP_DIR/.next/standalone" ]; then
  # GitHub's self-hosted builder records its uid in tar headers. Normalize the
  # live tree before copying it so neither the rollback artifact nor its
  # cutover evidence remains writable by a same-numeric-uid host account.
  chown -hR root:root -- "$APP_DIR/.next/standalone" || \
    fatal "cannot normalize live standalone ownership before backup"
  cp -a -- "$APP_DIR/.next/standalone" "$BACKUP_PATH/standalone"
  log "Backed up to $BACKUP_PATH"
else
  log "No existing standalone directory (first deploy)"
fi

restore_standalone_before_pm2() {
  local rollback_source="${EVENT_PLATFORM_PREVIOUS_STANDALONE_PATH:-$BACKUP_PATH/standalone}"
  if [ -d "$rollback_source" ]; then
    safe_remove_tree "$APP_DIR/.next/standalone"
    cp -a -- "$rollback_source" "$APP_DIR/.next/standalone"
    STANDALONE_REPLACED=false
    log "Standalone restored from $rollback_source. Live PM2 unchanged."
  else
    log "WARNING: no standalone backup is available; PM2 was not restarted"
  fi
}

fatal_after_standalone_replacement() {
  local message="$1"
  log "FATAL: $message"
  if [ "$STANDALONE_REPLACED" = "true" ] \
     || [ "$HANDOFF_STARTED" = "true" ] \
     || [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_applied" ]; then
    restore_standalone_before_pm2
  else
    log "Live standalone was not replaced; leaving the running artifact unchanged."
  fi
  exit 1
}

recover_application_handoff() {
  local rollback_config rollback_code rollback_ping_code
  local rollback_source="${EVENT_PLATFORM_PREVIOUS_STANDALONE_PATH:-$BACKUP_PATH/standalone}"

  if [ "$RUNTIME_STATE_CUTOVER_FINALIZED" != "true" ]; then
    log "Reverting incomplete runtime state cutover before restarting the previous artifact..."
    rollback_incomplete_runtime_state_cutover || {
      log "FATAL: incomplete runtime state cutover could not be reverted; refusing to start an ambiguous artifact layout"
      return 1
    }
  fi

  if [ "$RUNTIME_CUTOVER_APPLIED" != "true" ]; then
    log "Reverting incomplete runtime cutover before restarting the previous artifact..."
    rollback_incomplete_runtime_cutover || {
      log "FATAL: incomplete runtime cutover could not be reverted; refusing to start an ambiguous artifact layout"
      return 1
    }
  fi

  if [ ! -d "$rollback_source" ]; then
    log "FATAL: handoff recovery has no standalone backup; manual intervention is required"
    return 1
  fi

  log "Recovering the previous standalone artifact and PM2 process after failed handoff..."
  safe_remove_tree "$APP_DIR/.next/standalone" || {
    log "FATAL: cannot remove failed standalone artifact during handoff recovery"
    return 1
  }
  cp -a -- "$rollback_source" "$APP_DIR/.next/standalone" || {
    log "FATAL: cannot restore standalone backup during handoff recovery"
    return 1
  }
  load_dotenv_file "$APP_ENV_FILE"
  pm2 delete "$PM2_PROCESS" 2>/dev/null || true
  pm2 delete softphone-relay 2>/dev/null || true
  rollback_config="$APP_DIR/.next/standalone/ecosystem.config.cjs"
  if [ ! -f "$rollback_config" ]; then
    log "FATAL: rollback PM2 configuration is missing from standalone backup"
    return 1
  fi
  if ! pm2 start "$rollback_config" 2>/dev/null; then
    log "FATAL: PM2 could not start the rollback artifact"
    return 1
  fi
  if ! pm2 save 2>/dev/null; then
    log "FATAL: PM2 rollback state was not saved"
    return 1
  fi
  harden_pm2_reboot_dump || return 1
  sleep 5
  rollback_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL/login" 2>/dev/null || echo "000")"
  if [ "$rollback_code" != "200" ] && [ "$rollback_code" != "307" ]; then
    log "FATAL: rollback handoff page health check failed: $rollback_code"
    return 1
  fi
  rollback_ping_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL/api/v1/ping" 2>/dev/null || echo "000")"
  if [ "$rollback_ping_code" != "200" ]; then
    log "FATAL: rollback handoff API health check failed: $rollback_ping_code"
    return 1
  fi
  log "Rollback handoff health check passed: page=$rollback_code ping=$rollback_ping_code"
  HANDOFF_RECOVERY_COMPLETE=true
  STANDALONE_REPLACED=false
  return 0
}

rollback_replaced_standalone_on_exit() {
  local status=$?
  trap - EXIT
  cleanup_event_platform_cutover_lock
  if ! cleanup_event_platform_backup_transient; then
    log "FATAL: transient backup cleanup is incomplete; durable journal was preserved for the next recovery"
    status=1
  fi
  if [ "$status" -ne 0 ] && [ "$OPERATIONS_ACTIVATION_STARTED" = "true" ] && [ "$OPERATIONS_RELEASE_FINALIZED" != "true" ]; then
    if [ "$GENESIS_ACTIVATION_DURABLE" = "true" ]; then
      # After the genesis-pending journal is durable, rolling the immutable
      # release back would strand a PENDING/COMMITTED root anchor without the
      # exact program that can finish it. Preserve this bounded state and
      # require the explicit SHA-pinned bootstrap-resume route instead.
      log "Preserving durable genesis activation after failure; resume the exact bootstrap SHA"
    else
      set +e
      rollback_operations_activation_on_exit || \
        log "FATAL: incomplete immutable operations activation could not be fully rolled back"
    fi
  fi
  if ! release_operations_runner_locks; then
    log "FATAL: one or more immutable operations runner locks could not be released"
    status=1
  fi
  if [ "$status" -ne 0 ] && [ "$HANDOFF_STARTED" = "true" ] && [ "$HANDOFF_RECOVERY_COMPLETE" != "true" ]; then
    if [ "$EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED" = "true" ]; then
      log "FATAL: previous PM2 artifact remains stopped because the Fund pilot committed without a proven rollback-client path"
      log "FATAL: preserve the database and recovery-point evidence for reviewed operator recovery: ${EVENT_PLATFORM_PILOT_BACKUP_EVIDENCE:-unavailable}"
    else
      set +e
      recover_application_handoff
    fi
  elif [ "$status" -ne 0 ] && [ "$STANDALONE_REPLACED" = "true" ]; then
    set +e
    rollback_incomplete_runtime_state_cutover || \
      log "FATAL: incomplete runtime state cutover could not be reverted before standalone restore"
    restore_standalone_before_pm2
  fi
  exit "$status"
}

# Covers explicit failures and implicit `set -e` exits after the live
# standalone directory is replaced. During PM2 handoff it restores and starts
# the backed-up artifact, rather than merely replacing files while the process
# remains down.
trap rollback_replaced_standalone_on_exit EXIT

# ── Step 2: Extract new build ──────────────────────────────
log "Extracting new build..."

# Validate tarball BEFORE nuking the live standalone tree. A truncated /
# corrupt upload caught here keeps the old process running; without this
# guard, a half-uploaded tar would wipe standalone and only fail at line
# 52 after the live tree is already gone.
test -s "$DEPLOY_TAR" || { log "FATAL: $DEPLOY_TAR is missing or empty"; exit 1; }
tar -tzf "$DEPLOY_TAR" >/dev/null 2>&1 || { log "FATAL: $DEPLOY_TAR is not a valid gzipped tarball"; exit 1; }
# server.js presence check: `grep -q` early-exits on first match, which
# closes the pipe and triggers SIGPIPE on the long `tar -tzf` stream.
# Combined with `set -o pipefail` at the top of the file, the SIGPIPE
# bubbles up as a non-zero pipeline exit → false-FATAL on every healthy
# deploy where the tarball has more entries than the pipe buffer.
# Subshell scopes a temporary `set +o pipefail` to this single check.
( set +o pipefail; tar -tzf "$DEPLOY_TAR" 2>/dev/null | grep -qE '(^|/)server\.js$' ) || { log "FATAL: $DEPLOY_TAR has no server.js entry"; exit 1; }

# Validate revision metadata before replacing the live tree. The workflow packs
# from inside standalone, so tar records the hidden marker as ./.deploy-sha.
ARTIFACT_DEPLOY_SHA="$(tar -xOzf "$DEPLOY_TAR" ./.deploy-sha 2>/dev/null | tr -d '\r\n' || true)"
[[ "$ARTIFACT_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { log "FATAL: artifact has no valid .deploy-sha"; exit 1; }
[ "$ARTIFACT_DEPLOY_SHA" = "$EXPECTED_DEPLOY_SHA_ARG" ] || {
  log "FATAL: artifact identity changed after the recovery gate"; exit 1;
}
[ "$DEPLOY_SHA" = "$ARTIFACT_DEPLOY_SHA" ] || {
  log "FATAL: deployment identity changed after the recovery gate"; exit 1;
}
if tar -tzf "$DEPLOY_TAR" "./$EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER" >/dev/null 2>&1; then
  log "FATAL: candidate artifact must not claim the one-release Fund atomic prerequisite contract"
  exit 1
fi
log "Artifact revision verified: ${ARTIFACT_DEPLOY_SHA:0:12}"
recover_orphaned_event_platform_backup_transient

# The approved (non-preflight) deployment may now perform the one-time secret
# move and configure external runtime roots. This happens only after the
# artifact itself is proven readable and SHA-bound, but before standalone is
# replaced or PM2 is stopped. The checkout .env becomes a compatibility link
# so a rollback artifact has the same secret authority.
ensure_canonical_app_env
migrate_exact_legacy_help_video_env_path
validate_canonical_app_env
configure_runtime_paths "$APP_ENV_FILE"
configure_runtime_env_defaults
migrate_registered_shared_server_ip
for K in ESIGN_SECRET CRON_SECRET BROWSER_SOFTPHONE_TICKET_SECRET SOFTPHONE_RELAY_SECRET; do
  if ! grep -q "^[[:space:]]*${K}[[:space:]]*=" "$APP_ENV_FILE"; then
    append_env_if_missing "$K" "$(openssl rand -hex 32)"
    log "Generated $K in canonical app environment (was previously unconfigured)"
  fi
done
load_dotenv_file "$APP_ENV_FILE"
verify_runtime_cutover_preflight

# Resolve the durable database gate and persist the exact previous client
# before the generic standalone path is touched. On the first cutover the old
# process is drained under the INSERT-first atomic Fund lock contract while OLD
# bytes are still on disk; PM2 is then saved with both standalone-backed
# processes absent.
# A retry whose migration already committed trusts only the external recovery
# state and keeps automatic rollback blocked until the same gates complete.
load_dotenv_file "$MIGRATION_ENV_FILE" migration
require_env MIGRATION_DATABASE_URL
require_env MIGRATION_EXPECTED_DB_ROLE
EVENT_PLATFORM_CUTOVER_STATE=$(event_platform_cutover_state)
case "$EVENT_PLATFORM_CUTOVER_STATE" in
  migration_pending)
    EVENT_PLATFORM_REQUIRES_VERIFICATION=true
    validate_event_platform_atomic_prerequisite_artifact "$BACKUP_PATH/standalone" pre_swap
    validate_event_platform_atomic_prerequisite_live
    # This gate is intentionally repeated inside
    # backup_event_platform_pilot_database after the candidate is extracted.
    # The early pass catches static backup/env/unit failures while the healthy
    # predecessor is still serving traffic; the late pass protects against
    # config drift and compares the live unit to the extracted candidate.
    validate_event_platform_backup_preconditions
    sync_event_platform_previous_standalone
    prepare_event_platform_recovery_state
    quiesce_event_platform_pilot
    ;;
  migration_applied)
    EVENT_PLATFORM_REQUIRES_VERIFICATION=true
    EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
    validate_event_platform_recovery_state
    sync_event_platform_previous_standalone
    validate_event_platform_recovery_evidence
    quiesce_event_platform_pilot
    ;;
  verified)
    log "Fund event-source cutover gate was already durably verified"
    ;;
  *) fatal_after_standalone_replacement "unknown durable Fund cutover state" ;;
esac
unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE MIGRATION_WINDOW_ATTEMPTS

# The standalone snapshot does not contain live media, logs, or local help
# assets. Copy each real source into a root-only backup before the first move;
# a partial backup is a hard stop, not a warning, because runtime data may hold
# tenant PII and cannot be reconstructed from the release artifact.
backup_runtime_directory "$APP_DIR/uploads" "$BACKUP_PATH/uploads" "canonical uploads"
if [ "$(readlink -f -- "$APP_DIR/public/uploads")" != "$(readlink -f -- "$APP_DIR/uploads")" ]; then
  backup_runtime_directory "$APP_DIR/public/uploads" "$BACKUP_PATH/public-uploads" "legacy public uploads"
fi
backup_runtime_directory "$APP_DIR/logs" "$BACKUP_PATH/logs" "PM2 logs"
backup_runtime_directory "$APP_DIR/help-videos" "$BACKUP_PATH/help-videos" "help-video assets"

STANDALONE_REPLACED=true
safe_remove_tree "$APP_DIR/.next/standalone"
mkdir -p "$APP_DIR/.next/standalone"
tar --no-same-owner -xzf "$DEPLOY_TAR" -C "$APP_DIR/.next/standalone"

# Verify extraction
test -f "$APP_DIR/.next/standalone/server.js" || { log "FATAL: server.js missing after extract"; exit 1; }
test -d "$APP_DIR/.next/standalone/.next/static" || { log "FATAL: .next/static missing after extract"; exit 1; }
[ ! -e "$APP_DIR/.next/standalone/$EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER" ] \
  && [ ! -L "$APP_DIR/.next/standalone/$EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER" ] || {
  log "FATAL: extracted candidate falsely claims the Fund atomic prerequisite contract"
  exit 1
}
test -s "$APP_DIR/.next/standalone/scripts/event-platform-legacy-client-probe.mjs" || {
  log "FATAL: event-platform legacy-client probe missing after extract"
  exit 1
}

# The deployable artifact, not $APP_DIR's stale git checkout, is the source of
# truth for the running revision. This file is part of the standalone backup,
# so rollback restores the previous marker together with the previous code.
DEPLOY_SHA_FILE="$APP_DIR/.next/standalone/.deploy-sha"
test -s "$DEPLOY_SHA_FILE" || { log "FATAL: .deploy-sha missing from artifact"; exit 1; }
EXTRACTED_DEPLOY_SHA="$(tr -d '\r\n' < "$DEPLOY_SHA_FILE")"
[[ "$EXTRACTED_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { log "FATAL: invalid deploy SHA marker"; exit 1; }
[ "$EXTRACTED_DEPLOY_SHA" = "$ARTIFACT_DEPLOY_SHA" ] || { log "FATAL: extracted deploy SHA does not match validated artifact"; exit 1; }
[ "$DEPLOY_SHA" = "$EXTRACTED_DEPLOY_SHA" ] || { log "FATAL: extracted deploy SHA does not match the workflow-bound identity"; exit 1; }

# Recovery certification is a stable program-set contract, not a whole-app
# SHA. Every release revalidates the signed exact hashes after extraction and
# before any Prisma migration or operations-pointer mutation. Unrelated app
# commits can proceed when the recovery bytes are unchanged; modified backup,
# log, unit, logrotate or recovery-contract bytes require a new offline drill.
# On a host that has not been commissioned (BACKUP_ENCRYPTION != age) this is
# the plain-mode precondition check instead; see "Recovery gate mode".
validate_event_platform_backup_preconditions

CSS_COUNT=$(find "$APP_DIR/.next/standalone/.next/static" -name '*.css' | wc -l)
JS_COUNT=$(find "$APP_DIR/.next/standalone/.next/static" -name '*.js' | wc -l)
log "Verified: $CSS_COUNT CSS, $JS_COUNT JS files"
[ "$CSS_COUNT" -gt 0 ] || { log "FATAL: No CSS files"; exit 1; }
[ "$JS_COUNT" -gt 0 ] || { log "FATAL: No JS files"; exit 1; }
validate_release_owned_operations_artifact "$APP_DIR/.next/standalone"

# ── Step 2b: Verify Prisma engine is in the standalone tarball ────
# Next.js traces Prisma as external. A missing engine must fail the artifact:
# copying one from the stale checkout would make the live release depend on
# unreviewed host state and could pair a different engine with this client.
PRISMA_ENGINE_PATTERN="$APP_DIR/.next/standalone/node_modules/.prisma/client/libquery_engine-*.so.node"
# shellcheck disable=SC2086
if ! ls $PRISMA_ENGINE_PATTERN 1>/dev/null 2>&1; then
  log "FATAL: Prisma engine missing from the standalone artifact"
  exit 1
fi
log "Prisma engine verified: $(ls $PRISMA_ENGINE_PATTERN | head -1 | xargs basename)"

# ── Step 2c: Runtime cutover is deferred until PM2 is stopped ───────
# Source code now reads the external runtime root directly. The final move is
# deliberately later, during the existing process handoff: copying while the
# old artifact is still dual-writing would create a last-write-loss race.
BUNDLED_HELP_VIDEO_DIR="$APP_DIR/.next/standalone/help-videos/player"

# ── Step 3: Prisma migrate deploy ──────────────────────────
log "Running Prisma migrations..."
cd "$APP_DIR"

# Reload the app and root-only migration env files without executing unquoted
# values as shell code.
load_dotenv_file "$APP_ENV_FILE"
load_dotenv_file "$MIGRATION_ENV_FILE" migration

# The root $APP_DIR/prisma directory is NOT updated by the tarball deploy —
# it's whatever git commit the repo is at. The fresh schema + migrations
# always live in the standalone bundle. Point prisma migrate at that so a
# redeploy actually picks up new migrations.
#
# Previously this block swallowed failures with `|| { log WARNING }`, which
# meant a broken migration silently proceeded into PM2 restart — live
# process would then hit DB schema mismatches at runtime. Now: if migrate
# returns non-zero, restore the standalone tree from backup (so a later
# pm2 reload doesn't pick up the un-migrated new code) and exit. The live
# PM2 process keeps running on the old code unchanged.
STANDALONE_SCHEMA="$APP_DIR/.next/standalone/prisma/schema.prisma"
SCHEMA_TO_USE="$STANDALONE_SCHEMA"
[ -f "$STANDALONE_SCHEMA" ] || fatal_after_standalone_replacement "Prisma schema is missing from the standalone artifact"

# ── One-time auto-resolve for the 20260518120000_health migration ──
# That migration had a forward-FK ordering bug: it tried to add a FK on
# `health_medical_records.encounterId` BEFORE creating `health_encounters`.
# It aborted mid-apply, leaving health_providers/health_patients/
# health_medical_records created but no health_encounters or anything
# after. The row is now FAILED in _prisma_migrations, blocking every
# subsequent deploy. The fix-forward migration 20260519230000_fix_health_fk_order
# completes the missing work. To unblock the deploy chain we mark the
# original failed row as APPLIED — telling Prisma to skip the retry —
# so it proceeds to the fix-forward.
#
# This check is idempotent: once the failed row is marked applied, the
# query below returns no rows on subsequent runs and the resolve is
# skipped. Hardcoded to ONE specific migration name so it can never
# auto-resolve unrelated future failures by accident.
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  STUCK_HEALTH=$(
    psql "$MIGRATION_DATABASE_URL" -tAc \
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20260518120000_health' AND finished_at IS NULL AND rolled_back_at IS NULL LIMIT 1;" \
      2>/dev/null || true
  )
  if [ "$STUCK_HEALTH" = "20260518120000_health" ]; then
    log "Detected stuck migration 20260518120000_health (forward-FK bug). Auto-resolving as APPLIED so the fix-forward migration can run."
    if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --applied 20260518120000_health --schema="$SCHEMA_TO_USE" 2>&1; then
      log "WARNING: auto-resolve of 20260518120000_health failed. Proceeding to migrate deploy anyway — Prisma's own error will be more diagnostic."
    fi
  fi

  # Earlier deploy shipped a buggy version of 20260519230000_fix_health_fk_order
  # which crashed at apply time. Now that we've corrected its content
  # (verbatim from original + idempotent wrappers + all 5 tables created),
  # DELETE the failed row so Prisma re-attempts with the fresh content.
  # Hardcoded to ONE specific migration name. Idempotent — if no failed
  # row exists, the DELETE is a no-op.
  STUCK_FIX=$(
    psql "$MIGRATION_DATABASE_URL" -tAc \
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20260519230000_fix_health_fk_order' AND finished_at IS NULL AND rolled_back_at IS NULL LIMIT 1;" \
      2>/dev/null || true
  )
  if [ "$STUCK_FIX" = "20260519230000_fix_health_fk_order" ]; then
    log "Detected stuck 20260519230000_fix_health_fk_order from prior buggy attempt. Removing the failed row so the corrected content can apply."
    if ! psql "$MIGRATION_DATABASE_URL" -c \
      "DELETE FROM _prisma_migrations WHERE migration_name = '20260519230000_fix_health_fk_order' AND finished_at IS NULL;" 2>&1; then
      log "WARNING: failed to clean up 20260519230000_fix_health_fk_order row. Proceeding anyway."
    fi
  fi

  # GAP-003 was first shipped with its organization FK pointing at the Prisma
  # model name (`Organization`) instead of the mapped PostgreSQL table
  # (`organizations`). PostgreSQL rejected that statement. Recover only this
  # exact failed migration, and only after proving that every object introduced
  # by the migration was rolled back. If even one artifact remains, abort before
  # touching the migration ledger: a partial schema needs a dedicated
  # fix-forward migration, not an automatic retry.
  GAP003_MIGRATION="20260722040000_mtm_contact_master_parity"
  STUCK_GAP003=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT migration_name FROM _prisma_migrations
       WHERE migration_name = '$GAP003_MIGRATION'
         AND finished_at IS NULL
         AND rolled_back_at IS NULL
       LIMIT 1;" 2>/dev/null
  ) || fatal "cannot inspect $GAP003_MIGRATION migration state"

  if [ "$STUCK_GAP003" = "$GAP003_MIGRATION" ]; then
    GAP003_ARTIFACTS=$(
      psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
        "WITH artifacts(name) AS (
           SELECT 'type:MtmContactChangeKind'
           WHERE EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'MtmContactChangeKind'
           )
           UNION ALL
           SELECT 'table:mtm_contact_change_requests'
           WHERE to_regclass('public.mtm_contact_change_requests') IS NOT NULL
           UNION ALL
           SELECT 'column:' || column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'mtm_contacts'
             AND column_name = ANY (ARRAY[
               'workPhone', 'homePhone', 'mobilePhone', 'viberPhone',
               'whatsappPhone', 'telegramPhone', 'postalCode', 'addressRegion',
               'addressLocality', 'addressDistrict', 'addressStreet',
               'productCategory', 'verificationStatus', 'consentStatus',
               'contactPreference', 'source', 'verifiedAt', 'verifiedBy',
               'duplicateOfContactId'
             ])
           UNION ALL
           SELECT 'enum:MtmContactStatus:' || e.enumlabel
           FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           JOIN pg_enum e ON e.enumtypid = t.oid
           WHERE n.nspname = 'public'
             AND t.typname = 'MtmContactStatus'
             AND e.enumlabel IN ('DUPLICATE', 'MERGED')
           UNION ALL
           SELECT 'index:' || indexname
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname IN (
               'mtm_contacts_organizationId_verificationStatus_idx',
               'mtm_contacts_organizationId_duplicateOfContactId_idx'
             )
           UNION ALL
           SELECT 'constraint:' || c.conname
           FROM pg_constraint c
           JOIN pg_class r ON r.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'public'
             AND r.relname = 'mtm_contacts'
             AND c.conname IN (
               'mtm_contacts_duplicateOfContactId_fkey',
               'mtm_contacts_verification_status_check',
               'mtm_contacts_consent_status_check',
               'mtm_contacts_contact_preference_check'
             )
         )
         SELECT COALESCE(string_agg(name, ',' ORDER BY name), '') FROM artifacts;" \
        2>/dev/null
    ) || fatal "cannot verify rollback completeness for $GAP003_MIGRATION"

    [ -z "$GAP003_ARTIFACTS" ] || \
      fatal "$GAP003_MIGRATION left partial schema artifacts ($GAP003_ARTIFACTS); refusing automatic recovery"

    log "Verified complete rollback of $GAP003_MIGRATION. Resolving the failed attempt as ROLLED BACK before retry."
    if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve \
      --rolled-back "$GAP003_MIGRATION" --schema="$SCHEMA_TO_USE" 2>&1; then
      fatal "failed to resolve $GAP003_MIGRATION as rolled back"
    fi
  fi

  # The first production attempt of this migration used CREATE INDEX
  # CONCURRENTLY and PostgreSQL rejected it in the production runner's
  # transaction. Recover only the exact known failed attempt: one unresolved
  # ledger row, the original checksum, the known PostgreSQL error, and zero
  # surviving schema objects. Any mismatch needs a reviewed fix-forward.
  UNRESOLVED_MIGRATION_COUNT=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
      "SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null
  ) || fatal_after_standalone_replacement "cannot inspect unresolved migration count"

  # Prisma records migration completion after the migration SQL transaction.
  # A SIGKILL in that narrow gap can leave an unfinished ledger row even though
  # the Fund migration's own durable gate proves every SQL statement committed.
  # Resolve only that exact migration, only with one unresolved row, and only
  # when its ledger checksum equals the immutable extracted SQL. The cutover
  # remains migration_applied (not verified), so client/deep gates still run.
  if [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_applied" ]; then
    STUCK_EVENT_PLATFORM_PILOT=$(
      psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
        "SELECT migration_name, checksum
           FROM public._prisma_migrations
          WHERE migration_name = '$EVENT_PLATFORM_PILOT_MIGRATION'
            AND finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null
    ) || fatal_after_standalone_replacement "cannot inspect interrupted Fund migration ledger state"
    if [ -n "$STUCK_EVENT_PLATFORM_PILOT" ]; then
      [ "$UNRESOLVED_MIGRATION_COUNT" = "1" ] || \
        fatal_after_standalone_replacement "Fund migration recovery found unrelated unresolved migrations"
      EXTRACTED_EVENT_PLATFORM_PILOT_CHECKSUM=$(sha256sum \
        "$APP_DIR/.next/standalone/prisma/migrations/$EVENT_PLATFORM_PILOT_MIGRATION/migration.sql" \
        | awk '{print $1}') || \
        fatal_after_standalone_replacement "cannot hash extracted Fund pilot migration"
      [ "$STUCK_EVENT_PLATFORM_PILOT" = "$EVENT_PLATFORM_PILOT_MIGRATION|$EXTRACTED_EVENT_PLATFORM_PILOT_CHECKSUM" ] || \
        fatal_after_standalone_replacement "interrupted Fund migration ledger checksum does not match the immutable candidate"
      log "Durable Fund gate proves the SQL transaction committed; resolving its interrupted Prisma ledger row as APPLIED"
      if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve \
        --applied "$EVENT_PLATFORM_PILOT_MIGRATION" --schema="$SCHEMA_TO_USE" 2>&1; then
        fatal_after_standalone_replacement "failed to resolve the committed Fund migration ledger row"
      fi
      UNRESOLVED_MIGRATION_COUNT=$(
        psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
          "SELECT count(*) FROM public._prisma_migrations
            WHERE finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null
      ) || fatal_after_standalone_replacement "cannot recheck migration ledger after Fund recovery"
    fi
  fi

  STUCK_CALL_TARGET_STATE=$(
    psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
      "SELECT migration_name,
              checksum,
              applied_steps_count,
              (SELECT count(*) FROM _prisma_migrations successful
               WHERE successful.migration_name = '$CALL_TARGET_MIGRATION'
                 AND successful.finished_at IS NOT NULL),
              CASE
                WHEN COALESCE(logs, '') LIKE '%CREATE INDEX CONCURRENTLY cannot run inside a transaction block%'
                 AND COALESCE(logs, '') LIKE '%25001%'
                THEN 'known_concurrent_index_transaction_failure'
                ELSE 'unknown_failure'
              END
       FROM _prisma_migrations
       WHERE migration_name = '$CALL_TARGET_MIGRATION'
         AND finished_at IS NULL
         AND rolled_back_at IS NULL;" 2>/dev/null
  ) || fatal_after_standalone_replacement "cannot inspect $CALL_TARGET_MIGRATION migration state"

  if [ -n "$STUCK_CALL_TARGET_STATE" ]; then
    [ "$SCHEMA_TO_USE" = "$STANDALONE_SCHEMA" ] || \
      fatal_after_standalone_replacement "corrected standalone Prisma schema is required for migration recovery"
    [ "$UNRESOLVED_MIGRATION_COUNT" = "1" ] || \
      fatal_after_standalone_replacement "migration ledger has $UNRESOLVED_MIGRATION_COUNT unresolved rows; refusing automatic recovery"

    EXPECTED_CALL_TARGET_STATE="$CALL_TARGET_MIGRATION|$CALL_TARGET_FAILED_CHECKSUM|0|0|known_concurrent_index_transaction_failure"
    [ "$STUCK_CALL_TARGET_STATE" = "$EXPECTED_CALL_TARGET_STATE" ] || \
      fatal_after_standalone_replacement "$CALL_TARGET_MIGRATION failure identity does not match the reviewed production attempt"

    CALL_TARGET_ARTIFACTS=$(
      psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
        "WITH artifacts(name) AS (
           SELECT 'column:call_logs.targetPhoneE164'
           WHERE EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'call_logs'
               AND column_name = 'targetPhoneE164'
           )
           UNION ALL
           SELECT 'constraint:call_logs_target_phone_e164_check'
           WHERE EXISTS (
             SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             WHERE n.nspname = 'public'
               AND r.relname = 'call_logs'
               AND c.conname = 'call_logs_target_phone_e164_check'
           )
           UNION ALL
           SELECT 'index:call_logs_org_target_phone_e164_idx'
           WHERE to_regclass('public.call_logs_org_target_phone_e164_idx') IS NOT NULL
           UNION ALL
           SELECT 'index:audit_logs_voice_permission_request_key'
           WHERE to_regclass('public.audit_logs_voice_permission_request_key') IS NOT NULL
           UNION ALL
           SELECT 'function:protect_voice_permission_audit_row'
           WHERE to_regprocedure('public.protect_voice_permission_audit_row()') IS NOT NULL
           UNION ALL
           SELECT 'trigger:audit_logs_voice_permission_append_only'
           FROM pg_trigger t
           JOIN pg_class r ON r.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
             AND t.tgname = 'audit_logs_voice_permission_append_only'
         )
         SELECT COALESCE(string_agg(name, ',' ORDER BY name), '') FROM artifacts;" \
        2>/dev/null
    ) || fatal_after_standalone_replacement "cannot verify rollback completeness for $CALL_TARGET_MIGRATION"

    [ -z "$CALL_TARGET_ARTIFACTS" ] || \
      fatal_after_standalone_replacement "$CALL_TARGET_MIGRATION left partial schema artifacts ($CALL_TARGET_ARTIFACTS); refusing automatic recovery"

    VOICE_PERMISSION_PRESTATE=$(
      psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
        "SELECT
           count(*)::text,
           (SELECT count(*) FROM (
              SELECT 1 FROM audit_logs
               WHERE \"entityType\" = 'lead_voice_permission' AND \"entityId\" IS NOT NULL
               GROUP BY \"organizationId\", \"entityType\", \"entityId\"
               HAVING count(*) > 1
            ) duplicates)::text
         FROM audit_logs WHERE \"entityType\" = 'lead_voice_permission';" 2>/dev/null
    ) || fatal_after_standalone_replacement "cannot verify voice-permission audit pre-state"
    [ "$VOICE_PERMISSION_PRESTATE" = "0|0" ] || \
      fatal_after_standalone_replacement "voice-permission audit namespace is not empty before its first migration"

    EXTRACTED_CALL_TARGET_CHECKSUM=$(sha256sum "$APP_DIR/.next/standalone/prisma/migrations/$CALL_TARGET_MIGRATION/migration.sql" | awk '{print $1}') || \
      fatal_after_standalone_replacement "cannot hash extracted $CALL_TARGET_MIGRATION"
    EXTRACTED_VOICE_PERMISSION_CHECKSUM=$(sha256sum "$APP_DIR/.next/standalone/prisma/migrations/$VOICE_PERMISSION_MIGRATION/migration.sql" | awk '{print $1}') || \
      fatal_after_standalone_replacement "cannot hash extracted $VOICE_PERMISSION_MIGRATION"
    [ "$EXTRACTED_CALL_TARGET_CHECKSUM" = "$CALL_TARGET_FIXED_CHECKSUM" ] || \
      fatal_after_standalone_replacement "extracted call-history migration does not match the reviewed correction"
    [ "$EXTRACTED_VOICE_PERMISSION_CHECKSUM" = "$VOICE_PERMISSION_FIXED_CHECKSUM" ] || \
      fatal_after_standalone_replacement "extracted voice-permission migration does not match the reviewed correction"

    FINAL_MIGRATION_WINDOW=$(
      psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
        "SELECT
           (SELECT count(*) FROM pg_stat_activity
             WHERE datname = current_database()
               AND pid <> pg_backend_pid()
               AND state <> 'idle')::text,
           pg_total_relation_size('public.call_logs')::text,
           pg_total_relation_size('public.audit_logs')::text;" 2>/dev/null
    ) || fatal_after_standalone_replacement "cannot revalidate the final migration window"
    IFS='|' read -r FINAL_ACTIVE_TRANSACTIONS FINAL_CALL_LOG_BYTES FINAL_AUDIT_LOG_BYTES <<<"$FINAL_MIGRATION_WINDOW"
    [ "$FINAL_ACTIVE_TRANSACTIONS" = "0" ] || \
      fatal_after_standalone_replacement "database activity resumed before migration recovery"
    [ "$FINAL_CALL_LOG_BYTES" -le 268435456 ] || \
      fatal_after_standalone_replacement "call history table exceeded the bounded recovery size"
    [ "$FINAL_AUDIT_LOG_BYTES" -le 268435456 ] || \
      fatal_after_standalone_replacement "audit history table exceeded the bounded recovery size"

    log "Verified complete rollback of $CALL_TARGET_MIGRATION. Resolving the failed attempt as ROLLED BACK before retry."
    if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve \
      --rolled-back "$CALL_TARGET_MIGRATION" --schema="$SCHEMA_TO_USE" 2>&1; then
      fatal_after_standalone_replacement "failed to resolve $CALL_TARGET_MIGRATION as rolled back"
    fi
  elif [ "$UNRESOLVED_MIGRATION_COUNT" != "0" ]; then
    fatal_after_standalone_replacement "migration ledger contains an unrelated unresolved failure"
  fi
fi

if [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_pending" ]; then
  # PM2 is already durably fenced and the candidate artifact is now available
  # for exact service/unit comparison. Create the recovery point immediately
  # before the schema transaction; a retry with a committed gate reuses it.
  backup_event_platform_pilot_database
fi

# From the first instruction that can commit the Fund pilot onward, every
# asynchronous exit is fail-closed. A non-zero migrate result is ambiguous:
# the client may have lost its connection while PostgreSQL was still finishing
# the commit. Never infer "not applied" from immediate follow-up reads. A
# reviewed retry resolves the durable gate/ledger state before doing anything.
if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
  EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
fi

if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy --schema="$SCHEMA_TO_USE" 2>&1; then
  log "FATAL: prisma migrate deploy failed — aborting before PM2 restart."
  if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
    EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
    log "FATAL: the Fund pilot migration outcome is ambiguous; refusing automatic rollback until a reviewed retry resolves durable state"
    exit 1
  fi
  restore_standalone_before_pm2
  exit 1
fi

if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
  # The migration is now durable, while rollback compatibility and the deep
  # ledger rebuild are still unproven. Keep the old process stopped on every
  # failure until both gates below pass.
  EVENT_PLATFORM_CUTOVER_STATE=$(event_platform_cutover_state)
  [ "$EVENT_PLATFORM_CUTOVER_STATE" = "migration_applied" ] || \
    fatal_after_standalone_replacement "Fund migration did not leave the expected pending verification gate"
  EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
  validate_event_platform_recovery_state
  validate_event_platform_recovery_evidence
fi

# A schema-level compatibility argument is not enough for a rollback window.
# On the one deployment that installs the Fund pilot, load the exact generated
# Prisma client from the backed-up production artifact and execute its real
# Float create/read, atomic INSERT-first money, metadata and delete API paths
# against the migrated database. The probe is one transaction and deliberately
# ends at the reviewed hard-delete fence, so every synthetic tenant row rolls
# back. Until this passes, the EXIT trap must keep the previous process stopped:
# restarting an unproven client after an irreversible migration is not safety.
if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
  LEGACY_PRISMA_CLIENT_MODULE="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/@prisma/client"
  LEGACY_CLIENT_PROBE="$APP_DIR/.next/standalone/scripts/event-platform-legacy-client-probe.mjs"
  [ -d "$LEGACY_PRISMA_CLIENT_MODULE" ] || {
    EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
    fatal_after_standalone_replacement "the previous artifact has no Prisma client for the rollback compatibility proof"
  }
  [ -s "$LEGACY_CLIENT_PROBE" ] || {
    EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
    fatal_after_standalone_replacement "the legacy Prisma compatibility probe is missing from the immutable artifact"
  }
  validate_event_platform_recovery_state
  validate_event_platform_recovery_evidence
  # @prisma/client/default.js does a bare `require(".prisma/client/default")`,
  # and Node walks only directories literally called node_modules. The staged
  # tree is named `node_modules` for exactly that reason, so resolution now
  # works on its own; NODE_PATH points at the same root and is belt-and-braces,
  # not the mechanism. Keep the two in step — they were briefly not, when the
  # rename and this line landed from two different branches within the hour.
  # The cost of getting it wrong: the probe dies with MODULE_NOT_FOUND before
  # opening a single connection, and on 2026-09-07 the deploy read that as a
  # schema verdict, kept PM2 stopped after the Fund migration had already
  # committed, and took production down on a rollback proof that had never
  # once been able to run.
  # NODE_PATH is scoped to this one invocation; the probe imports nothing but
  # node: builtins and this exact client.
  if ! NODE_PATH="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules" \
      LEGACY_PRISMA_CLIENT_MODULE="$LEGACY_PRISMA_CLIENT_MODULE" \
      LEGACY_RUNTIME_DATABASE_URL="$DATABASE_URL" \
      LEGACY_VERIFY_DATABASE_URL="$MIGRATION_DATABASE_URL" \
      timeout 180 node "$LEGACY_CLIENT_PROBE"; then
    EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true
    fatal_after_standalone_replacement "the exact previous Prisma client did not pass the migrated Fund rollback proof"
  fi
  EVENT_PLATFORM_PREVIOUS_CLIENT_COMPATIBLE=true
  log "Exact previous-artifact Prisma client passed the migrated Fund rollback-window proof"
fi

# A successful Prisma exit proves only that every migration transaction
# committed. Before PM2 can see the new code, independently prove that the
# immutable event/outbox/head chain and the Fund source/projection rebuild are
# coherent. This check is read-only and fails closed; it never repairs or
# rewrites evidence during deployment.
EVENT_PLATFORM_POSTCONDITIONS_SQL="$APP_DIR/.next/standalone/scripts/event-platform-postconditions.sql"
[ -s "$EVENT_PLATFORM_POSTCONDITIONS_SQL" ] || \
  fatal_after_standalone_replacement "event-platform postcondition is missing from the immutable artifact"
if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
  EVENT_PLATFORM_POSTCONDITION_MODE="deep"
  EVENT_PLATFORM_POSTCONDITION_TIMEOUT_SECONDS=7200
  EVENT_PLATFORM_POSTCONDITION_PGOPTIONS="-c app.event_platform_force_deep=on -c statement_timeout=0"
else
  EVENT_PLATFORM_POSTCONDITION_MODE="structural"
  EVENT_PLATFORM_POSTCONDITION_TIMEOUT_SECONDS=180
  EVENT_PLATFORM_POSTCONDITION_PGOPTIONS="-c app.event_platform_force_deep=off -c statement_timeout=120s"
fi
if ! PGOPTIONS="$EVENT_PLATFORM_POSTCONDITION_PGOPTIONS" \
  timeout "$EVENT_PLATFORM_POSTCONDITION_TIMEOUT_SECONDS" \
  psql "$MIGRATION_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f "$EVENT_PLATFORM_POSTCONDITIONS_SQL" 2>&1; then
  fatal_after_standalone_replacement "event-platform ledger/schema postconditions failed"
fi
log "Event-platform $EVENT_PLATFORM_POSTCONDITION_MODE ledger, RLS, ownership, exact-money and Fund projection postconditions verified"
if [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ] \
   && [ "$EVENT_PLATFORM_PREVIOUS_CLIENT_COMPATIBLE" = "true" ]; then
  mark_event_platform_cutover_verified
fi

# Recheck the immutable artifact, successful ledger row, and all 73 exact keys
# from the extracted bundle before PM2 can activate the new application code.
EXTRACTED_TENANT_CASCADE_MIGRATION="$APP_DIR/.next/standalone/prisma/migrations/$TENANT_CASCADE_MIGRATION/migration.sql"
EXTRACTED_TENANT_CASCADE_STATE_SQL="$APP_DIR/.next/standalone/$TENANT_CASCADE_STATE_SQL"
EXTRACTED_TENANT_CASCADE_CHECKSUM=$(sha256sum "$EXTRACTED_TENANT_CASCADE_MIGRATION" | awk '{print $1}') || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: cannot hash the successful migration"
[ "$EXTRACTED_TENANT_CASCADE_CHECKSUM" = "$TENANT_CASCADE_SUCCESS_CHECKSUM" ] || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: successful migration artifact changed"
EXTRACTED_TENANT_CASCADE_STATE_SQL_CHECKSUM=$(sha256sum "$EXTRACTED_TENANT_CASCADE_STATE_SQL" | awk '{print $1}') || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: cannot hash the catalog query"
[ "$EXTRACTED_TENANT_CASCADE_STATE_SQL_CHECKSUM" = "$TENANT_CASCADE_STATE_SQL_CHECKSUM" ] || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: catalog query artifact changed"

TENANT_CASCADE_LEDGER_STATE=$(tenant_cascade_ledger_state) || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: cannot inspect migration ledger"
[ "$TENANT_CASCADE_LEDGER_STATE" = "1|1|0" ] || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: migration ledger is incomplete"
TENANT_CASCADE_CATALOG_STATE=$(
  psql "$MIGRATION_DATABASE_URL" -X -qAtF '|' -v ON_ERROR_STOP=1 \
    -c "BEGIN TRANSACTION READ ONLY;" \
    -f "$EXTRACTED_TENANT_CASCADE_STATE_SQL" \
    -c "COMMIT;" 2>/dev/null
) || fatal_after_standalone_replacement "tenant cascade postcondition failed: cannot inspect catalog state"
validate_tenant_cascade_catalog_state "$TENANT_CASCADE_CATALOG_STATE" || \
  fatal_after_standalone_replacement "tenant cascade postcondition failed: catalog state is incomplete"
TENANT_CASCADE_SCHEMA_STATE="$TENANT_CASCADE_LEDGER_STATE|$TENANT_CASCADE_CATALOG_STATE"

# Verify the two safety migrations structurally before allowing PM2 to see the
# new bundle. This catches an incomplete ledger resolution, an invalid index,
# an unvalidated constraint, or a missing append-only trigger.
VOICE_SAFETY_SCHEMA_STATE=$(
  psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
    "SELECT
       (SELECT count(*) FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND (
          (migration_name = '$CALL_TARGET_MIGRATION' AND checksum = '$CALL_TARGET_FIXED_CHECKSUM')
          OR
          (migration_name = '$VOICE_PERMISSION_MIGRATION' AND checksum = '$VOICE_PERMISSION_FIXED_CHECKSUM')
        ))::text,
       (SELECT count(*) FROM _prisma_migrations
        WHERE migration_name = '$CALL_TARGET_MIGRATION'
          AND checksum = '$CALL_TARGET_FAILED_CHECKSUM'
          AND rolled_back_at IS NOT NULL)::text,
       (SELECT count(*) FROM _prisma_migrations
        WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'call_logs'
          AND column_name = 'targetPhoneE164'
          AND data_type = 'text' AND is_nullable = 'YES')::text,
       (SELECT count(*) FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public' AND r.relname = 'call_logs'
          AND c.conname = 'call_logs_target_phone_e164_check'
          AND c.contype = 'c' AND c.convalidated)::text,
       (SELECT count(*) FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class r ON r.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public' AND r.relname = 'call_logs'
          AND idx.relname = 'call_logs_org_target_phone_e164_idx'
          AND i.indisvalid AND i.indisready AND i.indislive
          AND NOT i.indisunique AND i.indpred IS NULL
          AND pg_get_indexdef(i.indexrelid) LIKE '%(\"organizationId\", \"targetPhoneE164\")')::text,
       (SELECT count(*) FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class r ON r.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
          AND idx.relname = 'audit_logs_voice_permission_request_key'
          AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique
          AND pg_get_expr(i.indpred, i.indrelid) = '((\"entityType\" = ''lead_voice_permission''::text) AND (\"entityId\" IS NOT NULL))')::text,
       (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'protect_voice_permission_audit_row'
          AND p.pronargs = 0
          AND p.prosrc LIKE '%OLD.\"entityType\" = ''lead_voice_permission''%'
          AND p.prosrc LIKE '%TG_OP = ''DELETE''%')::text,
       (SELECT count(*) FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
          AND t.tgname = 'audit_logs_voice_permission_append_only'
          AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A'))::text;" \
    2>/dev/null
) || fatal_after_standalone_replacement "cannot verify voice safety migration postconditions"

[ "$VOICE_SAFETY_SCHEMA_STATE" = "2|1|0|1|1|1|1|1|1" ] || \
  fatal_after_standalone_replacement "voice safety migration postconditions are incomplete"

if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate status --schema="$SCHEMA_TO_USE" 2>&1; then
  fatal_after_standalone_replacement "Prisma migration status is not clean after voice safety recovery"
fi

# Do not let the BYPASSRLS credential reach backfill scripts or PM2. The
# application process must inherit only DATABASE_URL from the app-owned .env.
unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE MIGRATION_WINDOW_ATTEMPTS

# Backfill/operator state is deploy-owned, not application-process-owned. Move
# it only after the immutable artifact and schema have passed their checks, but
# before the idempotent backfills below need their external ledger paths.
prepare_runtime_state_cutover

# ── Step 3b: One-shot WhatsApp env → ChannelConfig backfill for LeadDrive ──
# After the whatsapp_multitenant migration, the runtime library reads creds
# from ChannelConfig instead of env. LeadDrive tenant's creds live in env on
# this box, so we seed them into its ChannelConfig row. Idempotent.
MIG_SCRIPT_STANDALONE="$APP_DIR/.next/standalone/scripts/migrate-leaddrive-whatsapp.mjs"
if [ -f "$MIG_SCRIPT_STANDALONE" ]; then
  node "$MIG_SCRIPT_STANDALONE" 2>&1 || log "WARNING: wa-migrate returned non-zero (non-fatal)"
else
  log "WARNING: wa-migrate helper missing from standalone artifact (non-fatal)"
fi

# ── Step 3c: One-shot backfill — re-attach plan-default features per tenant ──
# Fixes regression from commit 560bf202 where the sidebar's enterprise-plan
# bypass was removed: tenants that pre-date a feature (e.g. complaints_register)
# never had it written into their Organization.features row, so the sidebar item
# silently disappeared.
#
# IMPORTANT: gated by a sentinel file so it runs exactly ONCE per server. After
# the first successful run, an admin's intentional OFF-toggle in the per-tenant
# edit UI (`/admin/tenants/<id>/edit` → "Complaints Register: off") survives
# subsequent deploys. Without the sentinel, every deploy would re-add the
# plan-default features and silently undo the admin's choice.
#
# To force a re-run (e.g. after adding a new entry to TENANT_PLANS.features in
# src/lib/tenant-plans.ts) bump the sentinel version: change the path below to
# `.backfill-plan-features-v2-done`, etc.
PF_SENTINEL="$RUNTIME_STATE_DIR/backfills/plan-features-v1.done"
PF_SCRIPT_STANDALONE="$APP_DIR/.next/standalone/scripts/backfill-plan-features.mjs"
if [ -f "$PF_SENTINEL" ]; then
  log "plan-features backfill: sentinel present, skipping"
elif [ -f "$PF_SCRIPT_STANDALONE" ]; then
  if node "$PF_SCRIPT_STANDALONE" --execute 2>&1; then
    touch "$PF_SENTINEL" && log "plan-features backfill: done, sentinel set"
  else
    log "WARNING: plan-features backfill returned non-zero (non-fatal); sentinel NOT set, will retry next deploy"
  fi
else
  log "WARNING: plan-features backfill helper missing from standalone artifact (non-fatal)"
fi

# ── Step 3d: One-shot backfill — inject BASE_PLAN_MODULES per tenant ─────
# Companion to Step 3c. The new authoritative-modules branch in `hasModule()`
# (src/lib/modules.ts) makes Organization.features the source-of-truth for
# which sidebar pages a new-tier tenant sees. Before this semantic shipped,
# BASE_PLAN_MODULES (deals/leads/tasks/etc.) were short-circuited to enabled
# regardless of features — so most tenants' features arrays are sparse and
# don't include them. Without this backfill, those tenants would lose every
# base module from their sidebar after the new code restarts.
#
# Versioned ledger pattern (slice-3 piece-1 architect P3 closed 2026-05-29):
# Each version of BASE_PLAN_MODULES that needs to run gets its own line
# in `.backfill-base-modules.log`. Replaces the prior `-vN-done` boolean
# sentinel which forced a `vN→vN+1` rename in this file each time
# BASE_PLAN_MODULES grew. The script tags itself with `BACKFILL_VERSION`
# so we ask the ledger "has this version run?" instead of asking the
# filename. Idempotent across redeploys; admin's pre-existing OFF intent
# on plan-default features still survives the Set-merge backfill.
BM_LEDGER="$RUNTIME_STATE_DIR/backfills/base-modules.log"
BM_SCRIPT_STANDALONE="$APP_DIR/.next/standalone/scripts/backfill-base-modules.mjs"
BM_SCRIPT="$BM_SCRIPT_STANDALONE"
if [ -f "$BM_SCRIPT" ]; then
  # One-time migration: PROD servers that ran the prior sentinel logic
  # still carry `.backfill-base-modules-v2-done` (boolean file). Translate
  # that into the new ledger so we don't redundantly re-run the
  # idempotent Set-merge backfill on the first post-upgrade deploy.
  if [ -f "$RUNTIME_STATE_DIR/backfills/base-modules-v2.done" ] && [ ! -f "$BM_LEDGER" ]; then
    echo "v2" > "$BM_LEDGER" && log "base-modules backfill: migrated legacy v2 sentinel into new ledger"
  fi
  # Read the script's version by GREPPING the `BACKFILL_VERSION` constant out
  # of the source. Do NOT `node -e "import(...)"` it: importing used to execute
  # the script's top-level main() (a dry-run), so the captured "version" became
  # a multi-line log dump that never matched the ledger — making the EXECUTE
  # re-run on EVERY deploy and re-add plan modules admins had toggled OFF
  # (brandprotection regression, 2026-07-09). Grep is side-effect free.
  # Falls back to "v2" if the constant is missing (script too old).
  BM_VERSION=$(grep -oE 'BACKFILL_VERSION *= *"v[0-9]+"' "$BM_SCRIPT" 2>/dev/null | head -1 | grep -oE 'v[0-9]+' || true)
  [ -n "$BM_VERSION" ] || BM_VERSION="v2"
  if [ -f "$BM_LEDGER" ] && grep -qxF "$BM_VERSION" "$BM_LEDGER" 2>/dev/null; then
    log "base-modules backfill: version $BM_VERSION already in ledger, skipping"
  else
    if node "$BM_SCRIPT" --execute 2>&1; then
      echo "$BM_VERSION" >> "$BM_LEDGER" && log "base-modules backfill: $BM_VERSION done, ledger updated"
    else
      # FAIL-FATAL (as of v3): the authoritative-modules gate (src/lib/modules.ts)
      # reads Organization.features ONLY — the plan-name override is gone. If this
      # backfill fails but PM2 restarts with the new code, tenants whose `features`
      # weren't populated lose paid modules. So abort before restart; the live PM2
      # keeps serving the previous (pre-authoritative) deployment. Abort-before-restart: live PM2 keeps serving the old code.
      log "FATAL: base-modules backfill ($BM_VERSION) returned non-zero. Aborting before PM2 restart so the live process keeps serving old code (paid modules stay visible)."
      if [ -d "$BACKUP_PATH/standalone" ]; then
        safe_remove_tree "$APP_DIR/.next/standalone"
        cp -a -- "$BACKUP_PATH/standalone" "$APP_DIR/.next/standalone"
        log "Standalone restored from $BACKUP_PATH."
      fi
      exit 1
    fi
  fi
else
  # Script absent (tarball regression / incomplete archive). If the v3 backfill
  # hasn't run yet, shipping the authoritative-modules gate without populating
  # `features` would strip paid modules from tenants. FATAL unless the ledger
  # already shows v3 applied (then a missing script is harmless). Abort-before-restart: live PM2 keeps serving the old code.
  if [ -f "$BM_LEDGER" ] && grep -qE "^v3\$" "$BM_LEDGER" 2>/dev/null; then
    log "base-modules backfill: script absent but v3 already in ledger — harmless, skipping"
  else
    log "FATAL: base-modules backfill script not found and v3 not yet applied. The authoritative-modules gate needs it. Aborting before PM2 restart."
    if [ -d "$BACKUP_PATH/standalone" ]; then
      safe_remove_tree "$APP_DIR/.next/standalone"
      cp -a -- "$BACKUP_PATH/standalone" "$APP_DIR/.next/standalone"
      log "Standalone restored from $BACKUP_PATH."
    fi
    exit 1
  fi
fi

# ── Step 3f: Idempotent app marketplace catalog seed ───────
# The marketplace UI reads the global `apps` table. The first-party catalog
# lives in code, so every deploy re-upserts those rows; safe across reruns and
# prevents `/marketplace` from showing an empty catalog on fresh production DBs.
APP_CATALOG_SCRIPT_STANDALONE="$APP_DIR/.next/standalone/scripts/seed-app-catalog.mjs"
if [ -f "$APP_CATALOG_SCRIPT_STANDALONE" ]; then
  node "$APP_CATALOG_SCRIPT_STANDALONE" --execute 2>&1 || log "WARNING: app catalog seed returned non-zero (non-fatal)"
fi

# ── Step 4: Stop old process, cut over runtime, restart PM2 ─────────
log "Stopping old processes..."
cd "$APP_DIR"

# From this point the process handoff and health-check rollback own the live
# state. Any implicit failure must restore the previous artifact and restart
# it; do not leave production without a PM2 process after a failed handoff.
HANDOFF_STARTED=true

# Delete existing PM2 process (ignore errors if not found)
pm2 delete "$PM2_PROCESS" 2>/dev/null || true

# The softphone relay is a SECOND app in the same ecosystem file, present only
# when the server holds its secrets. Two reasons this line exists:
#   * `pm2 start ecosystem.config.cjs` refuses an app that is already running,
#     and that refusal is a non-zero exit — it would fail the whole deploy.
#   * without it the relay would keep running the code from the deploy before
#     this one, silently, while everything else moved forward.
# A deploy therefore drops a browser call in progress, exactly as it already
# drops in-flight web requests. Harmless when the app is absent.
pm2 delete softphone-relay 2>/dev/null || true

# Kill ANY process holding port 3001 (orphan from previous deploys)
fuser -k 3001/tcp 2>/dev/null || true
sleep 2

# Double-check port is free
if ss -tlnp | grep -q ":3001 "; then
  log "WARNING: port 3001 still occupied, force killing..."
  fuser -k -9 3001/tcp 2>/dev/null || true
  sleep 2
fi

log "Starting PM2..."

# The old process is stopped. This is the only safe point to move the final
# bytes without a dual-write/fallback race. Old artifacts remain compatible
# through source-path symlinks if health rollback becomes necessary.
finalize_runtime_data_cutover
mkdir -p "$HELP_VIDEO_ASSET_DIR_DEFAULT"
if [ -d "$BUNDLED_HELP_VIDEO_DIR" ]; then
  cp -a "$BUNDLED_HELP_VIDEO_DIR/." "$HELP_VIDEO_ASSET_DIR_DEFAULT/"
  HELP_VIDEO_ASSETS_COPIED=true
  log "Bundled help video assets copied → $HELP_VIDEO_ASSET_DIR_DEFAULT"
fi

PM2_CONFIG="$APP_DIR/.next/standalone/ecosystem.config.cjs"
[ -f "$PM2_CONFIG" ] || fatal "PM2 configuration is missing from the standalone artifact"
pm2 start "$PM2_CONFIG" 2>/dev/null || {
  log "FATAL: PM2 start failed"
  exit 1
}

# Save PM2 state for reboot persistence
pm2 save 2>/dev/null || fatal "cannot persist PM2 application state"
harden_pm2_reboot_dump || fatal "cannot harden persisted PM2 application state"

# ── Step 6: Health check (5 retries, longer warmup) ──────
log "Health check (waiting for startup)..."
sleep 15

# Warm up the app — first requests to Next.js 16 standalone can 500
curl -s -o /dev/null --max-time 10 "$HEALTH_URL/login" 2>/dev/null || true
sleep 5

HEALTHY=false
for i in 1 2 3 4 5; do
  log "Health check attempt $i/5..."
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL/login" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ]; then
    # Page responds — now verify CSS actually loads.
    # Same pipefail trap as the tar-grep guard at line 67: `head -1`
    # early-exits → SIGPIPE on grep → pipefail bubbles up → command
    # substitution fails. Soft failure path (CSS_URL stays empty, retry
    # loop catches it), but scope a `set +o pipefail` in a subshell to
    # match the deliberate intent: "first CSS URL is enough."
    CSS_URL=$( set +o pipefail; curl -s --max-time 10 "$HEALTH_URL/login" 2>/dev/null | grep -o '/_next/static/[^"]*\.css' | head -1 )

    if [ -n "$CSS_URL" ]; then
      CSS_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${HEALTH_URL}${CSS_URL}" 2>/dev/null || echo "000")
      if [ "$CSS_CODE" = "200" ]; then
        # DB-path probe — hits /api/v1/ping which runs prisma.organization.count().
        # Routine releases retain the historical soft behavior because an old
        # bundle may lack this endpoint and first-hit Prisma warmup has caused
        # false rollbacks. The one-time Fund cutover is different: migration
        # checks use the privileged migration URL, so only a 200 here proves
        # the candidate's actual web-role Prisma client/engine/URL path works.
        # Five outer attempts provide the warm-up allowance before the already
        # proven-compatible previous artifact is restored.
        DB_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL/api/v1/ping" 2>/dev/null || echo "000")
        if [ "$DB_CODE" = "200" ]; then
          log "DB probe: 200 (Prisma engine loaded, DB reachable)"
          HEALTHY=true
          log "PASSED (page: $HTTP_CODE, CSS: $CSS_CODE, db: $DB_CODE)"
          break
        elif [ "$EVENT_PLATFORM_REQUIRES_VERIFICATION" = "true" ]; then
          log "Fund cutover requires /api/v1/ping=200; candidate DB path returned $DB_CODE"
        elif [ "$DB_CODE" = "404" ]; then
          log "DB probe: 404 (ping endpoint not in this build — older version, treating as pass)"
          HEALTHY=true
          log "PASSED (page: $HTTP_CODE, CSS: $CSS_CODE, db: $DB_CODE)"
          break
        else
          log "DB probe: $DB_CODE (non-fatal — server booted, check /api/v1/ping after deploy)"
          HEALTHY=true
          log "PASSED (page: $HTTP_CODE, CSS: $CSS_CODE, db: $DB_CODE)"
          break
        fi
      else
        log "CSS returned $CSS_CODE (expected 200)"
      fi
    else
      log "No CSS URL found in page HTML"
    fi
  else
    log "Page returned $HTTP_CODE (expected 200 or 307)"
  fi

  [ "$i" -lt 5 ] && sleep 8
done

# ── Step 7: Rollback if unhealthy ──────────────────────────
if [ "$HEALTHY" = false ]; then
  log "HEALTH CHECK FAILED — initiating rollback!"
  if recover_application_handoff; then
    log "ROLLED BACK to previous version. Deploy FAILED."
  else
    log "FATAL: rollback handoff recovery failed; manual intervention is required"
  fi
  exit 1
fi

# The application and its rollback-compatible runtime paths are healthy. Later
# operational installation failures must fail the workflow visibly, but must
# not take the healthy web process down by restoring an older artifact.
HANDOFF_STARTED=false
HANDOFF_RECOVERY_COMPLETE=true
STANDALONE_REPLACED=false

# ── Step 8: Install external singleton/outbox schedules ─────
RESILIENCE_CRON_INSTALLER="$APP_DIR/.next/standalone/scripts/install-resilience-crons.sh"
[ -x "$RESILIENCE_CRON_INSTALLER" ] || fatal "Resilience cron installer is missing or not executable"
prepare_operations_crontab_rollback
install_release_owned_operations "$APP_DIR/.next/standalone" full-recovery
migrate_legacy_cron_paths
log "Installing managed resilience and social outbound schedules..."
run_resilience_cron_installer "$RESILIENCE_CRON_INSTALLER"
if awk '!/^[[:space:]]*#/ && /\/opt\/leaddrive-v2(\/\.next\/standalone)?\/scripts\// { found = 1 } END { exit found }' "$OPERATIONS_CRONTAB_EXPECTED"; then
  :
else
  fatal "active root crontab still references a checkout or standalone script after managed schedule installation"
fi
# Do not finalize the immutable operations transaction until the root anchor,
# exact remote object and timer are all proved. A failed proof leaves the
# pointer/configuration rollback journal intact instead of certifying a mixed
# recovery boundary.
#
# On an uncommissioned host there is nothing here that can be proved, and
# nothing that pretending would gain. The genesis needs $BACKUP_EVIDENCE_ROOT
# to exist as a root-only directory (it does not) and needs one successful run
# of leaddrive-log-ship.service, which cannot start because the pinned `age`
# binary was never installed. Running it anyway turns a healthy, already
# cut-over deployment red at its last step. Skipped loudly instead, and the
# activation journal is still closed so the operations pointer does not stay
# mid-transaction. Completing docs/BACKUP_RUNBOOK.md flips this back on its
# own: the mode is read from BACKUP_ENCRYPTION on the host, not from here.
if [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then
  log "Recovery gate: plain mode — skipping the immutable log-evidence genesis; off-box log shipping stays inactive until docs/BACKUP_RUNBOOK.md is completed"
else
  complete_log_evidence_genesis
fi
finalize_operations_activation_after_genesis

# ── Step 9: Purge replaced help-video assets at Cloudflare ─
if [ "$HELP_VIDEO_ASSETS_COPIED" = true ]; then
  HELP_VIDEO_PURGE_SCRIPT="$APP_DIR/.next/standalone/scripts/cf-purge-help-videos.mjs"
  HELP_VIDEO_VERSION_FILE="$APP_DIR/.next/standalone/help-videos/asset-version"

  [ -f "$HELP_VIDEO_PURGE_SCRIPT" ] || fatal "Help-video purge helper is missing from the standalone bundle"
  [ -s "$HELP_VIDEO_VERSION_FILE" ] || fatal "Help-video asset version is missing from the standalone bundle"
  require_env CLOUDFLARE_ZONE_ID
  require_env CLOUDFLARE_API_TOKEN

  HELP_VIDEO_ASSET_VERSION="$(tr -d '\r\n' < "$HELP_VIDEO_VERSION_FILE")"
  mapfile -d '' -t HELP_VIDEO_FILES < <(
    find "$BUNDLED_HELP_VIDEO_DIR" -maxdepth 1 -type f \
      \( -name '*.VOICE.mp4' -o -name '*.poster.jpg' \) \
      -printf '%f\0' | sort -z
  )

  if [ "${#HELP_VIDEO_FILES[@]}" -gt 0 ]; then
    log "Purging ${#HELP_VIDEO_FILES[@]} help-video URLs at Cloudflare (version=$HELP_VIDEO_ASSET_VERSION)..."
    if node "$HELP_VIDEO_PURGE_SCRIPT" \
      --env "$APP_ENV_FILE" \
      --base-url "${HELP_VIDEO_PUBLIC_BASE_URL:-$HELP_VIDEO_PUBLIC_BASE_URL_DEFAULT}" \
      --version "$HELP_VIDEO_ASSET_VERSION" \
      "${HELP_VIDEO_FILES[@]}"; then
      log "Cloudflare help-video purge completed"
    else
      log "WARNING: Cloudflare help-video purge failed after the app became healthy; continuing the deploy because the application and database health checks passed"
    fi
  else
    log "No bundled help-video assets matched the purge patterns"
  fi
fi

# ── Step 10: Cleanup ──────────────────────────────────────
log "Cleaning up..."
cd "$BACKUP_DIR"
ls -dt backup-* 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true
rm -f "$DEPLOY_TAR" /tmp/server-deploy.sh

# ── Step 11: Deploy summary (greppable single-line audit row) ──
COMMIT_SHORT="${DEPLOY_SHA:0:7}"
PRISMA_ENGINE_NAME=$(ls $PRISMA_ENGINE_PATTERN 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo "missing")
log "SUMMARY commit=$COMMIT_SHORT backup=$(basename "$BACKUP_PATH") css_files=$CSS_COUNT js_files=$JS_COUNT prisma_engine=$PRISMA_ENGINE_NAME health=$HTTP_CODE css_check=$CSS_CODE db_probe=$DB_CODE"
log "Deploy complete! App running on $HEALTH_URL"
