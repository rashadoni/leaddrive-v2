#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# LeadDrive — encrypted snapshot of the environment secrets.
#
# Closes F-36 (docs/isms/ISMS-02-gap-analysis.md). The database backup is
# verified by restoring it and comparing canaries, which proves the dump comes
# back. It does not prove the data is READABLE: 41 PII columns are AES-256-GCM
# under a per-tenant key derived from TENANT_PII_MASTER_KEY, and every channel's
# OAuth tokens are sealed under a key derived from NEXTAUTH_SECRET. Both live in
# /etc/leaddrive/app.env, which no data-dump backup touches.
#
# Lose the server and the archive restores into a database whose personal-data
# columns are ciphertext and whose integrations are dead.
#
# WHY A SEPARATE OBJECT rather than another file inside the dump archive:
# app.env carries CLOUDFLARE_API_TOKEN, which grants the domain and the mail
# routing — more than the data it protects. A restore drill legitimately opens
# the dump; it should not hand the person running it control of the domain.
#
# Set SECRETS_AGE_RECIPIENT to seal this under a SECOND key if you want the
# drill and the secrets separated by key as well as by object. Defaults to the
# backup recipient: one key is simpler and one key is one thing to lose.
#
# Env: /etc/leaddrive/backup.env (BACKUP_AGE_RECIPIENT, BACKUP_S3_*)
# ═══════════════════════════════════════════════════════════
set -euo pipefail

MODE="upload"
if [ "${1:-}" = "--dry-run" ] && [ "$#" -eq 1 ]; then
  MODE="dry-run"
elif [ "$#" -ne 0 ]; then
  printf 'Usage: %s [--dry-run]\n' "$0" >&2
  exit 2
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/leaddrive/backup.env}"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
WORK_ROOT="${SECRETS_WORK_ROOT:-/run/leaddrive-secrets-snapshot}"
STATE_ROOT="/var/lib/leaddrive-secrets-snapshot"
LOCK_FILE="${SECRETS_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock}"
WORK_DIR=""
SUCCESS=0

# Fixed production recovery set. Its membership is code-reviewed; environment
# overrides could silently create a successful but incomplete secrets backup.
SECRET_FILES=(
  /etc/leaddrive/app.env
  /etc/leaddrive/backup.env
  /etc/leaddrive/migration.env
)

log()   { echo "[$(date '+%H:%M:%S')] $1"; }
fatal() { log "FATAL: $1"; exit 1; }

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fatal "$name is required (set it in $BACKUP_ENV_FILE)"
}

ping_healthcheck() {
  local suffix="${1:-}"
  [ -n "${SECRETS_HEALTHCHECK_URL:-}" ] || return 0
  curl --fail --silent --show-error --retry 2 --max-time 10 \
    "${SECRETS_HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$SUCCESS" -ne 1 ] || [ "$status" -ne 0 ]; then
    ping_healthcheck "/fail"
  fi
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf -- "$WORK_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

assert_tmpfs_work_root() {
  local canonical
  [ -d "$WORK_ROOT" ] && [ ! -L "$WORK_ROOT" ] \
    || fatal "secrets work root must be a real non-symlink directory"
  canonical="$(realpath -e -- "$WORK_ROOT")" \
    || fatal "cannot resolve secrets work root"
  [ "$canonical" = "$WORK_ROOT" ] \
    || fatal "secrets work root must resolve to its canonical reviewed path"
  [ "$(findmnt -n -o FSTYPE --target "$WORK_ROOT")" = "tmpfs" ] \
    || fatal "plaintext secrets staging must be backed by tmpfs"
}

assert_secret_source() {
  local file="$1"
  local owner group mode
  [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] \
    || fatal "required recovery file is missing, symlinked, or unreadable: $file"
  owner="$(stat -c '%U' "$file")"
  group="$(stat -c '%G' "$file")"
  mode="$(stat -c '%a' "$file")"
  [ "$owner" = "root" ] || fatal "required recovery file must be root-owned: $file"
  case "$file:$group:$mode" in
    /etc/leaddrive/app.env:root:600|/etc/leaddrive/migration.env:root:600) ;;
    /etc/leaddrive/backup.env:root:600|/etc/leaddrive/backup.env:leaddrive-backup:640) ;;
    *) fatal "required recovery file ownership or mode is unsafe: $file" ;;
  esac
}

