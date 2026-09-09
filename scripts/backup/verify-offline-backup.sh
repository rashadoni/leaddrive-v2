#!/usr/bin/env bash
set -Eeuo pipefail

# Run only on the independent restore workstation. Private age/signing keys and
# recovered application secrets stay in the local temporary directory. The
# only transferable output is a PII-free signed evidence bundle.

umask 077

DATABASE_ARCHIVE="${1:-}"
SECRETS_ARCHIVE="${2:-}"
RUNTIME_FILES_ARCHIVE="${3:-}"
LOG_ARCHIVE=""
LOG_GENESIS_ANCHOR=""
CANDIDATE_RECORD=""
AGE_IDENTITY_FILE=""
EXPECTED_CANDIDATE_SHA256=""
EXPECTED_RECIPIENT_SHA256=""
EVIDENCE_REF=""
OFFLINE_OPERATOR=""
SIGNING_KEY_FILE=""
OUTPUT_FILE_INPUT=""
REVIEWED_MAIN_SHA=""

# FORMAT_VERSION=2 is the deliberately limited bootstrap ceremony that can run
# before the first log-evidence object exists.  Once a committed genesis exists,
# FORMAT_VERSION=3 adds that exact immutable object and the exported root anchor.
# Keep the old 12-argument shape only for bootstrap recovery; a v3 candidate
# can never be verified through the shorter interface.
case "$#" in
  12)
    CANDIDATE_RECORD="${4:-}"
    AGE_IDENTITY_FILE="${5:-}"
    EXPECTED_CANDIDATE_SHA256="${6:-}"
    EXPECTED_RECIPIENT_SHA256="${7:-}"
    EVIDENCE_REF="${8:-}"
    OFFLINE_OPERATOR="${9:-}"
    SIGNING_KEY_FILE="${10:-}"
    OUTPUT_FILE_INPUT="${11:-}"
    REVIEWED_MAIN_SHA="${12:-}"
    ;;
  14)
    LOG_ARCHIVE="${4:-}"
    LOG_GENESIS_ANCHOR="${5:-}"
    CANDIDATE_RECORD="${6:-}"
    AGE_IDENTITY_FILE="${7:-}"
    EXPECTED_CANDIDATE_SHA256="${8:-}"
    EXPECTED_RECIPIENT_SHA256="${9:-}"
    EVIDENCE_REF="${10:-}"
    OFFLINE_OPERATOR="${11:-}"
    SIGNING_KEY_FILE="${12:-}"
    OUTPUT_FILE_INPUT="${13:-}"
    REVIEWED_MAIN_SHA="${14:-}"
    ;;
  *)
    printf '%s\n' \
      'usage (bootstrap): verify-offline-backup.sh DATABASE_ARCHIVE SECRETS_ARCHIVE RUNTIME_FILES_ARCHIVE CANDIDATE_RECORD AGE_IDENTITY CANDIDATE_SHA256 RECIPIENT_SHA256 EVIDENCE_REF OFFLINE_OPERATOR SIGNING_KEY OUTPUT REVIEWED_MAIN_SHA' \
      'usage (full): verify-offline-backup.sh DATABASE_ARCHIVE SECRETS_ARCHIVE RUNTIME_FILES_ARCHIVE LOG_GENESIS_ARCHIVE LOG_GENESIS_ANCHOR CANDIDATE_RECORD AGE_IDENTITY CANDIDATE_SHA256 RECIPIENT_SHA256 EVIDENCE_REF OFFLINE_OPERATOR SIGNING_KEY OUTPUT REVIEWED_MAIN_SHA' >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNNING_VERIFIER_FILE="$SCRIPT_DIR/verify-offline-backup.sh"
SCRATCH_ROOT_REAL=""
WORK_DIR=""
OUTPUT_STAGE_DIR=""
OUTPUT_PARENT_REAL=""
OUTPUT_FILE=""
OUTPUT_SIGNATURE=""
OUTPUT_BUNDLE=""
OUTPUT_BUNDLE_BASE64=""
PUBLISHED=0
PUBLISHED_EVIDENCE=0
PUBLISHED_SIGNATURE=0
PUBLISHED_BUNDLE=0
PUBLISHED_BUNDLE_BASE64=0

fatal() {
  printf '[offline-backup-verify] FATAL: %s\n' "$*" >&2
  exit 1
}

candidate_value() {
  local key="$1"
  awk -F= -v want="$key" '
    $1 == want {
      if (found) exit 2
      print substr($0, length($1) + 2)
      found=1
    }
  ' "$CANDIDATE_RECORD"
}

remove_published_link_if_owned() {
  local published="$1"
  local destination="$2"
  local staged="$3"
  [ "$published" -eq 1 ] || return 0
  if [ -e "$destination" ] && [ ! -L "$destination" ] \
    && [ -e "$staged" ] && [ "$destination" -ef "$staged" ]; then
    unlink -- "$destination"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$PUBLISHED" -ne 1 ] \
    && [ -n "$OUTPUT_STAGE_DIR" ]; then
    remove_published_link_if_owned "$PUBLISHED_BUNDLE_BASE64" \
      "$OUTPUT_BUNDLE_BASE64" "$OUTPUT_STAGE_DIR/evidence.bundle.b64"
    remove_published_link_if_owned "$PUBLISHED_BUNDLE" \
      "$OUTPUT_BUNDLE" "$OUTPUT_STAGE_DIR/evidence.bundle.tar"
    remove_published_link_if_owned "$PUBLISHED_SIGNATURE" \
      "$OUTPUT_SIGNATURE" "$OUTPUT_STAGE_DIR/evidence.env.sig"
    remove_published_link_if_owned "$PUBLISHED_EVIDENCE" \
      "$OUTPUT_FILE" "$OUTPUT_STAGE_DIR/evidence.env"
  fi
  if [ -n "$OUTPUT_STAGE_DIR" ]; then
    case "$OUTPUT_STAGE_DIR" in
      "$OUTPUT_PARENT_REAL"/.leaddrive-offline-evidence-output.*)
        rm -rf --one-file-system -- "$OUTPUT_STAGE_DIR"
        ;;
      *) printf '[offline-backup-verify] REFUSED unexpected output-stage cleanup: %s\n' "$OUTPUT_STAGE_DIR" >&2 ;;
    esac
  fi
  if [ -n "$WORK_DIR" ]; then
    case "$WORK_DIR" in
      "$SCRATCH_ROOT_REAL"/.leaddrive-offline-restore.*) rm -rf --one-file-system -- "$WORK_DIR" ;;
      *) printf '[offline-backup-verify] REFUSED unexpected cleanup path: %s\n' "$WORK_DIR" >&2 ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT

[ -n "${OFFLINE_SCRATCH_ROOT:-}" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must name an operator-provided encrypted or ephemeral mount"
[ "${OFFLINE_DATABASE_STORAGE_ATTESTATION:-}" = "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED" ] \
  || fatal "isolated PostgreSQL storage attestation is required"
for archive in "$DATABASE_ARCHIVE" "$SECRETS_ARCHIVE" "$RUNTIME_FILES_ARCHIVE"; do
  [ -f "$archive" ] && [ -s "$archive" ] && [ ! -L "$archive" ] \
    || fatal "all three encrypted archives must be non-empty regular non-symlink files"
done
[ -f "$CANDIDATE_RECORD" ] && [ -s "$CANDIDATE_RECORD" ] && [ ! -L "$CANDIDATE_RECORD" ] \
  && [ "$(stat -c '%s' "$CANDIDATE_RECORD")" -le 65536 ] \
  || fatal "candidate recovery catalog must be a non-empty regular non-symlink file"
for private_file in "$AGE_IDENTITY_FILE" "$SIGNING_KEY_FILE"; do
  [ -f "$private_file" ] && [ -s "$private_file" ] && [ ! -L "$private_file" ] \
    || fatal "offline identity/signing key must be a non-empty regular non-symlink file"
  case "$(stat -c '%a' "$private_file")" in
    400|600) ;;
    *) fatal "offline identity/signing key must use mode 0400 or 0600" ;;
  esac
  [ "$(stat -c '%u' "$private_file")" = "$(id -u)" ] \
    || fatal "offline identity/signing key must belong to the operator account"
