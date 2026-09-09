#!/usr/bin/env bash
set -Eeuo pipefail

# Bounded production commissioning for the PostgreSQL backup runner. This file
# is streamed from an exact current main revision. It never accepts, generates,
# reads, or prints an age private identity.

umask 077

OPERATION="${1:-}"
CONFIRMATION="${2:-}"
WORKFLOW_SHA="${3:-}"
WORKFLOW_ACTOR="${4:-}"
WORKFLOW_RUN_ID="${5:-}"
EXPECTED_RECIPIENT_SHA256="${6:-}"
KEY_CUSTODY_ATTESTATION="${7:-}"
EVIDENCE_REF="${8:-}"
EVIDENCE_AT_UTC="${9:-}"
OFFLINE_OPERATOR="${10:-}"
EXPECTED_CANDIDATE_SHA256="${11:-}"
REMOTE_INPUT_STAGE="${12:-}"

BACKUP_ENV_FILE="/etc/leaddrive/backup.env"
BACKUP_SERVICE="leaddrive-postgres-backup.service"
BACKUP_TIMER="leaddrive-postgres-backup.timer"
BACKUP_RUNTIME_LOCK="/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock"
SECRETS_SERVICE="leaddrive-secrets-snapshot.service"
SECRETS_TIMER="leaddrive-secrets-snapshot.timer"
SECRETS_RUNTIME_LOCK="/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock"
RUNTIME_FILES_SERVICE="leaddrive-runtime-files-snapshot.service"
RUNTIME_FILES_TIMER="leaddrive-runtime-files-snapshot.timer"
RUNTIME_FILES_RUNTIME_LOCK="/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock"
LOG_SERVICE="leaddrive-log-ship.service"
LOG_TIMER="leaddrive-log-ship.timer"
LOG_RUNTIME_LOCK="/var/lib/leaddrive-recovery-runner-locks/log-ship.lock"
COMMISSION_LOCK="/run/lock/leaddrive-backup-commission.lock"
COMMISSION_STATE_ROOT="/var/lib/leaddrive-backup-commission"
COMMISSION_FENCE_JOURNAL="$COMMISSION_STATE_ROOT/runner-fence.env"
EVIDENCE_ROOT="/etc/leaddrive/backup-evidence"
CUSTODY_MARKER="$EVIDENCE_ROOT/key-custody.env"
CANDIDATE_DIR="$EVIDENCE_ROOT/candidates"
RESTORE_DIR="$EVIDENCE_ROOT/restores"
SIGNED_DIR="$EVIDENCE_ROOT/signed"
CURRENT_RESTORE_MARKER="$EVIDENCE_ROOT/offline-restore-current.env"
BOOTSTRAP_RESTORE_MARKER="$EVIDENCE_ROOT/bootstrap-offline-restore-current.env"
OFFLINE_ALLOWED_SIGNERS="$EVIDENCE_ROOT/offline-allowed-signers"
LOG_GENESIS_ANCHOR="$EVIDENCE_ROOT/log-evidence-genesis.env"
LOG_STATE_DIR="/var/lib/leaddrive-log-ship"
LOG_STATE_FILE="$LOG_STATE_DIR/log-ship-offsets"
LOG_BOOTSTRAP_TRANSACTION="$LOG_STATE_DIR/bootstrap-transaction"
LOG_BOOTSTRAP_PREPARING="$LOG_STATE_DIR/bootstrap-transaction.preparing"
LOG_BOOTSTRAP_TOMBSTONE="$LOG_STATE_DIR/bootstrap-transaction.committed"
OPS_RELEASES_DIR="/usr/local/lib/leaddrive-v2/ops/releases"
INCOMING_EVIDENCE_BUNDLE=""
INCOMING_ALLOWED_SIGNERS=""
INCOMING_CODE_BUNDLE=""

TOOLS_ROOT="/usr/local/lib/leaddrive-backup/tools"
AGE_VERSION="1.3.2"
AGE_ARCHIVE_SHA256="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"
AGE_BINARY_SHA256="eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c"
AGE_ROOT="$TOOLS_ROOT/age/$AGE_VERSION"
AGE_BIN="$AGE_ROOT/age"
AGE_PROVENANCE="$AGE_ROOT/LEADDRIVE_PROVENANCE"
AGE_LINK="/usr/local/bin/age"

AWS_VERSION="2.36.40"
AWS_ARCHIVE_SHA256="a904e314340ad4c4b62beb50e9259d4becb2acf3dffc86c96c553c834d7fdf7a"
AWS_SIGNING_FINGERPRINT="FB5DB77FD5C118B80511ADA8A6310ACC4672475C"
AWS_ROOT="$TOOLS_ROOT/aws-cli/$AWS_VERSION"
AWS_BIN="$AWS_ROOT/v2/current/bin/aws"
AWS_REAL_BIN="$AWS_ROOT/v2/$AWS_VERSION/dist/aws"
AWS_PROVENANCE="$AWS_ROOT/LEADDRIVE_PROVENANCE"
AWS_LINK="/usr/local/bin/aws"

# Filled from the reviewed offline helper files before this branch is merged.
# The signed evidence must prove that the independent operator ran these exact
# bytes from the exact main revision, not an arbitrary look-alike verifier.
CUSTODY_VERIFIER_SHA256="a02101a2e9ae313c7486d31337b9efe771ea2127d565b059d6e2427df86eca91"
ARCHIVE_VERIFIER_SHA256="c6d4caabb1f44db3036c79d59b63253f961fa8ce29780724c9d15667dac644a6"
POSTGRES_BACKUP_SHA256="ddf2142311b6c7ad561e510369925ca3f5347f667966a5c265451c0823e4e065"
SECRETS_SNAPSHOT_SHA256="16d4bf083ad2549cd34e1bd89a53ee958f1625605235fe5370c8acecc401de99"
RUNTIME_FILES_SNAPSHOT_SHA256="d5fe33b4b0b0e581194b3aff770eca45a14a493774ec314340146bd69475e53e"
RESTORE_CANARY_SHA256="af743a9bd8df3daa6ba6b60d90141daea28629f6140d8d12d1623f6b083f5d9e"
PII_PROOF_SHA256="e83f3fc65c56e0dc8db7eb26e47780c0901917908c05d7aa6552792a37f99e18"
CANARY_SQL_SHA256="5c3a9bf2b14c84c4deafa31525ac23518ba2290ab32a7cf5f66e2d05d4b249c9"

WORK_DIR=""
JOURNAL_FILE=""
ENV_STAGE=""
MARKER_STAGE=""
SIGNED_STAGE=""
CODE_STAGE=""
AGE_STAGE=""
AWS_STAGE=""
BACKUP_SERVICE_RUNTIME_MASKED=0
SECRETS_SERVICE_RUNTIME_MASKED=0
RUNTIME_FILES_SERVICE_RUNTIME_MASKED=0
LOG_SERVICE_RUNTIME_MASKED=0
BACKUP_LOCK_HELD=0
SECRETS_LOCK_HELD=0
RUNTIME_FILES_LOCK_HELD=0
LOG_LOCK_HELD=0
INSTALL_COMMITTED=0
AGE_ROOT_CREATED=0
AWS_ROOT_CREATED=0
AGE_LINK_CREATED=0
AWS_LINK_CREATED=0
CUSTODY_MARKER_CREATED=0
ALLOWED_SIGNERS_CREATED=0
SIGNED_EVIDENCE_SHA256=""
SIGNED_SIGNATURE_SHA256=""
ALLOWED_SIGNERS_SHA256=""
SIGNED_EVIDENCE_FILE=""
SIGNED_SIGNATURE_FILE=""
RECOVERY_CATALOG_OBJECT_KEY=""
RECOVERY_CATALOG_OBJECT_VERSION_ID=""
RECOVERY_CATALOG_SHA256=""
RECOVERY_CATALOG_BYTES=""
RECOVERY_CATALOG_CREATED_AT_UTC=""
RECOVERY_CATALOG_RETENTION_DAYS=""
RECOVERY_CATALOG_RETAIN_UNTIL=""
COMMISSION_POSTGRES_SHA256=""
COMMISSION_RESTORE_SHA256=""
COMMISSION_CANARY_SHA256=""
COMMISSION_SECRETS_SHA256=""
COMMISSION_RUNTIME_FILES_SHA256=""
COMMISSION_SHIP_LOGS_SHA256=""
COMMISSION_RECOVERY_PROGRAM_SET_SHA256=""
COMMISSION_RECOVERY_DB_CONTRACT_SHA256=""
ACTIVE_TRANSIENT_UNIT=""
COMMISSION_FENCE_STAGE=""
LOG_GENESIS_ANCHOR_SHA256=""
LOG_GENESIS_ANCHOR_BYTES=""
LOG_GENESIS_EVIDENCE_START_AT=""
LOG_GENESIS_OBJECT_KEY=""
LOG_GENESIS_OBJECT_VERSION_ID=""
LOG_GENESIS_CIPHERTEXT_SHA256=""
LOG_GENESIS_CIPHERTEXT_BYTES=""
LOG_GENESIS_OBJECT_FORMAT_VERSION=""
LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA=""
LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=""
LOG_GENESIS_RANGES_SHA256=""
LOG_GENESIS_FILE_RANGE_COUNT=""
LOG_GENESIS_FILE_RANGE_BYTES=""
LOG_GENESIS_JOURNAL_RANGE_COUNT=""
LOG_GENESIS_CURSOR_SHA256=""
LOG_GENESIS_OBJECT_CREATED_AT=""
LOG_GENESIS_RETAIN_UNTIL=""
LOG_GENESIS_SHIP_LOGS_SHA256=""
BOOTSTRAP_CERTIFICATE_MARKER_SHA256=""
BOOTSTRAP_CERTIFICATE_MARKER_BYTES=""
BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256=""
BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256=""
BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256=""
BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256=""
BOOTSTRAP_CERTIFICATE_EVIDENCE_FILE=""
BOOTSTRAP_CERTIFICATE_SIGNATURE_FILE=""

log() {
  printf '[backup-commission] %s\n' "$*"
}

fatal() {
  printf '[backup-commission] FATAL: %s\n' "$*" >&2
  exit 1
}

safe_remove_stage_tree() {
  local path="$1"
  case "$path" in
    /var/tmp/leaddrive-backup-tools.*|/var/tmp/leaddrive-backup-evidence.*|/var/tmp/leaddrive-backup-commission-stage.[A-Za-z0-9]*|/run/leaddrive-backup-commission-code-[0-9]*|"$SIGNED_DIR"/.signed-stage.*|"$TOOLS_ROOT"/age/.1.3.2.stage.*|"$TOOLS_ROOT"/aws-cli/.2.36.40.stage.*|"$AGE_ROOT"|"$AWS_ROOT")
      rm -rf -- "$path"
      ;;
    *)
      [ -z "$path" ] || printf '[backup-commission] REFUSED unexpected stage cleanup: %s\n' "$path" >&2
      ;;
  esac
}

cleanup() {
  local status=$?
  trap - EXIT

  if [ -n "$ACTIVE_TRANSIENT_UNIT" ]; then
    case "$ACTIVE_TRANSIENT_UNIT" in
      leaddrive-backup-commission-*-"$WORKFLOW_RUN_ID".service)
        systemctl stop "$ACTIVE_TRANSIENT_UNIT" >/dev/null 2>&1 || status=1
        systemctl reset-failed "$ACTIVE_TRANSIENT_UNIT" >/dev/null 2>&1 || true
        ;;
      *)
        printf '[backup-commission] REFUSED unexpected transient-unit cleanup: %s\n' \
          "$ACTIVE_TRANSIENT_UNIT" >&2
        ;;
    esac
    ACTIVE_TRANSIENT_UNIT=""
  fi

  if [ "$BACKUP_LOCK_HELD" -eq 1 ]; then
    exec 8>&-
    BACKUP_LOCK_HELD=0
  fi
  if [ "$SECRETS_LOCK_HELD" -eq 1 ]; then
    exec 7>&-
    SECRETS_LOCK_HELD=0
  fi
  if [ "$RUNTIME_FILES_LOCK_HELD" -eq 1 ]; then
    exec 6>&-
    RUNTIME_FILES_LOCK_HELD=0
  fi
  if [ "$LOG_LOCK_HELD" -eq 1 ]; then
    exec 5>&-
    LOG_LOCK_HELD=0
  fi
  if [ "$BACKUP_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || [ "$SECRETS_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || [ "$RUNTIME_FILES_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || [ "$LOG_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || [ -e "$COMMISSION_FENCE_JOURNAL" ] || [ -L "$COMMISSION_FENCE_JOURNAL" ]; then
    if ! clear_commission_runner_fence; then
      printf '[backup-commission] FATAL: runner fence cleanup failed; durable recovery journal retained\n' >&2
      status=1
    fi
  fi

  if [ "$status" -ne 0 ] && [ "$INSTALL_COMMITTED" -ne 1 ]; then
    if [ "$AWS_LINK_CREATED" -eq 1 ] && [ -L "$AWS_LINK" ] \
      && [ "$(readlink -- "$AWS_LINK")" = "$AWS_BIN" ]; then
      unlink -- "$AWS_LINK"
    fi
    if [ "$AGE_LINK_CREATED" -eq 1 ] && [ -L "$AGE_LINK" ] \
      && [ "$(readlink -- "$AGE_LINK")" = "$AGE_BIN" ]; then
      unlink -- "$AGE_LINK"
    fi
    if [ "$AWS_ROOT_CREATED" -eq 1 ] && [ -d "$AWS_ROOT" ] && [ ! -L "$AWS_ROOT" ]; then
      safe_remove_stage_tree "$AWS_ROOT"
    fi
    if [ "$AGE_ROOT_CREATED" -eq 1 ] && [ -d "$AGE_ROOT" ] && [ ! -L "$AGE_ROOT" ]; then
      safe_remove_stage_tree "$AGE_ROOT"
    fi
  fi

  if [ "$status" -ne 0 ] && [ "$CUSTODY_MARKER_CREATED" -eq 1 ] \
    && [ -f "$CUSTODY_MARKER" ]; then
    unlink -- "$CUSTODY_MARKER"
  fi
  if [ "$status" -ne 0 ] && [ "$ALLOWED_SIGNERS_CREATED" -eq 1 ] \
    && [ -f "$OFFLINE_ALLOWED_SIGNERS" ]; then
    unlink -- "$OFFLINE_ALLOWED_SIGNERS"
  fi
  if [ -n "$JOURNAL_FILE" ]; then
    case "$JOURNAL_FILE" in
      /run/leaddrive-backup-commission-journal.*) unlink -- "$JOURNAL_FILE" ;;
    esac
  fi
  if [ -n "$COMMISSION_FENCE_STAGE" ]; then
    case "$COMMISSION_FENCE_STAGE" in
      "$COMMISSION_STATE_ROOT"/.runner-fence.stage.*) unlink -- "$COMMISSION_FENCE_STAGE" >/dev/null 2>&1 || true ;;
    esac
    COMMISSION_FENCE_STAGE=""
  fi
  if [ -n "$ENV_STAGE" ]; then
    case "$ENV_STAGE" in
      /etc/leaddrive/.backup.env.age-stage.*|/etc/leaddrive/.backup.env.lock-stage.*|/etc/leaddrive/.backup.env.log-retention-stage.*) unlink -- "$ENV_STAGE" ;;
    esac
  fi
  if [ -n "$MARKER_STAGE" ]; then
    case "$MARKER_STAGE" in
      "$EVIDENCE_ROOT"/.marker-stage.*|"$CANDIDATE_DIR"/.candidate-stage.*|"$RESTORE_DIR"/.restore-stage.*)
        unlink -- "$MARKER_STAGE"
        ;;
    esac
  fi
  if [ -n "$SIGNED_STAGE" ]; then
    case "$SIGNED_STAGE" in
      "$SIGNED_DIR"/.signed-stage.*) safe_remove_stage_tree "$SIGNED_STAGE" ;;
    esac
  fi
  [ -z "$CODE_STAGE" ] || safe_remove_stage_tree "$CODE_STAGE"
  [ -z "$AGE_STAGE" ] || safe_remove_stage_tree "$AGE_STAGE"
  [ -z "$AWS_STAGE" ] || safe_remove_stage_tree "$AWS_STAGE"
  [ -z "$WORK_DIR" ] || safe_remove_stage_tree "$WORK_DIR"
  if [ -n "$REMOTE_INPUT_STAGE" ]; then
    if [[ "$REMOTE_INPUT_STAGE" =~ ^/var/tmp/leaddrive-backup-commission-stage\.[A-Za-z0-9]{6,64}$ ]]; then
      safe_remove_stage_tree "$REMOTE_INPUT_STAGE"
    else
      printf '[backup-commission] REFUSED unexpected remote input stage cleanup: %s\n' "$REMOTE_INPUT_STAGE" >&2
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

[ "$(id -u)" = "0" ] || fatal "must run as root"
command -v flock >/dev/null 2>&1 || fatal "flock is required"
exec 9>"$COMMISSION_LOCK"
flock -n 9 || fatal "another backup commissioning operation is active"

[[ "$WORKFLOW_SHA" =~ ^[0-9a-f]{40}$ ]] || fatal "workflow SHA is invalid"
[[ "$WORKFLOW_ACTOR" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,78}$ ]] \
  || fatal "workflow actor is invalid"
[[ "$WORKFLOW_RUN_ID" =~ ^[0-9]{1,20}$ ]] || fatal "workflow run id is invalid"
[[ "$REMOTE_INPUT_STAGE" =~ ^/var/tmp/leaddrive-backup-commission-stage\.[A-Za-z0-9]{6,64}$ ]] \
  || fatal "remote input stage path is invalid"
[ -d "$REMOTE_INPUT_STAGE" ] && [ ! -L "$REMOTE_INPUT_STAGE" ] \
  && [ "$(stat -c '%U:%G:%a' "$REMOTE_INPUT_STAGE")" = root:root:700 ] \
  && [ "$(realpath -e -- "$REMOTE_INPUT_STAGE")" = "$REMOTE_INPUT_STAGE" ] \
  || fatal "remote input stage must be a canonical root:root 0700 directory"
INCOMING_EVIDENCE_BUNDLE="$REMOTE_INPUT_STAGE/evidence.tar"
INCOMING_ALLOWED_SIGNERS="$REMOTE_INPUT_STAGE/allowed-signers"
INCOMING_CODE_BUNDLE="$REMOTE_INPUT_STAGE/backup-code.tar"

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

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

read_unique_value_from() {
  local file="$1"
  local key="$2"
  local value status
  set +e
  value="$(read_static_env_value "$file" "$key")"
  status=$?
  set -e
  [ "$status" -eq 0 ] || fatal "$(basename -- "$file") contains duplicate $key entries"
  printf '%s' "$value"
}

read_unique_value() {
  read_unique_value_from "$BACKUP_ENV_FILE" "$1"
}

require_static_value() {
  local key="$1"
  local value
  value="$(read_unique_value "$key")"
  [ -n "$value" ] || fatal "$key is not configured"
  printf '%s' "$value"
}

assert_root_directory() {
  local label="$1"
  local directory="$2"
  local mode
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    || fatal "$label must be a real directory"
  [ "$(stat -c '%u' "$directory")" = "0" ] || fatal "$label must be root-owned"
  mode="$(stat -c '%a' "$directory")"
  (( (8#$mode & 8#022) == 0 )) || fatal "$label must not be group/world writable"
}

assert_root_file() {
  local label="$1"
  local file="$2"
  local mode
  [ -f "$file" ] && [ ! -L "$file" ] || fatal "$label must be a regular non-symlink file"
  [ "$(stat -c '%u' "$file")" = "0" ] || fatal "$label must be root-owned"
  mode="$(stat -c '%a' "$file")"
  (( (8#$mode & 8#022) == 0 )) || fatal "$label must not be group/world writable"
}

ensure_root_directory() {
  local directory="$1"
  if [ -e "$directory" ] || [ -L "$directory" ]; then
    assert_root_directory "$directory" "$directory"
  else
    install -d -o root -g root -m 0755 "$directory"
    assert_root_directory "$directory" "$directory"
  fi
}

ensure_owned_directory() {
  local directory="$1"
  local owner="$2"
  local group="$3"
  local mode="$4"
  if [ -e "$directory" ] || [ -L "$directory" ]; then
    [ -d "$directory" ] && [ ! -L "$directory" ] \
      || fatal "$directory must be a real directory"
    [ "$(stat -c '%U:%G:%a' "$directory")" = "$owner:$group:$mode" ] \
      || fatal "$directory has unreviewed ownership or mode"
  else
    install -d -o "$owner" -g "$group" -m "$mode" "$directory"
  fi
}

migrate_legacy_lock_policy() {
  local key current expected migration_required=0
  local -a policies=(
    'BACKUP_LOCK_FILE|/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock'
    'SECRETS_LOCK_FILE|/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock'
    'RUNTIME_FILES_LOCK_FILE|/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock'
    'LOG_SHIP_LOCK_FILE|/var/lib/leaddrive-recovery-runner-locks/log-ship.lock'
  )

  assert_root_file "canonical backup environment" "$BACKUP_ENV_FILE"
  for policy in "${policies[@]}"; do
    IFS='|' read -r key expected <<<"$policy"
    current="$(read_unique_value "$key")"
    case "$key:$current" in
      "$key:$expected") ;;
      BACKUP_LOCK_FILE:|BACKUP_LOCK_FILE:/run/leaddrive-backup/postgres-backup.lock|BACKUP_LOCK_FILE:/run/leaddrive-postgres-backup/postgres-backup.lock|\
      SECRETS_LOCK_FILE:|SECRETS_LOCK_FILE:/run/leaddrive-backup/snapshot-secrets.lock|SECRETS_LOCK_FILE:/run/leaddrive-secrets-snapshot/snapshot-secrets.lock|\
      RUNTIME_FILES_LOCK_FILE:|RUNTIME_FILES_LOCK_FILE:/run/leaddrive-runtime-files-snapshot/snapshot.lock|\
      LOG_SHIP_LOCK_FILE:|LOG_SHIP_LOCK_FILE:/run/leaddrive-backup/ship-logs.lock|LOG_SHIP_LOCK_FILE:/run/leaddrive-log-ship/ship-logs.lock)
        migration_required=1
        ;;
      *) fatal "$key has an unreviewed value; refusing lock-authority migration" ;;
    esac
  done
  [ "$migration_required" -eq 1 ] || return 0

  ENV_STAGE="$(mktemp /etc/leaddrive/.backup.env.lock-stage.XXXXXX)"
  awk '
    /^[[:space:]]*(export[[:space:]]+)?(BACKUP_LOCK_FILE|SECRETS_LOCK_FILE|RUNTIME_FILES_LOCK_FILE|LOG_SHIP_LOCK_FILE)[[:space:]]*=/ { next }
    { print }
  ' "$BACKUP_ENV_FILE" >"$ENV_STAGE"
  cat >>"$ENV_STAGE" <<'LOCK_POLICY'
BACKUP_LOCK_FILE=/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock
SECRETS_LOCK_FILE=/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock
RUNTIME_FILES_LOCK_FILE=/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock
LOG_SHIP_LOCK_FILE=/var/lib/leaddrive-recovery-runner-locks/log-ship.lock
LOCK_POLICY
  chown --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
  chmod --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
  for policy in "${policies[@]}"; do
    IFS='|' read -r key expected <<<"$policy"
    [ "$(read_unique_value_from "$ENV_STAGE" "$key")" = "$expected" ] \
      || fatal "staged lock-authority migration did not pin $key"
  done
  cmp -s \
    <(awk '!/^[[:space:]]*(export[[:space:]]+)?(BACKUP_LOCK_FILE|SECRETS_LOCK_FILE|RUNTIME_FILES_LOCK_FILE|LOG_SHIP_LOCK_FILE)[[:space:]]*=/' "$BACKUP_ENV_FILE") \
    <(awk '!/^[[:space:]]*(export[[:space:]]+)?(BACKUP_LOCK_FILE|SECRETS_LOCK_FILE|RUNTIME_FILES_LOCK_FILE|LOG_SHIP_LOCK_FILE)[[:space:]]*=/' "$ENV_STAGE") \
    || fatal "lock-authority migration changed unrelated backup configuration"
  sync -f -- "$ENV_STAGE" /etc/leaddrive \
    || fatal "cannot flush staged lock-authority migration"
  mv -- "$ENV_STAGE" "$BACKUP_ENV_FILE"
  ENV_STAGE=""
  sync -f -- "$BACKUP_ENV_FILE" /etc/leaddrive \
    || fatal "cannot durably commit lock-authority migration"
  log "migrated all four recovery runners to root-managed persistent lock inodes"
}

# A v3 full-recovery certificate includes the exact first log-evidence object
# in the same Object-Lock horizon as its off-host catalog.  The original
# one-year policy (365 days) cannot satisfy that contract.  This migration is
# deliberately available only through the explicit tool-install ceremony and
# only performs the monotonic 365 -> 400 transition (or adds a missing value).
migrate_log_retention_policy() {
  local current migration_required=0

  assert_root_file "canonical backup environment" "$BACKUP_ENV_FILE"
  current="$(read_unique_value LOG_SHIP_RETENTION_DAYS)"
  case "$current" in
    ''|365) migration_required=1 ;;
    *[!0-9]*) fatal "LOG_SHIP_RETENTION_DAYS has an invalid unreviewed value" ;;
    *) [ "$current" -ge 400 ] || fatal "LOG_SHIP_RETENTION_DAYS may only be migrated monotonically to at least 400 days" ;;
  esac
  [ "$migration_required" -eq 1 ] || return 0

  ENV_STAGE="$(mktemp /etc/leaddrive/.backup.env.log-retention-stage.XXXXXX)"
  awk '!/^[[:space:]]*(export[[:space:]]+)?LOG_SHIP_RETENTION_DAYS[[:space:]]*=/' \
    "$BACKUP_ENV_FILE" >"$ENV_STAGE"
  printf 'LOG_SHIP_RETENTION_DAYS=400\n' >>"$ENV_STAGE"
  chown --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
  chmod --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
  [ "$(read_unique_value_from "$ENV_STAGE" LOG_SHIP_RETENTION_DAYS)" = 400 ] \
    || fatal "staged log-retention migration did not pin the 400-day policy"
  cmp -s \
    <(awk '!/^[[:space:]]*(export[[:space:]]+)?LOG_SHIP_RETENTION_DAYS[[:space:]]*=/' "$BACKUP_ENV_FILE") \
    <(awk '!/^[[:space:]]*(export[[:space:]]+)?LOG_SHIP_RETENTION_DAYS[[:space:]]*=/' "$ENV_STAGE") \
    || fatal "log-retention migration changed unrelated backup configuration"
  sync -f -- "$ENV_STAGE" /etc/leaddrive \
    || fatal "cannot flush staged log-retention migration"
  mv -- "$ENV_STAGE" "$BACKUP_ENV_FILE"
  ENV_STAGE=""
  sync -f -- "$BACKUP_ENV_FILE" /etc/leaddrive \
    || fatal "cannot persist the 400-day log-retention policy"
  log "migrated immutable log-evidence retention monotonically to 400 days"
}