file_generation() {
  local file="$1"
  printf '%s|%s' "$(stat -c '%d:%i:%s:%y' "$file")" \
    "$(sha256sum "$file" | awk '{print $1}')"
}

for c in age aws cp curl findmnt flock realpath sha256sum stat tar; do
  command -v "$c" >/dev/null 2>&1 || fatal "missing required command: $c"
done

[ -r "$BACKUP_ENV_FILE" ] || fatal "cannot read $BACKUP_ENV_FILE"
set -a
# shellcheck disable=SC1090
. "$BACKUP_ENV_FILE"
set +a

[ "$BACKUP_ENV_FILE" = "/etc/leaddrive/backup.env" ] \
  || fatal "BACKUP_ENV_FILE must remain /etc/leaddrive/backup.env"
[ "${APP_ENV_FILE:-/etc/leaddrive/app.env}" = "/etc/leaddrive/app.env" ] \
  || fatal "APP_ENV_FILE override is forbidden for production recovery"
[ "${SECRETS_WORK_ROOT:-/run/leaddrive-secrets-snapshot}" = "/run/leaddrive-secrets-snapshot" ] \
  && [ "$WORK_ROOT" = "/run/leaddrive-secrets-snapshot" ] \
  || fatal "SECRETS_WORK_ROOT override is forbidden"
[ "${SECRETS_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock}" = "/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock" ] \
  && [ "$LOCK_FILE" = "/var/lib/leaddrive-recovery-runner-locks/secrets-snapshot.lock" ] \
  || fatal "SECRETS_LOCK_FILE override is forbidden"
[ -z "${SECRETS_FILES:-}" ] \
  || fatal "SECRETS_FILES override is forbidden; the recovery set is code-reviewed"
[ -z "${SECRETS_DRY_RUN:-}" ] \
  || fatal "SECRETS_DRY_RUN environment override is forbidden; use --dry-run manually"
[ "${SECRETS_S3_PREFIX:-secrets}" = "secrets" ] \
  || fatal "SECRETS_S3_PREFIX must remain secrets"
require_env SECRETS_HEALTHCHECK_URL

[ -d "$STATE_ROOT" ] && [ ! -L "$STATE_ROOT" ] \
  && [ "$(realpath -e -- "$STATE_ROOT")" = "$STATE_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_ROOT" 2>/dev/null || true)" = root:root:700 ] \
  || fatal "secrets state root must be the reviewed root-owned persistent directory"
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
  && [ "$(realpath -e -- "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = /var/lib/leaddrive-recovery-runner-locks ] \
  && [ "$(stat -c '%U:%G:%a' "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = root:root:755 ] \
  && [ "$(stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null || true)" = root:root:600 ] \
  || fatal "secrets lock is missing, symlinked, or has unsafe ownership/mode"
exec 9<"$LOCK_FILE"
flock -n 9 || fatal "another snapshot run holds the lock"
[ "$(stat -Lc '%d:%i' "$LOCK_FILE" 2>/dev/null || true)" = \
  "$(stat -Lc '%d:%i' "/proc/$$/fd/9" 2>/dev/null || true)" ] \
  || fatal "secrets lock inode changed while it was acquired"

RECIPIENT="${SECRETS_AGE_RECIPIENT:-${BACKUP_AGE_RECIPIENT:-}}"
[ -n "$RECIPIENT" ] || fatal "no age recipient (SECRETS_AGE_RECIPIENT or BACKUP_AGE_RECIPIENT)"
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_BUCKET

S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
# Matches the longest database retention: a rotated key must stay recoverable
# for as long as the oldest archive it can open.
RETENTION_DAYS="${SECRETS_RETENTION_DAYS:-400}"
case "$RETENTION_DAYS" in ''|*[!0-9]*) fatal "SECRETS_RETENTION_DAYS must be a number" ;; esac
MONTHLY_RETENTION_DAYS="${BACKUP_RETENTION_MONTHLY_DAYS:-400}"
case "$MONTHLY_RETENTION_DAYS" in ''|*[!0-9]*) fatal "BACKUP_RETENTION_MONTHLY_DAYS must be a number" ;; esac
[ "$MONTHLY_RETENTION_DAYS" -ge 400 ] \
  || fatal "monthly database retention must be at least 400 days"