done
[[ "$EXPECTED_RECIPIENT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  && [[ "$EXPECTED_CANDIDATE_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fatal "candidate/recipient digests must be lowercase SHA-256"
[[ "$REVIEWED_MAIN_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fatal "reviewed main revision must be an exact lowercase Git SHA"
[[ "$EVIDENCE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]] \
  || fatal "evidence reference has an unsafe shape"
[[ "$OFFLINE_OPERATOR" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
  || fatal "offline operator identifier has an unsafe shape"
awk '
  !/^[A-Z][A-Z0-9_]*=[[:print:]]*$/ { bad=1; next }
  { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
  END { if (NR < 1 || bad) exit 1 }
' "$CANDIDATE_RECORD" \
  || fatal "candidate recovery catalog is malformed or contains duplicate keys"
actual_candidate_sha256="$(sha256sum "$CANDIDATE_RECORD" | awk '{print $1}')"
[ "$actual_candidate_sha256" = "$EXPECTED_CANDIDATE_SHA256" ] \
  || fatal "candidate recovery catalog digest does not match the commissioned digest"
CANDIDATE_FORMAT_VERSION="$(candidate_value FORMAT_VERSION)"
case "$CANDIDATE_FORMAT_VERSION:$#" in
  2:12) EXPECTED_RECOVERY_SCOPE=log-genesis-bootstrap-only ;;
  3:14)
    EXPECTED_RECOVERY_SCOPE=full-recovery
    [ -f "$LOG_ARCHIVE" ] && [ -s "$LOG_ARCHIVE" ] && [ ! -L "$LOG_ARCHIVE" ] \
      || fatal "genesis recovery requires a non-empty regular non-symlink log archive"
    [ -f "$LOG_GENESIS_ANCHOR" ] && [ -s "$LOG_GENESIS_ANCHOR" ] && [ ! -L "$LOG_GENESIS_ANCHOR" ] \
      && [ "$(stat -c '%s' "$LOG_GENESIS_ANCHOR")" -le 16384 ] \
      || fatal "genesis recovery requires the exported committed root anchor"
    ;;
  2:14) fatal "bootstrap candidate must use the shorter interface without genesis inputs" ;;
  3:12) fatal "genesis candidate requires the exact first log archive" ;;
  *) fatal "candidate recovery catalog uses an unsupported format" ;;
esac
# Candidate records are an externally transferred authorization surface.  Do
# not accept unknown, missing, reordered, or format-inappropriate fields even
# when a caller supplies a matching digest: the two schemas have different
# authorization scope and must stay mechanically distinguishable.
awk -F= -v format="$CANDIDATE_FORMAT_VERSION" '
  BEGIN {
    head = "FORMAT_VERSION STATUS RECOVERY_SCOPE RECIPIENT_SHA256 OBJECT_BUCKET " \
      "DATABASE_OBJECT_KEY DATABASE_OBJECT_VERSION_ID DATABASE_CIPHERTEXT_SHA256 " \
      "DATABASE_CIPHERTEXT_BYTES DATABASE_RETENTION_TIER DATABASE_RETENTION_DAYS " \
      "DATABASE_RETAIN_UNTIL SECRETS_OBJECT_KEY SECRETS_OBJECT_VERSION_ID " \
      "SECRETS_CIPHERTEXT_SHA256 SECRETS_CIPHERTEXT_BYTES SECRETS_FILE_COUNT " \
      "SECRETS_RETENTION_DAYS SECRETS_RETAIN_UNTIL RUNTIME_FILES_OBJECT_KEY " \
      "RUNTIME_FILES_OBJECT_VERSION_ID RUNTIME_FILES_CIPHERTEXT_SHA256 " \
      "RUNTIME_FILES_CIPHERTEXT_BYTES RUNTIME_FILES_RETENTION_TIER " \
      "RUNTIME_FILES_RETENTION_DAYS RUNTIME_FILES_RETAIN_UNTIL " \
      "RUNTIME_FILES_FILE_COUNT RUNTIME_FILES_INVENTORY_SHA256 RUNTIME_FILES_SOURCE_BYTES"
    log_fields = "LOG_GENESIS_ANCHOR_FORMAT_VERSION LOG_GENESIS_ANCHOR_STATUS " \
      "LOG_GENESIS_ANCHOR_SHA256 LOG_GENESIS_ANCHOR_BYTES LOG_GENESIS_EVIDENCE_START_AT " \
      "LOG_GENESIS_OBJECT_KEY LOG_GENESIS_OBJECT_VERSION_ID LOG_GENESIS_CIPHERTEXT_SHA256 " \
      "LOG_GENESIS_CIPHERTEXT_BYTES LOG_GENESIS_OBJECT_FORMAT_VERSION " \
      "LOG_GENESIS_EVIDENCE_BOOTSTRAP LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA " \
      "LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256 LOG_GENESIS_RANGES_SHA256 " \
      "LOG_GENESIS_FILE_RANGE_COUNT LOG_GENESIS_FILE_RANGE_BYTES " \
      "LOG_GENESIS_JOURNAL_RANGE_COUNT LOG_GENESIS_CURSOR_SHA256 " \
      "LOG_GENESIS_OBJECT_CREATED_AT LOG_GENESIS_RETAIN_UNTIL LOG_GENESIS_SHIP_LOGS_SHA256 " \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256 " \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256 " \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256 " \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256 " \
      "BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256"
    tail = "SOURCE_APP_ENV_SHA256 SOURCE_BACKUP_ENV_SHA256 SOURCE_MIGRATION_ENV_SHA256 " \
      "SOURCE_DATABASE_IDENTITY_SHA256 SOURCE_MIGRATION_LEDGER_SHA256 " \
      "DATABASE_SYSTEMD_INVOCATION_ID SECRETS_SYSTEMD_INVOCATION_ID " \
      "RUNTIME_FILES_SYSTEMD_INVOCATION_ID COMMISSION_CODE_BUNDLE_SHA256 " \
      "RECOVERY_PROGRAM_SET_SHA256 RECOVERY_DB_CONTRACT_SHA256 POSTGRES_BACKUP_SHA256 " \
      "POSTGRES_RESTORE_CANARY_SHA256 CANARY_SQL_SHA256 SECRETS_SNAPSHOT_SHA256 " \
      "RUNTIME_FILES_SNAPSHOT_SHA256 CREATED_AT_UTC CREATED_BY WORKFLOW_SHA WORKFLOW_RUN_ID"
    schema = head " " (format == "3" ? log_fields " " : "") tail
    expected_count = split(schema, expected, " ")
  }
  $1 != expected[NR] { bad=1 }
  END { if (NR != expected_count || bad) exit 1 }
' "$CANDIDATE_RECORD" \
  || fatal "candidate recovery catalog does not match its exact versioned schema"
[ "$(candidate_value RECOVERY_SCOPE)" = "$EXPECTED_RECOVERY_SCOPE" ] \
  || fatal "candidate recovery scope does not match its format and invocation"
[ "$(candidate_value STATUS)" = awaiting_offline_restore ] \
  && [ "$(candidate_value WORKFLOW_SHA)" = "$REVIEWED_MAIN_SHA" ] \
  && [ "$(candidate_value RECIPIENT_SHA256)" = "$EXPECTED_RECIPIENT_SHA256" ] \
  || fatal "candidate recovery catalog belongs to another revision, state, or recipient"

EXPECTED_DATABASE_SHA256="$(candidate_value DATABASE_CIPHERTEXT_SHA256)"
EXPECTED_SECRETS_SHA256="$(candidate_value SECRETS_CIPHERTEXT_SHA256)"
EXPECTED_RUNTIME_FILES_SHA256="$(candidate_value RUNTIME_FILES_CIPHERTEXT_SHA256)"
EXPECTED_DATABASE_BYTES="$(candidate_value DATABASE_CIPHERTEXT_BYTES)"
EXPECTED_SECRETS_BYTES="$(candidate_value SECRETS_CIPHERTEXT_BYTES)"
EXPECTED_RUNTIME_FILES_BYTES="$(candidate_value RUNTIME_FILES_CIPHERTEXT_BYTES)"
OBJECT_BUCKET="$(candidate_value OBJECT_BUCKET)"
DATABASE_OBJECT_KEY="$(candidate_value DATABASE_OBJECT_KEY)"
DATABASE_OBJECT_VERSION_ID="$(candidate_value DATABASE_OBJECT_VERSION_ID)"
DATABASE_RETAIN_UNTIL="$(candidate_value DATABASE_RETAIN_UNTIL)"
SECRETS_OBJECT_KEY="$(candidate_value SECRETS_OBJECT_KEY)"
SECRETS_OBJECT_VERSION_ID="$(candidate_value SECRETS_OBJECT_VERSION_ID)"
SECRETS_RETAIN_UNTIL="$(candidate_value SECRETS_RETAIN_UNTIL)"
RUNTIME_FILES_OBJECT_KEY="$(candidate_value RUNTIME_FILES_OBJECT_KEY)"
RUNTIME_FILES_OBJECT_VERSION_ID="$(candidate_value RUNTIME_FILES_OBJECT_VERSION_ID)"
RUNTIME_FILES_RETAIN_UNTIL="$(candidate_value RUNTIME_FILES_RETAIN_UNTIL)"
RUNTIME_FILES_EXPECTED_INVENTORY_SHA256="$(candidate_value RUNTIME_FILES_INVENTORY_SHA256)"
RUNTIME_FILES_EXPECTED_FILE_COUNT="$(candidate_value RUNTIME_FILES_FILE_COUNT)"
RUNTIME_FILES_EXPECTED_SOURCE_BYTES="$(candidate_value RUNTIME_FILES_SOURCE_BYTES)"
SOURCE_DATABASE_IDENTITY_SHA256="$(candidate_value SOURCE_DATABASE_IDENTITY_SHA256)"
SOURCE_MIGRATION_LEDGER_SHA256="$(candidate_value SOURCE_MIGRATION_LEDGER_SHA256)"
COMMISSION_CODE_BUNDLE_SHA256="$(candidate_value COMMISSION_CODE_BUNDLE_SHA256)"
RECOVERY_PROGRAM_SET_SHA256="$(candidate_value RECOVERY_PROGRAM_SET_SHA256)"
RECOVERY_DB_CONTRACT_SHA256="$(candidate_value RECOVERY_DB_CONTRACT_SHA256)"
SOURCE_APP_ENV_SHA256="$(candidate_value SOURCE_APP_ENV_SHA256)"
SOURCE_BACKUP_ENV_SHA256="$(candidate_value SOURCE_BACKUP_ENV_SHA256)"
SOURCE_MIGRATION_ENV_SHA256="$(candidate_value SOURCE_MIGRATION_ENV_SHA256)"
CANDIDATE_CREATED_AT="$(candidate_value CREATED_AT_UTC)"
EXPECTED_LOG_SHA256=""
LOG_OBJECT_KEY=""
LOG_OBJECT_VERSION_ID=""
LOG_RETAIN_UNTIL=""
LOG_EVIDENCE_START_AT=""
LOG_EVIDENCE_FIRST_OBJECT_BYTES=""
LOG_EVIDENCE_OBJECT_FORMAT_VERSION=""
LOG_EVIDENCE_ANCHOR_SHA256=""
LOG_EVIDENCE_BOOTSTRAP_DEPLOY_SHA=""
LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256=""
LOG_EVIDENCE_RANGES_SHA256=""
LOG_EVIDENCE_FILE_RANGE_COUNT=""
LOG_EVIDENCE_FILE_RANGE_BYTES=""
LOG_EVIDENCE_JOURNAL_RANGE_COUNT=""
LOG_EVIDENCE_CURSOR_SHA256=""
LOG_EVIDENCE_OBJECT_CREATED_AT=""
LOG_GENESIS_ANCHOR_FORMAT_VERSION=""
LOG_GENESIS_ANCHOR_STATUS=""
LOG_GENESIS_ANCHOR_BYTES=""
LOG_GENESIS_EVIDENCE_BOOTSTRAP=""
LOG_GENESIS_SHIP_LOGS_SHA256=""
BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION=""
BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256=""
BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES=""
BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256=""
BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256=""
BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256=""
BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256=""
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  EXPECTED_LOG_SHA256="$(candidate_value LOG_GENESIS_CIPHERTEXT_SHA256)"
  LOG_OBJECT_KEY="$(candidate_value LOG_GENESIS_OBJECT_KEY)"
  LOG_OBJECT_VERSION_ID="$(candidate_value LOG_GENESIS_OBJECT_VERSION_ID)"
  LOG_RETAIN_UNTIL="$(candidate_value LOG_GENESIS_RETAIN_UNTIL)"
  LOG_EVIDENCE_START_AT="$(candidate_value LOG_GENESIS_EVIDENCE_START_AT)"
  LOG_EVIDENCE_FIRST_OBJECT_BYTES="$(candidate_value LOG_GENESIS_CIPHERTEXT_BYTES)"
  LOG_EVIDENCE_OBJECT_FORMAT_VERSION="$(candidate_value LOG_GENESIS_OBJECT_FORMAT_VERSION)"
  LOG_EVIDENCE_ANCHOR_SHA256="$(candidate_value LOG_GENESIS_ANCHOR_SHA256)"
  LOG_EVIDENCE_BOOTSTRAP_DEPLOY_SHA="$(candidate_value LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA)"
  LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256="$(candidate_value LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)"
  LOG_EVIDENCE_RANGES_SHA256="$(candidate_value LOG_GENESIS_RANGES_SHA256)"
  LOG_EVIDENCE_FILE_RANGE_COUNT="$(candidate_value LOG_GENESIS_FILE_RANGE_COUNT)"
  LOG_EVIDENCE_FILE_RANGE_BYTES="$(candidate_value LOG_GENESIS_FILE_RANGE_BYTES)"
  LOG_EVIDENCE_JOURNAL_RANGE_COUNT="$(candidate_value LOG_GENESIS_JOURNAL_RANGE_COUNT)"
  LOG_EVIDENCE_CURSOR_SHA256="$(candidate_value LOG_GENESIS_CURSOR_SHA256)"
  LOG_EVIDENCE_OBJECT_CREATED_AT="$(candidate_value LOG_GENESIS_OBJECT_CREATED_AT)"
  LOG_GENESIS_ANCHOR_FORMAT_VERSION="$(candidate_value LOG_GENESIS_ANCHOR_FORMAT_VERSION)"
  LOG_GENESIS_ANCHOR_STATUS="$(candidate_value LOG_GENESIS_ANCHOR_STATUS)"
  LOG_GENESIS_ANCHOR_BYTES="$(candidate_value LOG_GENESIS_ANCHOR_BYTES)"
  LOG_GENESIS_EVIDENCE_BOOTSTRAP="$(candidate_value LOG_GENESIS_EVIDENCE_BOOTSTRAP)"
  LOG_GENESIS_SHIP_LOGS_SHA256="$(candidate_value LOG_GENESIS_SHIP_LOGS_SHA256)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256)"
  BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256="$(candidate_value BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256)"
fi
for digest in \
  "$EXPECTED_DATABASE_SHA256" "$EXPECTED_SECRETS_SHA256" "$EXPECTED_RUNTIME_FILES_SHA256" \
  "$RUNTIME_FILES_EXPECTED_INVENTORY_SHA256" "$SOURCE_DATABASE_IDENTITY_SHA256" \
  "$SOURCE_MIGRATION_LEDGER_SHA256" "$COMMISSION_CODE_BUNDLE_SHA256" \
  "$RECOVERY_PROGRAM_SET_SHA256" "$RECOVERY_DB_CONTRACT_SHA256" \
  "$SOURCE_APP_ENV_SHA256" "$SOURCE_BACKUP_ENV_SHA256" "$SOURCE_MIGRATION_ENV_SHA256" \
  "$(candidate_value POSTGRES_BACKUP_SHA256)" \
  "$(candidate_value POSTGRES_RESTORE_CANARY_SHA256)" \
  "$(candidate_value CANARY_SQL_SHA256)" \
  "$(candidate_value SECRETS_SNAPSHOT_SHA256)" \
  "$(candidate_value RUNTIME_FILES_SNAPSHOT_SHA256)"; do
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "candidate recovery catalog contains an invalid SHA-256"
done
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  for digest in "$EXPECTED_LOG_SHA256" "$LOG_EVIDENCE_ANCHOR_SHA256" \
    "$LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256" "$LOG_EVIDENCE_RANGES_SHA256" \
    "$LOG_EVIDENCE_CURSOR_SHA256" "$LOG_GENESIS_SHIP_LOGS_SHA256" \
    "$BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256" \
    "$BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256" \
    "$BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256" \
    "$BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256" \
    "$BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] \
      || fatal "genesis candidate contains an invalid log-evidence SHA-256"
  done
  [[ "$LOG_OBJECT_KEY" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]tar[.]gz[.]age$ ]] \
    && [[ "$LOG_OBJECT_VERSION_ID" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [ "$LOG_OBJECT_VERSION_ID" != None ] && [ "$LOG_OBJECT_VERSION_ID" != null ] \
    && [[ "$LOG_EVIDENCE_START_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [ "$LOG_GENESIS_ANCHOR_FORMAT_VERSION" = 1 ] \
    && [ "$LOG_GENESIS_ANCHOR_STATUS" = COMMITTED ] \
    && [[ "$LOG_GENESIS_ANCHOR_BYTES" =~ ^[1-9][0-9]{0,4}$ ]] \
    && [ "$LOG_GENESIS_ANCHOR_BYTES" -le 16384 ] \
    && [ "$LOG_GENESIS_EVIDENCE_BOOTSTRAP" = 1 ] \
    && [ "$BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION" = 1 ] \
    && [[ "$BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES" =~ ^[1-9][0-9]{0,4}$ ]] \
    && [ "$BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES" -le 65536 ] \
    && [ "$LOG_EVIDENCE_OBJECT_FORMAT_VERSION" = 4 ] \
    && [[ "$LOG_EVIDENCE_BOOTSTRAP_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] \
    && [[ "$LOG_EVIDENCE_FIRST_OBJECT_BYTES" =~ ^[1-9][0-9]{0,12}$ ]] \
    && [ "$LOG_EVIDENCE_FIRST_OBJECT_BYTES" -le 2199023255552 ] \
    && [[ "$LOG_EVIDENCE_FILE_RANGE_COUNT" =~ ^[1-9][0-9]{0,5}$ ]] \
    && [ "$LOG_EVIDENCE_FILE_RANGE_COUNT" -le 100000 ] \
    && [[ "$LOG_EVIDENCE_FILE_RANGE_BYTES" =~ ^[0-9]{1,13}$ ]] \
    && [ "$LOG_EVIDENCE_FILE_RANGE_BYTES" -le 1099511627776 ] \
    && [[ "$LOG_EVIDENCE_JOURNAL_RANGE_COUNT" =~ ^[0-4]$ ]] \
    || fatal "genesis candidate contains an invalid log-evidence authority"
  log_start_epoch="$(date -u -d "$LOG_EVIDENCE_START_AT" '+%s' 2>/dev/null || true)"
  log_created_epoch="$(date -u -d "$LOG_EVIDENCE_OBJECT_CREATED_AT" '+%s' 2>/dev/null || true)"
  log_retain_epoch="$(date -u -d "$LOG_RETAIN_UNTIL" '+%s' 2>/dev/null || true)"
  [[ "$log_start_epoch" =~ ^[0-9]+$ ]] && [[ "$log_created_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$log_retain_epoch" =~ ^[0-9]+$ ]] \
    && [ "$log_start_epoch" -le "$log_created_epoch" ] \
    && [ "$log_created_epoch" -le "$(($(date -u '+%s') + 300))" ] \
    && [ "$log_retain_epoch" -gt "$(date -u '+%s')" ] \
    || fatal "genesis candidate log retention is expired or malformed"
fi
[[ "$OBJECT_BUCKET" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$ ]] \
  && [[ "$DATABASE_OBJECT_KEY" =~ ^postgres/monthly/[0-9]{4}/[0-9]{2}/leaddrive-postgres-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]tar[.]age$ ]] \
  && [[ "$SECRETS_OBJECT_KEY" =~ ^secrets/[0-9]{4}/[0-9]{2}/leaddrive-secrets-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]tar[.]age$ ]] \
  && [[ "$RUNTIME_FILES_OBJECT_KEY" =~ ^runtime-files/monthly/[0-9]{4}/[0-9]{2}/leaddrive-runtime-files-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]tar[.]age$ ]] \
  || fatal "candidate recovery catalog contains an invalid object identity"
for version_id in "$DATABASE_OBJECT_VERSION_ID" "$SECRETS_OBJECT_VERSION_ID" "$RUNTIME_FILES_OBJECT_VERSION_ID"; do
  [[ "$version_id" =~ ^[A-Za-z0-9._=/+-]{1,200}$ ]] \
    && [ "$version_id" != None ] && [ "$version_id" != null ] \
    || fatal "candidate recovery catalog contains an invalid object version"
done
for ciphertext_bytes in "$EXPECTED_DATABASE_BYTES" "$EXPECTED_SECRETS_BYTES" "$EXPECTED_RUNTIME_FILES_BYTES"; do
  [[ "$ciphertext_bytes" =~ ^[1-9][0-9]{0,12}$ ]] \
    && [ "$ciphertext_bytes" -le 2199023255552 ] \
    || fatal "candidate ciphertext size is invalid or exceeds the reviewed bound"
done
[[ "$RUNTIME_FILES_EXPECTED_FILE_COUNT" =~ ^[0-9]{1,7}$ ]] \
  && [ "$RUNTIME_FILES_EXPECTED_FILE_COUNT" -le 1000000 ] \
  && [[ "$RUNTIME_FILES_EXPECTED_SOURCE_BYTES" =~ ^[0-9]{1,13}$ ]] \
  && [ "$RUNTIME_FILES_EXPECTED_SOURCE_BYTES" -le 2199023255552 ] \
  && [ "$(candidate_value SECRETS_FILE_COUNT)" = 3 ] \
  && [ "$(candidate_value DATABASE_RETENTION_TIER)" = monthly ] \
  && [ "$(candidate_value RUNTIME_FILES_RETENTION_TIER)" = monthly ] \
  || fatal "candidate archive counts, source bytes, or retention tiers are invalid"
[[ "$(candidate_value DATABASE_SYSTEMD_INVOCATION_ID)" =~ ^[0-9a-f]{32}$ ]] \
  && [[ "$(candidate_value SECRETS_SYSTEMD_INVOCATION_ID)" =~ ^[0-9a-f]{32}$ ]] \
  && [[ "$(candidate_value RUNTIME_FILES_SYSTEMD_INVOCATION_ID)" =~ ^[0-9a-f]{32}$ ]] \
  && [[ "$(candidate_value CREATED_BY)" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,78}$ ]] \
  && [[ "$(candidate_value WORKFLOW_RUN_ID)" =~ ^[0-9]{1,20}$ ]] \
  && [[ "$CANDIDATE_CREATED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fatal "candidate provenance is malformed"
candidate_created_epoch="$(date -u -d "$CANDIDATE_CREATED_AT" '+%s' 2>/dev/null || true)"
candidate_now_epoch="$(date -u '+%s')"
[[ "$candidate_created_epoch" =~ ^[0-9]+$ ]] \
  && [ "$candidate_created_epoch" -le $((candidate_now_epoch + 300)) ] \
  && [ "$candidate_created_epoch" -ge $((candidate_now_epoch - 3024000)) ] \
  || fatal "candidate creation timestamp is invalid, stale, or future-dated"
for retention_record in \
  "$(candidate_value DATABASE_RETENTION_DAYS)|$DATABASE_RETAIN_UNTIL" \
  "$(candidate_value SECRETS_RETENTION_DAYS)|$SECRETS_RETAIN_UNTIL" \
  "$(candidate_value RUNTIME_FILES_RETENTION_DAYS)|$RUNTIME_FILES_RETAIN_UNTIL"; do
  IFS='|' read -r retention_days retention_until <<<"$retention_record"
  retention_epoch="$(date -u -d "$retention_until" '+%s' 2>/dev/null || true)"
  [[ "$retention_days" =~ ^[0-9]{1,4}$ ]] && [ "$retention_days" -ge 400 ] \
    && [[ "$retention_epoch" =~ ^[0-9]+$ ]] \
    && [ "$retention_epoch" -gt "$candidate_now_epoch" ] \
    && [ "$retention_epoch" -ge "$candidate_created_epoch" ] \
    && [ "$retention_epoch" -ge $((candidate_created_epoch + retention_days * 86400 - 300)) ] \
    || fatal "candidate retention is expired, malformed, or shorter than the reviewed minimum"
done
[ -n "$OUTPUT_FILE_INPUT" ] || fatal "output evidence path is required"
output_parent_input="$(dirname -- "$OUTPUT_FILE_INPUT")"
output_name="$(basename -- "$OUTPUT_FILE_INPUT")"
[ "$output_name" != . ] && [ "$output_name" != .. ] && [ -n "$output_name" ] \
  || fatal "output evidence filename is invalid"
OUTPUT_PARENT_REAL="$(realpath -e -- "$output_parent_input")" \
  || fatal "output evidence parent could not be resolved"
[ -d "$output_parent_input" ] && [ ! -L "$output_parent_input" ] \
  && [ -d "$OUTPUT_PARENT_REAL" ] && [ -w "$OUTPUT_PARENT_REAL" ] \
  || fatal "evidence output parent must be a writable real directory"
[ "$(stat -c '%u' "$OUTPUT_PARENT_REAL")" = "$(id -u)" ] \
  || fatal "evidence output parent must belong to the offline operator"
output_parent_mode="$(stat -c '%a' "$OUTPUT_PARENT_REAL")"
[[ "$output_parent_mode" =~ ^[0-7]{3,4}$ ]] \
  && (( (8#$output_parent_mode & 8#022) == 0 )) \
  || fatal "evidence output parent must not be group/world writable"
OUTPUT_FILE="$OUTPUT_PARENT_REAL/$output_name"
OUTPUT_SIGNATURE="$OUTPUT_FILE.sig"
OUTPUT_BUNDLE="$OUTPUT_FILE.bundle.tar"
OUTPUT_BUNDLE_BASE64="$OUTPUT_FILE.bundle.b64"
for output in "$OUTPUT_FILE" "$OUTPUT_SIGNATURE" "$OUTPUT_BUNDLE" "$OUTPUT_BUNDLE_BASE64"; do
  [ ! -e "$output" ] && [ ! -L "$output" ] \
    || fatal "refusing to overwrite an existing evidence output"
done

for command_name in age age-keygen awk base64 cmp cp date find findmnt grep gzip install ln \
  mountpoint node pg_restore psql realpath sed sha256sum sort ssh-keygen stat sync tar wc xargs; do
  command -v "$command_name" >/dev/null 2>&1 || fatal "$command_name is required"
done
age_version="$(age --version 2>&1)"
age_keygen_version="$(age-keygen --version 2>&1)"
[[ "$age_version" =~ ^(age[[:space:]]+)?v?1\.3\.2$ ]] \
  && [[ "$age_keygen_version" =~ ^(age-keygen[[:space:]]+)?v?1\.3\.2$ ]] \
  || fatal "offline verifier requires reviewed age/age-keygen version 1.3.2"
ssh-keygen -y -f "$SIGNING_KEY_FILE" 2>/dev/null | grep -Eq '^ssh-ed25519 AAAA[A-Za-z0-9+/=]+$' \
  || fatal "offline evidence signing key must be Ed25519"

for reviewed_file in "$SCRIPT_DIR/verify-offline-backup.sh" \
  "$SCRIPT_DIR/postgres-restore-canary.sh" "$SCRIPT_DIR/prove-restored-pii.mjs" \
  "$SCRIPT_DIR/canary.sql"; do
  [ -f "$reviewed_file" ] && [ ! -L "$reviewed_file" ] \
    || fatal "reviewed verifier component is missing or symlinked"
done
archive_verifier_sha256="$(sha256sum "$SCRIPT_DIR/verify-offline-backup.sh" | awk '{print $1}')"
restore_canary_sha256="$(sha256sum "$SCRIPT_DIR/postgres-restore-canary.sh" | awk '{print $1}')"
pii_proof_sha256="$(sha256sum "$SCRIPT_DIR/prove-restored-pii.mjs" | awk '{print $1}')"
canary_sql_sha256="$(sha256sum "$SCRIPT_DIR/canary.sql" | awk '{print $1}')"

actual_database_sha256="$(sha256sum "$DATABASE_ARCHIVE" | awk '{print $1}')"
actual_secrets_sha256="$(sha256sum "$SECRETS_ARCHIVE" | awk '{print $1}')"
actual_runtime_files_sha256="$(sha256sum "$RUNTIME_FILES_ARCHIVE" | awk '{print $1}')"
actual_log_sha256=""
[ "$actual_database_sha256" = "$EXPECTED_DATABASE_SHA256" ] \
  && [ "$(stat -c '%s' "$DATABASE_ARCHIVE")" = "$EXPECTED_DATABASE_BYTES" ] \
  || fatal "downloaded database ciphertext digest does not match production metadata"
[ "$actual_secrets_sha256" = "$EXPECTED_SECRETS_SHA256" ] \
  && [ "$(stat -c '%s' "$SECRETS_ARCHIVE")" = "$EXPECTED_SECRETS_BYTES" ] \
  || fatal "downloaded secrets ciphertext digest does not match production metadata"
[ "$actual_runtime_files_sha256" = "$EXPECTED_RUNTIME_FILES_SHA256" ] \
  && [ "$(stat -c '%s' "$RUNTIME_FILES_ARCHIVE")" = "$EXPECTED_RUNTIME_FILES_BYTES" ] \
  || fatal "downloaded runtime-file ciphertext digest does not match production metadata"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  actual_log_sha256="$(sha256sum "$LOG_ARCHIVE" | awk '{print $1}')"
  [ "$actual_log_sha256" = "$EXPECTED_LOG_SHA256" ] \
    && [ "$(stat -c '%s' "$LOG_ARCHIVE")" = "$LOG_EVIDENCE_FIRST_OBJECT_BYTES" ] \
    || fatal "downloaded first log-evidence ciphertext digest does not match the signed candidate"
  [ "$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')" = "$LOG_EVIDENCE_ANCHOR_SHA256" ] \
    && [ "$(stat -c '%s' "$LOG_GENESIS_ANCHOR")" = "$LOG_GENESIS_ANCHOR_BYTES" ] \
    || fatal "exported log-genesis anchor does not match the candidate"
fi
derived_recipient="$(age-keygen -y "$AGE_IDENTITY_FILE" 2>/dev/null)" \
  || fatal "offline identity could not derive its public recipient"
[[ "$derived_recipient" =~ ^age1[0-9a-z]{58}$ ]] \
  || fatal "offline identity did not derive a native age X25519 recipient"
actual_recipient_sha256="$(printf '%s' "$derived_recipient" | sha256sum | awk '{print $1}')"
unset derived_recipient
[ "$actual_recipient_sha256" = "$EXPECTED_RECIPIENT_SHA256" ] \
  || fatal "offline identity belongs to a different production recipient"

[ "${VERIFY_ALLOW_SOURCE_CLUSTER:-0}" != "1" ] \
  || fatal "offline evidence forbids VERIFY_ALLOW_SOURCE_CLUSTER"
case "${VERIFY_PGHOST:-}" in
  127.0.0.1|localhost|::1) ;;
  *) fatal "offline evidence requires an isolated loopback scratch PostgreSQL" ;;
esac

SCRATCH_ROOT_REAL="$(realpath -e -- "$OFFLINE_SCRATCH_ROOT")" \
  || fatal "OFFLINE_SCRATCH_ROOT could not be resolved"
[ -d "$OFFLINE_SCRATCH_ROOT" ] && [ ! -L "$OFFLINE_SCRATCH_ROOT" ] \
  && [ -d "$SCRATCH_ROOT_REAL" ] && [ -w "$SCRATCH_ROOT_REAL" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must be a writable real directory"
[ "$SCRATCH_ROOT_REAL" != / ] && mountpoint -q -- "$SCRATCH_ROOT_REAL" \
  || fatal "OFFLINE_SCRATCH_ROOT must itself be a non-root mountpoint"
[ "$(stat -c '%u' "$SCRATCH_ROOT_REAL")" = "$(id -u)" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must belong to the offline operator"
scratch_mode="$(stat -c '%a' "$SCRATCH_ROOT_REAL")"
[[ "$scratch_mode" =~ ^[0-7]{3,4}$ ]] \
  && (( (8#$scratch_mode & 8#077) == 0 )) \
  || fatal "OFFLINE_SCRATCH_ROOT must not grant group or other permissions"
[ "$(stat -c '%d' "$SCRATCH_ROOT_REAL")" != "$(stat -c '%d' /)" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must use a filesystem separate from workstation root"
[ -n "$(findmnt -n -T "$SCRATCH_ROOT_REAL" -o SOURCE,FSTYPE 2>/dev/null)" ] \
  || fatal "OFFLINE_SCRATCH_ROOT mount metadata could not be verified"

WORK_DIR="$(mktemp -d "$SCRATCH_ROOT_REAL/.leaddrive-offline-restore.XXXXXX")"
[ -d "$WORK_DIR" ] && [ ! -L "$WORK_DIR" ] \
  && [ "$(stat -c '%d' "$WORK_DIR")" = "$(stat -c '%d' "$SCRATCH_ROOT_REAL")" ] \
  || fatal "offline restore work directory escaped the reviewed scratch mount"
install -d -m 0700 "$WORK_DIR/inputs" "$WORK_DIR/private" "$WORK_DIR/helpers" \
  "$WORK_DIR/database" "$WORK_DIR/secrets" "$WORK_DIR/runtime-files" "$WORK_DIR/log-evidence"

# Stage immutable-by-construction private copies before any decrypt/restore.
# Reflinks are forbidden so a concurrent replacement of a source path cannot
# change bytes that have already passed the digest checks below.
source_database_archive="$DATABASE_ARCHIVE"
source_secrets_archive="$SECRETS_ARCHIVE"
source_runtime_files_archive="$RUNTIME_FILES_ARCHIVE"
source_log_archive="$LOG_ARCHIVE"
source_log_genesis_anchor="$LOG_GENESIS_ANCHOR"
source_candidate_record="$CANDIDATE_RECORD"
source_age_identity="$AGE_IDENTITY_FILE"
source_signing_key="$SIGNING_KEY_FILE"
cp --reflink=never -- "$source_database_archive" "$WORK_DIR/inputs/database.tar.age"
cp --reflink=never -- "$source_secrets_archive" "$WORK_DIR/inputs/secrets.tar.age"
cp --reflink=never -- "$source_runtime_files_archive" "$WORK_DIR/inputs/runtime-files.tar.age"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  cp --reflink=never -- "$source_log_archive" "$WORK_DIR/inputs/log-evidence.tar.gz.age"
  cp --reflink=never -- "$source_log_genesis_anchor" "$WORK_DIR/inputs/log-evidence-genesis.env"
fi
cp --reflink=never -- "$source_candidate_record" "$WORK_DIR/inputs/candidate.env"
install -m 0600 "$source_age_identity" "$WORK_DIR/private/age-identity.txt"
install -m 0600 "$source_signing_key" "$WORK_DIR/private/evidence-signing-key"
install -m 0700 "$RUNNING_VERIFIER_FILE" "$WORK_DIR/helpers/verify-offline-backup.sh"
install -m 0700 "$SCRIPT_DIR/postgres-restore-canary.sh" "$WORK_DIR/helpers/postgres-restore-canary.sh"
install -m 0600 "$SCRIPT_DIR/prove-restored-pii.mjs" "$WORK_DIR/helpers/prove-restored-pii.mjs"
install -m 0600 "$SCRIPT_DIR/canary.sql" "$WORK_DIR/helpers/canary.sql"
sync -f -- "$WORK_DIR/inputs/database.tar.age" "$WORK_DIR/inputs/secrets.tar.age" \
  "$WORK_DIR/inputs/runtime-files.tar.age" "$WORK_DIR/inputs/candidate.env" \
  "$WORK_DIR/private/age-identity.txt" "$WORK_DIR/private/evidence-signing-key" \
  "$WORK_DIR/helpers/verify-offline-backup.sh" "$WORK_DIR/helpers/postgres-restore-canary.sh" \
  "$WORK_DIR/helpers/prove-restored-pii.mjs" "$WORK_DIR/helpers/canary.sql" \
  "$WORK_DIR/inputs" "$WORK_DIR/private" "$WORK_DIR/helpers" "$WORK_DIR"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  sync -f -- "$WORK_DIR/inputs/log-evidence.tar.gz.age" \
    "$WORK_DIR/inputs/log-evidence-genesis.env" "$WORK_DIR/inputs" "$WORK_DIR"
fi

DATABASE_ARCHIVE="$WORK_DIR/inputs/database.tar.age"
SECRETS_ARCHIVE="$WORK_DIR/inputs/secrets.tar.age"
RUNTIME_FILES_ARCHIVE="$WORK_DIR/inputs/runtime-files.tar.age"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  LOG_ARCHIVE="$WORK_DIR/inputs/log-evidence.tar.gz.age"
  LOG_GENESIS_ANCHOR="$WORK_DIR/inputs/log-evidence-genesis.env"
fi
CANDIDATE_RECORD="$WORK_DIR/inputs/candidate.env"
AGE_IDENTITY_FILE="$WORK_DIR/private/age-identity.txt"
SIGNING_KEY_FILE="$WORK_DIR/private/evidence-signing-key"
SCRIPT_DIR="$WORK_DIR/helpers"

[ "$(sha256sum "$CANDIDATE_RECORD" | awk '{print $1}')" = "$EXPECTED_CANDIDATE_SHA256" ] \
  && [ "$(sha256sum "$DATABASE_ARCHIVE" | awk '{print $1}')" = "$EXPECTED_DATABASE_SHA256" ] \
  && [ "$(sha256sum "$SECRETS_ARCHIVE" | awk '{print $1}')" = "$EXPECTED_SECRETS_SHA256" ] \
  && [ "$(sha256sum "$RUNTIME_FILES_ARCHIVE" | awk '{print $1}')" = "$EXPECTED_RUNTIME_FILES_SHA256" ] \
  || fatal "a private staged input differs from its reviewed digest"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  [ "$(sha256sum "$LOG_ARCHIVE" | awk '{print $1}')" = "$EXPECTED_LOG_SHA256" ] \
    && [ "$(stat -c '%s' "$LOG_ARCHIVE")" = "$LOG_EVIDENCE_FIRST_OBJECT_BYTES" ] \
    && [ "$(sha256sum "$LOG_GENESIS_ANCHOR" | awk '{print $1}')" = "$LOG_EVIDENCE_ANCHOR_SHA256" ] \
    && [ "$(stat -c '%s' "$LOG_GENESIS_ANCHOR")" = "$LOG_GENESIS_ANCHOR_BYTES" ] \
    || fatal "a private staged log-genesis input differs from its reviewed identity"
fi
[ "$(sha256sum "$SCRIPT_DIR/verify-offline-backup.sh" | awk '{print $1}')" = "$archive_verifier_sha256" ] \
  && [ "$(sha256sum "$SCRIPT_DIR/postgres-restore-canary.sh" | awk '{print $1}')" = "$restore_canary_sha256" ] \
  && [ "$(sha256sum "$SCRIPT_DIR/prove-restored-pii.mjs" | awk '{print $1}')" = "$pii_proof_sha256" ] \
  && [ "$(sha256sum "$SCRIPT_DIR/canary.sql" | awk '{print $1}')" = "$canary_sql_sha256" ] \
  || fatal "a private staged verifier helper differs from the reviewed bytes"
staged_recipient="$(age-keygen -y "$AGE_IDENTITY_FILE" 2>/dev/null)" \
  || fatal "private staged identity could not derive its recipient"
[ "$(printf '%s' "$staged_recipient" | sha256sum | awk '{print $1}')" = "$EXPECTED_RECIPIENT_SHA256" ] \
  || fatal "private staged identity belongs to a different recipient"
unset staged_recipient source_database_archive source_secrets_archive
unset source_runtime_files_archive source_log_archive source_log_genesis_anchor
unset source_candidate_record source_age_identity source_signing_key
ssh-keygen -y -f "$SIGNING_KEY_FILE" 2>/dev/null | grep -Eq '^ssh-ed25519 AAAA[A-Za-z0-9+/=]+$' \
  || fatal "private staged evidence signing key is not Ed25519"

age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output "$WORK_DIR/database/archive.tar" "$DATABASE_ARCHIVE" \
  || fatal "offline identity could not decrypt the database archive"
age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output "$WORK_DIR/secrets/archive.tar" "$SECRETS_ARCHIVE" \
  || fatal "offline identity could not decrypt the secrets archive"
age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output "$WORK_DIR/runtime-files/archive.tar" "$RUNTIME_FILES_ARCHIVE" \
  || fatal "offline identity could not decrypt the runtime-file archive"

log_genesis_manifest_sha256=""
log_genesis_checksums_sha256=""
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  # The exported root anchor is the off-host authority for where immutable log
  # history begins.  Validate its exact canonical bytes before trusting the
  # ciphertext metadata copied into the candidate.
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
  ' "$LOG_GENESIS_ANCHOR" \
    || fatal "exported log-genesis anchor is not the exact committed v1 schema"
  [ "$(awk -F= '$1 == "LOG_EVIDENCE_START_AT" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_START_AT" ] \
    && [ "$(awk -F= '$1 == "LOG_EVIDENCE_FIRST_OBJECT_KEY" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_OBJECT_KEY" ] \
    && [ "$(awk -F= '$1 == "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" {print substr($0, index($0, "=") + 1)}' "$LOG_GENESIS_ANCHOR")" = "$LOG_OBJECT_VERSION_ID" ] \
    && [ "$(awk -F= '$1 == "LOG_EVIDENCE_FIRST_OBJECT_SHA256" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$EXPECTED_LOG_SHA256" ] \
    && [ "$(awk -F= '$1 == "LOG_EVIDENCE_FIRST_OBJECT_BYTES" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_FIRST_OBJECT_BYTES" ] \
    && [ "$(awk -F= '$1 == "LOG_EVIDENCE_OBJECT_FORMAT_VERSION" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_OBJECT_FORMAT_VERSION" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_DEPLOY_SHA" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_BOOTSTRAP_DEPLOY_SHA" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_RANGES_SHA256" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_RANGES_SHA256" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_FILE_RANGE_COUNT" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_FILE_RANGE_COUNT" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_FILE_RANGE_BYTES" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_FILE_RANGE_BYTES" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_JOURNAL_RANGE_COUNT" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_JOURNAL_RANGE_COUNT" ] \
    && [ "$(awk -F= '$1 == "BOOTSTRAP_CURSOR_SHA256" {print $2}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_CURSOR_SHA256" ] \
    && [ "$(awk -F= '$1 == "OBJECT_CREATED_AT" {print substr($0, index($0, "=") + 1)}' "$LOG_GENESIS_ANCHOR")" = "$LOG_EVIDENCE_OBJECT_CREATED_AT" ] \
    || fatal "candidate log-genesis fields do not reproduce the exported root anchor"

  age --decrypt --identity "$AGE_IDENTITY_FILE" \
    --output "$WORK_DIR/log-evidence/archive.tar.gz" "$LOG_ARCHIVE" \
    || fatal "offline identity could not decrypt the first log-evidence archive"
  gzip -t -- "$WORK_DIR/log-evidence/archive.tar.gz" \
    || fatal "decrypted first log-evidence archive is not valid gzip"
  log_entries="$(tar -tzf "$WORK_DIR/log-evidence/archive.tar.gz")" \
    || fatal "first log-evidence archive could not be listed"
  expected_log_file_count=$((LOG_EVIDENCE_FILE_RANGE_COUNT + 8))
  printf '%s\n' "$log_entries" | awk -v expected_files="$expected_log_file_count" '
    $0 == "./" { roots++; next }
    $0 ~ /^\.[\/][A-Za-z0-9._-]+$/ { name=substr($0,3); if (seen[name]++) bad=1; files++; next }
    { bad=1 }
    END { if (roots != 1 || files != expected_files || bad) exit 1 }
  ' || fatal "first log-evidence archive is nested, duplicated, or outside its bounded flat layout"
  for required_log_member in manifest.env RANGES.tsv cursor.next SHA256SUMS \
    journal__leaddrive-postgres-backup.service.log \
    journal__leaddrive-secrets-snapshot.service.log \
    journal__leaddrive-runtime-files-snapshot.service.log \
    journal__leaddrive-log-ship.service.log; do
    [ "$(printf '%s\n' "$log_entries" | grep -Fxc "./$required_log_member")" = 1 ] \
      || fatal "first log-evidence archive is missing $required_log_member"
  done
  printf '%s\n' "$log_entries" | awk '
    $0 == "./" || $0 == "./manifest.env" || $0 == "./RANGES.tsv" \
      || $0 == "./cursor.next" || $0 == "./SHA256SUMS" \
      || $0 ~ /^\.[\/]journal__leaddrive-(postgres-backup|secrets-snapshot|runtime-files-snapshot|log-ship)[.]service[.]log$/ \
      || $0 ~ /^\.[\/][0-9a-f]{64}[.]slice$/ { next }
    { bad=1 }
    END { if (bad) exit 1 }
  ' || fatal "first log-evidence archive contains an unreviewed member"
  tar -tvzf "$WORK_DIR/log-evidence/archive.tar.gz" \
    | awk -v expected_files="$expected_log_file_count" \
      '$1 ~ /^d/ && $NF == "./" { roots++; next }
       $1 ~ /^-/ { files++; next }
       { bad=1 }
       END { if (roots != 1 || files != expected_files || bad) exit 1 }' \
    || fatal "first log-evidence archive contains a link or special file"
  tar --no-same-owner --no-same-permissions --keep-old-files \
    -xzf "$WORK_DIR/log-evidence/archive.tar.gz" -C "$WORK_DIR/log-evidence" \
    || fatal "first log-evidence archive could not be safely extracted"

  log_checksum_entries="$(awk -v expected_entries="$((LOG_EVIDENCE_FILE_RANGE_COUNT + 7))" '
    /^[0-9a-f]{64}  [A-Za-z0-9._-]+$/ {
      name=substr($0,67)
      if (name == "SHA256SUMS" || seen[name]++) bad=1
      print name
      next
    }
    { bad=1 }
    END { if (NR != expected_entries || bad) exit 1 }
  ' "$WORK_DIR/log-evidence/SHA256SUMS")" \
    || fatal "log-evidence checksum manifest is malformed or duplicated"
  extracted_log_members="$(find "$WORK_DIR/log-evidence" -xdev -mindepth 1 -maxdepth 1 -type f \
    ! -name archive.tar.gz -printf '%f\n' | LC_ALL=C sort)"
  checksummed_log_members="$(printf '%s\n' "$log_checksum_entries" SHA256SUMS | LC_ALL=C sort)"
  [ "$extracted_log_members" = "$checksummed_log_members" ] \
    || fatal "log-evidence checksums do not cover exactly every archive member"
  (
    cd "$WORK_DIR/log-evidence"
    sha256sum --strict --check SHA256SUMS >/dev/null
  ) || fatal "first log-evidence archive internal checksums do not match"

  [ "$(stat -c '%s' "$WORK_DIR/log-evidence/manifest.env")" -le 16384 ] \
    && [ "$(stat -c '%s' "$WORK_DIR/log-evidence/cursor.next")" -le 4194304 ] \
    && [ "$(wc -l <"$WORK_DIR/log-evidence/cursor.next" | tr -d '[:space:]')" -le 100011 ] \
    && [ "$(stat -c '%s' "$WORK_DIR/log-evidence/RANGES.tsv")" -le 134217728 ] \
    && [ "$(stat -c '%s' "$WORK_DIR/log-evidence/SHA256SUMS")" -le 16777216 ] \
    || fatal "first log-evidence control files exceed their reviewed bounds"

  log_manifest="$WORK_DIR/log-evidence/manifest.env"
  awk -v start="$LOG_EVIDENCE_START_AT" -v file_count="$LOG_EVIDENCE_FILE_RANGE_COUNT" \
    -v file_bytes="$LOG_EVIDENCE_FILE_RANGE_BYTES" -v journal_count="$LOG_EVIDENCE_JOURNAL_RANGE_COUNT" \
    -v cursor_sha="$LOG_EVIDENCE_CURSOR_SHA256" '
    NR == 1 { if ($0 !~ /^TIMESTAMP=[0-9]{8}T[0-9]{6}Z$/) bad=1; next }
    NR == 2 { if ($0 !~ /^HOSTNAME=[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/) bad=1; next }
    NR == 3 { if ($0 != "SOURCE_DIRS=/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql") bad=1; next }
    NR == 4 { if ($0 != "SOURCE_FILES=/var/log/leaddrive-resilience-cron.log") bad=1; next }
    NR == 5 { if ($0 != "JOURNAL_UNITS=leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service") bad=1; next }
    NR == 6 { split($0,a,"="); if (a[1] != "APPENDED_BYTES" || a[2] != file_bytes) bad=1; next }
    NR == 7 { if ($0 !~ /^JOURNAL_BYTES=[0-9]+$/) bad=1; next }
    NR == 8 { if ($0 != "LOG_EVIDENCE_START_AT=" start) bad=1; next }
    NR == 9 { if ($0 != "EVIDENCE_BOOTSTRAP=1") bad=1; next }
    NR == 10 { if ($0 != "FILE_RANGE_COUNT=" file_count) bad=1; next }
    NR == 11 { if ($0 != "FILE_RANGE_BYTES=" file_bytes) bad=1; next }
    NR == 12 { if ($0 != "JOURNAL_RANGE_COUNT=" journal_count) bad=1; next }
    NR == 13 { if ($0 != "CURSOR_SHA256=" cursor_sha) bad=1; next }
    NR == 14 { split($0,a,"="); if (a[1] != "RETENTION_DAYS" || a[2] !~ /^[0-9]+$/ || a[2] < 400) bad=1; next }
    NR == 15 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    { bad=1 }
    END { if (NR != 15 || bad) exit 1 }
  ' "$log_manifest" || fatal "first log-evidence manifest does not match the genesis authority"
  log_manifest_timestamp="$(awk -F= '$1 == "TIMESTAMP" {print $2}' "$log_manifest")"
  log_manifest_epoch="$(date -u -d "$log_manifest_timestamp" '+%s' 2>/dev/null || true)"
  log_retention_days="$(awk -F= '$1 == "RETENTION_DAYS" {print $2}' "$log_manifest")"
  [[ "$log_manifest_epoch" =~ ^[0-9]+$ ]] \
    && [ "$log_manifest_epoch" -ge "$log_start_epoch" ] \
    && [ "$log_manifest_epoch" -le $((log_created_epoch + 300)) ] \
    && [[ "$log_retention_days" =~ ^[0-9]{1,4}$ ]] \
    && [ "$log_retention_days" -ge 400 ] \
    && [ "$log_retain_epoch" -ge $((log_created_epoch + log_retention_days * 86400 - 300)) ] \
    && [ "$log_retain_epoch" -ge $((log_created_epoch + 400 * 86400 - 300)) ] \
    || fatal "first log-evidence timeline or Object Lock deadline violates its recovery policy"

  log_ranges="$WORK_DIR/log-evidence/RANGES.tsv"
  [ "$(sha256sum "$log_ranges" | awk '{print $1}')" = "$LOG_EVIDENCE_RANGES_SHA256" ] \
    || fatal "first log-evidence range index differs from the genesis anchor"
  range_totals="$(awk -F '\t' '
    function safe_source(p, rest) {
      if (p ~ /[\r\n]/) return 0
      if (p == "/var/log/leaddrive-resilience-cron.log") return 1
      if (index(p,"/var/log/leaddrive-resilience-cron.log.") == 1 \
          || index(p,"/var/log/leaddrive-resilience-cron.log-") == 1) {
        rest=substr(p,39)
        return rest != "" && rest !~ /\//
      }
      if (index(p,"/var/lib/leaddrive-v2-logs/") == 1) rest=substr(p,28)
      else if (index(p,"/var/log/nginx/") == 1) rest=substr(p,16)
      else if (index(p,"/var/log/postgresql/") == 1) rest=substr(p,21)
      else return 0
      return rest != "" && rest !~ /\// && rest ~ /[.]log($|[.-]|#)/
    }
    NR == 1 {
      if ($0 != "TYPE\tSLICE\tSOURCE\tSTART\tEND\tBYTES") bad=1
      next
    }
    $1 == "FILE" {
      if (NF != 6 || $2 !~ /^[0-9a-f]{64}[.]slice$/ || seen[$2]++ || !safe_source($3) \
          || length($3) > 4096 \
          || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ || $6 !~ /^[1-9][0-9]*$/ \
          || ($5 + 0) <= ($4 + 0) || ($5 - $4) != $6) bad=1
      files++; file_bytes += $6
      next
    }
    $1 == "JOURNAL" {
      if (NF != 6 || $2 != "journal__" $3 ".log" || seen[$2]++ \
          || $3 !~ /^leaddrive-(postgres-backup|secrets-snapshot|runtime-files-snapshot|log-ship)[.]service$/ \
          || $4 != "NO_CURSOR" || $5 !~ /^[!-~]+$/ || length($5) > 2048 \
          || $6 !~ /^[1-9][0-9]*$/) bad=1
      journals++; journal_bytes += $6
      next
    }
    { bad=1 }
    END {
      if (NR != 1 + files + journals || bad) exit 1
      printf "%d|%.0f|%d|%.0f\n", files, file_bytes, journals, journal_bytes
    }
  ' "$log_ranges")" || fatal "first log-evidence range index is malformed"
  IFS='|' read -r range_file_count range_file_bytes range_journal_count range_journal_bytes <<<"$range_totals"
  [ "$range_file_count" = "$LOG_EVIDENCE_FILE_RANGE_COUNT" ] \
    && [ "$range_file_bytes" = "$LOG_EVIDENCE_FILE_RANGE_BYTES" ] \
    && [ "$range_journal_count" = "$LOG_EVIDENCE_JOURNAL_RANGE_COUNT" ] \
    && [ "$(awk -F= '$1 == "JOURNAL_BYTES" {print $2}' "$log_manifest")" = "$range_journal_bytes" ] \
    || fatal "first log-evidence range totals differ from manifest and anchor"
  range_row=0
  while IFS=$'\t' read -r range_type range_file range_source range_start range_end range_bytes; do
    range_row=$((range_row + 1))
    if [ "$range_row" -eq 1 ]; then
      [ "$range_type" = TYPE ] && [ "$range_file" = SLICE ] \
        && [ "$range_source" = SOURCE ] && [ "$range_start" = START ] \
        && [ "$range_end" = END ] && [ "$range_bytes" = BYTES ] \
        || fatal "first log-evidence range index has an invalid header"
      continue
    fi
    [ "$(stat -c '%s' "$WORK_DIR/log-evidence/$range_file")" = "$range_bytes" ] \
      || fatal "log-evidence range member size differs from its index: $range_file"
    if [ "$range_type" = FILE ]; then
      [ "$range_file" = "$(printf '%s' "$range_source" | sha256sum | awk '{print $1}').slice" ] \
        || fatal "log-evidence slice name does not bind its exact source label"
    fi
  done <"$log_ranges"
  for journal_unit in leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service \
    leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service; do
    journal_member="journal__${journal_unit}.log"
    journal_size="$(stat -c '%s' "$WORK_DIR/log-evidence/$journal_member")"
    journal_rows="$(awk -F '\t' -v member="$journal_member" '$1 == "JOURNAL" && $2 == member {count++} END {print count+0}' "$log_ranges")"
    if [ "$journal_size" -eq 0 ]; then
      [ "$journal_rows" -eq 0 ] || fatal "empty journal member unexpectedly has a range row"
    else
      [ "$journal_rows" -eq 1 ] || fatal "non-empty journal member has no unique range row"
    fi
  done

  log_cursor="$WORK_DIR/log-evidence/cursor.next"
  [ "$(sha256sum "$log_cursor" | awk '{print $1}')" = "$LOG_EVIDENCE_CURSOR_SHA256" ] \
    || fatal "first log-evidence cursor differs from manifest and anchor"
  awk -F '\t' -v start="$LOG_EVIDENCE_START_AT" -v program="$LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256" \
    -v ship="$LOG_GENESIS_SHIP_LOGS_SHA256" '
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 != "SHIP_LOGS_SHA256=" ship) bad=1; next }
    NR == 3 { if ($0 != "RECOVERY_PROGRAM_SET_SHA256=" program) bad=1; next }
    NR == 4 { if ($0 != "LOG_EVIDENCE_START_AT=" start) bad=1; next }
    NR == 5 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_KEY=PENDING") bad=1; next }
    NR == 6 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=PENDING") bad=1; next }
    NR == 7 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_SHA256=PENDING") bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || seen_file[$2]++ || $2 !~ /^\/var\/(lib\/leaddrive-v2-logs|log\/(nginx|postgresql))\/[^\/]+[.]log$/ \
          && $2 != "/var/log/leaddrive-resilience-cron.log" \
          || $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ \
          || $6 !~ /^[0-9]+$/ || $6 > 4096 || $7 !~ /^[0-9a-f]{64}$/) bad=1
      if (index($2,"/var/lib/leaddrive-v2-logs/") == 1) pm2++
      else if (index($2,"/var/log/nginx/") == 1) nginx++
      else if (index($2,"/var/log/postgresql/") == 1) postgres++
      else if ($2 == "/var/log/leaddrive-resilience-cron.log") resilience++
      next
    }
    $1 == "JOURNAL" {
      if (NF != 3 || seen_journal[$2]++ \
          || $2 !~ /^leaddrive-(postgres-backup|secrets-snapshot|runtime-files-snapshot|log-ship)[.]service$/ \
          || ($3 != "NO_CURSOR" && ($3 !~ /^[!-~]+$/ || length($3) > 2048))) bad=1
      journals++
      next
    }
    { bad=1 }
    END { if (NR < 12 || bad || !pm2 || !nginx || !postgres || resilience != 1 || journals != 4) exit 1 }
  ' "$log_cursor" || fatal "first log-evidence cursor is not the exact reviewed bootstrap state"

  log_genesis_manifest_sha256="$(sha256sum "$log_manifest" | awk '{print $1}')"
  log_genesis_checksums_sha256="$(sha256sum "$WORK_DIR/log-evidence/SHA256SUMS" | awk '{print $1}')"
fi

database_entries="$(tar -tf "$WORK_DIR/database/archive.tar")"
[ "$(printf '%s\n' "$database_entries" | sed '/^$/d' | wc -l | tr -d '[:space:]')" = "9" ] \
  || fatal "decrypted database archive does not contain exactly nine reviewed files"
for required_file in database.dump globals.sql authority.tsv migration-ledger.tsv recovery-db-contract.tsv source-canary.tsv database.list manifest.env SHA256SUMS; do
  printf '%s\n' "$database_entries" | grep -Fxq "$required_file" \
    || fatal "decrypted database archive is missing $required_file"
done
! grep -Eq '(^/|(^|/)\.\.(/|$)|/)' <<<"$database_entries" \
  || fatal "decrypted database archive contains an unsafe path"
tar -tvf "$WORK_DIR/database/archive.tar" \
  | awk '$1 !~ /^-/ { unsafe=1 } END { exit unsafe }' \
  || fatal "decrypted database archive contains a link or special file"
tar --no-same-owner --no-same-permissions --keep-old-files \
  -xf "$WORK_DIR/database/archive.tar" -C "$WORK_DIR/database"

checksum_entries="$(awk '
  /^[0-9a-f]{64}  [A-Za-z0-9._-]+$/ { print substr($0, 67); next }
  { invalid=1 }
  END { if (invalid) exit 1 }
' "$WORK_DIR/database/SHA256SUMS")" \
  || fatal "database archive checksum manifest has an unsafe shape"
[ "$(printf '%s\n' "$checksum_entries" | sed '/^$/d' | wc -l | tr -d '[:space:]')" = "7" ] \
  || fatal "database checksum manifest must cover exactly seven files"
for checksummed_file in database.dump globals.sql authority.tsv migration-ledger.tsv recovery-db-contract.tsv source-canary.tsv database.list; do
  printf '%s\n' "$checksum_entries" | grep -Fxq "$checksummed_file" \
    || fatal "database checksum manifest is missing $checksummed_file"
done
(
  cd "$WORK_DIR/database"
  sha256sum --check SHA256SUMS >/dev/null
) || fatal "database archive internal checksums do not match"
[ "$(grep -Fxc 'CANARY_STATUS=passed' "$WORK_DIR/database/manifest.env")" = "1" ] \
  || fatal "database manifest has no unique passed source canary"
awk '
  !/^[A-Z][A-Z0-9_]*=[[:print:]]+$/ { bad=1; next }
  { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
  END { if (NR < 1 || bad) exit 1 }
' "$WORK_DIR/database/manifest.env" \
  || fatal "database manifest is malformed or contains duplicate keys"
[ "$(awk -F= '$1 == "BACKUP_FORMAT_VERSION" { print $2 }' "$WORK_DIR/database/manifest.env")" = 3 ] \
  && [ "$(awk -F= '$1 == "AUTHORITY_STATUS" { print $2 }' "$WORK_DIR/database/manifest.env")" = captured ] \
  && [ "$(awk -F= '$1 == "MIGRATION_LEDGER_STATUS" { print $2 }' "$WORK_DIR/database/manifest.env")" = captured_and_restored ] \
  && [ "$(awk -F= '$1 == "RECOVERY_DB_CONTRACT_STATUS" { print $2 }' "$WORK_DIR/database/manifest.env")" = applied_prefix_verified ] \
  || fatal "database manifest does not declare the reviewed authority/ledger-aware format"
database_authority_sha256="$(sha256sum "$WORK_DIR/database/authority.tsv" | awk '{print $1}')"
[ "$(awk -F= '$1 == "AUTHORITY_SHA256" { print $2 }' "$WORK_DIR/database/manifest.env")" = "$database_authority_sha256" ] \
  || fatal "database authority digest does not match the database manifest"
database_migration_ledger_sha256="$(sha256sum "$WORK_DIR/database/migration-ledger.tsv" | awk '{print $1}')"
[ "$database_migration_ledger_sha256" = "$SOURCE_MIGRATION_LEDGER_SHA256" ] \
  && [ "$(awk -F= '$1 == "MIGRATION_LEDGER_SHA256" { print $2 }' "$WORK_DIR/database/manifest.env")" = "$database_migration_ledger_sha256" ] \
  || fatal "database migration ledger digest does not match candidate and manifest"
awk -F '\t' '
  NF != 8 { bad=1; next }
  { for (i=1; i<=8; i++) if ($i !~ /^(n|x([0-9a-f][0-9a-f])*)$/) bad=1 }
  END { if (NR < 1 || bad) exit 1 }
' "$WORK_DIR/database/migration-ledger.tsv" \
  || fatal "database migration ledger is empty or malformed"
database_recovery_contract_sha256="$(sha256sum "$WORK_DIR/database/recovery-db-contract.tsv" | awk '{print $1}')"
[ "$database_recovery_contract_sha256" = "$RECOVERY_DB_CONTRACT_SHA256" ] \
  && [ "$(awk -F= '$1 == "RECOVERY_DB_CONTRACT_SHA256" { print $2 }' "$WORK_DIR/database/manifest.env")" = "$database_recovery_contract_sha256" ] \
  || fatal "recovery DB contract manifest does not match candidate and database manifest"
awk -F '\t' '
  NR == 1 { if ($1 != "SCHEMA" || $2 != "prisma/schema.prisma" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  NR == 2 { if ($1 != "MIGRATION_LOCK" || $2 != "prisma/migrations/migration_lock.toml" || $3 !~ /^[0-9a-f]{64}$/) bad=1; next }
  $1 != "MIGRATION" || $2 !~ /^[0-9]{8,14}_[A-Za-z0-9_]+$/ || $3 !~ /^[0-9a-f]{64}$/ { bad=1; next }
  seen[$2]++ { bad=1 }
  { if (previous != "" && previous >= $2) bad=1; previous=$2; migrations++ }
  END { if (NR < 3 || migrations < 1 || bad) exit 1 }
' "$WORK_DIR/database/recovery-db-contract.tsv" \
  || fatal "recovery DB contract manifest is malformed"
awk -F '\t' '
  NF != 9 || $1 !~ /^(ROLE|MEMBERSHIP|DATABASE|SCHEMA|RELATION|TYPE|SECURITY_RELATION|POLICY|SECURITY_POLICY|DEFAULT_ACL|FUNCTION|SETTING)$/ { bad=1; next }
  { for (i=2; i<=9; i++) if ($i !~ /^x([0-9a-f][0-9a-f])*$/) bad=1; seen[$1]++ }
  END {
    if (NR < 5 || bad || !seen["ROLE"] || !seen["DATABASE"] || !seen["SCHEMA"] \
        || !seen["RELATION"] || !seen["TYPE"] || !seen["SECURITY_RELATION"]) exit 1
  }
' "$WORK_DIR/database/authority.tsv" \
  || fatal "database authority catalog is incomplete or malformed"
if grep -Fq 'SCRAM-SHA-256$' "$WORK_DIR/database/globals.sql" \
  || grep -Eiq 'md5[0-9a-f]{32}' "$WORK_DIR/database/globals.sql" \
  || grep -Eiq "PASSWORD[[:space:]]+(E)?'[^']*'" "$WORK_DIR/database/globals.sql"; then
  fatal "database globals contain password material"
fi
for required_table in organizations users contacts deals; do
  awk -v table="$required_table" '
    $4 == "TABLE" && $5 == "public" && $6 == table && $NF != "-" { found=1 }
    END { exit(found ? 0 : 1) }
  ' "$WORK_DIR/database/database.list" \
    || fatal "database dump does not preserve an owner for public.$required_table"
done
source_system_identifier="$(awk -F= '$1 == "SOURCE_SYSTEM_IDENTIFIER" { print $2 }' \
  "$WORK_DIR/database/manifest.env")"
[[ "$source_system_identifier" =~ ^[0-9]{1,20}$ ]] \
  || fatal "database manifest has no unique source PostgreSQL system identifier"

secrets_entries="$(tar -tf "$WORK_DIR/secrets/archive.tar")"
[ -n "$secrets_entries" ] && ! grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$secrets_entries" \
  || fatal "decrypted secrets archive contains an unsafe path"
[ "$(printf '%s\n' "$secrets_entries" | sed '/^$/d' | wc -l | tr -d '[:space:]')" = "5" ] \
  || fatal "decrypted secrets archive must contain the exact fixed recovery set"
printf '%s\n' "$secrets_entries" | awk '
  {
    if (seen[$0]++) bad=1
    if ($0 == "./") roots++
  }
  $0 == "./" || $0 == "./manifest.txt" \
    || $0 == "./etc__leaddrive__app.env" \
    || $0 == "./etc__leaddrive__backup.env" \
    || $0 == "./etc__leaddrive__migration.env" { next }
  { bad=1 }
  END { if (roots != 1 || bad) exit 1 }
' || fatal "decrypted secrets archive contains an unexpected file"
for required_secret_entry in ./manifest.txt ./etc__leaddrive__app.env \
  ./etc__leaddrive__backup.env ./etc__leaddrive__migration.env; do
  printf '%s\n' "$secrets_entries" | grep -Fxq "$required_secret_entry" \
    || fatal "decrypted secrets archive is missing $required_secret_entry"
done
tar -tvf "$WORK_DIR/secrets/archive.tar" \
  | awk '$1 !~ /^[-d]/ { unsafe=1 } END { exit unsafe }' \
  || fatal "decrypted secrets archive contains a link or special file"
tar --no-same-owner --no-same-permissions --keep-old-files \
  -xf "$WORK_DIR/secrets/archive.tar" -C "$WORK_DIR/secrets"
app_env_sha256=""
backup_env_sha256=""
migration_env_sha256=""
for recovery_path in /etc/leaddrive/app.env /etc/leaddrive/backup.env /etc/leaddrive/migration.env; do
  recovered_name="${recovery_path#/}"
  recovered_name="${recovered_name//\//__}"
  recovered_file="$WORK_DIR/secrets/$recovered_name"
  [ -s "$recovered_file" ] && [ ! -L "$recovered_file" ] \
    || fatal "secrets archive does not contain required recovery material"
  chmod 0600 "$recovered_file"
  recovered_sha256="$(sha256sum "$recovered_file" | awk '{print $1}')"
  recovered_bytes="$(wc -c <"$recovered_file" | tr -d '[:space:]')"
  [ "$(grep -Fxc "FILE $recovery_path sha256=$recovered_sha256 bytes=$recovered_bytes" \
    "$WORK_DIR/secrets/manifest.txt")" = "1" ] \
    || fatal "secrets manifest does not bind the complete fixed recovery set"
  case "$recovery_path" in
    /etc/leaddrive/app.env) app_env_sha256="$recovered_sha256" ;;
    /etc/leaddrive/backup.env) backup_env_sha256="$recovered_sha256" ;;
    /etc/leaddrive/migration.env) migration_env_sha256="$recovered_sha256" ;;
  esac
done
app_env_recovered="$WORK_DIR/secrets/etc__leaddrive__app.env"
[ "$app_env_sha256" = "$SOURCE_APP_ENV_SHA256" ] \
  && [ "$backup_env_sha256" = "$SOURCE_BACKUP_ENV_SHA256" ] \
  && [ "$migration_env_sha256" = "$SOURCE_MIGRATION_ENV_SHA256" ] \
  || fatal "recovered recovery-set secrets do not match the candidate source digests"

runtime_entries="$(tar -tf "$WORK_DIR/runtime-files/archive.tar")"
[ -n "$runtime_entries" ] \
  || fatal "decrypted runtime-file archive is empty"
printf '%s\n' "$runtime_entries" | awk '
  { if (seen[$0]++) bad=1 }
  $0 == "manifest.env" || $0 == "inventory.sha256z" \
    || $0 == "uploads" || index($0, "uploads/") == 1 \
    || $0 == "help-videos" || index($0, "help-videos/") == 1 { next }
  { bad=1 }
  END { if (NR > 2000010 || bad) exit 1 }
' || fatal "decrypted runtime-file archive contains a path outside the reviewed recovery roots"
! grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$runtime_entries" \
  || fatal "decrypted runtime-file archive contains an unsafe path"
tar -tvf "$WORK_DIR/runtime-files/archive.tar" \
  | awk '$1 !~ /^[-d]/ { unsafe=1 } END { exit unsafe }' \
  || fatal "decrypted runtime-file archive contains a link or special file"
tar --no-same-owner --no-same-permissions --keep-old-files \
  -xf "$WORK_DIR/runtime-files/archive.tar" -C "$WORK_DIR/runtime-files"
[ -d "$WORK_DIR/runtime-files/uploads" ] \
  && [ ! -L "$WORK_DIR/runtime-files/uploads" ] \
  && [ -d "$WORK_DIR/runtime-files/help-videos" ] \
  && [ ! -L "$WORK_DIR/runtime-files/help-videos" ] \
  || fatal "runtime-file archive is missing one fixed authoritative directory"
[ -f "$WORK_DIR/runtime-files/manifest.env" ] \
  && [ ! -L "$WORK_DIR/runtime-files/manifest.env" ] \
  && [ -f "$WORK_DIR/runtime-files/inventory.sha256z" ] \
  && [ ! -L "$WORK_DIR/runtime-files/inventory.sha256z" ] \
  || fatal "runtime-file archive is missing its manifest or inventory"
runtime_unsafe_nodes="$WORK_DIR/runtime-files/unsafe-nodes"
find "$WORK_DIR/runtime-files/uploads" "$WORK_DIR/runtime-files/help-videos" \
  \( -type l -o \( ! -type f ! -type d \) \) -print -quit >"$runtime_unsafe_nodes" \
  || fatal "restored runtime-file tree could not be inventoried safely"
if [ -s "$runtime_unsafe_nodes" ]; then
  fatal "restored runtime-file tree contains a symlink or special file"
fi
awk '
  !/^[A-Z][A-Z0-9_]*=[[:print:]]+$/ { bad=1; next }
  { key=$0; sub(/=.*/, "", key); if (seen[key]++) bad=1 }
  END { if (NR != 7 || bad) exit 1 }
' "$WORK_DIR/runtime-files/manifest.env" \
  || fatal "runtime-file manifest is malformed"
runtime_manifest_inventory="$(awk -F= '$1 == "INVENTORY_SHA256" {print $2}' "$WORK_DIR/runtime-files/manifest.env")"
runtime_manifest_count="$(awk -F= '$1 == "FILE_COUNT" {print $2}' "$WORK_DIR/runtime-files/manifest.env")"
[ "$(awk -F= '$1 == "FORMAT_VERSION" {print $2}' "$WORK_DIR/runtime-files/manifest.env")" = 1 ] \
  && [ "$(awk -F= '$1 == "SOURCE_ROOT" {print $2}' "$WORK_DIR/runtime-files/manifest.env")" = /var/lib/leaddrive-v2 ] \
  && [ "$(awk -F= '$1 == "SOURCE_PATHS" {print $2}' "$WORK_DIR/runtime-files/manifest.env")" = uploads,help-videos ] \
  && [ "$runtime_manifest_inventory" = "$RUNTIME_FILES_EXPECTED_INVENTORY_SHA256" ] \
  && [ "$runtime_manifest_count" = "$RUNTIME_FILES_EXPECTED_FILE_COUNT" ] \
  && [ "$(awk -F= '$1 == "SOURCE_BYTES" {print $2}' "$WORK_DIR/runtime-files/manifest.env")" = "$RUNTIME_FILES_EXPECTED_SOURCE_BYTES" ] \
  && [ "$(sha256sum "$WORK_DIR/runtime-files/inventory.sha256z" | awk '{print $1}')" = "$runtime_manifest_inventory" ] \
  || fatal "runtime-file manifest does not match the commissioned candidate"
node - "$WORK_DIR/runtime-files/inventory.sha256z" "$runtime_manifest_count" <<'NODE'
const fs = require("node:fs")
const [file, expectedRaw] = process.argv.slice(2)
const records = fs.readFileSync(file).toString("utf8").split("\0")
if (records.at(-1) !== "") throw new Error("inventory is not NUL terminated")
records.pop()
if (!/^\d+$/.test(expectedRaw) || records.length !== Number(expectedRaw)) {
  throw new Error("inventory file count differs from the manifest")
}
const seen = new Set()
for (const record of records) {
  const match = /^([0-9a-f]{64})  ((?:uploads|help-videos)\/(.+))$/u.exec(record)
  if (!match) throw new Error("inventory record has an unsafe shape")
  const path = match[2]
  if (path.includes("\n") || path.includes("\r") || path.includes("\t")
      || path.split("/").some((part) => part === "" || part === "." || part === "..")
      || seen.has(path)) {
    throw new Error("inventory path is unsafe or duplicated")
  }
  seen.add(path)
}
NODE
(
  cd "$WORK_DIR/runtime-files"
  if ! find uploads help-videos -xdev -type f -print0 > inventory.paths; then
    exit 1
  fi
  LC_ALL=C sort -z < inventory.paths \
    | xargs -0 -r sha256sum -z > inventory.actual.sha256z
  cmp -s -- inventory.sha256z inventory.actual.sha256z
) || fatal "restored runtime-file inventory or content checksum does not match"
runtime_files_manifest_sha256="$(sha256sum "$WORK_DIR/runtime-files/manifest.env" | awk '{print $1}')"

unset VERIFY_ALLOW_SOURCE_CLUSTER
case "${VERIFY_PGSSLMODE:-verify-full}" in
  verify-full) unset VERIFY_OFFLINE_LOOPBACK_PLAINTEXT ;;
  disable) export VERIFY_OFFLINE_LOOPBACK_PLAINTEXT=1 ;;
  *) fatal "offline scratch VERIFY_PGSSLMODE must be verify-full or explicit loopback disable" ;;
esac
restore_log="$WORK_DIR/restore-proof.log"
if ! TMPDIR="$WORK_DIR" "$SCRIPT_DIR/postgres-restore-canary.sh" \
  "$WORK_DIR/database/database.dump" "$WORK_DIR/database/source-canary.tsv" \
  "$source_system_identifier" "$WORK_DIR/database/authority.tsv" \
  "$WORK_DIR/database/migration-ledger.tsv" "$WORK_DIR/database/recovery-db-contract.tsv" \
  "$app_env_recovered" >"$restore_log" 2>&1; then
  fatal "independent scratch restore, tenant canary, or secret recovery proof failed"
fi
grep -Fq '[restore-canary] restore canary passed' "$restore_log" \
  && grep -Fq '[restore-canary] restored Prisma migration ledger proof passed' "$restore_log" \
  && grep -Fq '[restore-canary] restored applied migrations match the recovery DB contract' "$restore_log" \
  && grep -Fq '[restore-canary] restored RLS/FORCE RLS catalog proof passed' "$restore_log" \
  && grep -Fq '[pii-restore-proof] encrypted PII decrypt passed' "$restore_log" \
  || fatal "scratch restore output has no tenant, RLS/FORCE RLS, and real PII decrypt proof"
if [ "$(grep -Fxc '[pii-restore-proof] INTEGRATION_TOKEN_DECRYPT_STATUS=passed' "$restore_log")" = "1" ]; then
  integration_token_status="passed"
elif [ "$(grep -Fxc '[pii-restore-proof] INTEGRATION_TOKEN_DECRYPT_STATUS=not_applicable_no_persisted_ciphertext' "$restore_log")" = "1" ]; then
  integration_token_status="not_applicable_no_persisted_ciphertext"
else
  fatal "scratch restore output has no integration-token recovery status"
fi

database_manifest_sha256="$(sha256sum "$WORK_DIR/database/manifest.env" | awk '{print $1}')"
source_canary_sha256="$(sha256sum "$WORK_DIR/database/source-canary.tsv" | awk '{print $1}')"
secrets_manifest_sha256="$(sha256sum "$WORK_DIR/secrets/manifest.txt" | awk '{print $1}')"
verified_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
evidence_file="$WORK_DIR/evidence.env"
[ "$(sha256sum "$RUNNING_VERIFIER_FILE" | awk '{print $1}')" = "$archive_verifier_sha256" ] \
  || fatal "the running verifier file changed while offline verification was in progress"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  evidence_format_version=2
  recovery_scope=full-recovery
else
  evidence_format_version=1
  recovery_scope=log-genesis-bootstrap-only
fi
{
printf '%s\n' \
  "FORMAT_VERSION=$evidence_format_version" \
  'EVIDENCE_TYPE=archive-restore' \
  'STATUS=verified' \
  "RECOVERY_SCOPE=$recovery_scope" \
  "CANDIDATE_SHA256=$EXPECTED_CANDIDATE_SHA256" \
  "DATABASE_CIPHERTEXT_SHA256=$actual_database_sha256" \
  "SECRETS_CIPHERTEXT_SHA256=$actual_secrets_sha256" \
  "RUNTIME_FILES_CIPHERTEXT_SHA256=$actual_runtime_files_sha256" \
  "RECIPIENT_SHA256=$actual_recipient_sha256" \
  "OBJECT_BUCKET=$OBJECT_BUCKET" \
  "DATABASE_OBJECT_KEY=$DATABASE_OBJECT_KEY" \
  "DATABASE_OBJECT_VERSION_ID=$DATABASE_OBJECT_VERSION_ID" \
  "DATABASE_RETAIN_UNTIL=$DATABASE_RETAIN_UNTIL" \
  "SECRETS_OBJECT_KEY=$SECRETS_OBJECT_KEY" \
  "SECRETS_OBJECT_VERSION_ID=$SECRETS_OBJECT_VERSION_ID" \
  "SECRETS_RETAIN_UNTIL=$SECRETS_RETAIN_UNTIL" \
  "RUNTIME_FILES_OBJECT_KEY=$RUNTIME_FILES_OBJECT_KEY" \
  "RUNTIME_FILES_OBJECT_VERSION_ID=$RUNTIME_FILES_OBJECT_VERSION_ID" \
  "RUNTIME_FILES_RETAIN_UNTIL=$RUNTIME_FILES_RETAIN_UNTIL"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  printf '%s\n' \
    "LOG_GENESIS_ANCHOR_FORMAT_VERSION=$LOG_GENESIS_ANCHOR_FORMAT_VERSION" \
    "LOG_GENESIS_ANCHOR_STATUS=$LOG_GENESIS_ANCHOR_STATUS" \
    "LOG_GENESIS_ANCHOR_SHA256=$LOG_EVIDENCE_ANCHOR_SHA256" \
    "LOG_GENESIS_ANCHOR_BYTES=$LOG_GENESIS_ANCHOR_BYTES" \
    "LOG_GENESIS_EVIDENCE_START_AT=$LOG_EVIDENCE_START_AT" \
    "LOG_GENESIS_OBJECT_KEY=$LOG_OBJECT_KEY" \
    "LOG_GENESIS_OBJECT_VERSION_ID=$LOG_OBJECT_VERSION_ID" \
    "LOG_GENESIS_CIPHERTEXT_SHA256=$actual_log_sha256" \
    "LOG_GENESIS_CIPHERTEXT_BYTES=$LOG_EVIDENCE_FIRST_OBJECT_BYTES" \
    "LOG_GENESIS_OBJECT_FORMAT_VERSION=$LOG_EVIDENCE_OBJECT_FORMAT_VERSION" \
    "LOG_GENESIS_EVIDENCE_BOOTSTRAP=$LOG_GENESIS_EVIDENCE_BOOTSTRAP" \
    "LOG_GENESIS_BOOTSTRAP_DEPLOY_SHA=$LOG_EVIDENCE_BOOTSTRAP_DEPLOY_SHA" \
    "LOG_GENESIS_BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256=$LOG_EVIDENCE_BOOTSTRAP_PROGRAM_SHA256" \
    "LOG_GENESIS_RANGES_SHA256=$LOG_EVIDENCE_RANGES_SHA256" \
    "LOG_GENESIS_FILE_RANGE_COUNT=$LOG_EVIDENCE_FILE_RANGE_COUNT" \
    "LOG_GENESIS_FILE_RANGE_BYTES=$LOG_EVIDENCE_FILE_RANGE_BYTES" \
    "LOG_GENESIS_JOURNAL_RANGE_COUNT=$LOG_EVIDENCE_JOURNAL_RANGE_COUNT" \
    "LOG_GENESIS_CURSOR_SHA256=$LOG_EVIDENCE_CURSOR_SHA256" \
    "LOG_GENESIS_OBJECT_CREATED_AT=$LOG_EVIDENCE_OBJECT_CREATED_AT" \
    "LOG_GENESIS_RETAIN_UNTIL=$LOG_RETAIN_UNTIL" \
    "LOG_GENESIS_SHIP_LOGS_SHA256=$LOG_GENESIS_SHIP_LOGS_SHA256" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION=$BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256=$BOOTSTRAP_RECOVERY_CERTIFICATE_SHA256" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES=$BOOTSTRAP_RECOVERY_CERTIFICATE_BYTES" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256=$BOOTSTRAP_RECOVERY_CERTIFICATE_CANDIDATE_SHA256" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256=$BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_EVIDENCE_SHA256" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256=$BOOTSTRAP_RECOVERY_CERTIFICATE_SIGNED_SIGNATURE_SHA256" \
    "BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256=$BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256" \
    "LOG_GENESIS_MANIFEST_SHA256=$log_genesis_manifest_sha256" \
    "LOG_GENESIS_SHA256SUMS_SHA256=$log_genesis_checksums_sha256"
fi
printf '%s\n' \
  "DATABASE_MANIFEST_SHA256=$database_manifest_sha256" \
  "DATABASE_AUTHORITY_CATALOG_SHA256=$database_authority_sha256" \
  "SOURCE_MIGRATION_LEDGER_SHA256=$database_migration_ledger_sha256" \
  "SECRETS_MANIFEST_SHA256=$secrets_manifest_sha256" \
  "RUNTIME_FILES_MANIFEST_SHA256=$runtime_files_manifest_sha256" \
  "RUNTIME_FILES_INVENTORY_SHA256=$runtime_manifest_inventory" \
  "RUNTIME_FILES_FILE_COUNT=$runtime_manifest_count" \
  "SOURCE_CANARY_SHA256=$source_canary_sha256" \
  "SOURCE_SYSTEM_IDENTIFIER=$source_system_identifier" \
  "SOURCE_DATABASE_IDENTITY_SHA256=$SOURCE_DATABASE_IDENTITY_SHA256" \
  "COMMISSION_CODE_BUNDLE_SHA256=$COMMISSION_CODE_BUNDLE_SHA256" \
  "RECOVERY_PROGRAM_SET_SHA256=$RECOVERY_PROGRAM_SET_SHA256" \
  "RECOVERY_DB_CONTRACT_SHA256=$RECOVERY_DB_CONTRACT_SHA256" \
  "SOURCE_APP_ENV_SHA256=$app_env_sha256" \
  "SOURCE_BACKUP_ENV_SHA256=$backup_env_sha256" \
  "SOURCE_MIGRATION_ENV_SHA256=$migration_env_sha256" \
  "ARCHIVE_VERIFIER_SHA256=$archive_verifier_sha256" \
  "RESTORE_CANARY_SHA256=$restore_canary_sha256" \
  "PII_PROOF_SHA256=$pii_proof_sha256" \
  "CANARY_SQL_SHA256=$canary_sql_sha256" \
  "REVIEWED_MAIN_SHA=$REVIEWED_MAIN_SHA" \
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
  "INTEGRATION_TOKEN_DECRYPT_STATUS=$integration_token_status"
if [ "$CANDIDATE_FORMAT_VERSION" = 3 ]; then
  printf '%s\n' \
    'LOG_GENESIS_DECRYPT_STATUS=passed' \
    'LOG_GENESIS_ARCHIVE_LAYOUT_STATUS=passed' \
    'LOG_GENESIS_INTERNAL_CHECKSUM_STATUS=passed' \
    'LOG_GENESIS_RANGES_STATUS=passed' \
    'LOG_GENESIS_CURSOR_STATUS=passed' \
    'LOG_GENESIS_ANCHOR_BINDING_STATUS=passed'
fi
printf '%s\n' \
  'DATABASE_STORAGE_ATTESTATION=DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED' \
  "EVIDENCE_REF=$EVIDENCE_REF" \
  "OFFLINE_OPERATOR=$OFFLINE_OPERATOR" \
  "VERIFIED_AT_UTC=$verified_at"
} >"$evidence_file"
chmod 0600 "$evidence_file"

ssh-keygen -Y sign -f "$SIGNING_KEY_FILE" \
  -n leaddrive-backup-evidence "$evidence_file" >/dev/null \
  || fatal "offline evidence signing failed"
[ -s "$evidence_file.sig" ] || fatal "offline evidence signature is missing"
install -d -m 0700 "$WORK_DIR/bundle"
install -m 0600 "$evidence_file" "$WORK_DIR/bundle/evidence.env"
install -m 0600 "$evidence_file.sig" "$WORK_DIR/bundle/evidence.env.sig"
tar -C "$WORK_DIR/bundle" -cf "$WORK_DIR/evidence.bundle.tar" evidence.env evidence.env.sig
base64 --wrap=0 "$WORK_DIR/evidence.bundle.tar" >"$WORK_DIR/evidence.bundle.b64"

OUTPUT_STAGE_DIR="$(mktemp -d "$OUTPUT_PARENT_REAL/.leaddrive-offline-evidence-output.XXXXXX")"
chmod 0700 "$OUTPUT_STAGE_DIR"
install -m 0600 "$evidence_file" "$OUTPUT_STAGE_DIR/evidence.env"
install -m 0600 "$evidence_file.sig" "$OUTPUT_STAGE_DIR/evidence.env.sig"
install -m 0600 "$WORK_DIR/evidence.bundle.tar" "$OUTPUT_STAGE_DIR/evidence.bundle.tar"
install -m 0600 "$WORK_DIR/evidence.bundle.b64" "$OUTPUT_STAGE_DIR/evidence.bundle.b64"
sync -f -- "$OUTPUT_STAGE_DIR/evidence.env" "$OUTPUT_STAGE_DIR/evidence.env.sig" \
  "$OUTPUT_STAGE_DIR/evidence.bundle.tar" "$OUTPUT_STAGE_DIR/evidence.bundle.b64" \
  "$OUTPUT_STAGE_DIR" "$OUTPUT_PARENT_REAL"
ln -- "$OUTPUT_STAGE_DIR/evidence.env" "$OUTPUT_FILE" \
  || fatal "evidence output appeared concurrently; nothing was overwritten"
PUBLISHED_EVIDENCE=1
ln -- "$OUTPUT_STAGE_DIR/evidence.env.sig" "$OUTPUT_SIGNATURE" \
  || fatal "signature output appeared concurrently; published links were rolled back"
PUBLISHED_SIGNATURE=1
ln -- "$OUTPUT_STAGE_DIR/evidence.bundle.tar" "$OUTPUT_BUNDLE" \
  || fatal "bundle output appeared concurrently; published links were rolled back"
PUBLISHED_BUNDLE=1
ln -- "$OUTPUT_STAGE_DIR/evidence.bundle.b64" "$OUTPUT_BUNDLE_BASE64" \
  || fatal "base64 bundle output appeared concurrently; published links were rolled back"
PUBLISHED_BUNDLE_BASE64=1
sync -f -- "$OUTPUT_FILE" "$OUTPUT_SIGNATURE" "$OUTPUT_BUNDLE" \
  "$OUTPUT_BUNDLE_BASE64" "$OUTPUT_PARENT_REAL"
PUBLISHED=1

evidence_sha256="$(sha256sum "$OUTPUT_FILE" | awk '{print $1}')"
printf '[offline-backup-verify] decrypt, checksums, scratch restore, tenant canary and encrypted PII read passed\n'
printf '[offline-backup-verify] evidence_at_utc=%s\n' "$verified_at"
printf '[offline-backup-verify] signed_evidence_sha256=%s\n' "$evidence_sha256"
printf '[offline-backup-verify] bundle_base64_file=%s\n' "$OUTPUT_BUNDLE_BASE64"
printf '[offline-backup-verify] candidate_sha256=%s\n' "$EXPECTED_CANDIDATE_SHA256"
printf '[offline-backup-verify] recipient_sha256=%s\n' "$actual_recipient_sha256"