assert_recovery_policy() {
  local key value configured minimum label monthly_retention secrets_retention policy
  for policy in \
    'BACKUP_WORK_ROOT:/run/leaddrive-postgres-backup' \
    'BACKUP_STATE_ROOT:/var/lib/leaddrive-postgres-backup' \
    'BACKUP_S3_PREFIX:postgres' \
    'APP_ENV_FILE:/etc/leaddrive/app.env' \
    'SECRETS_WORK_ROOT:/run/leaddrive-secrets-snapshot' \
    'RUNTIME_FILES_SOURCE_ROOT:/var/lib/leaddrive-v2' \
    'RUNTIME_FILES_STATE_ROOT:/var/lib/leaddrive-runtime-files-snapshot' \
    'RUNTIME_FILES_WORK_ROOT:/run/leaddrive-runtime-files-snapshot' \
    'RUNTIME_FILES_S3_PREFIX:runtime-files' \
    'LOG_SHIP_SOURCE_DIRS:/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql' \
    'LOG_SHIP_SOURCE_FILES:/var/log/leaddrive-resilience-cron.log' \
    'LOG_SHIP_STATE_FILE:/var/lib/leaddrive-log-ship/log-ship-offsets' \
    'LOG_SHIP_WORK_ROOT:/run/leaddrive-log-ship' \
    'LOG_SHIP_S3_PREFIX:logs' \
    'LOG_SHIP_JOURNAL_UNITS:leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service' \
    'PGPASSFILE:/etc/leaddrive/backup.pgpass' \
    'PGSSLROOTCERT:/etc/leaddrive/managed-postgres-ca.crt' \
    'VERIFY_PGPASSFILE:/etc/leaddrive/restore-verifier.pgpass' \
    'VERIFY_PGSSLROOTCERT:/etc/leaddrive/restore-postgres-ca.crt' \
    'SECRETS_S3_PREFIX:secrets'; do
    key="${policy%%:*}"
    value="${policy#*:}"
    configured="$(read_unique_value "$key")"
    [ -z "$configured" ] || [ "$configured" = "$value" ] \
      || fatal "$key overrides the reviewed production recovery authority"
  done
  for policy in \
    'BACKUP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock' \
    'SECRETS_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock' \
    'RUNTIME_FILES_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock' \
    'LOG_SHIP_LOCK_FILE:/var/lib/leaddrive-recovery-runner-locks/log-ship.lock'; do
    key="${policy%%:*}"
    value="${policy#*:}"
    configured="$(read_unique_value "$key")"
    if [ "$configured" = "$value" ]; then
      continue
    fi
    if [ "$OPERATION" = install-backup-tools ]; then
      case "$key:$configured" in
        BACKUP_LOCK_FILE:|BACKUP_LOCK_FILE:/run/leaddrive-backup/postgres-backup.lock|BACKUP_LOCK_FILE:/run/leaddrive-postgres-backup/postgres-backup.lock|\
        SECRETS_LOCK_FILE:|SECRETS_LOCK_FILE:/run/leaddrive-backup/snapshot-secrets.lock|SECRETS_LOCK_FILE:/run/leaddrive-secrets-snapshot/snapshot-secrets.lock|\
        RUNTIME_FILES_LOCK_FILE:|RUNTIME_FILES_LOCK_FILE:/run/leaddrive-runtime-files-snapshot/snapshot.lock|\
        LOG_SHIP_LOCK_FILE:|LOG_SHIP_LOCK_FILE:/run/leaddrive-backup/ship-logs.lock|LOG_SHIP_LOCK_FILE:/run/leaddrive-log-ship/ship-logs.lock)
          continue
          ;;
      esac
    fi
    fatal "$key does not use the reviewed root-managed persistent lock authority"
  done
  for key in BACKUP_TIER_OVERRIDE SECRETS_FILES SECRETS_DRY_RUN RUNTIME_FILES_PATHS \
    LOG_SHIP_SOURCE_DIR LOG_SHIP_JOURNAL_SINCE; do
    [ -z "$(read_unique_value "$key")" ] \
      || fatal "$key is forbidden in production backup configuration"
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
    IFS=: read -r key value minimum label <<<"$policy"
    configured="$(read_unique_value "$key")"
    configured="${configured:-$value}"
    [[ "$configured" =~ ^[0-9]+$ ]] && [ "$configured" -ge "$minimum" ] \
      || fatal "$label recovery policy is below its reviewed minimum"
  done
  monthly_retention="$(read_unique_value BACKUP_RETENTION_MONTHLY_DAYS)"
  monthly_retention="${monthly_retention:-400}"
  secrets_retention="$(read_unique_value SECRETS_RETENTION_DAYS)"
  secrets_retention="${secrets_retention:-400}"
  [[ "$secrets_retention" =~ ^[0-9]+$ ]] \
    && [ "$secrets_retention" -ge "$monthly_retention" ] \
    || fatal "secrets retention must cover the longest database retention"
  [ "$(require_static_value PGSSLMODE)" = "verify-full" ] \
    || fatal "PGSSLMODE must remain verify-full"
  [ "$(require_static_value VERIFY_PGSSLMODE)" = "verify-full" ] \
    || fatal "VERIFY_PGSSLMODE must remain verify-full"
  for key in PGCONNECT_TIMEOUT VERIFY_PGCONNECT_TIMEOUT; do
    configured="$(require_static_value "$key")"
    [[ "$configured" =~ ^[0-9]+$ ]] \
      && [ "$configured" -ge 1 ] && [ "$configured" -le 30 ] \
      || fatal "$key must be between 1 and 30 seconds"
  done
  [ "$(require_static_value BACKUP_REQUIRE_HEALTHCHECK)" = "1" ] \
    || fatal "BACKUP_REQUIRE_HEALTHCHECK must remain enabled"
  for key in BACKUP_HEALTHCHECK_URL SECRETS_HEALTHCHECK_URL RUNTIME_FILES_HEALTHCHECK_URL \
    LOG_SHIP_HEALTHCHECK_URL; do
    configured="$(require_static_value "$key")"
    [[ "$configured" =~ ^https://[^[:space:]]{8,}$ ]] \
      || fatal "$key must be a non-placeholder HTTPS dead-man URL"
    [[ "${configured,,}" != *replace* ]] && [[ "${configured,,}" != *.example* ]] \
      || fatal "$key is still a placeholder"
  done
}

assert_backup_env() {
  local owner mode file
  assert_root_directory "/etc" /etc
  assert_root_directory "/etc/leaddrive" /etc/leaddrive
  assert_root_file "canonical backup environment" "$BACKUP_ENV_FILE"
  owner="$(stat -c '%U:%G' "$BACKUP_ENV_FILE")"
  mode="$(stat -c '%a' "$BACKUP_ENV_FILE")"
  { [ "$owner:$mode" = "root:root:600" ] \
      || [ "$owner:$mode" = "root:leaddrive-backup:640" ]; } \
    || fatal "canonical backup environment ownership or mode is unsafe"
  [ -z "$(read_unique_value BACKUP_ENV_FILE)" ] \
    || fatal "backup environment may not redirect BACKUP_ENV_FILE"
  assert_recovery_policy
  for file in \
    /etc/leaddrive/backup.pgpass \
    /etc/leaddrive/managed-postgres-ca.crt \
    /etc/leaddrive/restore-verifier.pgpass \
    /etc/leaddrive/restore-postgres-ca.crt; do
    assert_root_file "database connection material" "$file"
  done
  for file in /etc/leaddrive/backup.pgpass /etc/leaddrive/restore-verifier.pgpass; do
    owner="$(stat -c '%U:%G:%a' "$file")"
    { [ "$owner" = "root:leaddrive-backup:640" ] \
        || [ "$owner" = "root:leaddrive-backup:440" ]; } \
      || fatal "$file must be root:leaddrive-backup mode 0640 or 0440"
  done
  for file in /etc/leaddrive/managed-postgres-ca.crt /etc/leaddrive/restore-postgres-ca.crt; do
    mode="$(stat -c '%a' "$file")"
    case "$mode" in 400|440|444|600|640|644) ;; *) fatal "$file has an unsafe CA mode" ;; esac
  done
  for file in /etc/leaddrive/app.env /etc/leaddrive/migration.env; do
    assert_root_file "recovery-set secret" "$file"
    [ "$(stat -c '%U:%G:%a' "$file")" = "root:root:600" ] \
      || fatal "$file must be root:root mode 0600"
  done
  if [ -d /var/lib/leaddrive-backup ] && \
      find /var/lib/leaddrive-backup -mindepth 1 -maxdepth 2 \
        \( -name 'run-*' -o -name 'secrets-*' -o -name 'logship-*' \
           -o -name '*.dump' -o -name '*.tar' -o -name '*.age' \) \
        -print -quit | grep -q .; then
    fatal "legacy backup root contains possible plaintext/ciphertext remnants; inspect and remove through the incident runbook"
  fi
}

assert_confirmation() {
  [ "$CONFIRMATION" = "$1" ] || fatal "exact commissioning confirmation is required"
}

validate_evidence_inputs() {
  local actor_lower operator_lower evidence_epoch now_epoch
  [ "$KEY_CUSTODY_ATTESTATION" = "TWO_READABLE_OFFLINE_COPIES_AND_INDEPENDENT_DECRYPT_CONFIRMED" ] \
    || fatal "offline-key custody attestation is missing"
  [[ "$EVIDENCE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]] \
    || fatal "evidence reference is invalid"
  [[ "$EVIDENCE_AT_UTC" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || fatal "evidence timestamp must use exact UTC RFC3339 seconds"
  [[ "$OFFLINE_OPERATOR" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
    || fatal "offline operator is invalid"
  actor_lower="${WORKFLOW_ACTOR,,}"
  operator_lower="${OFFLINE_OPERATOR,,}"
  [ "$actor_lower" != "$operator_lower" ] \
    || fatal "offline evidence must come from an operator independent of the workflow actor"
  evidence_epoch="$(date -u -d "$EVIDENCE_AT_UTC" '+%s' 2>/dev/null)" \
    || fatal "evidence timestamp is not a real UTC timestamp"
  now_epoch="$(date -u '+%s')"
  [ "$evidence_epoch" -le $((now_epoch + 300)) ] \
    || fatal "evidence timestamp is more than five minutes in the future"
  [ "$evidence_epoch" -ge $((now_epoch - 7776000)) ] \
    || fatal "evidence timestamp is older than 90 days"
}

recipient_sha256() {
  local recipient="$1"
  printf '%s' "$recipient" | sha256sum | awk '{print $1}'
}

assert_expected_recipient() {
  local recipient secrets_recipient actual_sha
  [[ "$EXPECTED_RECIPIENT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "expected recipient SHA-256 is invalid"
  recipient="$(require_static_value BACKUP_AGE_RECIPIENT)"
  [[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] \
    || fatal "production requires one native age X25519 recipient"
  actual_sha="$(recipient_sha256 "$recipient")"
  [ "$actual_sha" = "$EXPECTED_RECIPIENT_SHA256" ] \
    || fatal "configured public age recipient does not match the operator-reviewed digest"
  secrets_recipient="$(read_unique_value SECRETS_AGE_RECIPIENT)"
  [ -z "$secrets_recipient" ] || [ "$secrets_recipient" = "$recipient" ] \
    || fatal "initial commissioning requires database and secrets snapshots to use the same offline recipient"
  printf '%s' "$recipient"
}

publish_commission_runner_fence() {
  local spec label timer load_state enabled_state active_state
  local backup_load backup_enabled backup_active
  local secrets_load secrets_enabled secrets_active
  local runtime_files_load runtime_files_enabled runtime_files_active
  local log_load log_enabled log_active

  for spec in \
    "BACKUP:$BACKUP_TIMER" \
    "SECRETS:$SECRETS_TIMER" \
    "RUNTIME_FILES:$RUNTIME_FILES_TIMER" \
    "LOG:$LOG_TIMER"; do
    label="${spec%%:*}"
    timer="${spec#*:}"
    load_state="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"
    if [ "$load_state" = "not-found" ]; then
      enabled_state=not-found
      active_state=not-found
    else
      [ "$load_state" = loaded ] \
        || fatal "$timer has an unsupported load state before commissioning"
      enabled_state="$(systemctl is-enabled "$timer" 2>/dev/null || true)"
      active_state="$(systemctl is-active "$timer" 2>/dev/null || true)"
      case "$enabled_state" in enabled|disabled) ;; *) fatal "$timer has an unsupported enablement state before commissioning" ;; esac
      case "$active_state" in active|inactive) ;; *) fatal "$timer has an unsupported activity state before commissioning" ;; esac
    fi
    case "$label" in
      BACKUP)
        backup_load="$load_state"; backup_enabled="$enabled_state"; backup_active="$active_state"
        ;;
      SECRETS)
        secrets_load="$load_state"; secrets_enabled="$enabled_state"; secrets_active="$active_state"
        ;;
      RUNTIME_FILES)
        runtime_files_load="$load_state"; runtime_files_enabled="$enabled_state"; runtime_files_active="$active_state"
        ;;
      LOG)
        log_load="$load_state"; log_enabled="$enabled_state"; log_active="$active_state"
        ;;
    esac
  done

  [ -d "$COMMISSION_STATE_ROOT" ] && [ ! -L "$COMMISSION_STATE_ROOT" ] \
    || install -d -o root -g root -m 0700 "$COMMISSION_STATE_ROOT"
  assert_root_directory "commissioning recovery state" "$COMMISSION_STATE_ROOT"
  [ "$(stat -c '%a' "$COMMISSION_STATE_ROOT")" = "700" ] \
    || fatal "commissioning recovery state must use mode 0700"
  [ ! -e "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ] \
    || fatal "a prior commissioning runner-fence journal must be reconciled first"
  COMMISSION_FENCE_STAGE="$(mktemp "$COMMISSION_STATE_ROOT/.runner-fence.stage.XXXXXX")"
  printf '%s\n' \
    'FORMAT_VERSION=3' \
    'STATUS=fencing' \
    "BACKUP_SERVICE=$BACKUP_SERVICE" \
    "SECRETS_SERVICE=$SECRETS_SERVICE" \
    "RUNTIME_FILES_SERVICE=$RUNTIME_FILES_SERVICE" \
    "LOG_SERVICE=$LOG_SERVICE" \
    "WORKFLOW_RUN_ID=$WORKFLOW_RUN_ID" \
    "OPERATION=$OPERATION" \
    "BACKUP_TIMER_LOAD_STATE=$backup_load" \
    "BACKUP_TIMER_ENABLED_STATE=$backup_enabled" \
    "BACKUP_TIMER_ACTIVE_STATE=$backup_active" \
    "SECRETS_TIMER_LOAD_STATE=$secrets_load" \
    "SECRETS_TIMER_ENABLED_STATE=$secrets_enabled" \
    "SECRETS_TIMER_ACTIVE_STATE=$secrets_active" \
    "RUNTIME_FILES_TIMER_LOAD_STATE=$runtime_files_load" \
    "RUNTIME_FILES_TIMER_ENABLED_STATE=$runtime_files_enabled" \
    "RUNTIME_FILES_TIMER_ACTIVE_STATE=$runtime_files_active" \
    "LOG_TIMER_LOAD_STATE=$log_load" \
    "LOG_TIMER_ENABLED_STATE=$log_enabled" \
    "LOG_TIMER_ACTIVE_STATE=$log_active" >"$COMMISSION_FENCE_STAGE"
  chown root:root "$COMMISSION_FENCE_STAGE"
  chmod 0600 "$COMMISSION_FENCE_STAGE"
  sync -f -- "$COMMISSION_FENCE_STAGE" "$COMMISSION_STATE_ROOT" \
    || fatal "cannot flush commissioning runner-fence journal"
  mv -- "$COMMISSION_FENCE_STAGE" "$COMMISSION_FENCE_JOURNAL"
  COMMISSION_FENCE_STAGE=""
  sync -f -- "$COMMISSION_FENCE_JOURNAL" "$COMMISSION_STATE_ROOT" \
    || fatal "cannot durably publish commissioning runner-fence journal"
}

restore_timer_states_from_journal() {
  local spec label timer load_key enabled_key active_key
  local prior_load prior_enabled prior_active current_load current_enabled current_active

  [ -f "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ] \
    || return 1
  for spec in \
    "BACKUP:$BACKUP_TIMER" \
    "SECRETS:$SECRETS_TIMER" \
    "RUNTIME_FILES:$RUNTIME_FILES_TIMER" \
    "LOG:$LOG_TIMER"; do
    label="${spec%%:*}"
    timer="${spec#*:}"
    load_key="${label}_TIMER_LOAD_STATE"
    enabled_key="${label}_TIMER_ENABLED_STATE"
    active_key="${label}_TIMER_ACTIVE_STATE"
    prior_load="$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "$load_key")"
    prior_enabled="$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "$enabled_key")"
    prior_active="$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "$active_key")"
    current_load="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"

    if [ "$prior_load:$prior_enabled:$prior_active" = "not-found:not-found:not-found" ]; then
      [ "$current_load" = not-found ] || return 1
      continue
    fi
    [ "$prior_load" = loaded ] && [ "$current_load" = loaded ] || return 1
    case "$prior_enabled" in
      enabled) systemctl enable "$timer" >/dev/null 2>&1 || return 1 ;;
      disabled) systemctl disable "$timer" >/dev/null 2>&1 || return 1 ;;
      *) return 1 ;;
    esac
    case "$prior_active" in
      active) systemctl start "$timer" >/dev/null 2>&1 || return 1 ;;
      inactive) systemctl stop "$timer" >/dev/null 2>&1 || return 1 ;;
      *) return 1 ;;
    esac
    current_enabled="$(systemctl is-enabled "$timer" 2>/dev/null || true)"
    current_active="$(systemctl is-active "$timer" 2>/dev/null || true)"
    [ "$current_enabled:$current_active" = "$prior_enabled:$prior_active" ] || return 1
  done
}

clear_commission_runner_fence() {
  local cleanup_failed=0 service enabled_state mask_path
  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    if ! systemctl unmask --runtime "$service" >/dev/null 2>&1; then
      cleanup_failed=1
    fi
    mask_path="/run/systemd/system/$service"
    enabled_state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
    if [ -e "$mask_path" ] || [ -L "$mask_path" ] \
      || [ "$enabled_state" = "masked" ] || [ "$enabled_state" = "masked-runtime" ]; then
      cleanup_failed=1
    fi
  done
  if [ -e "$COMMISSION_FENCE_JOURNAL" ] || [ -L "$COMMISSION_FENCE_JOURNAL" ]; then
    restore_timer_states_from_journal || cleanup_failed=1
  fi
  [ "$cleanup_failed" -eq 0 ] || return 1
  BACKUP_SERVICE_RUNTIME_MASKED=0
  SECRETS_SERVICE_RUNTIME_MASKED=0
  RUNTIME_FILES_SERVICE_RUNTIME_MASKED=0
  LOG_SERVICE_RUNTIME_MASKED=0
  if [ -e "$COMMISSION_FENCE_JOURNAL" ] || [ -L "$COMMISSION_FENCE_JOURNAL" ]; then
    [ -f "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ] \
      || return 1
    unlink -- "$COMMISSION_FENCE_JOURNAL" || return 1
    sync -f -- "$COMMISSION_STATE_ROOT" || return 1
  fi
}

recover_commission_runner_fence() {
  local old_run_id old_operation unit label load_state fragment service mask_path
  if [ ! -e "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ]; then
    for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
      case "$(systemctl is-enabled "$service" 2>/dev/null || true)" in
        masked|masked-runtime) fatal "$service is masked without a durable commissioning journal" ;;
      esac
    done
    return 0
  fi
  assert_root_directory "commissioning recovery state" "$COMMISSION_STATE_ROOT"
  [ "$(stat -c '%a' "$COMMISSION_STATE_ROOT")" = "700" ] \
    || fatal "commissioning recovery state must use mode 0700"
  assert_root_file "commissioning runner-fence journal" "$COMMISSION_FENCE_JOURNAL"
  [ "$(stat -c '%a' "$COMMISSION_FENCE_JOURNAL")" = "600" ] \
    || fatal "commissioning runner-fence journal must use mode 0600"
  awk '
    !/^[A-Z][A-Z0-9_]*=/ { bad=1; next }
    { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
    END { if (NR != 20 || bad) exit 1 }
  ' "$COMMISSION_FENCE_JOURNAL" \
    || fatal "commissioning runner-fence journal is malformed"
  [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" FORMAT_VERSION)" = "3" ] \
    && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" STATUS)" = "fencing" ] \
    && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" BACKUP_SERVICE)" = "$BACKUP_SERVICE" ] \
    && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" SECRETS_SERVICE)" = "$SECRETS_SERVICE" ] \
    && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" RUNTIME_FILES_SERVICE)" = "$RUNTIME_FILES_SERVICE" ] \
    && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" LOG_SERVICE)" = "$LOG_SERVICE" ] \
    || fatal "commissioning runner-fence journal has an invalid authority"
  for label in BACKUP SECRETS RUNTIME_FILES LOG; do
    case "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "${label}_TIMER_LOAD_STATE")" in
      loaded)
        case "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "${label}_TIMER_ENABLED_STATE")" in
          enabled|disabled) ;;
          *) fatal "commissioning runner-fence journal has an invalid timer enablement state" ;;
        esac
        case "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "${label}_TIMER_ACTIVE_STATE")" in
          active|inactive) ;;
          *) fatal "commissioning runner-fence journal has an invalid timer activity state" ;;
        esac
        ;;
      not-found)
        [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "${label}_TIMER_ENABLED_STATE")" = not-found ] \
          && [ "$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" "${label}_TIMER_ACTIVE_STATE")" = not-found ] \
          || fatal "commissioning runner-fence journal has an inconsistent absent-timer state"
        ;;
      *) fatal "commissioning runner-fence journal has an invalid timer load state" ;;
    esac
  done
  old_run_id="$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" WORKFLOW_RUN_ID)"
  old_operation="$(read_unique_value_from "$COMMISSION_FENCE_JOURNAL" OPERATION)"
  [[ "$old_run_id" =~ ^[0-9]{1,20}$ ]] \
    && [[ "$old_operation" =~ ^(install-backup-tools|activate-backup-encryption|run-bootstrap-backup|certify-bootstrap-restore|run-verified-backup|certify-offline-restore)$ ]] \
    || fatal "commissioning runner-fence journal identity is invalid"
  for label in database secrets runtime-files; do
    unit="leaddrive-backup-commission-${label}-${old_run_id}.service"
    load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
    if [ -n "$load_state" ] && [ "$load_state" != "not-found" ]; then
      fragment="$(systemctl show --property=FragmentPath --value "$unit" 2>/dev/null || true)"
      [ "$fragment" = "/run/systemd/transient/$unit" ] \
        || fatal "journaled commissioning unit is not an exact systemd transient"
      systemctl stop "$unit" >/dev/null \
        || fatal "cannot stop journaled commissioning transient $unit"
      systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    fi
  done
  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    mask_path="/run/systemd/system/$service"
    if [ -e "$mask_path" ] || [ -L "$mask_path" ]; then
      [ -L "$mask_path" ] && [ "$(readlink -- "$mask_path")" = /dev/null ] \
        || fatal "$service runtime mask has an unexpected target"
    fi
  done
  BACKUP_SERVICE_RUNTIME_MASKED=1
  SECRETS_SERVICE_RUNTIME_MASKED=1
  RUNTIME_FILES_SERVICE_RUNTIME_MASKED=1
  LOG_SERVICE_RUNTIME_MASKED=1
  clear_commission_runner_fence \
    || fatal "cannot reconcile the prior commissioning runner fence; journal retained"
  log "recovered a durable commissioning runner fence from interrupted run $old_run_id"
}