[ "$RETENTION_DAYS" -ge "$MONTHLY_RETENTION_DAYS" ] \
  || fatal "secrets retention must cover the longest database retention"

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
umask 077
mkdir -p -- "$WORK_ROOT"
assert_tmpfs_work_root
WORK_DIR="$(mktemp -d "$WORK_ROOT/secrets-${TIMESTAMP}.XXXXXX")"
# Plaintext exists only inside this tmpfs directory and only until cleanup.
BUNDLE="$WORK_DIR/bundle"
mkdir -p -- "$BUNDLE"

MANIFEST="$BUNDLE/manifest.txt"
{
  echo "TIMESTAMP=$TIMESTAMP"
  echo "HOSTNAME=$(hostname)"
  echo "FORMAT_VERSION=1"
} > "$MANIFEST"

declare -A source_generation_before=()
declare -A source_sha256=()
for f in "${SECRET_FILES[@]}"; do
  assert_secret_source "$f"
  source_generation_before["$f"]="$(file_generation "$f")"
  source_sha256["$f"]="${source_generation_before[$f]##*|}"
done

copied=0
for f in "${SECRET_FILES[@]}"; do
  dest="$BUNDLE/$(echo "$f" | sed 's|^/||; s|/|__|g')"
  cp -- "$f" "$dest"
  copied_sha="$(sha256sum "$dest" | awk '{print $1}')"
  [ "$copied_sha" = "${source_sha256[$f]}" ] \
    || fatal "required recovery file changed while it was copied: $f"
  # Fingerprints let you tell whether a snapshot is current WITHOUT decrypting
  # it — the whole point of recording them outside the ciphertext as well.
  echo "FILE $f sha256=$copied_sha bytes=$(wc -c <"$dest" | tr -d '[:space:]')" >> "$MANIFEST"
  copied=$((copied + 1))
done
[ "$copied" -eq "${#SECRET_FILES[@]}" ] \
  || fatal "fixed recovery set was not copied completely"
for f in "${SECRET_FILES[@]}"; do
  [ "$(file_generation "$f")" = "${source_generation_before[$f]}" ] \
    || fatal "required recovery file changed during the snapshot generation: $f"
done

APP_ENV_SHA256="${source_sha256[/etc/leaddrive/app.env]}"
BACKUP_ENV_SHA256="${source_sha256[/etc/leaddrive/backup.env]}"
MIGRATION_ENV_SHA256="${source_sha256[/etc/leaddrive/migration.env]}"

PACKAGE="$WORK_DIR/leaddrive-secrets-${TIMESTAMP}.tar"
ENCRYPTED="$PACKAGE.age"
tar -C "$BUNDLE" -cf "$PACKAGE" .
age --recipient "$RECIPIENT" --output "$ENCRYPTED" "$PACKAGE"
rm -f -- "$PACKAGE"

BYTES="$(wc -c <"$ENCRYPTED" | tr -d '[:space:]')"
SHA="$(sha256sum "$ENCRYPTED" | awk '{print $1}')"

# Dry run stops here: everything above is local and reversible, everything below
# creates an object that Object Lock keeps for 400 days. Validate first.
if [ "$MODE" = "dry-run" ]; then
  log "DRY RUN — not uploading. Bundle contents (fingerprints only, no values):"
  sed 's/^/  /' "$MANIFEST"
  log "encrypted size: $BYTES bytes, sha256=$SHA"
  SUCCESS=1
  exit 0
fi

S3=(--endpoint-url "$BACKUP_S3_ENDPOINT" --region "$S3_REGION" --no-cli-pager)
lock_state="$(aws s3api get-object-lock-configuration "${S3[@]}" --bucket "$BACKUP_S3_BUCKET" \
  --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode]' --output text)"
read -r lock_enabled lock_mode <<<"$lock_state"
[ "$lock_enabled" = "Enabled" ] || fatal "S3 bucket Object Lock is not enabled"
[ "$lock_mode" = "COMPLIANCE" ] || fatal "S3 bucket default retention must use COMPLIANCE mode"