fence_backup_runner() {
  local attempt service service_state timer timer_load disable_failed=0
  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    case "$(systemctl is-enabled "$service" 2>/dev/null || true)" in
      masked|masked-runtime) fatal "$service was already masked before commissioning" ;;
    esac
  done
  publish_commission_runner_fence
  for timer in "$BACKUP_TIMER" "$SECRETS_TIMER" "$RUNTIME_FILES_TIMER" "$LOG_TIMER"; do
    timer_load="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"
    [ "$timer_load" != "not-found" ] || continue
    systemctl disable --now "$timer" >/dev/null 2>&1 \
      || disable_failed=1
  done
  for timer in "$BACKUP_TIMER" "$SECRETS_TIMER" "$RUNTIME_FILES_TIMER" "$LOG_TIMER"; do
    timer_load="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"
    [ "$timer_load" != "not-found" ] || continue
    [ "$(systemctl is-enabled "$timer" 2>/dev/null || true)" = "disabled" ] \
      || disable_failed=1
    [ "$(systemctl is-active "$timer" 2>/dev/null || true)" != "active" ] \
      || disable_failed=1
  done
  [ "$disable_failed" -eq 0 ] \
    || fatal "all automatic recovery timers could not be disabled and stopped"

  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    for attempt in $(seq 1 120); do
      service_state="$(systemctl is-active "$service" 2>/dev/null || true)"
      [ "$service_state" != "active" ] && [ "$service_state" != "activating" ] && break
      [ "$attempt" -lt 120 ] || fatal "$service did not become inactive within 10 minutes"
      sleep 5
    done
  done

  systemctl mask --runtime "$BACKUP_SERVICE" >/dev/null \
    || fatal "cannot place $BACKUP_SERVICE behind a runtime start fence"
  BACKUP_SERVICE_RUNTIME_MASKED=1
  systemctl mask --runtime "$SECRETS_SERVICE" >/dev/null \
    || fatal "cannot place $SECRETS_SERVICE behind a runtime start fence"
  SECRETS_SERVICE_RUNTIME_MASKED=1
  systemctl mask --runtime "$RUNTIME_FILES_SERVICE" >/dev/null \
    || fatal "cannot place $RUNTIME_FILES_SERVICE behind a runtime start fence"
  RUNTIME_FILES_SERVICE_RUNTIME_MASKED=1
  systemctl mask --runtime "$LOG_SERVICE" >/dev/null \
    || fatal "cannot place $LOG_SERVICE behind a runtime start fence"
  LOG_SERVICE_RUNTIME_MASKED=1
  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    [ "$(systemctl is-active "$service" 2>/dev/null || true)" != "active" ] \
      || fatal "$service raced the runtime start fence"
  done

  ensure_owned_directory /run/leaddrive-postgres-backup leaddrive-backup leaddrive-backup 750
  ensure_owned_directory /var/lib/leaddrive-recovery-runner-locks root root 755
  ensure_owned_directory /var/lib/leaddrive-postgres-backup leaddrive-backup leaddrive-backup 750
  ensure_owned_directory /run/leaddrive-secrets-snapshot root root 700
  ensure_owned_directory /var/lib/leaddrive-secrets-snapshot root root 700
  ensure_owned_directory /run/leaddrive-runtime-files-snapshot root root 700
  ensure_owned_directory /var/lib/leaddrive-runtime-files-snapshot root root 700
  ensure_owned_directory /run/leaddrive-log-ship leaddrive-backup leaddrive-backup 750
  ensure_owned_directory /var/lib/leaddrive-log-ship leaddrive-backup leaddrive-backup 750
  for runtime_dir in /run/leaddrive-postgres-backup /run/leaddrive-secrets-snapshot \
    /run/leaddrive-runtime-files-snapshot /run/leaddrive-log-ship; do
    [ -d "$runtime_dir" ] && [ ! -L "$runtime_dir" ] \
      && [ "$(realpath -e -- "$runtime_dir")" = "$runtime_dir" ] \
      && [ "$(findmnt -n -o FSTYPE --target "$runtime_dir")" = "tmpfs" ] \
      || fatal "$runtime_dir must be a real canonical tmpfs directory"
  done
  [ "$(stat -c '%U:%G:%a' /run/leaddrive-postgres-backup)" = "leaddrive-backup:leaddrive-backup:750" ] \
    && [ "$(stat -c '%U:%G:%a' /var/lib/leaddrive-postgres-backup)" = "leaddrive-backup:leaddrive-backup:750" ] \
    && [ "$(stat -c '%U:%G:%a' /run/leaddrive-secrets-snapshot)" = "root:root:700" ] \
    && [ "$(stat -c '%U:%G:%a' /var/lib/leaddrive-secrets-snapshot)" = "root:root:700" ] \
    && [ "$(stat -c '%U:%G:%a' /run/leaddrive-runtime-files-snapshot)" = "root:root:700" ] \
    && [ "$(stat -c '%U:%G:%a' /var/lib/leaddrive-runtime-files-snapshot)" = "root:root:700" ] \
    && [ "$(stat -c '%U:%G:%a' /run/leaddrive-log-ship)" = "leaddrive-backup:leaddrive-backup:750" ] \
    && [ "$(stat -c '%U:%G:%a' /var/lib/leaddrive-log-ship)" = "leaddrive-backup:leaddrive-backup:750" ] \
    || fatal "separate backup state/runtime ownership is unsafe"
  if [ ! -e "$BACKUP_RUNTIME_LOCK" ]; then
    install -o root -g leaddrive-backup -m 0660 /dev/null "$BACKUP_RUNTIME_LOCK"
  fi
  [ -f "$BACKUP_RUNTIME_LOCK" ] && [ ! -L "$BACKUP_RUNTIME_LOCK" ] \
    || fatal "backup runtime lock is not a regular file"
  [ "$(stat -c '%U:%G:%a' "$BACKUP_RUNTIME_LOCK")" = "root:leaddrive-backup:660" ] \
    || fatal "backup persistent lock ownership or mode is unsafe"
  if [ ! -e "$SECRETS_RUNTIME_LOCK" ]; then
    install -o root -g root -m 0600 /dev/null "$SECRETS_RUNTIME_LOCK"
  fi
  [ -f "$SECRETS_RUNTIME_LOCK" ] && [ ! -L "$SECRETS_RUNTIME_LOCK" ] \
    || fatal "secrets runtime lock is not a regular file"
  [ "$(stat -c '%U:%G:%a' "$SECRETS_RUNTIME_LOCK")" = "root:root:600" ] \
    || fatal "secrets runtime lock ownership or mode is unsafe"
  if [ ! -e "$RUNTIME_FILES_RUNTIME_LOCK" ]; then
    install -o root -g root -m 0600 /dev/null "$RUNTIME_FILES_RUNTIME_LOCK"
  fi
  [ -f "$RUNTIME_FILES_RUNTIME_LOCK" ] && [ ! -L "$RUNTIME_FILES_RUNTIME_LOCK" ] \
    || fatal "runtime-files lock is not a regular file"
  [ "$(stat -c '%U:%G:%a' "$RUNTIME_FILES_RUNTIME_LOCK")" = "root:root:600" ] \
    || fatal "runtime-files lock ownership or mode is unsafe"
  if [ ! -e "$LOG_RUNTIME_LOCK" ]; then
    install -o root -g leaddrive-backup -m 0660 /dev/null "$LOG_RUNTIME_LOCK"
  fi
  [ -f "$LOG_RUNTIME_LOCK" ] && [ ! -L "$LOG_RUNTIME_LOCK" ] \
    || fatal "log-shipping lock is not a regular file"
  [ "$(stat -c '%U:%G:%a' "$LOG_RUNTIME_LOCK")" = "root:leaddrive-backup:660" ] \
    || fatal "log-shipping lock ownership or mode is unsafe"
  exec 8<"$BACKUP_RUNTIME_LOCK"
  flock -n 8 || fatal "another backup run holds the persistent lock"
  [ "$(stat -Lc '%d:%i' "$BACKUP_RUNTIME_LOCK")" = "$(stat -Lc '%d:%i' /proc/$$/fd/8)" ] \
    || fatal "backup persistent lock inode changed while it was acquired"
  BACKUP_LOCK_HELD=1
  exec 7<"$SECRETS_RUNTIME_LOCK"
  flock -n 7 || fatal "another secrets snapshot holds the persistent lock"
  [ "$(stat -Lc '%d:%i' "$SECRETS_RUNTIME_LOCK")" = "$(stat -Lc '%d:%i' /proc/$$/fd/7)" ] \
    || fatal "secrets persistent lock inode changed while it was acquired"
  SECRETS_LOCK_HELD=1
  exec 6<"$RUNTIME_FILES_RUNTIME_LOCK"
  flock -n 6 || fatal "another runtime-files snapshot holds the runtime lock"
  [ "$(stat -Lc '%d:%i' "$RUNTIME_FILES_RUNTIME_LOCK")" = "$(stat -Lc '%d:%i' /proc/$$/fd/6)" ] \
    || fatal "runtime-files persistent lock inode changed while it was acquired"
  RUNTIME_FILES_LOCK_HELD=1
  exec 5<"$LOG_RUNTIME_LOCK"
  flock -n 5 || fatal "another log-shipping run holds the persistent lock"
  [ "$(stat -Lc '%d:%i' "$LOG_RUNTIME_LOCK")" = "$(stat -Lc '%d:%i' /proc/$$/fd/5)" ] \
    || fatal "log-shipping persistent lock inode changed while it was acquired"
  LOG_LOCK_HELD=1
  log "database, secrets, runtime-file and log timers disabled; all recovery runners fenced"
}

release_backup_locks() {
  [ "$BACKUP_LOCK_HELD" -eq 1 ] || fatal "backup runtime lock was not acquired"
  exec 8>&-
  BACKUP_LOCK_HELD=0
  [ "$SECRETS_LOCK_HELD" -eq 1 ] || fatal "secrets runtime lock was not acquired"
  exec 7>&-
  SECRETS_LOCK_HELD=0
  [ "$RUNTIME_FILES_LOCK_HELD" -eq 1 ] || fatal "runtime-files lock was not acquired"
  exec 6>&-
  RUNTIME_FILES_LOCK_HELD=0
  [ "$LOG_LOCK_HELD" -eq 1 ] || fatal "log-shipping runtime lock was not acquired"
  exec 5>&-
  LOG_LOCK_HELD=0
}