IFS= read -r OBJECT_NONCE </proc/sys/kernel/random/uuid \
  || fatal "cannot allocate a cryptographically random object-key nonce"
[[ "$OBJECT_NONCE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fatal "kernel object-key nonce has an unexpected format"
KEY="${SECRETS_S3_PREFIX:-secrets}/$(date -u '+%Y/%m')/leaddrive-secrets-${TIMESTAMP}-${OBJECT_NONCE}.tar.age"
log "uploading encrypted secrets snapshot to s3://$BACKUP_S3_BUCKET/$KEY"
aws s3 cp "$ENCRYPTED" "s3://$BACKUP_S3_BUCKET/$KEY" "${S3[@]}" \
  --only-show-errors --no-progress \
  --metadata "sha256=$SHA,files=$copied,format-version=1,app_env_sha256=$APP_ENV_SHA256,backup_env_sha256=$BACKUP_ENV_SHA256,migration_env_sha256=$MIGRATION_ENV_SHA256"

head_state="$(aws s3api head-object "${S3[@]}" --bucket "$BACKUP_S3_BUCKET" --key "$KEY" \
  --query '[ContentLength,VersionId,Metadata.sha256,Metadata.app_env_sha256,Metadata.backup_env_sha256,Metadata.migration_env_sha256]' --output text)"
read -r remote_bytes version_id remote_sha remote_app_sha remote_backup_sha remote_migration_sha <<<"$head_state"
[ "$remote_bytes" = "$BYTES" ] || fatal "uploaded size mismatch: local=$BYTES remote=$remote_bytes"
[ "$remote_sha" = "$SHA" ] || fatal "uploaded SHA-256 metadata mismatch"
[ "$remote_app_sha" = "$APP_ENV_SHA256" ] \
  && [ "$remote_backup_sha" = "$BACKUP_ENV_SHA256" ] \
  && [ "$remote_migration_sha" = "$MIGRATION_ENV_SHA256" ] \
  || fatal "uploaded source-secret fingerprints do not match the stable local generation"
[ -n "$version_id" ] && [ "$version_id" != "None" ] || fatal "no version ID; Object Lock may be misconfigured"

RETAIN_UNTIL="$(date -u -d "+${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ')"
# --version-id=VALUE, not --version-id VALUE: S3 version IDs may begin with a
# hyphen (observed: -TG2lbh8Z9QB5M8XlkzgGCRkYgNG08D), and argparse then reads the
# value as the next option and fails with "expected one argument". It is
# intermittent — roughly one upload in thirty — so it looks like a transient S3
# problem rather than a quoting bug, and the object silently keeps only the
# bucket's default retention instead of the one this script meant to set.
aws s3api put-object-retention "${S3[@]}" --bucket "$BACKUP_S3_BUCKET" --key "$KEY" \
  --version-id="$version_id" --retention "Mode=COMPLIANCE,RetainUntilDate=$RETAIN_UNTIL" >/dev/null

retention_state="$(aws s3api get-object-retention "${S3[@]}" \
  --bucket "$BACKUP_S3_BUCKET" --key "$KEY" --version-id="$version_id" \
  --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)"
read -r remote_mode remote_until <<<"$retention_state"
[ "$remote_mode" = "COMPLIANCE" ] \
  || fatal "uploaded secrets object is not COMPLIANCE-locked"
requested_retention_epoch="$(date -u -d "$RETAIN_UNTIL" '+%s' 2>/dev/null)" \
  || fatal "requested secrets-retention deadline is invalid"
remote_retention_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null)" \
  || fatal "uploaded secrets object retain-until date is invalid"
[ "$remote_retention_epoch" -ge "$requested_retention_epoch" ] \
  || fatal "uploaded secrets retention is shorter than the reviewed recovery policy"

SUCCESS=1
ping_healthcheck
log "SUMMARY key=$KEY version=$version_id files=$copied retention_days=$RETENTION_DAYS bytes=$BYTES sha256=$SHA retain_until=$remote_until app_env_sha256=$APP_ENV_SHA256 backup_env_sha256=$BACKUP_ENV_SHA256 migration_env_sha256=$MIGRATION_ENV_SHA256"