release_service_masks() {
  [ "$BACKUP_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || fatal "backup service runtime mask was not acquired"
  [ "$SECRETS_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || fatal "secrets service runtime mask was not acquired"
  [ "$RUNTIME_FILES_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || fatal "runtime-files service runtime mask was not acquired"
  [ "$LOG_SERVICE_RUNTIME_MASKED" -eq 1 ] \
    || fatal "log-shipping service runtime mask was not acquired"
  clear_commission_runner_fence \
    || fatal "cannot release and verify all commissioning runner fences; journal retained"
}

open_commission_runner_fence_for_timer_commit() {
  local service enabled_state mask_path
  [ -f "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ] \
    || fatal "timer enablement commit has no durable rollback journal"
  for service in "$BACKUP_SERVICE" "$SECRETS_SERVICE" "$RUNTIME_FILES_SERVICE" "$LOG_SERVICE"; do
    systemctl unmask --runtime "$service" >/dev/null 2>&1 \
      || fatal "cannot open $service runtime fence for timer enablement commit"
    mask_path="/run/systemd/system/$service"
    enabled_state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
    [ ! -e "$mask_path" ] && [ ! -L "$mask_path" ] \
      && [ "$enabled_state" != masked ] && [ "$enabled_state" != masked-runtime ] \
      || fatal "$service remains masked before timer enablement commit"
  done
  BACKUP_SERVICE_RUNTIME_MASKED=0
  SECRETS_SERVICE_RUNTIME_MASKED=0
  RUNTIME_FILES_SERVICE_RUNTIME_MASKED=0
  LOG_SERVICE_RUNTIME_MASKED=0
}

commit_commission_timer_state() {
  [ -f "$COMMISSION_FENCE_JOURNAL" ] && [ ! -L "$COMMISSION_FENCE_JOURNAL" ] \
    || fatal "timer enablement commit lost its durable rollback journal"
  unlink -- "$COMMISSION_FENCE_JOURNAL" \
    && sync -f -- "$COMMISSION_STATE_ROOT" \
    || fatal "cannot durably commit commissioned timer state"
}

commit_commission_timers_disabled() {
  local timer timer_load
  open_commission_runner_fence_for_timer_commit
  for timer in "$BACKUP_TIMER" "$SECRETS_TIMER" "$RUNTIME_FILES_TIMER" "$LOG_TIMER"; do
    timer_load="$(systemctl show --property=LoadState --value "$timer" 2>/dev/null || true)"
    [ "$timer_load" != not-found ] || continue
    [ "$timer_load" = loaded ] \
      && [ "$(systemctl is-enabled "$timer" 2>/dev/null || true)" = disabled ] \
      && [ "$(systemctl is-active "$timer" 2>/dev/null || true)" = inactive ] \
      || fatal "$timer is not disabled and inactive at commissioning stage commit"
  done
  commit_commission_timer_state
}

assert_link_target() {
  local label="$1"
  local link="$2"
  local target="$3"
  [ -L "$link" ] || fatal "$label must be an owned symbolic link"
  [ "$(readlink -- "$link")" = "$target" ] \
    && [ "$(readlink -f -- "$link")" = "$target" ] \
    || fatal "$label resolves outside the reviewed versioned installation"
  [ "$(stat -c '%u' "$link")" = "0" ] || fatal "$label link must be root-owned"
}

assert_age_payload() {
  local version binary_sha
  assert_root_directory "age installation" "$AGE_ROOT"
  assert_root_file "age binary" "$AGE_BIN"
  assert_root_file "age provenance" "$AGE_PROVENANCE"
  [ "$(read_unique_value_from "$AGE_PROVENANCE" VERSION)" = "$AGE_VERSION" ] \
    || fatal "age provenance version is invalid"
  [ "$(read_unique_value_from "$AGE_PROVENANCE" ARCHIVE_SHA256)" = "$AGE_ARCHIVE_SHA256" ] \
    || fatal "age provenance archive digest is invalid"
  [ "$(read_unique_value_from "$AGE_PROVENANCE" BINARY_SHA256)" = "$AGE_BINARY_SHA256" ] \
    || fatal "age provenance binary digest is invalid"
  binary_sha="$(sha256sum "$AGE_BIN" | awk '{print $1}')"
  [ "$binary_sha" = "$AGE_BINARY_SHA256" ] || fatal "installed age binary digest drifted"
  version="$("$AGE_BIN" --version 2>&1)"
  [[ "$version" =~ ^v?1\.3\.2$ ]] || fatal "installed age version is not exactly 1.3.2"
}

assert_age_installation() {
  assert_age_payload
  assert_link_target "age command" "$AGE_LINK" "$AGE_BIN"
}

assert_aws_payload() {
  local version aws_real
  assert_root_directory "AWS CLI installation" "$AWS_ROOT"
  assert_root_file "AWS CLI resolved binary" "$AWS_REAL_BIN"
  assert_root_file "AWS CLI provenance" "$AWS_PROVENANCE"
  [ "$(read_unique_value_from "$AWS_PROVENANCE" VERSION)" = "$AWS_VERSION" ] \
    || fatal "AWS CLI provenance version is invalid"
  [ "$(read_unique_value_from "$AWS_PROVENANCE" ARCHIVE_SHA256)" = "$AWS_ARCHIVE_SHA256" ] \
    || fatal "AWS CLI provenance archive digest is invalid"
  [ "$(read_unique_value_from "$AWS_PROVENANCE" SIGNING_FINGERPRINT)" = "$AWS_SIGNING_FINGERPRINT" ] \
    || fatal "AWS CLI provenance signing fingerprint is invalid"
  [ -L "$AWS_ROOT/v2/current" ] \
    && [ "$(readlink -- "$AWS_ROOT/v2/current")" = "$AWS_ROOT/v2/$AWS_VERSION" ] \
    || fatal "AWS CLI current link does not select the pinned version"
  [ -L "$AWS_BIN" ] || fatal "AWS CLI command inside the pinned installation must be a symlink"
  aws_real="$(readlink -f -- "$AWS_BIN")"
  [ "$aws_real" = "$AWS_REAL_BIN" ] \
    || fatal "AWS CLI binary resolves outside the pinned installation"
  version="$("$AWS_BIN" --version 2>&1)"
  [ "${version%% *}" = "aws-cli/$AWS_VERSION" ] \
    || fatal "installed AWS CLI version is not exactly $AWS_VERSION"
}

assert_aws_installation() {
  assert_aws_payload
  [ -L "$AWS_LINK" ] \
    && [ "$(readlink -- "$AWS_LINK")" = "$AWS_BIN" ] \
    && [ "$(readlink -f -- "$AWS_LINK")" = "$AWS_REAL_BIN" ] \
    || fatal "AWS CLI global command does not resolve through the reviewed versioned installation"
}

assert_toolchain() {
  assert_root_directory "/usr/local" /usr/local
  assert_root_directory "/usr/local/bin" /usr/local/bin
  assert_root_directory "/usr/local/lib" /usr/local/lib
  assert_root_directory "LeadDrive backup authority root" /usr/local/lib/leaddrive-backup
  assert_root_directory "LeadDrive backup tool root" "$TOOLS_ROOT"
  assert_root_directory "age tool family" "$TOOLS_ROOT/age"
  assert_root_directory "AWS CLI tool family" "$TOOLS_ROOT/aws-cli"
  assert_root_directory "AWS CLI version root" "$AWS_ROOT"
  assert_root_directory "AWS CLI v2 root" "$AWS_ROOT/v2"
  assert_root_directory "AWS CLI resolved version root" "$AWS_ROOT/v2/$AWS_VERSION"
  assert_age_installation
  assert_aws_installation
}

assert_free_capacity() {
  local path="$1"
  local free_kib free_inodes
  free_kib="$(df -Pk "$path" | awk 'NR == 2 { print $4 }')"
  free_inodes="$(df -Pi "$path" | awk 'NR == 2 { print $4 }')"
  [[ "$free_kib" =~ ^[0-9]+$ ]] && [ "$free_kib" -ge 2097152 ] \
    || fatal "$path has less than 2 GiB free"
  [[ "$free_inodes" =~ ^[0-9]+$ ]] && [ "$free_inodes" -ge 10000 ] \
    || fatal "$path has fewer than 10000 free inodes"
}

install_tools() {
  local os_id os_version machine_arch age_url age_sha archive_entries
  local aws_url signature_url aws_sha gpg_fingerprint gpg_status zip_entries
  local age_parent aws_parent

  assert_confirmation "INSTALL_PINNED_BACKUP_TOOLS_AND_EXTEND_LOG_RETENTION_ON_13_140_132_245"
  [ -z "$EXPECTED_RECIPIENT_SHA256$KEY_CUSTODY_ATTESTATION$EVIDENCE_REF$EVIDENCE_AT_UTC$OFFLINE_OPERATOR$EXPECTED_CANDIDATE_SHA256" ] \
    || fatal "tool installation does not accept key or evidence inputs"
  fence_backup_runner
  migrate_log_retention_policy
  assert_backup_env
  os_id="$(read_static_env_value /etc/os-release ID 2>/dev/null || true)"
  os_version="$(read_static_env_value /etc/os-release VERSION_ID 2>/dev/null || true)"
  machine_arch="$(uname -m)"
  [ "$os_id:$os_version:$machine_arch" = "ubuntu:24.04:x86_64" ] \
    || fatal "tool commissioning is pinned to Ubuntu 24.04 x86_64"

  for command_name in curl gpg sha256sum tar unzip; do
    command -v "$command_name" >/dev/null 2>&1 || fatal "$command_name is required"
  done
  assert_free_capacity /var/tmp
  assert_free_capacity /usr/local

  assert_root_directory "/usr" /usr
  assert_root_directory "/usr/local" /usr/local
  assert_root_directory "/usr/local/bin" /usr/local/bin
  assert_root_directory "/usr/local/lib" /usr/local/lib
  ensure_root_directory /usr/local/lib/leaddrive-backup
  ensure_root_directory "$TOOLS_ROOT"
  ensure_root_directory "$TOOLS_ROOT/age"
  ensure_root_directory "$TOOLS_ROOT/aws-cli"
  age_parent="$TOOLS_ROOT/age"
  aws_parent="$TOOLS_ROOT/aws-cli"

  WORK_DIR="$(mktemp -d /var/tmp/leaddrive-backup-tools.XXXXXX)"
  install -d -m 0700 "$WORK_DIR/gnupg"

  age_url="https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --connect-timeout 20 --max-time 600 --retry 3 \
    --output "$WORK_DIR/age.tar.gz" "$age_url"
  age_sha="$(sha256sum "$WORK_DIR/age.tar.gz" | awk '{print $1}')"
  [ "$age_sha" = "$AGE_ARCHIVE_SHA256" ] || fatal "upstream age archive SHA-256 mismatch"
  archive_entries="$(tar -tzf "$WORK_DIR/age.tar.gz")"
  [ -n "$archive_entries" ] \
    && ! grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$archive_entries" \
    && grep -Fxq 'age/age' <<<"$archive_entries" \
    || fatal "upstream age archive layout is unsafe"
  tar -tvzf "$WORK_DIR/age.tar.gz" \
    | awk '$1 !~ /^[-d]/ { unsafe=1 } END { exit unsafe }' \
    || fatal "upstream age archive contains a link or special file"
  tar --no-same-owner --no-same-permissions -xzf "$WORK_DIR/age.tar.gz" -C "$WORK_DIR"
  [ -f "$WORK_DIR/age/age" ] && [ ! -L "$WORK_DIR/age/age" ] \
    || fatal "verified age archive has no regular age binary"
  [ "$(sha256sum "$WORK_DIR/age/age" | awk '{print $1}')" = "$AGE_BINARY_SHA256" ] \
    || fatal "verified age binary SHA-256 mismatch"

  if [ -e "$AGE_ROOT" ] || [ -L "$AGE_ROOT" ]; then
    assert_age_payload
    if [ ! -e "$AGE_LINK" ] && [ ! -L "$AGE_LINK" ]; then
      ln -s -- "$AGE_BIN" "$AGE_LINK"
      AGE_LINK_CREATED=1
    fi
  else
    AGE_STAGE="$age_parent/.1.3.2.stage.${WORKFLOW_RUN_ID}.$$"
    install -d -o root -g root -m 0755 "$AGE_STAGE"
    install -o root -g root -m 0755 "$WORK_DIR/age/age" "$AGE_STAGE/age"
    printf 'VERSION=%s\nARCHIVE_SHA256=%s\nBINARY_SHA256=%s\n' \
      "$AGE_VERSION" "$AGE_ARCHIVE_SHA256" "$AGE_BINARY_SHA256" \
      >"$AGE_STAGE/LEADDRIVE_PROVENANCE"
    chmod 0600 "$AGE_STAGE/LEADDRIVE_PROVENANCE"
    sync -f -- "$AGE_STAGE/age" "$AGE_STAGE/LEADDRIVE_PROVENANCE" "$AGE_STAGE" "$age_parent"
    mv -- "$AGE_STAGE" "$AGE_ROOT"
    AGE_STAGE=""
    AGE_ROOT_CREATED=1
    if [ -e "$AGE_LINK" ] || [ -L "$AGE_LINK" ]; then
      fatal "refusing to replace an unknown pre-existing age command"
    fi
    ln -s -- "$AGE_BIN" "$AGE_LINK"
    AGE_LINK_CREATED=1
    cmp -s -- "$AGE_BIN" "$WORK_DIR/age/age" \
      || fatal "installed age binary differs from the verified stage"
  fi
  assert_age_installation

  aws_url="https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_VERSION}.zip"
  signature_url="${aws_url}.sig"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --connect-timeout 20 --max-time 900 --retry 3 \
    --output "$WORK_DIR/awscliv2.zip" "$aws_url"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --connect-timeout 20 --max-time 120 --retry 3 \
    --output "$WORK_DIR/awscliv2.zip.sig" "$signature_url"
  aws_sha="$(sha256sum "$WORK_DIR/awscliv2.zip" | awk '{print $1}')"
  [ "$aws_sha" = "$AWS_ARCHIVE_SHA256" ] || fatal "AWS CLI archive SHA-256 mismatch"

  gpg --batch --homedir "$WORK_DIR/gnupg" --import >/dev/null 2>&1 <<'AWS_CLI_TEAM_KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBF2Cr7UBEADJZHcgusOJl7ENSyumXh85z0TRV0xJorM2B/JL0kHOyigQluUG
ZMLhENaG0bYatdrKP+3H91lvK050pXwnO/R7fB/FSTouki4ciIx5OuLlnJZIxSzx
PqGl0mkxImLNbGWoi6Lto0LYxqHN2iQtzlwTVmq9733zd3XfcXrZ3+LblHAgEt5G
TfNxEKJ8soPLyWmwDH6HWCnjZ/aIQRBTIQ05uVeEoYxSh6wOai7ss/KveoSNBbYz
gbdzoqI2Y8cgH2nbfgp3DSasaLZEdCSsIsK1u05CinE7k2qZ7KgKAUIcT/cR/grk
C6VwsnDU0OUCideXcQ8WeHutqvgZH1JgKDbznoIzeQHJD238GEu+eKhRHcz8/jeG
94zkcgJOz3KbZGYMiTh277Fvj9zzvZsbMBCedV1BTg3TqgvdX4bdkhf5cH+7NtWO
lrFj6UwAsGukBTAOxC0l/dnSmZhJ7Z1KmEWilro/gOrjtOxqRQutlIqG22TaqoPG
fYVN+en3Zwbt97kcgZDwqbuykNt64oZWc4XKCa3mprEGC3IbJTBFqglXmZ7l9ywG
EEUJYOlb2XrSuPWml39beWdKM8kzr1OjnlOm6+lpTRCBfo0wa9F8YZRhHPAkwKkX
XDeOGpWRj4ohOx0d2GWkyV5xyN14p2tQOCdOODmz80yUTgRpPVQUtOEhXQARAQAB
tCFBV1MgQ0xJIFRlYW0gPGF3cy1jbGlAYW1hem9uLmNvbT6JAlQEEwEIAD4CGwMF
CwkIBwIGFQoJCAsCBBYCAwECHgECF4AWIQT7Xbd/1cEYuAURraimMQrMRnJHXAUC
akV0ygUJDqP4lQAKCRCmMQrMRnJHXFHjD/9eyZLYcKuQOlLvtqSDtUBiEZf6ZZjM
i3ygYH8rJNtuToUH+HvSpe819urJCquXhDrlK6N+aqW0hCLtNABJG/vsafIgvIYJ
hSGgpgtNnQyMV1jViRWqPjbouw8OkYKBThUfT1i2Y+wn58ifs6ODBCmTexWtXspA
Si+Gt49xDOW0APmbOPnI+a4HJW6tVEo6MWS0WjzpiBayR3d1A4pt4YrPfSdDgpLo
h2SLQqlRqvvVZJaWBjhkErNFpfsBA06sDcPEOb0G8LBUbR4WOcdvhe5LubJbZuxC
AG9kNPCVeQP1ixwjgjXKysaxeQ6rv0VzIQgRp6tLVLWhy6AKDNvLjFSsmXZ1Wl08
Y/RlOHXlzLuQMRE6sR1wOdRxc9TsrNWTGiBK65cvSWOy03JeBkQQ8pesqltiyxI9
U21kkgiXtTSKNGfKK8pO27D81YANhRqPK7iTp6kuFiY2WtOg90KTMNlIT+Ff85Y2
b1rHj6Z0SrCkJujhWk3IBPic/wJgz01LEc/OAdUPlby90RJZcIBhSlWhT7mXnXIO
c0HWlNQrns2s3CTyYwZSiSlYe9ApeLwhjDo8NhbFuCAy61l6O5UsR4AfZxx/rGKv
2wFb1/RN/P4gNe6vmxZAPjR0AQcwD3tc2McimOLr/22kmPz8IH3I0X7WoSFr0Biz
E91G7bb0hOb/cA==
=knv7
-----END PGP PUBLIC KEY BLOCK-----
AWS_CLI_TEAM_KEY
  gpg_fingerprint="$(gpg --batch --homedir "$WORK_DIR/gnupg" --with-colons \
    --fingerprint A6310ACC4672475C 2>/dev/null \
    | awk -F: '$1 == "fpr" { print $10; exit }')"
  [ "$gpg_fingerprint" = "$AWS_SIGNING_FINGERPRINT" ] \
    || fatal "AWS CLI signing-key fingerprint mismatch"
  gpg_status="$(gpg --batch --homedir "$WORK_DIR/gnupg" --status-fd 1 \
    --verify "$WORK_DIR/awscliv2.zip.sig" "$WORK_DIR/awscliv2.zip" 2>/dev/null)" \
    || fatal "AWS CLI detached signature verification failed"
  grep -Eq "^\[GNUPG:\] VALIDSIG ${AWS_SIGNING_FINGERPRINT} .* 10 00 " <<<"$gpg_status" \
    || fatal "AWS CLI signature is not a valid SHA-512 signature from the pinned key"
  unzip -tq "$WORK_DIR/awscliv2.zip" >/dev/null || fatal "AWS CLI signed archive is corrupt"
  zip_entries="$(unzip -Z1 "$WORK_DIR/awscliv2.zip")"
  [ -n "$zip_entries" ] \
    && ! grep -Eq '(^/|(^|/)\.\.(/|$)|\\)' <<<"$zip_entries" \
    && ! grep -Ev '^aws/' <<<"$zip_entries" | grep -q . \
    || fatal "AWS CLI archive layout is unsafe"
  unzip -q "$WORK_DIR/awscliv2.zip" -d "$WORK_DIR/unpacked"
  [ -x "$WORK_DIR/unpacked/aws/install" ] || fatal "AWS CLI archive has no executable installer"

  if [ -e "$AWS_ROOT" ] || [ -L "$AWS_ROOT" ]; then
    assert_aws_payload
    if [ ! -e "$AWS_LINK" ] && [ ! -L "$AWS_LINK" ]; then
      ln -s -- "$AWS_BIN" "$AWS_LINK"
      AWS_LINK_CREATED=1
    fi
  else
    install -d -o root -g root -m 0700 "$WORK_DIR/aws-bin"
    AWS_STAGE="$aws_parent/.2.36.40.stage.${WORKFLOW_RUN_ID}.$$"
    "$WORK_DIR/unpacked/aws/install" \
      --install-dir "$AWS_STAGE" --bin-dir "$WORK_DIR/aws-bin" >/dev/null
    [ -x "$AWS_STAGE/v2/current/bin/aws" ] || fatal "AWS CLI installer produced no versioned binary"
    [ "$("$AWS_STAGE/v2/current/bin/aws" --version 2>&1 | awk '{print $1}')" = "aws-cli/$AWS_VERSION" ] \
      || fatal "staged AWS CLI version is not exactly $AWS_VERSION"
    find "$AWS_STAGE" -xdev ! -type l -perm /022 -print -quit | grep -q . \
      && fatal "AWS CLI installer produced a group/world-writable path"
    unlink -- "$AWS_STAGE/v2/current"
    ln -s -- "$AWS_ROOT/v2/$AWS_VERSION" "$AWS_STAGE/v2/current"
    printf 'VERSION=%s\nARCHIVE_SHA256=%s\nSIGNING_FINGERPRINT=%s\n' \
      "$AWS_VERSION" "$AWS_ARCHIVE_SHA256" "$AWS_SIGNING_FINGERPRINT" \
      >"$AWS_STAGE/LEADDRIVE_PROVENANCE"
    chmod 0600 "$AWS_STAGE/LEADDRIVE_PROVENANCE"
    chown -R root:root "$AWS_STAGE"
    sync -f -- "$AWS_STAGE/v2/$AWS_VERSION/dist/aws" "$AWS_STAGE/LEADDRIVE_PROVENANCE" \
      "$AWS_STAGE" "$aws_parent"
    mv -- "$AWS_STAGE" "$AWS_ROOT"
    AWS_STAGE=""
    AWS_ROOT_CREATED=1
    sync -f -- "$AWS_ROOT/v2/current/bin/aws" "$AWS_ROOT/LEADDRIVE_PROVENANCE" \
      "$AWS_ROOT" "$aws_parent"
    if [ -e "$AWS_LINK" ] || [ -L "$AWS_LINK" ]; then
      fatal "refusing to replace an unknown pre-existing aws command"
    fi
    ln -s -- "$AWS_BIN" "$AWS_LINK"
    AWS_LINK_CREATED=1
  fi

  assert_toolchain
  sync -f -- "$AGE_LINK" "$AWS_LINK" /usr/local/bin "$TOOLS_ROOT"
  INSTALL_COMMITTED=1
  commit_commission_timers_disabled
  migrate_legacy_lock_policy
  assert_recovery_policy
  log "digest-pinned age $AGE_VERSION and signed AWS CLI $AWS_VERSION installed"
  log "all automatic recovery timers remain disabled; backup encryption is unchanged"
}

run_aws() {
  local timeout_seconds="$1"
  local access_key="$2"
  local secret_key="$3"
  shift 3
  env -i \
    PATH=/usr/bin:/bin HOME=/nonexistent \
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    timeout "$timeout_seconds" "$AWS_BIN" "$@"
}

prove_object_lock() {
  local endpoint region bucket access_key secret_key lock_state
  local lock_enabled lock_mode lock_days
  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  [ "$endpoint" = "https://${region}.your-objectstorage.com" ] \
    || fatal "Object Storage endpoint does not match its configured Hetzner region"
  lock_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-lock-configuration \
      --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" \
      --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]' \
      --output text 2>/dev/null)" \
    || fatal "writer credential cannot verify Object Lock"
  read -r lock_enabled lock_mode lock_days <<<"$lock_state"
  [ "$lock_enabled" = "Enabled" ] && [ "$lock_mode" = "COMPLIANCE" ] \
    && [[ "$lock_days" =~ ^[0-9]+$ ]] && [ "$lock_days" -ge 14 ] \
    || fatal "Object Lock is not COMPLIANCE for at least 14 days"
  log "Object Lock precondition verified (bucket details redacted)"
}

ensure_evidence_directories() {
  assert_root_directory "/etc/leaddrive" /etc/leaddrive
  ensure_root_directory "$EVIDENCE_ROOT"
  chmod 0700 "$EVIDENCE_ROOT"
  ensure_root_directory "$CANDIDATE_DIR"
  chmod 0700 "$CANDIDATE_DIR"
  ensure_root_directory "$RESTORE_DIR"
  chmod 0700 "$RESTORE_DIR"
  ensure_root_directory "$SIGNED_DIR"
  chmod 0700 "$SIGNED_DIR"
}

install_or_validate_allowed_signers() {
  local signer_count
  [ -f "$INCOMING_ALLOWED_SIGNERS" ] && [ ! -L "$INCOMING_ALLOWED_SIGNERS" ] \
    || fatal "signed evidence has no staged offline-verifier allowlist"
  [ "$(stat -c '%u' "$INCOMING_ALLOWED_SIGNERS")" = "0" ] \
    || fatal "staged offline-verifier allowlist must be root-owned"
  [ "$(stat -c '%s' "$INCOMING_ALLOWED_SIGNERS")" -le 16384 ] \
    || fatal "offline-verifier allowlist is unexpectedly large"
  awk '
    NF != 3 || $1 !~ /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/ \
      || $2 != "ssh-ed25519" || $3 !~ /^AAAA[A-Za-z0-9+\/=]+$/ { bad=1 }
    END { if (NR < 1 || bad) exit 1 }
  ' "$INCOMING_ALLOWED_SIGNERS" \
    || fatal "offline-verifier allowlist contains an unsupported record"
  signer_count="$(awk -v principal="$OFFLINE_OPERATOR" '$1 == principal { count++ } END { print count+0 }' \
    "$INCOMING_ALLOWED_SIGNERS")"
  [ "$signer_count" = "1" ] \
    || fatal "offline operator must identify exactly one trusted signing key"

  ensure_evidence_directories
  if [ -e "$OFFLINE_ALLOWED_SIGNERS" ] || [ -L "$OFFLINE_ALLOWED_SIGNERS" ]; then
    assert_root_file "offline-verifier allowlist" "$OFFLINE_ALLOWED_SIGNERS"
    [ "$(stat -c '%a' "$OFFLINE_ALLOWED_SIGNERS")" = "600" ] \
      || fatal "offline-verifier allowlist must use mode 0600"
    cmp -s -- "$INCOMING_ALLOWED_SIGNERS" "$OFFLINE_ALLOWED_SIGNERS" \
      || fatal "offline-verifier allowlist changed; use the explicit signer-rotation runbook"
  else
    MARKER_STAGE="$(mktemp "$EVIDENCE_ROOT/.marker-stage.XXXXXX")"
    install -o root -g root -m 0600 "$INCOMING_ALLOWED_SIGNERS" "$MARKER_STAGE"
    sync -f -- "$MARKER_STAGE" "$EVIDENCE_ROOT"
    mv -- "$MARKER_STAGE" "$OFFLINE_ALLOWED_SIGNERS"
    MARKER_STAGE=""
    sync -f -- "$OFFLINE_ALLOWED_SIGNERS" "$EVIDENCE_ROOT"
    ALLOWED_SIGNERS_CREATED=1
  fi
  ALLOWED_SIGNERS_SHA256="$(sha256sum "$OFFLINE_ALLOWED_SIGNERS" | awk '{print $1}')"
}

verify_signed_evidence() {
  local expected_type="$1"
  local expected_recipient="$2"
  local candidate_file="${3:-}"
  local entries evidence_file signature_file verified_epoch now_epoch maximum_age_seconds
  local candidate_format evidence_format recovery_scope candidate_sha key

  command -v ssh-keygen >/dev/null 2>&1 || fatal "ssh-keygen is required for offline evidence verification"
  [ -f "$INCOMING_EVIDENCE_BUNDLE" ] && [ ! -L "$INCOMING_EVIDENCE_BUNDLE" ] \
    || fatal "signed offline evidence bundle is missing"
  [ "$(stat -c '%u' "$INCOMING_EVIDENCE_BUNDLE")" = "0" ] \
    || fatal "signed offline evidence bundle must be root-owned"
  [ "$(stat -c '%s' "$INCOMING_EVIDENCE_BUNDLE")" -le 45000 ] \
    || fatal "signed offline evidence bundle is unexpectedly large"
  entries="$(tar -tf "$INCOMING_EVIDENCE_BUNDLE")"
  [ "$entries" = $'evidence.env\nevidence.env.sig' ] \
    || fatal "signed offline evidence bundle has an unexpected layout"
  tar -tvf "$INCOMING_EVIDENCE_BUNDLE" \
    | awk '$1 !~ /^-/ { unsafe=1 } END { exit unsafe }' \
    || fatal "signed offline evidence bundle contains a link or special file"

  WORK_DIR="$(mktemp -d /var/tmp/leaddrive-backup-evidence.XXXXXX)"
  tar --no-same-owner --no-same-permissions -xf "$INCOMING_EVIDENCE_BUNDLE" -C "$WORK_DIR"
  evidence_file="$WORK_DIR/evidence.env"
  signature_file="$WORK_DIR/evidence.env.sig"
  [ -s "$evidence_file" ] && [ ! -L "$evidence_file" ] \
    && [ -s "$signature_file" ] && [ ! -L "$signature_file" ] \
    || fatal "signed offline evidence files are missing"
  [ "$(stat -c '%s' "$evidence_file")" -le 8192 ] \
    && [ "$(stat -c '%s' "$signature_file")" -le 8192 ] \
    || fatal "signed offline evidence files are unexpectedly large"

  ssh-keygen -Y verify -f "$OFFLINE_ALLOWED_SIGNERS" \
    -I "$OFFLINE_OPERATOR" -n leaddrive-backup-evidence \
    -s "$signature_file" <"$evidence_file" >/dev/null 2>&1 \
    || fatal "offline evidence signature is not valid for the trusted operator"

  evidence_format=1
  recovery_scope=""
  if [ "$expected_type" = archive-restore ]; then
    assert_root_file "archive evidence candidate" "$candidate_file"
    candidate_sha="$(sha256sum "$candidate_file" | awk '{print $1}')"
    [ "$candidate_sha" = "$EXPECTED_CANDIDATE_SHA256" ] \
      || fatal "archive evidence candidate digest changed before verification"
    candidate_format="$(read_unique_value_from "$candidate_file" FORMAT_VERSION)"
    case "$candidate_format" in
      2)
        evidence_format=1
        recovery_scope=log-genesis-bootstrap-only
        ;;
      3)
        evidence_format=2
        recovery_scope=full-recovery
        ;;
      *) fatal "archive evidence candidate has an unsupported format" ;;
    esac
  fi

  [ "$(read_unique_value_from "$evidence_file" FORMAT_VERSION)" = "$evidence_format" ] \
    && [ "$(read_unique_value_from "$evidence_file" EVIDENCE_TYPE)" = "$expected_type" ] \
    && [ "$(read_unique_value_from "$evidence_file" STATUS)" = "verified" ] \
    && [ "$(read_unique_value_from "$evidence_file" RECIPIENT_SHA256)" = "$expected_recipient" ] \
    && [ "$(read_unique_value_from "$evidence_file" EVIDENCE_REF)" = "$EVIDENCE_REF" ] \
    && [ "$(read_unique_value_from "$evidence_file" OFFLINE_OPERATOR)" = "$OFFLINE_OPERATOR" ] \
    && [ "$(read_unique_value_from "$evidence_file" VERIFIED_AT_UTC)" = "$EVIDENCE_AT_UTC" ] \
    && [ "$(read_unique_value_from "$evidence_file" REVIEWED_MAIN_SHA)" = "$WORKFLOW_SHA" ] \
    || fatal "signed offline evidence does not match the commissioned operation"
  verified_epoch="$(date -u -d "$EVIDENCE_AT_UTC" '+%s' 2>/dev/null)" \
    || fatal "signed evidence timestamp is invalid"
  now_epoch="$(date -u '+%s')"
  case "$expected_type" in
    archive-restore) maximum_age_seconds=3024000 ;;
    age-key-custody) maximum_age_seconds=7776000 ;;
    *) fatal "unsupported signed evidence type" ;;
  esac
  [ "$verified_epoch" -le $((now_epoch + 300)) ] \
    && [ "$verified_epoch" -ge $((now_epoch - maximum_age_seconds)) ] \
    || fatal "signed evidence timestamp is outside the reviewed freshness window"

  case "$expected_type" in
    age-key-custody)
      [ "$(read_unique_value_from "$evidence_file" COPY_COUNT_MINIMUM)" = "2" ] \
        && [ "$(read_unique_value_from "$evidence_file" COPY_ONE_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" COPY_TWO_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" COPY_FILE_IDENTITY_STATUS)" = "distinct" ] \
        && [ "$(read_unique_value_from "$evidence_file" COPY_FILESYSTEM_DEVICE_STATUS)" = "distinct" ] \
        && [ "$(read_unique_value_from "$evidence_file" COPY_FAILURE_DOMAIN_ATTESTATION)" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
        && [ "$(read_unique_value_from "$evidence_file" CUSTODY_VERIFIER_SHA256)" = "$CUSTODY_VERIFIER_SHA256" ] \
        || fatal "signed key-custody evidence does not prove both offline copies"
      ;;
    archive-restore)
      [ "$(read_unique_value_from "$evidence_file" RECOVERY_SCOPE)" = "$recovery_scope" ] \
        && [ "$(read_unique_value_from "$evidence_file" CANDIDATE_SHA256)" = "$candidate_sha" ] \
        && [ "$(read_unique_value_from "$evidence_file" DATABASE_CIPHERTEXT_SHA256)" = "$(read_unique_value_from "$candidate_file" DATABASE_CIPHERTEXT_SHA256)" ] \
        && [ "$(read_unique_value_from "$evidence_file" SECRETS_CIPHERTEXT_SHA256)" = "$(read_unique_value_from "$candidate_file" SECRETS_CIPHERTEXT_SHA256)" ] \
        && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$(read_unique_value_from "$candidate_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" ] \
        && [ "$(read_unique_value_from "$evidence_file" DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" INTERNAL_CHECKSUM_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" SCRATCH_RESTORE_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" TENANT_CANARY_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
        && [ "$(read_unique_value_from "$evidence_file" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
        && [[ "$(read_unique_value_from "$evidence_file" SOURCE_MIGRATION_LEDGER_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        && [[ "$(read_unique_value_from "$evidence_file" RECOVERY_DB_CONTRACT_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$(read_unique_value_from "$evidence_file" RLS_FORCE_RLS_CATALOG_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" FULL_AUTHORITY_RESTORE_STATUS)" = "not_tested" ] \
        && [[ "$(read_unique_value_from "$evidence_file" DATABASE_AUTHORITY_CATALOG_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
        && [ "$(read_unique_value_from "$evidence_file" PII_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
        && [ "$(read_unique_value_from "$evidence_file" DATABASE_STORAGE_ATTESTATION)" = "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED" ] \
        && [ "$(read_unique_value_from "$evidence_file" ARCHIVE_VERIFIER_SHA256)" = "$ARCHIVE_VERIFIER_SHA256" ] \
        && [ "$(read_unique_value_from "$evidence_file" RESTORE_CANARY_SHA256)" = "$RESTORE_CANARY_SHA256" ] \
        && [ "$(read_unique_value_from "$evidence_file" PII_PROOF_SHA256)" = "$PII_PROOF_SHA256" ] \
        && [ "$(read_unique_value_from "$evidence_file" CANARY_SQL_SHA256)" = "$CANARY_SQL_SHA256" ] \
        && [ "$(read_unique_value_from "$evidence_file" SOURCE_APP_ENV_SHA256)" = "$(read_unique_value_from "$candidate_file" SOURCE_APP_ENV_SHA256)" ] \
        && [ "$(read_unique_value_from "$evidence_file" SOURCE_BACKUP_ENV_SHA256)" = "$(read_unique_value_from "$candidate_file" SOURCE_BACKUP_ENV_SHA256)" ] \
        && [ "$(read_unique_value_from "$evidence_file" SOURCE_MIGRATION_ENV_SHA256)" = "$(read_unique_value_from "$candidate_file" SOURCE_MIGRATION_ENV_SHA256)" ] \
        || fatal "signed archive evidence is not bound to the restored candidate and checks"
      for key in \
        OBJECT_BUCKET \
        DATABASE_OBJECT_KEY DATABASE_OBJECT_VERSION_ID DATABASE_RETAIN_UNTIL \
        SECRETS_OBJECT_KEY SECRETS_OBJECT_VERSION_ID SECRETS_RETAIN_UNTIL \
        RUNTIME_FILES_OBJECT_KEY RUNTIME_FILES_OBJECT_VERSION_ID RUNTIME_FILES_RETAIN_UNTIL \
        RUNTIME_FILES_INVENTORY_SHA256 RUNTIME_FILES_FILE_COUNT \
        SOURCE_DATABASE_IDENTITY_SHA256 COMMISSION_CODE_BUNDLE_SHA256 \
        SOURCE_MIGRATION_LEDGER_SHA256 RECOVERY_PROGRAM_SET_SHA256 \
        RECOVERY_DB_CONTRACT_SHA256; do
        [ "$(read_unique_value_from "$evidence_file" "$key")" = \
          "$(read_unique_value_from "$candidate_file" "$key")" ] \
          || fatal "signed archive evidence does not bind candidate field $key"
      done
      if [ "$candidate_format" = 3 ]; then
        for key in \
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
          [ "$(read_unique_value_from "$evidence_file" "$key")" = \
            "$(read_unique_value_from "$candidate_file" "$key")" ] \
            || fatal "signed full-recovery evidence does not bind candidate field $key"
        done
        [[ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_MANIFEST_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
          && [[ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_SHA256SUMS_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_DECRYPT_STATUS)" = passed ] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_ARCHIVE_LAYOUT_STATUS)" = passed ] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_INTERNAL_CHECKSUM_STATUS)" = passed ] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_RANGES_STATUS)" = passed ] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_CURSOR_STATUS)" = passed ] \
          && [ "$(read_unique_value_from "$evidence_file" LOG_GENESIS_ANCHOR_BINDING_STATUS)" = passed ] \
          || fatal "signed full-recovery evidence has no complete log-genesis restore proof"
      elif grep -q '^LOG_GENESIS_' "$evidence_file"; then
        fatal "bootstrap-only evidence may not claim log-genesis verification"
      fi
      case "$(read_unique_value_from "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)" in
        passed|not_applicable_no_persisted_ciphertext) ;;
        *) fatal "signed archive evidence has no valid integration-token recovery result" ;;
      esac
      ;;
    *) fatal "unsupported signed evidence type" ;;
  esac
  SIGNED_EVIDENCE_SHA256="$(sha256sum "$evidence_file" | awk '{print $1}')"
  SIGNED_SIGNATURE_SHA256="$(sha256sum "$signature_file" | awk '{print $1}')"
  SIGNED_EVIDENCE_FILE="$evidence_file"
  SIGNED_SIGNATURE_FILE="$signature_file"
}

preserve_signed_evidence() {
  local target_dir="$SIGNED_DIR/$SIGNED_EVIDENCE_SHA256"
  [ -n "$SIGNED_EVIDENCE_FILE" ] && [ -n "$SIGNED_SIGNATURE_FILE" ] \
    || fatal "signed evidence was not verified before preservation"
  ensure_evidence_directories
  if [ -e "$target_dir" ] || [ -L "$target_dir" ]; then
    assert_root_directory "preserved signed evidence directory" "$target_dir"
    assert_root_file "preserved signed evidence" "$target_dir/evidence.env"
    assert_root_file "preserved signed evidence signature" "$target_dir/evidence.env.sig"
    [ "$(stat -c '%a' "$target_dir")" = "700" ] \
      && [ "$(stat -c '%a' "$target_dir/evidence.env")" = "600" ] \
      && [ "$(stat -c '%a' "$target_dir/evidence.env.sig")" = "600" ] \
      || fatal "preserved signed evidence permissions are unsafe"
    [ "$(sha256sum "$target_dir/evidence.env" | awk '{print $1}')" = "$SIGNED_EVIDENCE_SHA256" ] \
      && [ "$(sha256sum "$target_dir/evidence.env.sig" | awk '{print $1}')" = "$SIGNED_SIGNATURE_SHA256" ] \
      || fatal "preserved signed evidence conflicts with the incoming proof"
  else
    SIGNED_STAGE="$(mktemp -d "$SIGNED_DIR/.signed-stage.XXXXXX")"
    chmod 0700 "$SIGNED_STAGE"
    install -o root -g root -m 0600 "$SIGNED_EVIDENCE_FILE" "$SIGNED_STAGE/evidence.env"
    install -o root -g root -m 0600 "$SIGNED_SIGNATURE_FILE" "$SIGNED_STAGE/evidence.env.sig"
    sync -f -- "$SIGNED_STAGE/evidence.env" "$SIGNED_STAGE/evidence.env.sig" "$SIGNED_STAGE" "$SIGNED_DIR"
    mv -- "$SIGNED_STAGE" "$target_dir"
    SIGNED_STAGE=""
    sync -f -- "$target_dir/evidence.env" "$target_dir/evidence.env.sig" "$target_dir" "$SIGNED_DIR"
  fi
  SIGNED_EVIDENCE_FILE="$target_dir/evidence.env"
  SIGNED_SIGNATURE_FILE="$target_dir/evidence.env.sig"
}

extend_and_verify_recovery_payload_retention() {
  local candidate_file="$1"
  local requested_until="$2"
  local endpoint region configured_bucket candidate_bucket access_key secret_key requested_epoch
  local label key version expected_bytes expected_sha head_state remote_bytes remote_sha
  local retention_state retention_mode retention_until retention_epoch

  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  configured_bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  candidate_bucket="$(read_unique_value_from "$candidate_file" OBJECT_BUCKET)"
  [ "$candidate_bucket" = "$configured_bucket" ] \
    || fatal "full-recovery candidate belongs to another object-storage bucket"
  requested_epoch="$(date -u -d "$requested_until" '+%s' 2>/dev/null)" \
    || fatal "recovery catalog requested retention timestamp is invalid"

  for label in DATABASE SECRETS RUNTIME_FILES LOG_GENESIS; do
    key="$(read_unique_value_from "$candidate_file" "${label}_OBJECT_KEY")"
    version="$(read_unique_value_from "$candidate_file" "${label}_OBJECT_VERSION_ID")"
    expected_bytes="$(read_unique_value_from "$candidate_file" "${label}_CIPHERTEXT_BYTES")"
    expected_sha="$(read_unique_value_from "$candidate_file" "${label}_CIPHERTEXT_SHA256")"
    [[ "$key" =~ ^[A-Za-z0-9._/-]+[.](tar[.]age|tar[.]gz[.]age)$ ]] \
      && [[ "$expected_bytes" =~ ^[1-9][0-9]*$ ]] \
      && [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
      || fatal "$label recovery payload identity is invalid"
    case "$label" in
      LOG_GENESIS)
        [[ "$version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
          && [ "$version" != None ] && [ "$version" != null ] \
          || fatal "LOG_GENESIS recovery payload VersionId is invalid"
        ;;
      *)
        [[ "$version" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
          || fatal "$label recovery payload VersionId is invalid"
        ;;
    esac
    head_state="$(run_aws 45 "$access_key" "$secret_key" \
      s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
        --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
        --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null)" \
      || fatal "$label recovery payload version is no longer readable"
    read -r remote_bytes remote_sha <<<"$head_state"
    [ "$remote_bytes" = "$expected_bytes" ] && [ "$remote_sha" = "$expected_sha" ] \
      || fatal "$label recovery payload metadata drifted before catalog publication"

    retention_state="$(run_aws 45 "$access_key" "$secret_key" \
      s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
        --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
        --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
      || fatal "$label recovery payload retention cannot be inspected"
    read -r retention_mode retention_until <<<"$retention_state"
    retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
      || fatal "$label recovery payload retention timestamp is invalid"
    [ "$retention_mode" = COMPLIANCE ] \
      || fatal "$label recovery payload is not protected by COMPLIANCE retention"
    if [ "$retention_epoch" -lt "$requested_epoch" ]; then
      run_aws 45 "$access_key" "$secret_key" \
        s3api put-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
          --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
          --retention "Mode=COMPLIANCE,RetainUntilDate=$requested_until" >/dev/null \
        || fatal "$label recovery payload retention could not be extended monotonically"
    fi
    retention_state="$(run_aws 45 "$access_key" "$secret_key" \
      s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
        --bucket "$candidate_bucket" --key="$key" --version-id="$version" \
        --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
      || fatal "$label recovery payload retention cannot be reverified"
    read -r retention_mode retention_until <<<"$retention_state"
    retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
      || fatal "$label recovery payload final retention timestamp is invalid"
    [ "$retention_mode" = COMPLIANCE ] && [ "$retention_epoch" -ge "$requested_epoch" ] \
      || fatal "$label recovery payload does not outlive the catalog"
  done
}

publish_recovery_catalog() {
  local candidate_file="$1"
  local endpoint region bucket access_key secret_key retention_days
  local catalog_dir catalog_file roundtrip_file roundtrip_dir catalog_sha catalog_bytes object_key
  local anchor_sha head_state remote_bytes version_id remote_sha remote_candidate remote_evidence
  local remote_signature remote_signers remote_catalog_format remote_genesis remote_bootstrap
  local remote_bootstrap_evidence remote_bootstrap_signature created_at requested_until
  local retention_state retention_mode retention_until

  [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ] && [ ! -L "$WORK_DIR" ] \
    || fatal "verified evidence workspace is unavailable for recovery catalog publication"
  assert_root_file "recovery catalog candidate" "$candidate_file"
  assert_root_file "recovery catalog signed evidence" "$SIGNED_EVIDENCE_FILE"
  assert_root_file "recovery catalog signature" "$SIGNED_SIGNATURE_FILE"
  assert_root_file "recovery catalog signer allowlist" "$OFFLINE_ALLOWED_SIGNERS"
  assert_root_file "recovery catalog log-genesis anchor" "$LOG_GENESIS_ANCHOR"
  [ "$(read_unique_value_from "$candidate_file" FORMAT_VERSION)" = 3 ] \
    && [ "$(read_unique_value_from "$candidate_file" RECOVERY_SCOPE)" = full-recovery ] \
    || fatal "only a full-recovery v3 candidate may be cataloged"
  validate_bootstrap_certificate_for_full_chain "$(read_unique_value_from "$candidate_file" RECIPIENT_SHA256)"
  [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)" = 1 ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_MARKER_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)" = "$BOOTSTRAP_CERTIFICATE_MARKER_BYTES" ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)" = "$BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256" ] \
    || fatal "catalog candidate is not bound to the limited bootstrap certificate"
  anchor_sha="$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')"
  [ "$anchor_sha" = "$(read_unique_value_from "$candidate_file" LOG_GENESIS_ANCHOR_SHA256)" ] \
    && [ "$(stat -c '%s' "$LOG_GENESIS_ANCHOR")" = \
      "$(read_unique_value_from "$candidate_file" LOG_GENESIS_ANCHOR_BYTES)" ] \
    || fatal "log-genesis anchor changed before catalog publication"

  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  retention_days="$(read_unique_value BACKUP_RETENTION_MONTHLY_DAYS)"
  retention_days="${retention_days:-400}"
  [[ "$retention_days" =~ ^[0-9]+$ ]] && [ "$retention_days" -ge 400 ] \
    || fatal "recovery catalog retention must be at least 400 days"
  created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  requested_until="$(date -u -d "$created_at +$retention_days days" '+%Y-%m-%dT%H:%M:%SZ')"

  # The catalog must never outlive any object it references. Extend and then
  # re-read every exact object version before publishing the immutable index.
  extend_and_verify_recovery_payload_retention "$candidate_file" "$requested_until"

  catalog_dir="$(mktemp -d "$WORK_DIR/recovery-catalog.XXXXXX")"
  chmod 0700 "$catalog_dir"
  install -o root -g root -m 0600 "$candidate_file" "$catalog_dir/candidate.env"
  install -o root -g root -m 0600 "$SIGNED_EVIDENCE_FILE" "$catalog_dir/evidence.env"
  install -o root -g root -m 0600 "$SIGNED_SIGNATURE_FILE" "$catalog_dir/evidence.env.sig"
  install -o root -g root -m 0600 "$BOOTSTRAP_RESTORE_MARKER" "$catalog_dir/bootstrap-offline-restore.env"
  install -o root -g root -m 0600 "$BOOTSTRAP_CERTIFICATE_EVIDENCE_FILE" "$catalog_dir/bootstrap-evidence.env"
  install -o root -g root -m 0600 "$BOOTSTRAP_CERTIFICATE_SIGNATURE_FILE" "$catalog_dir/bootstrap-evidence.env.sig"
  install -o root -g root -m 0600 "$LOG_GENESIS_ANCHOR" "$catalog_dir/log-evidence-genesis.env"
  install -o root -g root -m 0600 "$OFFLINE_ALLOWED_SIGNERS" "$catalog_dir/offline-allowed-signers"
  catalog_file="$WORK_DIR/recovery-catalog.tar"
  [ ! -e "$catalog_file" ] && [ ! -L "$catalog_file" ] \
    || fatal "recovery catalog output path already exists"
  tar --format=posix --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
    -cf "$catalog_file" -C "$catalog_dir" \
    bootstrap-evidence.env bootstrap-evidence.env.sig bootstrap-offline-restore.env \
    candidate.env evidence.env evidence.env.sig log-evidence-genesis.env offline-allowed-signers
  [ "$(tar -tf "$catalog_file")" = $'bootstrap-evidence.env\nbootstrap-evidence.env.sig\nbootstrap-offline-restore.env\ncandidate.env\nevidence.env\nevidence.env.sig\nlog-evidence-genesis.env\noffline-allowed-signers' ] \
    && tar -tvf "$catalog_file" | awk '$1 !~ /^-/ { bad=1 } END { exit bad }' \
    || fatal "recovery catalog does not have the exact eight-file v3 layout"
  catalog_sha="$(sha256sum "$catalog_file" | awk '{print $1}')"
  catalog_bytes="$(stat -c '%s' "$catalog_file")"
  [[ "$catalog_sha" =~ ^[0-9a-f]{64}$ ]] && [[ "$catalog_bytes" =~ ^[1-9][0-9]*$ ]] \
    || fatal "recovery catalog digest or size is invalid"
  object_key="recovery-catalog/v3/archive-restore/$EXPECTED_CANDIDATE_SHA256/$catalog_sha.tar"

  run_aws 120 "$access_key" "$secret_key" s3 cp "$catalog_file" "s3://$bucket/$object_key" \
    --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
    --only-show-errors --no-progress \
    --metadata "sha256=$catalog_sha,candidate=$EXPECTED_CANDIDATE_SHA256,evidence=$SIGNED_EVIDENCE_SHA256,signature=$SIGNED_SIGNATURE_SHA256,signers=$ALLOWED_SIGNERS_SHA256,catalog_format=3,genesis=$anchor_sha,bootstrap=$BOOTSTRAP_CERTIFICATE_MARKER_SHA256,bootstrap_evidence=$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256,bootstrap_signature=$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" \
    || fatal "verified recovery catalog could not be uploaded"
  head_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$object_key" \
      --query '[ContentLength,VersionId,Metadata.sha256,Metadata.candidate,Metadata.evidence,Metadata.signature,Metadata.signers,Metadata.catalog_format,Metadata.genesis,Metadata.bootstrap,Metadata.bootstrap_evidence,Metadata.bootstrap_signature]' \
      --output text 2>/dev/null)" \
    || fatal "uploaded recovery catalog cannot be inspected"
  read -r remote_bytes version_id remote_sha remote_candidate remote_evidence remote_signature remote_signers \
    remote_catalog_format remote_genesis remote_bootstrap remote_bootstrap_evidence remote_bootstrap_signature <<<"$head_state"
  [ "$remote_bytes" = "$catalog_bytes" ] \
    && [[ "$version_id" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [ "$remote_sha" = "$catalog_sha" ] \
    && [ "$remote_candidate" = "$EXPECTED_CANDIDATE_SHA256" ] \
    && [ "$remote_evidence" = "$SIGNED_EVIDENCE_SHA256" ] \
    && [ "$remote_signature" = "$SIGNED_SIGNATURE_SHA256" ] \
    && [ "$remote_signers" = "$ALLOWED_SIGNERS_SHA256" ] \
    && [ "$remote_catalog_format" = 3 ] \
    && [ "$remote_genesis" = "$anchor_sha" ] \
    && [ "$remote_bootstrap" = "$BOOTSTRAP_CERTIFICATE_MARKER_SHA256" ] \
    && [ "$remote_bootstrap_evidence" = "$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256" ] \
    && [ "$remote_bootstrap_signature" = "$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" ] \
    || fatal "uploaded recovery catalog metadata or version is invalid"

  run_aws 45 "$access_key" "$secret_key" \
    s3api put-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$object_key" --version-id="$version_id" \
      --retention "Mode=COMPLIANCE,RetainUntilDate=$requested_until" >/dev/null \
    || fatal "recovery catalog COMPLIANCE retention could not be applied"
  retention_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$object_key" --version-id="$version_id" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
    || fatal "recovery catalog retention cannot be verified"
  read -r retention_mode retention_until <<<"$retention_state"
  [ "$retention_mode" = COMPLIANCE ] \
    && [ "$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)" \
      -ge "$(date -u -d "$requested_until" '+%s')" ] \
    || fatal "recovery catalog is not locked for the reviewed retention window"

  # Object Storage is allowed to round a requested deadline upward.  The
  # marker records that actual immutable deadline, so re-check all four exact
  # payload versions against it before making the marker durable; otherwise a
  # catalog could outlive an object merely because the provider rounded one
  # value differently.
  extend_and_verify_recovery_payload_retention "$candidate_file" "$retention_until"

  roundtrip_file="$WORK_DIR/recovery-catalog-roundtrip.tar"
  [ ! -e "$roundtrip_file" ] && [ ! -L "$roundtrip_file" ] \
    || fatal "recovery catalog round-trip output path already exists"
  run_aws 120 "$access_key" "$secret_key" \
    s3api get-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$object_key" --version-id="$version_id" \
      "$roundtrip_file" >/dev/null \
    || fatal "exact recovery catalog object version cannot be downloaded"
  [ "$(stat -c '%s' "$roundtrip_file")" = "$catalog_bytes" ] \
    && [ "$(sha256sum "$roundtrip_file" | awk '{print $1}')" = "$catalog_sha" ] \
    && [ "$(tar -tf "$roundtrip_file")" = $'bootstrap-evidence.env\nbootstrap-evidence.env.sig\nbootstrap-offline-restore.env\ncandidate.env\nevidence.env\nevidence.env.sig\nlog-evidence-genesis.env\noffline-allowed-signers' ] \
    && tar -tvf "$roundtrip_file" | awk '$1 !~ /^-/ { bad=1 } END { exit bad }' \
    || fatal "recovery catalog round-trip bytes or layout do not match"
  roundtrip_dir="$(mktemp -d "$WORK_DIR/recovery-catalog-roundtrip.XXXXXX")"
  chmod 0700 "$roundtrip_dir"
  tar --keep-old-files --no-same-owner --no-same-permissions -xf "$roundtrip_file" -C "$roundtrip_dir"
  cmp -s "$candidate_file" "$roundtrip_dir/candidate.env" \
    && cmp -s "$SIGNED_EVIDENCE_FILE" "$roundtrip_dir/evidence.env" \
    && cmp -s "$SIGNED_SIGNATURE_FILE" "$roundtrip_dir/evidence.env.sig" \
    && cmp -s "$BOOTSTRAP_RESTORE_MARKER" "$roundtrip_dir/bootstrap-offline-restore.env" \
    && cmp -s "$BOOTSTRAP_CERTIFICATE_EVIDENCE_FILE" "$roundtrip_dir/bootstrap-evidence.env" \
    && cmp -s "$BOOTSTRAP_CERTIFICATE_SIGNATURE_FILE" "$roundtrip_dir/bootstrap-evidence.env.sig" \
    && cmp -s "$LOG_GENESIS_ANCHOR" "$roundtrip_dir/log-evidence-genesis.env" \
    && cmp -s "$OFFLINE_ALLOWED_SIGNERS" "$roundtrip_dir/offline-allowed-signers" \
    || fatal "recovery catalog round-trip members changed"

  RECOVERY_CATALOG_OBJECT_KEY="$object_key"
  RECOVERY_CATALOG_OBJECT_VERSION_ID="$version_id"
  RECOVERY_CATALOG_SHA256="$catalog_sha"
  RECOVERY_CATALOG_BYTES="$catalog_bytes"
  RECOVERY_CATALOG_CREATED_AT_UTC="$created_at"
  RECOVERY_CATALOG_RETENTION_DAYS="$retention_days"
  RECOVERY_CATALOG_RETAIN_UNTIL="$retention_until"
  log "signed full-recovery catalog includes bootstrap authority and all four payload versions are COMPLIANCE-locked to the actual catalog deadline"
}

assert_preserved_signed_evidence() {
  local marker="$1"
  local expected_type="$2"
  local evidence_sha signature_sha signer_sha operator evidence_file signature_file marker_scope
  evidence_sha="$(read_unique_value_from "$marker" SIGNED_EVIDENCE_SHA256)"
  signature_sha="$(read_unique_value_from "$marker" SIGNED_SIGNATURE_SHA256)"
  signer_sha="$(read_unique_value_from "$marker" ALLOWED_SIGNERS_SHA256)"
  operator="$(read_unique_value_from "$marker" OFFLINE_OPERATOR)"
  [[ "$evidence_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signature_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$signer_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$operator" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
    || fatal "signed-evidence references in $(basename -- "$marker") are invalid"
  evidence_file="$SIGNED_DIR/$evidence_sha/evidence.env"
  signature_file="$SIGNED_DIR/$evidence_sha/evidence.env.sig"
  assert_root_directory "preserved signed evidence directory" "$SIGNED_DIR/$evidence_sha"
  assert_root_file "preserved signed evidence" "$evidence_file"
  assert_root_file "preserved signed evidence signature" "$signature_file"
  [ "$(sha256sum "$evidence_file" | awk '{print $1}')" = "$evidence_sha" ] \
    && [ "$(sha256sum "$signature_file" | awk '{print $1}')" = "$signature_sha" ] \
    && [ "$(sha256sum "$OFFLINE_ALLOWED_SIGNERS" | awk '{print $1}')" = "$signer_sha" ] \
    || fatal "preserved signed evidence or verifier allowlist drifted"
  ssh-keygen -Y verify -f "$OFFLINE_ALLOWED_SIGNERS" \
    -I "$operator" -n leaddrive-backup-evidence \
    -s "$signature_file" <"$evidence_file" >/dev/null 2>&1 \
    || fatal "preserved offline evidence signature is invalid"
  [ "$(read_unique_value_from "$evidence_file" EVIDENCE_TYPE)" = "$expected_type" ] \
    && [ "$(read_unique_value_from "$evidence_file" STATUS)" = "verified" ] \
    && [ "$(read_unique_value_from "$evidence_file" RECIPIENT_SHA256)" = "$(read_unique_value_from "$marker" RECIPIENT_SHA256)" ] \
    && [ "$(read_unique_value_from "$evidence_file" EVIDENCE_REF)" = "$(read_unique_value_from "$marker" EVIDENCE_REF)" ] \
    && [ "$(read_unique_value_from "$evidence_file" VERIFIED_AT_UTC)" = "$(read_unique_value_from "$marker" EVIDENCE_AT_UTC)" ] \
    && [ "$(read_unique_value_from "$evidence_file" OFFLINE_OPERATOR)" = "$operator" ] \
    || fatal "preserved signed evidence no longer matches its marker"
  if [ "$expected_type" = archive-restore ]; then
    marker_scope="$(read_unique_value_from "$marker" RECOVERY_SCOPE)"
    [ "$(read_unique_value_from "$evidence_file" RECOVERY_SCOPE)" = "$marker_scope" ] \
      || fatal "preserved signed archive evidence belongs to another recovery scope"
  fi
}

# A full certificate must prove that the immutable genesis did not appear as an
# unreviewed shortcut.  Bind the prior, deliberately limited bootstrap
# certificate (and its independently signed evidence) into the full candidate
# and later into the off-host catalog.
validate_bootstrap_certificate_for_full_chain() {
  local recipient_sha="$1"
  local bootstrap_candidate evidence_sha signature_sha signers_sha evidence_file signature_file

  assert_root_file "bootstrap offline restore marker" "$BOOTSTRAP_RESTORE_MARKER"
  [ "$(stat -c '%a' "$BOOTSTRAP_RESTORE_MARKER")" = 600 ] \
    || fatal "bootstrap offline restore marker must use mode 0600"
  [ "$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" FORMAT_VERSION)" = 1 ] \
    && [ "$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" EVIDENCE_TYPE)" = archive-restore ] \
    && [ "$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" STATUS)" = verified ] \
    && [ "$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" RECOVERY_SCOPE)" = log-genesis-bootstrap-only ] \
    && [ "$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" RECIPIENT_SHA256)" = "$recipient_sha" ] \
    || fatal "bootstrap restore marker is not the limited independently verified ceremony"
  ! grep -q '^LOG_GENESIS_' "$BOOTSTRAP_RESTORE_MARKER" \
    || fatal "bootstrap restore marker must not claim a log-genesis proof"
  assert_preserved_signed_evidence "$BOOTSTRAP_RESTORE_MARKER" archive-restore

  BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256="$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" CANDIDATE_SHA256)"
  BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256="$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" SIGNED_EVIDENCE_SHA256)"
  BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256="$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" SIGNED_SIGNATURE_SHA256)"
  BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256="$(read_unique_value_from "$BOOTSTRAP_RESTORE_MARKER" ALLOWED_SIGNERS_SHA256)"
  for bootstrap_candidate in \
    "$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256" \
    "$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256" \
    "$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" \
    "$BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256"; do
    [[ "$bootstrap_candidate" =~ ^[0-9a-f]{64}$ ]] \
      || fatal "bootstrap certificate contains an invalid digest"
  done
  bootstrap_candidate="$(find_candidate_by_digest "$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256")"
  assert_root_file "bootstrap recovery candidate" "$bootstrap_candidate"
  [ "$(read_unique_value_from "$bootstrap_candidate" FORMAT_VERSION)" = 2 ] \
    && [ "$(read_unique_value_from "$bootstrap_candidate" RECOVERY_SCOPE)" = log-genesis-bootstrap-only ] \
    && [ "$(read_unique_value_from "$bootstrap_candidate" STATUS)" = awaiting_offline_restore ] \
    && [ "$(read_unique_value_from "$bootstrap_candidate" RECIPIENT_SHA256)" = "$recipient_sha" ] \
    || fatal "bootstrap certificate points to an invalid limited candidate"
  evidence_file="$SIGNED_DIR/$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256/evidence.env"
  signature_file="$SIGNED_DIR/$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256/evidence.env.sig"
  assert_root_file "bootstrap signed evidence" "$evidence_file"
  assert_root_file "bootstrap signed evidence signature" "$signature_file"
  [ "$(read_unique_value_from "$evidence_file" FORMAT_VERSION)" = 1 ] \
    && [ "$(read_unique_value_from "$evidence_file" RECOVERY_SCOPE)" = log-genesis-bootstrap-only ] \
    && [ "$(read_unique_value_from "$evidence_file" CANDIDATE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256" ] \
    && [ "$(read_unique_value_from "$evidence_file" RECIPIENT_SHA256)" = "$recipient_sha" ] \
    || fatal "bootstrap signed evidence does not bind the limited candidate"
  BOOTSTRAP_CERTIFICATE_MARKER_SHA256="$(sha256sum "$BOOTSTRAP_RESTORE_MARKER" | awk '{print $1}')"
  BOOTSTRAP_CERTIFICATE_MARKER_BYTES="$(stat -c '%s' "$BOOTSTRAP_RESTORE_MARKER")"
  [[ "$BOOTSTRAP_CERTIFICATE_MARKER_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$BOOTSTRAP_CERTIFICATE_MARKER_BYTES" =~ ^[1-9][0-9]*$ ]] \
    && [ "$BOOTSTRAP_CERTIFICATE_MARKER_BYTES" -le 65536 ] \
    || fatal "bootstrap certificate marker identity is invalid"
  BOOTSTRAP_CERTIFICATE_EVIDENCE_FILE="$evidence_file"
  BOOTSTRAP_CERTIFICATE_SIGNATURE_FILE="$signature_file"
}

write_custody_marker() {
  local recipient_sha="$1"
  local recorded_at existing_sha marker_existed=0
  ensure_evidence_directories
  if [ -e "$CUSTODY_MARKER" ] || [ -L "$CUSTODY_MARKER" ]; then
    assert_root_file "age key-custody marker" "$CUSTODY_MARKER"
    existing_sha="$(read_unique_value_from "$CUSTODY_MARKER" RECIPIENT_SHA256)"
    [ "$existing_sha" = "$recipient_sha" ] \
      || fatal "existing key-custody marker belongs to another recipient; use the rotation runbook"
    [ "$(read_unique_value_from "$CUSTODY_MARKER" STATUS)" = "verified" ] \
      || fatal "existing key-custody marker is not verified"
    marker_existed=1
  fi
  recorded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  MARKER_STAGE="$(mktemp "$EVIDENCE_ROOT/.marker-stage.XXXXXX")"
  printf '%s\n' \
    'FORMAT_VERSION=1' \
    'EVIDENCE_TYPE=age-key-custody' \
    'STATUS=verified' \
    "RECIPIENT_SHA256=$recipient_sha" \
    'COPY_COUNT_MINIMUM=2' \
    'INDEPENDENT_DECRYPT_TEST=passed' \
    'COPY_FILESYSTEM_DEVICE_STATUS=distinct' \
    'COPY_FAILURE_DOMAIN_ATTESTATION=TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED' \
    "SIGNED_EVIDENCE_SHA256=$SIGNED_EVIDENCE_SHA256" \
    "SIGNED_SIGNATURE_SHA256=$SIGNED_SIGNATURE_SHA256" \
    "ALLOWED_SIGNERS_SHA256=$ALLOWED_SIGNERS_SHA256" \
    "EVIDENCE_REF=$EVIDENCE_REF" \
    "EVIDENCE_AT_UTC=$EVIDENCE_AT_UTC" \
    "OFFLINE_OPERATOR=$OFFLINE_OPERATOR" \
    "REVIEWED_MAIN_SHA=$WORKFLOW_SHA" \
    "RECORDED_AT_UTC=$recorded_at" \
    "RECORDED_BY=$WORKFLOW_ACTOR" \
    "WORKFLOW_SHA=$WORKFLOW_SHA" \
    "WORKFLOW_RUN_ID=$WORKFLOW_RUN_ID" >"$MARKER_STAGE"
  chown root:root "$MARKER_STAGE"
  chmod 0600 "$MARKER_STAGE"
  sync -f -- "$MARKER_STAGE" "$EVIDENCE_ROOT"
  mv -f -- "$MARKER_STAGE" "$CUSTODY_MARKER"
  MARKER_STAGE=""
  sync -f -- "$CUSTODY_MARKER" "$EVIDENCE_ROOT"
  [ "$marker_existed" -eq 1 ] || CUSTODY_MARKER_CREATED=1
}

assert_custody_marker() {
  local recipient_sha="$1"
  local signer_hash evidence_sha evidence_file
  assert_root_file "age key-custody marker" "$CUSTODY_MARKER"
  [ "$(stat -c '%a' "$CUSTODY_MARKER")" = "600" ] \
    || fatal "age key-custody marker must use mode 0600"
  [ "$(read_unique_value_from "$CUSTODY_MARKER" FORMAT_VERSION)" = "1" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" STATUS)" = "verified" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" RECIPIENT_SHA256)" = "$recipient_sha" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" COPY_COUNT_MINIMUM)" = "2" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" INDEPENDENT_DECRYPT_TEST)" = "passed" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" COPY_FILESYSTEM_DEVICE_STATUS)" = "distinct" ] \
    && [ "$(read_unique_value_from "$CUSTODY_MARKER" COPY_FAILURE_DOMAIN_ATTESTATION)" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
    && [[ "$(read_unique_value_from "$CUSTODY_MARKER" SIGNED_EVIDENCE_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$(read_unique_value_from "$CUSTODY_MARKER" SIGNED_SIGNATURE_SHA256)" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "age key-custody marker is incomplete or belongs to another recipient"
  assert_root_file "offline-verifier allowlist" "$OFFLINE_ALLOWED_SIGNERS"
  signer_hash="$(sha256sum "$OFFLINE_ALLOWED_SIGNERS" | awk '{print $1}')"
  [ "$(read_unique_value_from "$CUSTODY_MARKER" ALLOWED_SIGNERS_SHA256)" = "$signer_hash" ] \
    || fatal "age key-custody marker is not bound to the current verifier allowlist"
  assert_preserved_signed_evidence "$CUSTODY_MARKER" age-key-custody
  evidence_sha="$(read_unique_value_from "$CUSTODY_MARKER" SIGNED_EVIDENCE_SHA256)"
  evidence_file="$SIGNED_DIR/$evidence_sha/evidence.env"
  [ "$(read_unique_value_from "$evidence_file" COPY_COUNT_MINIMUM)" = "2" ] \
    && [ "$(read_unique_value_from "$evidence_file" COPY_ONE_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" COPY_TWO_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" COPY_FILESYSTEM_DEVICE_STATUS)" = "distinct" ] \
    && [ "$(read_unique_value_from "$evidence_file" COPY_FAILURE_DOMAIN_ATTESTATION)" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
    && [ "$(read_unique_value_from "$evidence_file" CUSTODY_VERIFIER_SHA256)" = "$CUSTODY_VERIFIER_SHA256" ] \
    || fatal "preserved key-custody evidence is incomplete or used unreviewed code"
}

activate_encryption() {
  local recipient current_encryption recipient_sha staged_recipient staged_encryption
  assert_confirmation "ENABLE_AGE_BACKUPS_ON_13_140_132_245"
  validate_evidence_inputs
  [ -z "$EXPECTED_CANDIDATE_SHA256" ] \
    || fatal "encryption activation may not claim a completed archive restore"
  fence_backup_runner
  assert_backup_env
  assert_toolchain
  recipient="$(assert_expected_recipient)"
  recipient_sha="$(recipient_sha256 "$recipient")"
  install_or_validate_allowed_signers
  verify_signed_evidence age-key-custody "$recipient_sha"
  preserve_signed_evidence
  current_encryption="$(read_unique_value BACKUP_ENCRYPTION)"
  case "${current_encryption:-age}" in
    age|off) ;;
    *) fatal "backup environment has an unsupported encryption mode" ;;
  esac
  printf 'leaddrive-age-recipient-proof\n' \
    | "$AGE_BIN" --recipient "$recipient" >/dev/null 2>&1 \
    || fatal "configured public age recipient cannot encrypt a test payload"
  prove_object_lock
  write_custody_marker "$recipient_sha"

  if [ "${current_encryption:-age}" != "age" ]; then
    ENV_STAGE="$(mktemp /etc/leaddrive/.backup.env.age-stage.XXXXXX)"
    awk '!/^[[:space:]]*(export[[:space:]]+)?BACKUP_ENCRYPTION[[:space:]]*=/' \
      "$BACKUP_ENV_FILE" >"$ENV_STAGE"
    printf 'BACKUP_ENCRYPTION=age\n' >>"$ENV_STAGE"
    chown --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
    chmod --reference="$BACKUP_ENV_FILE" "$ENV_STAGE"
    staged_encryption="$(read_unique_value_from "$ENV_STAGE" BACKUP_ENCRYPTION)"
    staged_recipient="$(read_unique_value_from "$ENV_STAGE" BACKUP_AGE_RECIPIENT)"
    [ "$staged_encryption" = "age" ] && [ "$staged_recipient" = "$recipient" ] \
      || fatal "staged backup environment changed encryption or recipient unexpectedly"
    [ -z "$(read_unique_value_from "$ENV_STAGE" BACKUP_ENV_FILE)" ] \
      || fatal "staged backup environment redirects its authority"
    sync -f -- "$ENV_STAGE" /etc/leaddrive
    mv -- "$ENV_STAGE" "$BACKUP_ENV_FILE"
    ENV_STAGE=""
    sync -f -- "$BACKUP_ENV_FILE" /etc/leaddrive
  fi
  [ "$(read_unique_value BACKUP_ENCRYPTION)" = "age" ] \
    || fatal "age setting was not committed"
  assert_custody_marker "$recipient_sha"
  CUSTODY_MARKER_CREATED=0
  ALLOWED_SIGNERS_CREATED=0
  commit_commission_timers_disabled
  log "age encryption activated for the attested recipient; all recovery timers remain disabled"
}

prepare_commission_code() {
  local entries expected_entries bundled_manifest file
  [ -f "$INCOMING_CODE_BUNDLE" ] && [ ! -L "$INCOMING_CODE_BUNDLE" ] \
    || fatal "exact-main backup code bundle is missing"
  [ "$(stat -c '%u' "$INCOMING_CODE_BUNDLE")" = "0" ] \
    && [ "$(stat -c '%s' "$INCOMING_CODE_BUNDLE")" -le 1048576 ] \
    || fatal "exact-main backup code bundle ownership or size is unsafe"
  entries="$(tar -tf "$INCOMING_CODE_BUNDLE")"
  bundled_manifest="$(tar -xOf "$INCOMING_CODE_BUNDLE" \
    ops/backup/recovery-program-set.files 2>/dev/null)" \
    || fatal "exact-main backup code bundle has no recovery program manifest"
  printf '%s\n' "$bundled_manifest" | awk '
    !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/ || /^\// || /(^|\/)\.\.?(\/|$)/ { bad=1 }
    seen[$0]++ { bad=1 }
    { if (previous != "" && previous >= $0) bad=1; previous=$0 }
    END { if (NR < 1 || bad) exit 1 }
  ' || fatal "bundled recovery program manifest is unsafe, unsorted or duplicated"
  expected_entries="$(printf 'ops/backup/recovery-program-set.files\n%s\nrecovery-db-contract.tsv\nrecovery-db-contract.sha256\n' "$bundled_manifest")"
  [ "$entries" = "$expected_entries" ] \
    || fatal "exact-main backup code bundle has an unexpected layout"
  tar -tvf "$INCOMING_CODE_BUNDLE" \
    | awk '$1 !~ /^-/ { unsafe=1 } END { exit unsafe }' \
    || fatal "exact-main backup code bundle contains a link or special file"

  CODE_STAGE="/run/leaddrive-backup-commission-code-${WORKFLOW_RUN_ID}"
  [ ! -e "$CODE_STAGE" ] && [ ! -L "$CODE_STAGE" ] \
    || fatal "this workflow run already has a staged backup-code directory"
  install -d -o root -g root -m 0755 "$CODE_STAGE"
  tar --no-same-owner --no-same-permissions -xf "$INCOMING_CODE_BUNDLE" -C "$CODE_STAGE"
  while IFS= read -r file || [ -n "$file" ]; do
    [ -f "$CODE_STAGE/$file" ] && [ ! -L "$CODE_STAGE/$file" ] \
      || fatal "staged exact-main recovery program is missing $file"
  done <<<"$bundled_manifest"
  chown -R root:root "$CODE_STAGE"
  find "$CODE_STAGE" -type d -exec chmod 0755 {} +
  find "$CODE_STAGE" -type f -exec chmod 0644 {} +
  for file in \
    hash-recovery-db-contract.sh hash-recovery-program-set.sh postgres-backup.sh postgres-restore-canary.sh \
    prove-source-database.sh ship-logs.sh snapshot-runtime-files.sh snapshot-secrets.sh; do
    chmod 0755 "$CODE_STAGE/scripts/backup/$file"
  done
  install -o root -g root -m 0644 "$CODE_STAGE/recovery-db-contract.tsv" \
    "$CODE_STAGE/scripts/backup/recovery-db-contract.tsv"
  [ -f "$CODE_STAGE/scripts/backup/canary.sql" ] && [ ! -L "$CODE_STAGE/scripts/backup/canary.sql" ] \
    || fatal "staged exact-main backup code is missing canary.sql"
  find "$CODE_STAGE" -type f -exec sync -f -- {} +
  sync -f -- "$CODE_STAGE"

  COMMISSION_POSTGRES_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/postgres-backup.sh" | awk '{print $1}')"
  COMMISSION_RESTORE_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/postgres-restore-canary.sh" | awk '{print $1}')"
  COMMISSION_CANARY_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/canary.sql" | awk '{print $1}')"
  COMMISSION_SECRETS_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/snapshot-secrets.sh" | awk '{print $1}')"
  COMMISSION_RUNTIME_FILES_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/snapshot-runtime-files.sh" | awk '{print $1}')"
  COMMISSION_SHIP_LOGS_SHA256="$(sha256sum "$CODE_STAGE/scripts/backup/ship-logs.sh" | awk '{print $1}')"
  COMMISSION_RECOVERY_PROGRAM_SET_SHA256="$(
    "$CODE_STAGE/scripts/backup/hash-recovery-program-set.sh" "$CODE_STAGE"
  )"
  COMMISSION_RECOVERY_DB_CONTRACT_SHA256="$(tr -d '\r\n' <"$CODE_STAGE/recovery-db-contract.sha256")"
  [ "$COMMISSION_POSTGRES_SHA256" = "$POSTGRES_BACKUP_SHA256" ] \
    && [ "$COMMISSION_RESTORE_SHA256" = "$RESTORE_CANARY_SHA256" ] \
    && [ "$COMMISSION_CANARY_SHA256" = "$CANARY_SQL_SHA256" ] \
    && [ "$COMMISSION_SECRETS_SHA256" = "$SECRETS_SNAPSHOT_SHA256" ] \
    && [ "$COMMISSION_RUNTIME_FILES_SHA256" = "$RUNTIME_FILES_SNAPSHOT_SHA256" ] \
    && [[ "$COMMISSION_SHIP_LOGS_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$COMMISSION_RECOVERY_PROGRAM_SET_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$COMMISSION_RECOVERY_DB_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(sha256sum "$CODE_STAGE/scripts/backup/recovery-db-contract.tsv" | awk '{print $1}')" = \
      "$COMMISSION_RECOVERY_DB_CONTRACT_SHA256" ] \
    || fatal "staged backup code does not match the reviewed commissioning hashes"
}

capture_committed_log_genesis() {
  local endpoint region bucket access_key secret_key original_release original_shipper original_program_record
  local anchor_digest anchor_bytes_after head_state remote_bytes remote_sha remote_format remote_start
  local remote_bootstrap remote_program remote_ranges remote_file_count remote_file_bytes
  local remote_journal_count remote_cursor remote_modified retention_state retention_mode retention_until
  local state_start state_key state_version state_sha

  for path in "$LOG_BOOTSTRAP_TRANSACTION" "$LOG_BOOTSTRAP_PREPARING" "$LOG_BOOTSTRAP_TOMBSTONE"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] \
      || fatal "full commissioning refuses an unfinished log-genesis transaction"
  done
  assert_root_file "committed log-genesis anchor" "$LOG_GENESIS_ANCHOR"
  [ "$(realpath -e -- "$LOG_GENESIS_ANCHOR" 2>/dev/null || true)" = "$LOG_GENESIS_ANCHOR" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$LOG_GENESIS_ANCHOR")" = root:root:600:1 ] \
    && [ "$(wc -c <"$LOG_GENESIS_ANCHOR" | tr -d '[:space:]')" -le 16384 ] \
    || fatal "committed log-genesis anchor is non-canonical, oversized, linked, or has unsafe permissions"
  awk '
    NR == 1 { if ($0 != "FORMAT_VERSION=1") bad=1; next }
    NR == 2 { if ($0 != "STATUS=COMMITTED") bad=1; next }
    NR == 3 { if ($0 !~ /^LOG_EVIDENCE_START_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/) bad=1; next }
    NR == 4 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\/[0-9]{4}\/[0-9]{2}\/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]tar[.]gz[.]age$/) bad=1; next }
    NR == 5 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=[-A-Za-z0-9._~+\/=]+$/ || $0 ~ /=None$/ || $0 ~ /=null$/ || length($0) > 1100) bad=1; next }
    NR == 6 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 7 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_BYTES=[1-9][0-9]*$/) bad=1; next }
    NR == 8 { if ($0 != "LOG_EVIDENCE_OBJECT_FORMAT_VERSION=4") bad=1; next }
    NR == 9 { if ($0 !~ /^BOOTSTRAP_DEPLOY_SHA=[0-9a-f]{40}$/) bad=1; next }
    NR == 10 { if ($0 !~ /^BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 11 { if ($0 !~ /^BOOTSTRAP_RANGES_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 12 { if ($0 !~ /^BOOTSTRAP_FILE_RANGE_COUNT=[1-9][0-9]*$/) bad=1; next }
    NR == 13 { if ($0 !~ /^BOOTSTRAP_FILE_RANGE_BYTES=[0-9]+$/) bad=1; next }
    NR == 14 { if ($0 !~ /^BOOTSTRAP_JOURNAL_RANGE_COUNT=[0-9]+$/) bad=1; next }
    NR == 15 { if ($0 !~ /^BOOTSTRAP_CURSOR_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 16 { if ($0 !~ /^OBJECT_CREATED_AT=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+]00:00)$/) bad=1; next }
    { bad=1 }
    END { if (NR != 16 || bad) exit 1 }
  ' "$LOG_GENESIS_ANCHOR" || fatal "log-genesis anchor is not the exact committed schema"

  LOG_GENESIS_ANCHOR_SHA256="$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')"
  LOG_GENESIS_ANCHOR_BYTES="$(stat -c '%s' "$LOG_GENESIS_ANCHOR")"
  LOG_GENESIS_EVIDENCE_START_AT="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_START_AT)"
  LOG_GENESIS_OBJECT_KEY="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_KEY)"
  LOG_GENESIS_OBJECT_VERSION_ID="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)"
  LOG_GENESIS_CIPHERTEXT_SHA256="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_SHA256)"
  LOG_GENESIS_CIPHERTEXT_BYTES="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_FIRST_OBJECT_BYTES)"
  LOG_GENESIS_OBJECT_FORMAT_VERSION="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" LOG_EVIDENCE_OBJECT_FORMAT_VERSION)"
  LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_DEPLOY_SHA)"
  LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)"
  LOG_GENESIS_RANGES_SHA256="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_RANGES_SHA256)"
  LOG_GENESIS_FILE_RANGE_COUNT="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_COUNT)"
  LOG_GENESIS_FILE_RANGE_BYTES="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_FILE_RANGE_BYTES)"
  LOG_GENESIS_JOURNAL_RANGE_COUNT="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_JOURNAL_RANGE_COUNT)"
  LOG_GENESIS_CURSOR_SHA256="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" BOOTSTRAP_CURSOR_SHA256)"
  LOG_GENESIS_OBJECT_CREATED_AT="$(read_unique_value_from "$LOG_GENESIS_ANCHOR" OBJECT_CREATED_AT)"

  original_release="$OPS_RELEASES_DIR/$LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA"
  original_shipper="$original_release/backup/ship-logs.sh"
  original_program_record="$original_release/recovery-program-set.sha256"
  assert_root_directory "original log-genesis operations release" "$original_release"
  assert_root_file "original log-genesis shipper" "$original_shipper"
  assert_root_file "original log-genesis recovery-program record" "$original_program_record"
  [ "$(realpath -e -- "$original_release")" = "$original_release" ] \
    && [ "$(tr -d '\r\n' <"$original_program_record")" = "$LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" ] \
    || fatal "original log-genesis recovery program is absent or differs from the anchor"
  LOG_GENESIS_SHIP_LOGS_SHA256="$(sha256sum "$original_shipper" | awk '{print $1}')"
  [[ "$LOG_GENESIS_SHIP_LOGS_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "original log-genesis shipper digest is invalid"

  [ -d "$LOG_STATE_DIR" ] && [ ! -L "$LOG_STATE_DIR" ] \
    && [ "$(stat -c '%U:%G:%a' "$LOG_STATE_DIR")" = leaddrive-backup:leaddrive-backup:750 ] \
    && [ -f "$LOG_STATE_FILE" ] && [ ! -L "$LOG_STATE_FILE" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$LOG_STATE_FILE")" = leaddrive-backup:leaddrive-backup:600:1 ] \
    || fatal "log-genesis cursor authority is missing or unsafe"
  awk -F '\t' '
    BEGIN {
      expected["leaddrive-postgres-backup.service"]=1
      expected["leaddrive-secrets-snapshot.service"]=1
      expected["leaddrive-runtime-files-snapshot.service"]=1
      expected["leaddrive-log-ship.service"]=1
    }
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 !~ /^SHIP_LOGS_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 3 { if ($0 !~ /^RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 4 { if ($0 !~ /^LOG_EVIDENCE_START_AT=/) bad=1; next }
    NR == 5 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_KEY=logs\//) bad=1; next }
    NR == 6 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=/) bad=1; next }
    NR == 7 { if ($0 !~ /^LOG_EVIDENCE_FIRST_OBJECT_SHA256=[0-9a-f]{64}$/) bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || seen_file[$2]++ || ($2 !~ /^\/var\/lib\/leaddrive-v2-logs\/[^\/]+[.]log$/ \
          && $2 !~ /^\/var\/log\/nginx\/[^\/]+[.]log$/ \
          && $2 !~ /^\/var\/log\/postgresql\/[^\/]+[.]log$/ \
          && $2 != "/var/log/leaddrive-resilience-cron.log") \
          || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ \
          || $6 !~ /^[0-9]+$/ || $6 > 4096 || $6 > $5 || $7 !~ /^[0-9a-f]{64}$/) bad=1
      if ($2 ~ /^\/var\/lib\/leaddrive-v2-logs\//) pm2=1
      else if ($2 ~ /^\/var\/log\/nginx\//) nginx=1
      else if ($2 ~ /^\/var\/log\/postgresql\//) postgres=1
      else if ($2 == "/var/log/leaddrive-resilience-cron.log") resilience++
      next
    }
    $1 == "JOURNAL" {
      if (NF != 3 || !expected[$2] || seen_journal[$2]++ \
          || ($3 != "NO_CURSOR" && ($3 !~ /^[!-~]+$/ || length($3) > 2048))) bad=1
      next
    }
    { bad=1 }
    END {
      for (unit in expected) if (seen_journal[unit] != 1) bad=1
      if (NR < 11 || !pm2 || !nginx || !postgres || resilience != 1 || bad) exit 1
    }
  ' "$LOG_STATE_FILE" || fatal "log-genesis cursor is not a complete reviewed v4 state"
  state_start="$(read_unique_value_from "$LOG_STATE_FILE" LOG_EVIDENCE_START_AT)"
  state_key="$(read_unique_value_from "$LOG_STATE_FILE" LOG_EVIDENCE_FIRST_OBJECT_KEY)"
  state_version="$(read_unique_value_from "$LOG_STATE_FILE" LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)"
  state_sha="$(read_unique_value_from "$LOG_STATE_FILE" LOG_EVIDENCE_FIRST_OBJECT_SHA256)"
  [ "$state_start" = "$LOG_GENESIS_EVIDENCE_START_AT" ] \
    && [ "$state_key" = "$LOG_GENESIS_OBJECT_KEY" ] \
    && [ "$state_version" = "$LOG_GENESIS_OBJECT_VERSION_ID" ] \
    && [ "$state_sha" = "$LOG_GENESIS_CIPHERTEXT_SHA256" ] \
    || fatal "live log cursor diverges from the committed genesis anchor"

  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  head_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$LOG_GENESIS_OBJECT_KEY" --version-id="$LOG_GENESIS_OBJECT_VERSION_ID" \
      --query '[ContentLength,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256,LastModified]' \
      --output text 2>/dev/null)" || fatal "exact log-genesis object version is unreadable"
  read -r remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges \
    remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_modified <<<"$head_state"
  [ "$remote_bytes" = "$LOG_GENESIS_CIPHERTEXT_BYTES" ] \
    && [ "$remote_sha" = "$LOG_GENESIS_CIPHERTEXT_SHA256" ] \
    && [ "$remote_format" = "$LOG_GENESIS_OBJECT_FORMAT_VERSION" ] \
    && [ "$remote_start" = "$LOG_GENESIS_EVIDENCE_START_AT" ] \
    && [ "$remote_bootstrap" = 1 ] \
    && [ "$remote_program" = "$LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" ] \
    && [ "$remote_ranges" = "$LOG_GENESIS_RANGES_SHA256" ] \
    && [ "$remote_file_count" = "$LOG_GENESIS_FILE_RANGE_COUNT" ] \
    && [ "$remote_file_bytes" = "$LOG_GENESIS_FILE_RANGE_BYTES" ] \
    && [ "$remote_journal_count" = "$LOG_GENESIS_JOURNAL_RANGE_COUNT" ] \
    && [ "$remote_cursor" = "$LOG_GENESIS_CURSOR_SHA256" ] \
    && [ "$remote_modified" = "$LOG_GENESIS_OBJECT_CREATED_AT" ] \
    || fatal "exact log-genesis object metadata differs from root anchor"
  retention_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$LOG_GENESIS_OBJECT_KEY" --version-id="$LOG_GENESIS_OBJECT_VERSION_ID" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
    || fatal "exact log-genesis object retention is unreadable"
  read -r retention_mode retention_until <<<"$retention_state"
  [ "$retention_mode" = COMPLIANCE ] \
    && [ "$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)" -gt "$(date -u '+%s')" ] \
    || fatal "exact log-genesis object is not under live COMPLIANCE retention"
  LOG_GENESIS_RETAIN_UNTIL="$retention_until"

  anchor_digest="$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')"
  anchor_bytes_after="$(stat -c '%s' "$LOG_GENESIS_ANCHOR")"
  [ "$anchor_digest" = "$LOG_GENESIS_ANCHOR_SHA256" ] \
    && [ "$anchor_bytes_after" = "$LOG_GENESIS_ANCHOR_BYTES" ] \
    || fatal "log-genesis anchor changed during candidate capture"
}

assert_full_recovery_program_matches_committed_genesis() {
  local candidate_file="${1:-}"

  if [ -n "$candidate_file" ]; then
    # Certification deliberately has no staged executable program: it proves
    # the immutable candidate produced by run-verified-backup.  Bind that
    # candidate's already-reviewed digest directly to the committed genesis.
    [ "$(read_unique_value_from "$candidate_file" RECOVERY_PROGRAM_SET_SHA256)" = \
      "$LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" ] \
      || fatal "full-recovery candidate was created with a recovery program different from the committed genesis"
  else
    [ "$COMMISSION_RECOVERY_PROGRAM_SET_SHA256" = "$LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" ] \
      || fatal "current recovery program differs from the committed bootstrap genesis; this chain cannot continue"
  fi
}

LAST_TRANSIENT_INVOCATION=""
run_transient_backup_unit() {
  local label="$1"
  local run_user="$2"
  local run_group="$3"
  local executable="$4"
  local timeout_seconds="$5"
  local output_file="$6"
  local unit="leaddrive-backup-commission-${label}-${WORKFLOW_RUN_ID}.service"
  local launch_status result exec_status invocation load_state active_state sub_state deadline
  local -a identity_args=()
  local -a storage_args=()
  local -a executable_args=()

  load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
  [ -z "$load_state" ] || [ "$load_state" = "not-found" ] \
    || fatal "transient unit $unit already exists; refusing a duplicate immutable upload"
  if [ "$run_user" != "root" ]; then
    identity_args=(--uid="$run_user" --gid="$run_group")
  fi
  case "$label" in
    database)
      storage_args=(
        --property=StateDirectory=leaddrive-postgres-backup
        --property=StateDirectoryMode=0750
        --property=RuntimeDirectory=leaddrive-postgres-backup
        --property=RuntimeDirectoryMode=0750
        --property=ReadWritePaths=/var/lib/leaddrive-postgres-backup
        --property=ReadWritePaths=/run/leaddrive-postgres-backup
      )
      executable_args=(--commission-monthly)
      ;;
    secrets)
      storage_args=(
        --property=StateDirectory=leaddrive-secrets-snapshot
        --property=StateDirectoryMode=0700
        --property=RuntimeDirectory=leaddrive-secrets-snapshot
        --property=RuntimeDirectoryMode=0700
        --property=ReadWritePaths=/var/lib/leaddrive-secrets-snapshot
        --property=ReadWritePaths=/run/leaddrive-secrets-snapshot
      )
      ;;
    runtime-files)
      storage_args=(
        --property=StateDirectory=leaddrive-runtime-files-snapshot
        --property=StateDirectoryMode=0700
        --property=RuntimeDirectory=leaddrive-runtime-files-snapshot
        --property=RuntimeDirectoryMode=0700
        --property=ReadOnlyPaths=/var/lib/leaddrive-v2
        --property=ReadWritePaths=/var/lib/leaddrive-runtime-files-snapshot
        --property=ReadWritePaths=/run/leaddrive-runtime-files-snapshot
      )
      executable_args=(--commission-monthly)
      ;;
    *) fatal "unsupported transient backup label" ;;
  esac
  ACTIVE_TRANSIENT_UNIT="$unit"
  set +e
  systemd-run --quiet \
    --unit="$unit" "${identity_args[@]}" "${storage_args[@]}" \
    --property=EnvironmentFile="$BACKUP_ENV_FILE" \
    --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
    --property=RemainAfterExit=yes \
    --property=StandardOutput=journal \
    --property=StandardError=journal \
    --property=TimeoutStartSec="$timeout_seconds" \
    --property=MemorySwapMax=0 \
    --property=UMask=0077 \
    --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes \
    --property=PrivateTmp=yes \
    --property=ProtectSystem=strict \
    --property=ReadOnlyPaths=/etc/leaddrive \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=RestrictNamespaces=yes \
    --property=RestrictRealtime=yes \
    --property=RestrictSUIDSGID=yes \
    --property=LockPersonality=yes \
    --property=SystemCallArchitectures=native \
    "$executable" "${executable_args[@]}" >/dev/null
  launch_status=$?
  set -e
  [ "$launch_status" -eq 0 ] || {
    systemctl stop "$unit" >/dev/null 2>&1 || true
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    ACTIVE_TRANSIENT_UNIT=""
    fatal "transient $label run could not be started"
  }

  invocation=""
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    invocation="$(systemctl show --property=InvocationID --value "$unit" 2>/dev/null || true)"
    active_state="$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null || true)"
    sub_state="$(systemctl show --property=SubState --value "$unit" 2>/dev/null || true)"
    case "$active_state:$sub_state" in
      active:exited|failed:*|inactive:dead) break ;;
    esac
    sleep 1
  done
  result="$(systemctl show --property=Result --value "$unit" 2>/dev/null || true)"
  exec_status="$(systemctl show --property=ExecMainStatus --value "$unit" 2>/dev/null || true)"
  active_state="$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null || true)"
  sub_state="$(systemctl show --property=SubState --value "$unit" 2>/dev/null || true)"
  if [ "$active_state:$sub_state" != "active:exited" ] \
    || [ "$result" != "success" ] || [ "$exec_status" != "0" ]; then
    systemctl stop "$unit" >/dev/null 2>&1 || true
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    ACTIVE_TRANSIENT_UNIT=""
    fatal "transient $label run failed or timed out (state=${active_state:-unknown}/${sub_state:-unknown}, result=${result:-unknown}, status=${exec_status:-unknown})"
  fi
  [[ "$invocation" =~ ^[0-9a-f]{32}$ ]] \
    || fatal "transient $label run has no unique systemd invocation id"
  journalctl --sync >/dev/null 2>&1 || true
  journalctl --unit "$unit" "_SYSTEMD_INVOCATION_ID=$invocation" \
    --no-pager -o cat >"$output_file" \
    || fatal "cannot capture the exact transient $label journal"
  LAST_TRANSIENT_INVOCATION="$invocation"
  systemctl stop "$unit" >/dev/null \
    || fatal "cannot retire the completed transient $label unit"
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  ACTIVE_TRANSIENT_UNIT=""
}

run_verified_backup() {
  local recipient recipient_sha encryption endpoint region bucket access_key secret_key
  local database_log secrets_log runtime_files_log database_invocation secrets_invocation runtime_files_invocation
  local database_summary database_payload database_object_key database_version_id head_state
  local database_tier database_retention_days database_bytes database_ciphertext_sha database_logged_until database_remote_until source_identity source_identity_sha
  local source_migration_ledger_sha database_recovery_contract_sha
  local secrets_summary secrets_payload secrets_object_key secrets_files secrets_retention_days secrets_logged_bytes secrets_logged_until
  local secrets_version_id secrets_bytes secrets_ciphertext_sha secrets_metadata_files
  local secrets_remote_until
  local runtime_files_summary runtime_files_payload runtime_files_object_key runtime_files_version_id
  local runtime_files_tier runtime_files_retention_days runtime_files_logged_bytes runtime_files_ciphertext_sha
  local runtime_files_logged_until runtime_files_count runtime_files_inventory_sha runtime_files_source_bytes
  local runtime_files_bytes remote_runtime_files_sha remote_runtime_files_tier remote_runtime_files_count
  local remote_runtime_files_inventory runtime_files_remote_until
  local app_env_sha backup_env_sha migration_env_sha remote_app_sha remote_backup_sha remote_migration_sha
  local retention_state retention_mode retention_until retention_epoch logged_retention_epoch now_epoch
  local candidate_file candidate_sha created_at code_bundle_sha candidate_format_version recovery_scope

  case "$OPERATION" in
    run-bootstrap-backup)
      assert_confirmation "CREATE_BOOTSTRAP_BACKUP_ON_13_140_132_245"
      candidate_format_version=2
      recovery_scope=log-genesis-bootstrap-only
      ;;
    run-verified-backup)
      assert_confirmation "CREATE_FULL_RECOVERY_BACKUP_ON_13_140_132_245"
      candidate_format_version=3
      recovery_scope=full-recovery
      ;;
    *) fatal "backup creation was invoked through an unsupported operation" ;;
  esac
  [ -z "$KEY_CUSTODY_ATTESTATION$EVIDENCE_REF$EVIDENCE_AT_UTC$OFFLINE_OPERATOR$EXPECTED_CANDIDATE_SHA256" ] \
    || fatal "backup creation accepts only the reviewed recipient digest"
  fence_backup_runner
  assert_backup_env
  assert_toolchain
  recipient="$(assert_expected_recipient)"
  recipient_sha="$(recipient_sha256 "$recipient")"
  assert_custody_marker "$recipient_sha"
  encryption="$(read_unique_value BACKUP_ENCRYPTION)"
  [ "${encryption:-age}" = "age" ] || fatal "refusing to run an unencrypted backup"
  prove_object_lock
  ensure_evidence_directories
  candidate_file="$CANDIDATE_DIR/${WORKFLOW_RUN_ID}.env"
  [ ! -e "$candidate_file" ] && [ ! -L "$candidate_file" ] \
    || fatal "this workflow run already has a candidate record"
  prepare_commission_code
  code_bundle_sha="$(sha256sum "$INCOMING_CODE_BUNDLE" | awk '{print $1}')"
  if [ "$candidate_format_version" = 2 ]; then
    [ ! -e "$LOG_GENESIS_ANCHOR" ] && [ ! -L "$LOG_GENESIS_ANCHOR" ] \
      || fatal "bootstrap-only backup is forbidden after a log-genesis anchor exists"
    for path in "$LOG_BOOTSTRAP_TRANSACTION" "$LOG_BOOTSTRAP_PREPARING" "$LOG_BOOTSTRAP_TOMBSTONE"; do
      [ ! -e "$path" ] && [ ! -L "$path" ] \
        || fatal "bootstrap-only backup refuses pre-existing log-genesis transaction state"
    done
    if [ -e "$LOG_STATE_FILE" ] || [ -L "$LOG_STATE_FILE" ]; then
      [ -f "$LOG_STATE_FILE" ] && [ ! -L "$LOG_STATE_FILE" ] && [ ! -s "$LOG_STATE_FILE" ] \
        || fatal "bootstrap-only backup refuses an existing non-empty log cursor"
    fi
  else
    capture_committed_log_genesis
    validate_bootstrap_certificate_for_full_chain "$recipient_sha"
    assert_full_recovery_program_matches_committed_genesis
  fi
  WORK_DIR="$(mktemp -d /var/tmp/leaddrive-backup-evidence.XXXXXX)"
  database_log="$WORK_DIR/database.log"
  secrets_log="$WORK_DIR/secrets.log"
  runtime_files_log="$WORK_DIR/runtime-files.log"
  release_backup_locks
  run_transient_backup_unit database leaddrive-backup leaddrive-backup \
    "$CODE_STAGE/scripts/backup/postgres-backup.sh" 14400 "$database_log"
  database_invocation="$LAST_TRANSIENT_INVOCATION"
  run_transient_backup_unit secrets root root \
    "$CODE_STAGE/scripts/backup/snapshot-secrets.sh" 1800 "$secrets_log"
  secrets_invocation="$LAST_TRANSIENT_INVOCATION"
  run_transient_backup_unit runtime-files root root \
    "$CODE_STAGE/scripts/backup/snapshot-runtime-files.sh" 14400 "$runtime_files_log"
  runtime_files_invocation="$LAST_TRANSIENT_INVOCATION"

  grep -Fq '[restore-canary] restore canary passed' "$database_log" \
    || fatal "manual backup has no restore-canary proof"
  grep -Fq '[restore-canary] restored Prisma migration ledger proof passed' "$database_log" \
    || fatal "manual backup has no restored migration-ledger proof"
  grep -Fq '[restore-canary] restored applied migrations match the recovery DB contract' "$database_log" \
    || fatal "manual backup has no restored DB-contract proof"
  grep -Fq '[postgres-backup] source database identity ' "$database_log" \
    || fatal "manual backup has no source database identity proof"
  grep -Fq '[postgres-backup] encrypting backup with offline age recipient' "$database_log" \
    || fatal "manual backup has no age-encryption proof"
  grep -Fq '[postgres-backup] backup verified and locked until' "$database_log" \
    || fatal "manual backup has no upload/Object Lock proof"
  ! grep -Eq 'BACKUP_ENCRYPTION=off|UNENCRYPTED' "$database_log" \
    || fatal "manual backup journal contains an unencrypted-upload warning"

  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  database_summary="$(grep -E 'SUMMARY key=.* version=.* tier=monthly retention_days=[0-9]+ bytes=[0-9]+ sha256=[0-9a-f]{64} retain_until=.* migration_ledger_sha256=[0-9a-f]{64} recovery_db_contract_sha256=[0-9a-f]{64}$' "$database_log" | tail -1)"
  database_payload="${database_summary#*SUMMARY }"
  if [[ "$database_payload" =~ ^key=([A-Za-z0-9._/-]+\.tar\.age)[[:space:]]version=([A-Za-z0-9._=/+-]{1,200})[[:space:]]tier=(monthly)[[:space:]]retention_days=([0-9]+)[[:space:]]bytes=([0-9]+)[[:space:]]sha256=([0-9a-f]{64})[[:space:]]retain_until=([0-9T:Z+.-]+)[[:space:]]migration_ledger_sha256=([0-9a-f]{64})[[:space:]]recovery_db_contract_sha256=([0-9a-f]{64})$ ]]; then
    database_object_key="${BASH_REMATCH[1]}"
    database_version_id="${BASH_REMATCH[2]}"
    database_tier="${BASH_REMATCH[3]}"
    database_retention_days="${BASH_REMATCH[4]}"
    database_bytes="${BASH_REMATCH[5]}"
    database_ciphertext_sha="${BASH_REMATCH[6]}"
    database_logged_until="${BASH_REMATCH[7]}"
    source_migration_ledger_sha="${BASH_REMATCH[8]}"
    database_recovery_contract_sha="${BASH_REMATCH[9]}"
  else
    fatal "manual backup summary has an unexpected exact-version identity"
  fi
  [ "$database_tier" = "monthly" ] \
    && [ "$database_retention_days" -ge "$(require_static_value BACKUP_RETENTION_MONTHLY_DAYS)" ] \
    && [ "$database_bytes" -gt 1048576 ] \
    && [ "$database_recovery_contract_sha" = "$COMMISSION_RECOVERY_DB_CONTRACT_SHA256" ] \
    || fatal "encrypted backup object is too small or uses another recovery DB contract"
  head_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$database_object_key" --version-id="$database_version_id" \
      --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null)" \
    || fatal "cannot bind offline candidate to the uploaded object"
  read -r remote_database_bytes remote_database_sha <<<"$head_state"
  [ "$remote_database_bytes" = "$database_bytes" ] \
    && [ "$remote_database_sha" = "$database_ciphertext_sha" ] \
    || fatal "exact database object metadata does not match the local encrypted upload"
  retention_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$database_object_key" --version-id="$database_version_id" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
    || fatal "cannot verify exact database object retention"
  read -r retention_mode retention_until <<<"$retention_state"
  database_remote_until="$retention_until"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
    || fatal "database candidate retention timestamp is invalid"
  logged_retention_epoch="$(date -u -d "$database_logged_until" '+%s' 2>/dev/null)" \
    || fatal "database backup reported an invalid retention timestamp"
  now_epoch="$(date -u '+%s')"
  [ "$retention_mode" = "COMPLIANCE" ] \
    && [ "$retention_epoch" -ge $((now_epoch + database_retention_days * 86400 - 300)) ] \
    && [ "$retention_epoch" -ge "$logged_retention_epoch" ] \
    || fatal "database candidate version is not COMPLIANCE-locked"
  source_identity="$(grep -F '[postgres-backup] source database identity ' "$database_log" | tail -1)"
  source_identity="${source_identity#*source database identity }"
  [[ "$source_identity" =~ ^[0-9]+\|[^|[:space:]]+\|[0-9]+\|0$ ]] \
    || fatal "source database identity evidence has an unexpected shape"
  source_identity_sha="$(printf '%s' "$source_identity" | sha256sum | awk '{print $1}')"

  grep -Fq 'uploading encrypted secrets snapshot to s3://' "$secrets_log" \
    || fatal "manual secrets snapshot has no encrypted-upload proof"
  secrets_summary="$(grep -E 'SUMMARY key=.* version=.* files=[0-9]+ retention_days=[0-9]+ bytes=[0-9]+ sha256=[0-9a-f]{64} retain_until=.* app_env_sha256=[0-9a-f]{64} backup_env_sha256=[0-9a-f]{64} migration_env_sha256=[0-9a-f]{64}$' "$secrets_log" | tail -1)"
  secrets_payload="${secrets_summary#*SUMMARY }"
  if [[ "$secrets_payload" =~ ^key=([A-Za-z0-9._/-]+\.tar\.age)[[:space:]]version=([A-Za-z0-9._=/+-]{1,200})[[:space:]]files=([0-9]+)[[:space:]]retention_days=([0-9]+)[[:space:]]bytes=([0-9]+)[[:space:]]sha256=([0-9a-f]{64})[[:space:]]retain_until=([0-9T:Z+.-]+)[[:space:]]app_env_sha256=([0-9a-f]{64})[[:space:]]backup_env_sha256=([0-9a-f]{64})[[:space:]]migration_env_sha256=([0-9a-f]{64})$ ]]; then
    secrets_object_key="${BASH_REMATCH[1]}"
    secrets_version_id="${BASH_REMATCH[2]}"
    secrets_files="${BASH_REMATCH[3]}"
    secrets_retention_days="${BASH_REMATCH[4]}"
    secrets_logged_bytes="${BASH_REMATCH[5]}"
    secrets_ciphertext_sha="${BASH_REMATCH[6]}"
    secrets_logged_until="${BASH_REMATCH[7]}"
    app_env_sha="${BASH_REMATCH[8]}"
    backup_env_sha="${BASH_REMATCH[9]}"
    migration_env_sha="${BASH_REMATCH[10]}"
  else
    fatal "manual secrets snapshot summary has an unexpected shape"
  fi
  [ "$secrets_files" -eq 3 ] \
    && [ "$secrets_retention_days" -ge "$(require_static_value BACKUP_RETENTION_MONTHLY_DAYS)" ] \
    && [ "$secrets_logged_bytes" -gt 1024 ] \
    || fatal "encrypted secrets snapshot is incomplete or unexpectedly small"
  head_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$secrets_object_key" --version-id="$secrets_version_id" \
      --query '[ContentLength,Metadata.sha256,Metadata.files,Metadata.app_env_sha256,Metadata.backup_env_sha256,Metadata.migration_env_sha256]' --output text 2>/dev/null)" \
    || fatal "cannot bind offline candidate to the secrets object"
  read -r secrets_bytes remote_secrets_sha secrets_metadata_files remote_app_sha remote_backup_sha remote_migration_sha <<<"$head_state"
  [ "$secrets_bytes" = "$secrets_logged_bytes" ] \
    && [ "$secrets_metadata_files" = "$secrets_files" ] \
    && [ "$remote_secrets_sha" = "$secrets_ciphertext_sha" ] \
    && [ "$remote_app_sha" = "$app_env_sha" ] \
    && [ "$remote_backup_sha" = "$backup_env_sha" ] \
    && [ "$remote_migration_sha" = "$migration_env_sha" ] \
    || fatal "encrypted secrets object metadata does not match the exact run"
  retention_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$secrets_object_key" --version-id="$secrets_version_id" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
    || fatal "cannot verify exact secrets object retention"
  read -r retention_mode retention_until <<<"$retention_state"
  secrets_remote_until="$retention_until"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
    || fatal "secrets candidate retention timestamp is invalid"
  logged_retention_epoch="$(date -u -d "$secrets_logged_until" '+%s' 2>/dev/null)" \
    || fatal "secrets snapshot reported an invalid retention timestamp"
  [ "$retention_mode" = "COMPLIANCE" ] \
    && [ "$retention_epoch" -ge $((now_epoch + secrets_retention_days * 86400 - 300)) ] \
    && [ "$retention_epoch" -ge "$logged_retention_epoch" ] \
    || fatal "secrets candidate version is not locked to the reported deadline"

  grep -Fq 'uploading encrypted runtime files to s3://' "$runtime_files_log" \
    || fatal "manual runtime-file snapshot has no encrypted-upload proof"
  runtime_files_summary="$(grep -E 'SUMMARY key=.* version=.* tier=monthly retention_days=[0-9]+ bytes=[0-9]+ sha256=[0-9a-f]{64} retain_until=.* files=[0-9]+ inventory_sha256=[0-9a-f]{64} source_bytes=[0-9]+$' "$runtime_files_log" | tail -1)"
  runtime_files_payload="${runtime_files_summary#*SUMMARY }"
  if [[ "$runtime_files_payload" =~ ^key=([A-Za-z0-9._/-]+\.tar\.age)[[:space:]]version=([A-Za-z0-9._=/+-]{1,200})[[:space:]]tier=(monthly)[[:space:]]retention_days=([0-9]+)[[:space:]]bytes=([0-9]+)[[:space:]]sha256=([0-9a-f]{64})[[:space:]]retain_until=([0-9T:Z+.-]+)[[:space:]]files=([0-9]+)[[:space:]]inventory_sha256=([0-9a-f]{64})[[:space:]]source_bytes=([0-9]+)$ ]]; then
    runtime_files_object_key="${BASH_REMATCH[1]}"
    runtime_files_version_id="${BASH_REMATCH[2]}"
    runtime_files_tier="${BASH_REMATCH[3]}"
    runtime_files_retention_days="${BASH_REMATCH[4]}"
    runtime_files_logged_bytes="${BASH_REMATCH[5]}"
    runtime_files_ciphertext_sha="${BASH_REMATCH[6]}"
    runtime_files_logged_until="${BASH_REMATCH[7]}"
    runtime_files_count="${BASH_REMATCH[8]}"
    runtime_files_inventory_sha="${BASH_REMATCH[9]}"
    runtime_files_source_bytes="${BASH_REMATCH[10]}"
  else
    fatal "manual runtime-file snapshot summary has an unexpected shape"
  fi
  [ "$runtime_files_tier" = monthly ] \
    && [ "$runtime_files_retention_days" -ge "$(require_static_value BACKUP_RETENTION_MONTHLY_DAYS)" ] \
    && [ "$runtime_files_logged_bytes" -gt 1024 ] \
    || fatal "encrypted runtime-file snapshot is incomplete or below monthly retention"
  head_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$runtime_files_object_key" --version-id="$runtime_files_version_id" \
      --query '[ContentLength,Metadata.sha256,Metadata.tier,Metadata.files,Metadata.inventory_sha256]' --output text 2>/dev/null)" \
    || fatal "cannot bind offline candidate to the runtime-file object"
  read -r runtime_files_bytes remote_runtime_files_sha remote_runtime_files_tier \
    remote_runtime_files_count remote_runtime_files_inventory <<<"$head_state"
  [ "$runtime_files_bytes" = "$runtime_files_logged_bytes" ] \
    && [ "$remote_runtime_files_sha" = "$runtime_files_ciphertext_sha" ] \
    && [ "$remote_runtime_files_tier" = monthly ] \
    && [ "$remote_runtime_files_count" = "$runtime_files_count" ] \
    && [ "$remote_runtime_files_inventory" = "$runtime_files_inventory_sha" ] \
    || fatal "runtime-file object metadata does not match the stable exact run"
  retention_state="$(run_aws 45 "$access_key" "$secret_key" \
    s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
      --bucket "$bucket" --key "$runtime_files_object_key" --version-id="$runtime_files_version_id" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
    || fatal "cannot verify exact runtime-file object retention"
  read -r retention_mode retention_until <<<"$retention_state"
  runtime_files_remote_until="$retention_until"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
    || fatal "runtime-file retention timestamp is invalid"
  logged_retention_epoch="$(date -u -d "$runtime_files_logged_until" '+%s' 2>/dev/null)" \
    || fatal "runtime-file snapshot reported an invalid retention timestamp"
  [ "$retention_mode" = COMPLIANCE ] \
    && [ "$retention_epoch" -ge $((now_epoch + runtime_files_retention_days * 86400 - 300)) ] \
    && [ "$retention_epoch" -ge "$logged_retention_epoch" ] \
    || fatal "runtime-file candidate version is not locked to the reported deadline"

  if [ "$candidate_format_version" = 3 ]; then
    [ "$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')" = "$LOG_GENESIS_ANCHOR_SHA256" ] \
      && [ "$(stat -c '%s' "$LOG_GENESIS_ANCHOR")" = "$LOG_GENESIS_ANCHOR_BYTES" ] \
      || fatal "log-genesis anchor changed before full candidate publication"
  fi

  created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  MARKER_STAGE="$(mktemp "$CANDIDATE_DIR/.candidate-stage.XXXXXX")"
  {
  printf '%s\n' \
    "FORMAT_VERSION=$candidate_format_version" \
    'STATUS=awaiting_offline_restore' \
    "RECOVERY_SCOPE=$recovery_scope" \
    "RECIPIENT_SHA256=$recipient_sha" \
    "OBJECT_BUCKET=$bucket" \
    "DATABASE_OBJECT_KEY=$database_object_key" \
    "DATABASE_OBJECT_VERSION_ID=$database_version_id" \
    "DATABASE_CIPHERTEXT_SHA256=$database_ciphertext_sha" \
    "DATABASE_CIPHERTEXT_BYTES=$database_bytes" \
    "DATABASE_RETENTION_TIER=$database_tier" \
    "DATABASE_RETENTION_DAYS=$database_retention_days" \
    "DATABASE_RETAIN_UNTIL=$database_remote_until" \
    "SECRETS_OBJECT_KEY=$secrets_object_key" \
    "SECRETS_OBJECT_VERSION_ID=$secrets_version_id" \
    "SECRETS_CIPHERTEXT_SHA256=$secrets_ciphertext_sha" \
    "SECRETS_CIPHERTEXT_BYTES=$secrets_bytes" \
    "SECRETS_FILE_COUNT=$secrets_files" \
    "SECRETS_RETENTION_DAYS=$secrets_retention_days" \
    "SECRETS_RETAIN_UNTIL=$secrets_remote_until" \
    "RUNTIME_FILES_OBJECT_KEY=$runtime_files_object_key" \
    "RUNTIME_FILES_OBJECT_VERSION_ID=$runtime_files_version_id" \
    "RUNTIME_FILES_CIPHERTEXT_SHA256=$runtime_files_ciphertext_sha" \
    "RUNTIME_FILES_CIPHERTEXT_BYTES=$runtime_files_bytes" \
    "RUNTIME_FILES_RETENTION_TIER=$runtime_files_tier" \
    "RUNTIME_FILES_RETENTION_DAYS=$runtime_files_retention_days" \
    "RUNTIME_FILES_RETAIN_UNTIL=$runtime_files_remote_until" \
    "RUNTIME_FILES_FILE_COUNT=$runtime_files_count" \
    "RUNTIME_FILES_INVENTORY_SHA256=$runtime_files_inventory_sha" \
    "RUNTIME_FILES_SOURCE_BYTES=$runtime_files_source_bytes"
  if [ "$candidate_format_version" = 3 ]; then
    printf '%s\n' \
      'LOG_GENESIS_ANCHOR_FORMAT_VERSION=1' \
      'LOG_GENESIS_ANCHOR_STATUS=COMMITTED' \
      "LOG_GENESIS_ANCHOR_SHA256=$LOG_GENESIS_ANCHOR_SHA256" \
      "LOG_GENESIS_ANCHOR_BYTES=$LOG_GENESIS_ANCHOR_BYTES" \
      "LOG_GENESIS_EVIDENCE_START_AT=$LOG_GENESIS_EVIDENCE_START_AT" \
      "LOG_GENESIS_OBJECT_KEY=$LOG_GENESIS_OBJECT_KEY" \
      "LOG_GENESIS_OBJECT_VERSION_ID=$LOG_GENESIS_OBJECT_VERSION_ID" \
      "LOG_GENESIS_CIPHERTEXT_SHA256=$LOG_GENESIS_CIPHERTEXT_SHA256" \
      "LOG_GENESIS_CIPHERTEXT_BYTES=$LOG_GENESIS_CIPHERTEXT_BYTES" \
      "LOG_GENESIS_OBJECT_FORMAT_VERSION=$LOG_GENESIS_OBJECT_FORMAT_VERSION" \
      'LOG_GENESIS_EVIDENCE_BOOTSTRAP=1' \
      "LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA=$LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA" \
      "LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=$LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" \
      "LOG_GENESIS_RANGES_SHA256=$LOG_GENESIS_RANGES_SHA256" \
      "LOG_GENESIS_FILE_RANGE_COUNT=$LOG_GENESIS_FILE_RANGE_COUNT" \
      "LOG_GENESIS_FILE_RANGE_BYTES=$LOG_GENESIS_FILE_RANGE_BYTES" \
      "LOG_GENESIS_JOURNAL_RANGE_COUNT=$LOG_GENESIS_JOURNAL_RANGE_COUNT" \
      "LOG_GENESIS_CURSOR_SHA256=$LOG_GENESIS_CURSOR_SHA256" \
      "LOG_GENESIS_OBJECT_CREATED_AT=$LOG_GENESIS_OBJECT_CREATED_AT" \
      "LOG_GENESIS_RETAIN_UNTIL=$LOG_GENESIS_RETAIN_UNTIL" \
      "LOG_GENESIS_SHIP_LOGS_SHA256=$LOG_GENESIS_SHIP_LOGS_SHA256" \
      'BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION=1' \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256=$BOOTSTRAP_CERTIFICATE_MARKER_SHA256" \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES=$BOOTSTRAP_CERTIFICATE_MARKER_BYTES" \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256=$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256" \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256=$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256" \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256=$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256=$BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256"
  fi
  printf '%s\n' \
    "SOURCE_APP_ENV_SHA256=$app_env_sha" \
    "SOURCE_BACKUP_ENV_SHA256=$backup_env_sha" \
    "SOURCE_MIGRATION_ENV_SHA256=$migration_env_sha" \
    "SOURCE_DATABASE_IDENTITY_SHA256=$source_identity_sha" \
    "SOURCE_MIGRATION_LEDGER_SHA256=$source_migration_ledger_sha" \
    "DATABASE_SYSTEMD_INVOCATION_ID=$database_invocation" \
    "SECRETS_SYSTEMD_INVOCATION_ID=$secrets_invocation" \
    "RUNTIME_FILES_SYSTEMD_INVOCATION_ID=$runtime_files_invocation" \
    "COMMISSION_CODE_BUNDLE_SHA256=$code_bundle_sha" \
    "RECOVERY_PROGRAM_SET_SHA256=$COMMISSION_RECOVERY_PROGRAM_SET_SHA256" \
    "RECOVERY_DB_CONTRACT_SHA256=$COMMISSION_RECOVERY_DB_CONTRACT_SHA256" \
    "POSTGRES_BACKUP_SHA256=$COMMISSION_POSTGRES_SHA256" \
    "POSTGRES_RESTORE_CANARY_SHA256=$COMMISSION_RESTORE_SHA256" \
    "CANARY_SQL_SHA256=$COMMISSION_CANARY_SHA256" \
    "SECRETS_SNAPSHOT_SHA256=$COMMISSION_SECRETS_SHA256" \
    "RUNTIME_FILES_SNAPSHOT_SHA256=$COMMISSION_RUNTIME_FILES_SHA256" \
    "CREATED_AT_UTC=$created_at" \
    "CREATED_BY=$WORKFLOW_ACTOR" \
    "WORKFLOW_SHA=$WORKFLOW_SHA" \
    "WORKFLOW_RUN_ID=$WORKFLOW_RUN_ID"
  } >"$MARKER_STAGE"
  chown root:root "$MARKER_STAGE"
  chmod 0600 "$MARKER_STAGE"
  sync -f -- "$MARKER_STAGE" "$CANDIDATE_DIR"
  mv -- "$MARKER_STAGE" "$candidate_file"
  MARKER_STAGE=""
  sync -f -- "$candidate_file" "$CANDIDATE_DIR"
  candidate_sha="$(sha256sum "$candidate_file" | awk '{print $1}')"
  log "database, secrets and runtime-file snapshots passed identity, restore, upload and Object Lock checks"
  log "offline candidate_sha256=$candidate_sha"
  log "offline database_ciphertext_sha256=$database_ciphertext_sha"
  log "offline secrets_ciphertext_sha256=$secrets_ciphertext_sha"
  log "offline runtime_files_ciphertext_sha256=$runtime_files_ciphertext_sha"
  log "offline recipient_sha256=$recipient_sha"
  log "offline database_object_key=$database_object_key"
  log "offline database_object_version_id=$database_version_id"
  log "offline secrets_object_key=$secrets_object_key"
  log "offline secrets_object_version_id=$secrets_version_id"
  log "offline runtime_files_object_key=$runtime_files_object_key"
  log "offline runtime_files_object_version_id=$runtime_files_version_id"
  if [ "$candidate_format_version" = 3 ]; then
    log "offline log_genesis_ciphertext_sha256=$LOG_GENESIS_CIPHERTEXT_SHA256"
    log "offline log_genesis_object_key=$LOG_GENESIS_OBJECT_KEY"
    log "offline log_genesis_object_version_id=$LOG_GENESIS_OBJECT_VERSION_ID"
    log "offline log_genesis_anchor_base64=$(base64 --wrap=0 "$LOG_GENESIS_ANCHOR")"
  fi
  log "offline candidate_record_base64=$(base64 --wrap=0 "$candidate_file")"
  commit_commission_timers_disabled
  log "all recovery timers remain disabled until independent decrypt/checksum/scratch-restore evidence is certified"
}

find_candidate_by_digest() {
  local expected="$1"
  local file digest match="" matches=0
  for file in "$CANDIDATE_DIR"/*.env; do
    [ -f "$file" ] && [ ! -L "$file" ] || continue
    digest="$(sha256sum "$file" | awk '{print $1}')"
    [ "$digest" = "$expected" ] || continue
    match="$file"
    matches=$((matches + 1))
  done
  [ "$matches" -eq 1 ] || fatal "candidate digest must identify exactly one server record"
  printf '%s' "$match"
}

assert_candidate_remote_objects() {
  local candidate_file="$1"
  local endpoint region configured_bucket access_key secret_key candidate_bucket
  local label key version expected_bytes expected_sha head_state remote_bytes remote_sha
  local retention_state retention_mode retention_until retention_epoch now_epoch expected_until expected_epoch candidate_epoch
  local retention_days minimum_days retention_tier
  endpoint="$(require_static_value BACKUP_S3_ENDPOINT)"
  region="$(require_static_value BACKUP_S3_REGION)"
  configured_bucket="$(require_static_value BACKUP_S3_BUCKET)"
  access_key="$(require_static_value AWS_ACCESS_KEY_ID)"
  secret_key="$(require_static_value AWS_SECRET_ACCESS_KEY)"
  candidate_bucket="$(read_unique_value_from "$candidate_file" OBJECT_BUCKET)"
  candidate_epoch="$(date -u -d "$(read_unique_value_from "$candidate_file" CREATED_AT_UTC)" '+%s' 2>/dev/null)" \
    || fatal "offline candidate creation timestamp is invalid"
  [ "$candidate_bucket" = "$configured_bucket" ] \
    || fatal "offline candidate belongs to another object-storage bucket"

  for label in DATABASE SECRETS RUNTIME_FILES; do
    key="$(read_unique_value_from "$candidate_file" "${label}_OBJECT_KEY")"
    version="$(read_unique_value_from "$candidate_file" "${label}_OBJECT_VERSION_ID")"
    expected_bytes="$(read_unique_value_from "$candidate_file" "${label}_CIPHERTEXT_BYTES")"
    expected_sha="$(read_unique_value_from "$candidate_file" "${label}_CIPHERTEXT_SHA256")"
    expected_until="$(read_unique_value_from "$candidate_file" "${label}_RETAIN_UNTIL")"
    retention_days="$(read_unique_value_from "$candidate_file" "${label}_RETENTION_DAYS")"
    [[ "$key" =~ ^[A-Za-z0-9._/-]+\.tar\.age$ ]] \
      && [[ "$version" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
      && [[ "$expected_bytes" =~ ^[0-9]+$ ]] \
      && [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
      && [[ "$retention_days" =~ ^[0-9]+$ ]] \
      || fatal "$label candidate object identity is invalid"
    case "$label" in
      DATABASE)
        retention_tier="$(read_unique_value_from "$candidate_file" DATABASE_RETENTION_TIER)"
        [ "$retention_tier" = "monthly" ] || fatal "commissioned database candidate must use monthly retention"
        minimum_days="$(require_static_value BACKUP_RETENTION_MONTHLY_DAYS)"
        ;;
      SECRETS) minimum_days="$(require_static_value SECRETS_RETENTION_DAYS)" ;;
      RUNTIME_FILES)
        retention_tier="$(read_unique_value_from "$candidate_file" RUNTIME_FILES_RETENTION_TIER)"
        [ "$retention_tier" = "monthly" ] || fatal "commissioned runtime-file candidate must use monthly retention"
        minimum_days="$(require_static_value BACKUP_RETENTION_MONTHLY_DAYS)"
        ;;
    esac
    [ "$retention_days" -ge "$minimum_days" ] \
      || fatal "$label candidate retention policy is shorter than configured"
    head_state="$(run_aws 45 "$access_key" "$secret_key" \
      s3api head-object --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
        --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
        --query '[ContentLength,Metadata.sha256]' --output text 2>/dev/null)" \
      || fatal "$label candidate object version is no longer readable"
    read -r remote_bytes remote_sha <<<"$head_state"
    [ "$remote_bytes" = "$expected_bytes" ] && [ "$remote_sha" = "$expected_sha" ] \
      || fatal "$label candidate object metadata drifted"
    retention_state="$(run_aws 45 "$access_key" "$secret_key" \
      s3api get-object-retention --endpoint-url "$endpoint" --region "$region" --no-cli-pager \
        --bucket "$candidate_bucket" --key "$key" --version-id="$version" \
        --query '[Retention.Mode,Retention.RetainUntilDate]' --output text 2>/dev/null)" \
      || fatal "$label candidate retention cannot be verified"
    read -r retention_mode retention_until <<<"$retention_state"
    retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null)" \
      || fatal "$label candidate retention timestamp is invalid"
    expected_epoch="$(date -u -d "$expected_until" '+%s' 2>/dev/null)" \
      || fatal "$label candidate recorded retention timestamp is invalid"
    [ "$expected_epoch" -ge $((candidate_epoch + retention_days * 86400 - 300)) ] \
      || fatal "$label candidate recorded retention is shorter than its declared policy"
    now_epoch="$(date -u '+%s')"
    [ "$retention_mode" = "COMPLIANCE" ] \
      && [ "$retention_epoch" -ge "$expected_epoch" ] \
      && [ "$retention_epoch" -ge "$now_epoch" ] \
      || fatal "$label candidate is not currently COMPLIANCE-locked"
  done
}

certify_offline_restore() {
  local recipient recipient_sha candidate_file candidate_created candidate_epoch evidence_epoch
  local candidate_recipient database_ciphertext secrets_ciphertext runtime_files_ciphertext candidate_status recorded_at restore_file
  local evidence_file evidence_sha integration_token_status database_authority_sha
  local app_env_sha backup_env_sha migration_env_sha
  local expected_candidate_format recovery_scope marker_format current_marker log_recorded_until_epoch log_live_until_epoch
  local key

  case "$OPERATION" in
    certify-bootstrap-restore)
      assert_confirmation "CERTIFY_BOOTSTRAP_RESTORE_ON_13_140_132_245"
      expected_candidate_format=2
      recovery_scope=log-genesis-bootstrap-only
      marker_format=1
      current_marker="$BOOTSTRAP_RESTORE_MARKER"
      ;;
    certify-offline-restore)
      assert_confirmation "CERTIFY_FULL_RECOVERY_ON_13_140_132_245"
      expected_candidate_format=3
      recovery_scope=full-recovery
      marker_format=4
      current_marker="$CURRENT_RESTORE_MARKER"
      ;;
    *) fatal "offline restore certification was invoked through an unsupported operation" ;;
  esac
  validate_evidence_inputs
  [[ "$EXPECTED_CANDIDATE_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "candidate digest is required"
  fence_backup_runner
  assert_backup_env
  assert_toolchain
  recipient="$(assert_expected_recipient)"
  recipient_sha="$(recipient_sha256 "$recipient")"
  assert_custody_marker "$recipient_sha"
  [ "$(read_unique_value BACKUP_ENCRYPTION)" = "age" ] \
    || fatal "offline restore may only certify an age-encrypted backup"
  prove_object_lock
  ensure_evidence_directories
  candidate_file="$(find_candidate_by_digest "$EXPECTED_CANDIDATE_SHA256")"
  assert_root_file "offline restore candidate" "$candidate_file"
  [ "$(stat -c '%a' "$candidate_file")" = "600" ] \
    || fatal "offline restore candidate must use mode 0600"
  candidate_status="$(read_unique_value_from "$candidate_file" STATUS)"
  candidate_recipient="$(read_unique_value_from "$candidate_file" RECIPIENT_SHA256)"
  database_ciphertext="$(read_unique_value_from "$candidate_file" DATABASE_CIPHERTEXT_SHA256)"
  secrets_ciphertext="$(read_unique_value_from "$candidate_file" SECRETS_CIPHERTEXT_SHA256)"
  runtime_files_ciphertext="$(read_unique_value_from "$candidate_file" RUNTIME_FILES_CIPHERTEXT_SHA256)"
  candidate_created="$(read_unique_value_from "$candidate_file" CREATED_AT_UTC)"
  app_env_sha="$(read_unique_value_from "$candidate_file" SOURCE_APP_ENV_SHA256)"
  backup_env_sha="$(read_unique_value_from "$candidate_file" SOURCE_BACKUP_ENV_SHA256)"
  migration_env_sha="$(read_unique_value_from "$candidate_file" SOURCE_MIGRATION_ENV_SHA256)"
  [ "$(read_unique_value_from "$candidate_file" FORMAT_VERSION)" = "$expected_candidate_format" ] \
    && [ "$(read_unique_value_from "$candidate_file" RECOVERY_SCOPE)" = "$recovery_scope" ] \
    && [ "$candidate_status" = "awaiting_offline_restore" ] \
    && [ "$candidate_recipient" = "$recipient_sha" ] \
    && [[ "$database_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$secrets_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$runtime_files_ciphertext" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$app_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$backup_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "$migration_env_sha" =~ ^[0-9a-f]{64}$ ]] \
    && [ "$(read_unique_value_from "$candidate_file" WORKFLOW_SHA)" = "$WORKFLOW_SHA" ] \
    && [ "$(read_unique_value_from "$candidate_file" POSTGRES_BACKUP_SHA256)" = "$POSTGRES_BACKUP_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" POSTGRES_RESTORE_CANARY_SHA256)" = "$RESTORE_CANARY_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" CANARY_SQL_SHA256)" = "$CANARY_SQL_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" SECRETS_SNAPSHOT_SHA256)" = "$SECRETS_SNAPSHOT_SHA256" ] \
    && [ "$(read_unique_value_from "$candidate_file" RUNTIME_FILES_SNAPSHOT_SHA256)" = "$RUNTIME_FILES_SNAPSHOT_SHA256" ] \
    || fatal "offline restore candidate is incomplete or belongs to another recipient"
  [ "$(sha256sum /etc/leaddrive/app.env | awk '{print $1}')" = "$app_env_sha" ] \
    && [ "$(sha256sum /etc/leaddrive/backup.env | awk '{print $1}')" = "$backup_env_sha" ] \
    && [ "$(sha256sum /etc/leaddrive/migration.env | awk '{print $1}')" = "$migration_env_sha" ] \
    || fatal "production recovery-set secrets changed after the candidate snapshot"
  candidate_epoch="$(date -u -d "$candidate_created" '+%s' 2>/dev/null)" \
    || fatal "offline restore candidate timestamp is invalid"
  evidence_epoch="$(date -u -d "$EVIDENCE_AT_UTC" '+%s' 2>/dev/null)" \
    || fatal "offline evidence timestamp is invalid"
  [ "$evidence_epoch" -ge "$candidate_epoch" ] \
    || fatal "offline restore evidence predates the encrypted candidate"
  if [ "$expected_candidate_format" = 2 ]; then
    [ ! -e "$LOG_GENESIS_ANCHOR" ] && [ ! -L "$LOG_GENESIS_ANCHOR" ] \
      || fatal "bootstrap-only certification is forbidden after log genesis is committed"
    for key in "$LOG_BOOTSTRAP_TRANSACTION" "$LOG_BOOTSTRAP_PREPARING" "$LOG_BOOTSTRAP_TOMBSTONE"; do
      [ ! -e "$key" ] && [ ! -L "$key" ] \
        || fatal "bootstrap-only certification refuses log-genesis transaction state"
    done
    if [ -e "$LOG_STATE_FILE" ] || [ -L "$LOG_STATE_FILE" ]; then
      [ -f "$LOG_STATE_FILE" ] && [ ! -L "$LOG_STATE_FILE" ] && [ ! -s "$LOG_STATE_FILE" ] \
        || fatal "bootstrap-only certification refuses a non-empty log cursor"
    fi
  else
    capture_committed_log_genesis
    validate_bootstrap_certificate_for_full_chain "$recipient_sha"
    assert_full_recovery_program_matches_committed_genesis "$candidate_file"
    [ "$(read_unique_value_from "$candidate_file" LOG_GENESIS_ANCHOR_FORMAT_VERSION)" = 1 ] \
      && [ "$(read_unique_value_from "$candidate_file" LOG_GENESIS_ANCHOR_STATUS)" = COMMITTED ] \
      && [ "$(read_unique_value_from "$candidate_file" LOG_GENESIS_EVIDENCE_BOOTSTRAP)" = 1 ] \
      || fatal "full-recovery candidate has no committed bootstrap genesis"
    for key in \
      LOG_GENESIS_ANCHOR_SHA256 LOG_GENESIS_ANCHOR_BYTES \
      LOG_GENESIS_EVIDENCE_START_AT LOG_GENESIS_OBJECT_KEY \
      LOG_GENESIS_OBJECT_VERSION_ID LOG_GENESIS_CIPHERTEXT_SHA256 \
      LOG_GENESIS_CIPHERTEXT_BYTES LOG_GENESIS_OBJECT_FORMAT_VERSION \
      LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256 \
      LOG_GENESIS_RANGES_SHA256 LOG_GENESIS_FILE_RANGE_COUNT LOG_GENESIS_FILE_RANGE_BYTES \
      LOG_GENESIS_JOURNAL_RANGE_COUNT LOG_GENESIS_CURSOR_SHA256 \
      LOG_GENESIS_OBJECT_CREATED_AT LOG_GENESIS_SHIP_LOGS_SHA256; do
      [ "$(read_unique_value_from "$candidate_file" "$key")" = "${!key}" ] \
        || fatal "live committed log genesis differs from candidate field $key"
    done
    log_recorded_until_epoch="$(date -u -d "$(read_unique_value_from "$candidate_file" LOG_GENESIS_RETAIN_UNTIL)" '+%s' 2>/dev/null)" \
      || fatal "candidate log-genesis retention timestamp is invalid"
    log_live_until_epoch="$(date -u -d "$LOG_GENESIS_RETAIN_UNTIL" '+%s' 2>/dev/null)" \
      || fatal "live log-genesis retention timestamp is invalid"
    [ "$log_live_until_epoch" -ge "$log_recorded_until_epoch" ] \
      || fatal "live log-genesis retention is shorter than the candidate record"
    [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)" = 1 ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_MARKER_SHA256" ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)" = "$BOOTSTRAP_CERTIFICATE_MARKER_BYTES" ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_CANDIDATE_SHA256" ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_SIGNED_EVIDENCE_SHA256" ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)" = "$BOOTSTRAP_CERTIFICATE_SIGNED_SIGNATURE_SHA256" ] \
      && [ "$(read_unique_value_from "$candidate_file" BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)" = "$BOOTSTRAP_CERTIFICATE_ALLOWED_SIGNERS_SHA256" ] \
      || fatal "full-recovery candidate is not bound to the limited bootstrap certificate"
  fi
  assert_candidate_remote_objects "$candidate_file"
  install_or_validate_allowed_signers
  verify_signed_evidence archive-restore "$recipient_sha" "$candidate_file"
  preserve_signed_evidence
  evidence_file="$SIGNED_EVIDENCE_FILE"
  integration_token_status="$(read_unique_value_from "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)"
  database_authority_sha="$(read_unique_value_from "$evidence_file" DATABASE_AUTHORITY_CATALOG_SHA256)"
  [[ "$database_authority_sha" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "signed offline evidence has no valid database authority digest"
  [ "$(read_unique_value_from "$evidence_file" CANDIDATE_SHA256)" = "$EXPECTED_CANDIDATE_SHA256" ] \
    && [ "$(read_unique_value_from "$evidence_file" DATABASE_CIPHERTEXT_SHA256)" = "$database_ciphertext" ] \
    && [ "$(read_unique_value_from "$evidence_file" SECRETS_CIPHERTEXT_SHA256)" = "$secrets_ciphertext" ] \
    && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_CIPHERTEXT_SHA256)" = "$runtime_files_ciphertext" ] \
    && [ "$(read_unique_value_from "$evidence_file" DATABASE_AUTHORITY_CATALOG_SHA256)" = "$database_authority_sha" ] \
    && [ "$(read_unique_value_from "$evidence_file" DATABASE_AUTHORITY_CATALOG_STATUS)" = "captured_and_bound" ] \
    && [ "$(read_unique_value_from "$evidence_file" MIGRATION_LEDGER_RESTORE_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" RLS_FORCE_RLS_CATALOG_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" FULL_AUTHORITY_RESTORE_STATUS)" = "not_tested" ] \
    && [ "$(read_unique_value_from "$evidence_file" PII_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" NEXTAUTH_SECRET_RECOVERY_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_DECRYPT_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" RUNTIME_FILES_INVENTORY_STATUS)" = "passed" ] \
    && [ "$(read_unique_value_from "$evidence_file" INTEGRATION_TOKEN_DECRYPT_STATUS)" = "$integration_token_status" ] \
    && [ "$(read_unique_value_from "$evidence_file" SOURCE_APP_ENV_SHA256)" = "$app_env_sha" ] \
    && [ "$(read_unique_value_from "$evidence_file" SOURCE_BACKUP_ENV_SHA256)" = "$backup_env_sha" ] \
    && [ "$(read_unique_value_from "$evidence_file" SOURCE_MIGRATION_ENV_SHA256)" = "$migration_env_sha" ] \
    && [ "$(read_unique_value_from "$evidence_file" ARCHIVE_VERIFIER_SHA256)" = "$ARCHIVE_VERIFIER_SHA256" ] \
    || fatal "preserved archive evidence is incomplete or used unreviewed code"

  if [ "$expected_candidate_format" = 3 ]; then
    # Publish only after every signed/candidate field and restore status has
    # passed. This also extends all four exact payload versions first.
    publish_recovery_catalog "$candidate_file"
  fi

  recorded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  restore_file="$RESTORE_DIR/${recovery_scope}-${WORKFLOW_RUN_ID}.env"
  [ ! -e "$restore_file" ] && [ ! -L "$restore_file" ] \
    || fatal "this workflow run already has an offline restore record"
  MARKER_STAGE="$(mktemp "$RESTORE_DIR/.restore-stage.XXXXXX")"
  {
  printf '%s\n' \
    "FORMAT_VERSION=$marker_format" \
    'EVIDENCE_TYPE=archive-restore' \
    'STATUS=verified' \
    "RECOVERY_SCOPE=$recovery_scope" \
    "RECIPIENT_SHA256=$recipient_sha" \
    "CANDIDATE_SHA256=$EXPECTED_CANDIDATE_SHA256" \
    "DATABASE_CIPHERTEXT_SHA256=$database_ciphertext" \
    "SECRETS_CIPHERTEXT_SHA256=$secrets_ciphertext" \
    "RUNTIME_FILES_CIPHERTEXT_SHA256=$runtime_files_ciphertext" \
    "OBJECT_BUCKET=$(read_unique_value_from "$candidate_file" OBJECT_BUCKET)" \
    "DATABASE_OBJECT_KEY=$(read_unique_value_from "$candidate_file" DATABASE_OBJECT_KEY)" \
    "DATABASE_OBJECT_VERSION_ID=$(read_unique_value_from "$candidate_file" DATABASE_OBJECT_VERSION_ID)" \
    "DATABASE_RETAIN_UNTIL=$(read_unique_value_from "$candidate_file" DATABASE_RETAIN_UNTIL)" \
    "SECRETS_OBJECT_KEY=$(read_unique_value_from "$candidate_file" SECRETS_OBJECT_KEY)" \
    "SECRETS_OBJECT_VERSION_ID=$(read_unique_value_from "$candidate_file" SECRETS_OBJECT_VERSION_ID)" \
    "SECRETS_RETAIN_UNTIL=$(read_unique_value_from "$candidate_file" SECRETS_RETAIN_UNTIL)" \
    "RUNTIME_FILES_OBJECT_KEY=$(read_unique_value_from "$candidate_file" RUNTIME_FILES_OBJECT_KEY)" \
    "RUNTIME_FILES_OBJECT_VERSION_ID=$(read_unique_value_from "$candidate_file" RUNTIME_FILES_OBJECT_VERSION_ID)" \
    "RUNTIME_FILES_RETAIN_UNTIL=$(read_unique_value_from "$candidate_file" RUNTIME_FILES_RETAIN_UNTIL)" \
    "DATABASE_AUTHORITY_CATALOG_SHA256=$database_authority_sha" \
    "RUNTIME_FILES_INVENTORY_SHA256=$(read_unique_value_from "$candidate_file" RUNTIME_FILES_INVENTORY_SHA256)" \
    "RUNTIME_FILES_FILE_COUNT=$(read_unique_value_from "$candidate_file" RUNTIME_FILES_FILE_COUNT)" \
    "SOURCE_DATABASE_IDENTITY_SHA256=$(read_unique_value_from "$candidate_file" SOURCE_DATABASE_IDENTITY_SHA256)" \
    "SOURCE_MIGRATION_LEDGER_SHA256=$(read_unique_value_from "$candidate_file" SOURCE_MIGRATION_LEDGER_SHA256)" \
    "COMMISSION_CODE_BUNDLE_SHA256=$(read_unique_value_from "$candidate_file" COMMISSION_CODE_BUNDLE_SHA256)" \
    "RECOVERY_PROGRAM_SET_SHA256=$(read_unique_value_from "$candidate_file" RECOVERY_PROGRAM_SET_SHA256)" \
    "RECOVERY_DB_CONTRACT_SHA256=$(read_unique_value_from "$candidate_file" RECOVERY_DB_CONTRACT_SHA256)" \
    "SOURCE_APP_ENV_SHA256=$app_env_sha" \
    "SOURCE_BACKUP_ENV_SHA256=$backup_env_sha" \
    "SOURCE_MIGRATION_ENV_SHA256=$migration_env_sha" \
    "SIGNED_EVIDENCE_SHA256=$SIGNED_EVIDENCE_SHA256" \
    "SIGNED_SIGNATURE_SHA256=$SIGNED_SIGNATURE_SHA256" \
    "ALLOWED_SIGNERS_SHA256=$ALLOWED_SIGNERS_SHA256"
  if [ "$expected_candidate_format" = 3 ]; then
    printf '%s\n' \
      'LOG_GENESIS_ANCHOR_FORMAT_VERSION=1' \
      'LOG_GENESIS_ANCHOR_STATUS=COMMITTED'
    for key in \
      LOG_GENESIS_ANCHOR_SHA256 LOG_GENESIS_ANCHOR_BYTES \
      LOG_GENESIS_EVIDENCE_START_AT LOG_GENESIS_OBJECT_KEY \
      LOG_GENESIS_OBJECT_VERSION_ID LOG_GENESIS_CIPHERTEXT_SHA256 \
      LOG_GENESIS_CIPHERTEXT_BYTES LOG_GENESIS_OBJECT_FORMAT_VERSION \
      LOG_GENESIS_EVIDENCE_BOOTSTRAP LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA \
      LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256 LOG_GENESIS_RANGES_SHA256 \
      LOG_GENESIS_FILE_RANGE_COUNT LOG_GENESIS_FILE_RANGE_BYTES \
      LOG_GENESIS_JOURNAL_RANGE_COUNT LOG_GENESIS_CURSOR_SHA256 \
      LOG_GENESIS_OBJECT_CREATED_AT LOG_GENESIS_RETAIN_UNTIL \
      LOG_GENESIS_SHIP_LOGS_SHA256; do
      printf '%s=%s\n' "$key" "$(read_unique_value_from "$candidate_file" "$key")"
    done
    for key in \
      BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION \
      BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256 BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES \
      BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256 \
      BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256 \
      BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256 \
      BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256; do
      printf '%s=%s\n' "$key" "$(read_unique_value_from "$candidate_file" "$key")"
    done
    printf '%s\n' \
      "LOG_GENESIS_MANIFEST_SHA256=$(read_unique_value_from "$evidence_file" LOG_GENESIS_MANIFEST_SHA256)" \
      "LOG_GENESIS_SHA256SUMS_SHA256=$(read_unique_value_from "$evidence_file" LOG_GENESIS_SHA256SUMS_SHA256)" \
      'LOG_GENESIS_DECRYPT_STATUS=passed' \
      'LOG_GENESIS_ARCHIVE_LAYOUT_STATUS=passed' \
      'LOG_GENESIS_INTERNAL_CHECKSUM_STATUS=passed' \
      'LOG_GENESIS_RANGES_STATUS=passed' \
      'LOG_GENESIS_CURSOR_STATUS=passed' \
      'LOG_GENESIS_ANCHOR_BINDING_STATUS=passed' \
      'RECOVERY_CATALOG_FORMAT_VERSION=3' \
      "RECOVERY_CATALOG_OBJECT_KEY=$RECOVERY_CATALOG_OBJECT_KEY" \
      "RECOVERY_CATALOG_OBJECT_VERSION_ID=$RECOVERY_CATALOG_OBJECT_VERSION_ID" \
      "RECOVERY_CATALOG_SHA256=$RECOVERY_CATALOG_SHA256" \
      "RECOVERY_CATALOG_BYTES=$RECOVERY_CATALOG_BYTES" \
      "RECOVERY_CATALOG_CREATED_AT_UTC=$RECOVERY_CATALOG_CREATED_AT_UTC" \
      "RECOVERY_CATALOG_RETENTION_DAYS=$RECOVERY_CATALOG_RETENTION_DAYS" \
      "RECOVERY_CATALOG_RETAIN_UNTIL=$RECOVERY_CATALOG_RETAIN_UNTIL" \
      "RECOVERY_PAYLOAD_RETAIN_UNTIL=$RECOVERY_CATALOG_RETAIN_UNTIL"
  fi
  printf '%s\n' \
    'DECRYPT_STATUS=passed' \
    'INTERNAL_CHECKSUM_STATUS=passed' \
    'SCRATCH_RESTORE_STATUS=passed' \
    'TENANT_CANARY_STATUS=passed' \
    'DATABASE_AUTHORITY_CATALOG_STATUS=captured_and_bound' \
    'MIGRATION_LEDGER_RESTORE_STATUS=passed' \
    'RLS_FORCE_RLS_CATALOG_STATUS=passed' \
    'FULL_AUTHORITY_RESTORE_STATUS=not_tested' \
    'PII_DECRYPT_STATUS=passed' \
    'NEXTAUTH_SECRET_RECOVERY_STATUS=passed' \
    'RUNTIME_FILES_DECRYPT_STATUS=passed' \
    'RUNTIME_FILES_INVENTORY_STATUS=passed' \
    "INTEGRATION_TOKEN_DECRYPT_STATUS=$integration_token_status" \
    'DATABASE_STORAGE_ATTESTATION=DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED' \
    'COPY_COUNT_MINIMUM=2' \
    "EVIDENCE_REF=$EVIDENCE_REF" \
    "EVIDENCE_AT_UTC=$EVIDENCE_AT_UTC" \
    "OFFLINE_OPERATOR=$OFFLINE_OPERATOR" \
    "REVIEWED_MAIN_SHA=$WORKFLOW_SHA" \
    "RECORDED_AT_UTC=$recorded_at" \
    "RECORDED_BY=$WORKFLOW_ACTOR" \
    "WORKFLOW_SHA=$WORKFLOW_SHA" \
    "WORKFLOW_RUN_ID=$WORKFLOW_RUN_ID"
  } >"$MARKER_STAGE"
  chown root:root "$MARKER_STAGE"
  chmod 0600 "$MARKER_STAGE"
  sync -f -- "$MARKER_STAGE" "$RESTORE_DIR"
  mv -- "$MARKER_STAGE" "$restore_file"
  MARKER_STAGE=""
  sync -f -- "$restore_file" "$RESTORE_DIR"
  assert_preserved_signed_evidence "$restore_file" archive-restore
  if [ -e "$current_marker" ] || [ -L "$current_marker" ]; then
    assert_root_file "current $recovery_scope restore marker" "$current_marker"
    [ "$(stat -c '%a' "$current_marker")" = "600" ] \
      || fatal "current offline restore marker must use mode 0600"
  fi
  MARKER_STAGE="$(mktemp "$EVIDENCE_ROOT/.marker-stage.XXXXXX")"
  cp --preserve=mode,ownership -- "$restore_file" "$MARKER_STAGE"
  sync -f -- "$MARKER_STAGE" "$EVIDENCE_ROOT"
  mv -f -- "$MARKER_STAGE" "$current_marker"
  MARKER_STAGE=""
  sync -f -- "$current_marker" "$EVIDENCE_ROOT"

  release_backup_locks
  # Certification proves exact candidate/evidence bytes, but the currently
  # installed runners can still belong to the previous application release.
  # Keep every schedule disabled. The reviewed deployment revalidates the
  # signed program/DB digests, installs one immutable operations release, then
  # enables all four timers atomically.
  commit_commission_timers_disabled
  log "independent $recovery_scope evidence certified; all four recovery timers remain disabled for the matching reviewed deployment stage"
}

recover_commission_runner_fence

case "$OPERATION" in
  install-backup-tools) install_tools ;;
  activate-backup-encryption) activate_encryption ;;
  run-bootstrap-backup|run-verified-backup) run_verified_backup ;;
  certify-bootstrap-restore|certify-offline-restore) certify_offline_restore ;;
  *) fatal "unsupported commissioning operation" ;;
esac
