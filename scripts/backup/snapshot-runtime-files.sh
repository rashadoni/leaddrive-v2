#!/usr/bin/env bash
# LeadDrive authoritative runtime-file backup.
#
# PostgreSQL contains references to contracts, MTM photos, inbox attachments,
# avatars and channel media, but the bytes themselves live below the fixed
# production runtime root.  This job creates a content-inventoried, age-
# encrypted, version-bound and COMPLIANCE-locked offsite recovery object.  It
# never writes a plaintext tar archive to persistent storage.
set -Eeuo pipefail

umask 077

FORCE_RETENTION_TIER=""
if [ "${1:-}" = "--commission-monthly" ] && [ "$#" -eq 1 ]; then
  FORCE_RETENTION_TIER=monthly
elif [ "$#" -ne 0 ]; then
  printf 'Usage: %s [--commission-monthly]\n' "$0" >&2
  exit 2
fi

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/leaddrive/backup.env}"
SOURCE_ROOT="${RUNTIME_FILES_SOURCE_ROOT:-/var/lib/leaddrive-v2}"
STATE_ROOT="${RUNTIME_FILES_STATE_ROOT:-/var/lib/leaddrive-runtime-files-snapshot}"
WORK_ROOT="${RUNTIME_FILES_WORK_ROOT:-/run/leaddrive-runtime-files-snapshot}"
LOCK_FILE="${RUNTIME_FILES_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock}"
SOURCE_PATHS=(uploads help-videos)
WORK_DIR=""
ENCRYPTED_FILE=""
SUCCESS=0

log() { printf '[runtime-files-snapshot] %s\n' "$*"; }
fatal() { log "FATAL: $*" >&2; exit 1; }
require_env() { [ -n "${!1:-}" ] || fatal "$1 is required"; }

ping_healthcheck() {
  local suffix="${1:-}"
  [ -n "${RUNTIME_FILES_HEALTHCHECK_URL:-}" ] || return 0
  curl --fail --silent --show-error --retry 2 --max-time 10 \
    "${RUNTIME_FILES_HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$SUCCESS" -ne 1 ] || [ "$status" -ne 0 ]; then
    ping_healthcheck /fail
  fi
  if [ -n "$ENCRYPTED_FILE" ]; then
    case "$ENCRYPTED_FILE" in
      "$STATE_ROOT"/.runtime-files-*.tar.age.stage) rm -f -- "$ENCRYPTED_FILE" ;;
      *) log "REFUSED unexpected ciphertext cleanup path: $ENCRYPTED_FILE" >&2 ;;
    esac
  fi
  if [ -n "$WORK_DIR" ]; then
    case "$WORK_DIR" in
      "$WORK_ROOT"/runtime-files-*) rm -rf --one-file-system -- "$WORK_DIR" ;;
      *) log "REFUSED unexpected work cleanup path: $WORK_DIR" >&2 ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT

for command_name in age awk aws cmp curl date df du find findmnt flock realpath sha256sum sort stat sync tar xargs; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fatal "missing required command: $command_name"
done

[ -r "$BACKUP_ENV_FILE" ] || fatal "cannot read $BACKUP_ENV_FILE"
set -a
# shellcheck disable=SC1090
. "$BACKUP_ENV_FILE"
set +a

[ "$BACKUP_ENV_FILE" = /etc/leaddrive/backup.env ] \
  || fatal "BACKUP_ENV_FILE must remain /etc/leaddrive/backup.env"
[ "${RUNTIME_FILES_SOURCE_ROOT:-/var/lib/leaddrive-v2}" = /var/lib/leaddrive-v2 ] \
  && [ "$SOURCE_ROOT" = /var/lib/leaddrive-v2 ] \
  || fatal "RUNTIME_FILES_SOURCE_ROOT override is forbidden"
[ "${RUNTIME_FILES_STATE_ROOT:-/var/lib/leaddrive-runtime-files-snapshot}" = /var/lib/leaddrive-runtime-files-snapshot ] \
  && [ "$STATE_ROOT" = /var/lib/leaddrive-runtime-files-snapshot ] \
  || fatal "RUNTIME_FILES_STATE_ROOT override is forbidden"
[ "${RUNTIME_FILES_WORK_ROOT:-/run/leaddrive-runtime-files-snapshot}" = /run/leaddrive-runtime-files-snapshot ] \
  && [ "$WORK_ROOT" = /run/leaddrive-runtime-files-snapshot ] \
  || fatal "RUNTIME_FILES_WORK_ROOT override is forbidden"
[ "${RUNTIME_FILES_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock}" = /var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock ] \
  && [ "$LOCK_FILE" = /var/lib/leaddrive-recovery-runner-locks/runtime-files-snapshot.lock ] \
  || fatal "RUNTIME_FILES_LOCK_FILE override is forbidden"
[ -z "${RUNTIME_FILES_PATHS:-}" ] \
  || fatal "RUNTIME_FILES_PATHS override is forbidden; the authoritative set is code-reviewed"
[ "${RUNTIME_FILES_S3_PREFIX:-runtime-files}" = runtime-files ] \
  || fatal "RUNTIME_FILES_S3_PREFIX must remain runtime-files"

require_env BACKUP_AGE_RECIPIENT
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_REGION
require_env BACKUP_S3_BUCKET
require_env AWS_ACCESS_KEY_ID
require_env AWS_SECRET_ACCESS_KEY
require_env RUNTIME_FILES_HEALTHCHECK_URL
[ "${BACKUP_ENCRYPTION:-age}" = age ] \
  || fatal "runtime-file upload requires BACKUP_ENCRYPTION=age"
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] \
  || fatal "runtime-file snapshot requires one native age X25519 recipient"

for policy in \
  "${BACKUP_RETENTION_DAILY_DAYS:-16}:16:daily" \
  "${BACKUP_RETENTION_WEEKLY_DAYS:-63}:63:weekly" \
  "${BACKUP_RETENTION_MONTHLY_DAYS:-400}:400:monthly"; do
  IFS=: read -r configured minimum label <<<"$policy"
  [[ "$configured" =~ ^[0-9]+$ ]] && [ "$configured" -ge "$minimum" ] \
    || fatal "$label runtime-file retention is below the reviewed minimum"
done

mkdir -p -- "$WORK_ROOT" "$STATE_ROOT"
for directory in "$SOURCE_ROOT" "$WORK_ROOT" "$STATE_ROOT"; do
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(realpath -e -- "$directory")" = "$directory" ] \
    || fatal "required directory must be real and canonical: $directory"
done
[ "$(findmnt -n -o FSTYPE --target "$WORK_ROOT")" = tmpfs ] \
  || fatal "runtime-file inventory staging must be backed by tmpfs"
for relative in "${SOURCE_PATHS[@]}"; do
  [ -d "$SOURCE_ROOT/$relative" ] && [ ! -L "$SOURCE_ROOT/$relative" ] \
    || fatal "authoritative runtime-file directory is missing or symlinked: $relative"
  nested_mount="$(findmnt -rn -o TARGET | awk -v root="$SOURCE_ROOT/$relative/" '
    index($0, root) == 1 { print; exit }
  ')"
  [ -z "$nested_mount" ] \
    || fatal "authoritative runtime-file directory contains an unreviewed nested mount: $nested_mount"
done
unset nested_mount

[ "$(stat -c '%U:%G:%a' "$STATE_ROOT" 2>/dev/null || true)" = root:root:700 ] \
  || fatal "runtime-file state root has unsafe ownership/mode"
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
  && [ "$(realpath -e -- "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = /var/lib/leaddrive-recovery-runner-locks ] \
  && [ "$(stat -c '%U:%G:%a' "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = root:root:755 ] \
  && [ "$(stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null || true)" = root:root:600 ] \
  || fatal "runtime-file lock is missing, symlinked, or has unsafe ownership/mode"
exec 9<"$LOCK_FILE"
flock -n 9 || fatal "another runtime-file snapshot holds the lock"
[ "$(stat -Lc '%d:%i' "$LOCK_FILE" 2>/dev/null || true)" = \
  "$(stat -Lc '%d:%i' "/proc/$$/fd/9" 2>/dev/null || true)" ] \
  || fatal "runtime-file lock inode changed while it was acquired"

if find "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" -xdev \
    \( -type l -o \( ! -type f ! -type d \) \) -print -quit | grep -q .; then
  fatal "authoritative runtime-file tree contains a symlink or special file"
fi
if find "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" -xdev -type f -links +1 -print -quit | grep -q .; then
  fatal "authoritative runtime-file tree contains a multiply-linked file"
fi

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
IFS= read -r OBJECT_NONCE </proc/sys/kernel/random/uuid \
  || fatal "cannot allocate an object-key nonce"
[[ "$OBJECT_NONCE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fatal "kernel object-key nonce has an unexpected format"
WORK_DIR="$(mktemp -d "$WORK_ROOT/runtime-files-${TIMESTAMP}.XXXXXX")"
ENTRY_LIST="$WORK_DIR/source-entries.nul"
find "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" -xdev -print0 >"$ENTRY_LIST" \
  || fatal "cannot enumerate the complete authoritative runtime-file set"
while IFS= read -r -d '' source_entry; do
  [[ "$source_entry" != *$'\n'* ]] \
    && [[ "$source_entry" != *$'\r'* ]] \
    && [[ "$source_entry" != *$'\t'* ]] \
    || fatal "runtime-file path contains a control character unsupported by the recovery catalog"
done <"$ENTRY_LIST"
INVENTORY_BEFORE="$WORK_DIR/inventory.sha256z"
INVENTORY_AFTER="$WORK_DIR/inventory.after.sha256z"
MANIFEST="$WORK_DIR/manifest.env"
ENCRYPTED_FILE="$STATE_ROOT/.runtime-files-${TIMESTAMP}-${OBJECT_NONCE}.tar.age.stage"
[ ! -e "$ENCRYPTED_FILE" ] && [ ! -L "$ENCRYPTED_FILE" ] \
  || fatal "runtime-file ciphertext stage already exists"

create_inventory() {
  local destination="$1"
  (
    cd "$SOURCE_ROOT"
    find "${SOURCE_PATHS[@]}" -xdev -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum -z
  ) >"$destination"
}

create_inventory "$INVENTORY_BEFORE"
FILE_COUNT="$(tr -cd '\0' <"$INVENTORY_BEFORE" | wc -c | tr -d '[:space:]')"
SOURCE_BYTES="$(du -sb --apparent-size "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" \
  | awk '{ total += $1 } END { printf "%.0f", total }')"
[[ "$FILE_COUNT" =~ ^[0-9]+$ ]] && [[ "$SOURCE_BYTES" =~ ^[0-9]+$ ]] \
  || fatal "runtime-file inventory returned invalid counts"
CAPACITY_RATIO_PERCENT="${RUNTIME_FILES_CAPACITY_RATIO_PERCENT:-110}"
MIN_FREE_BYTES="${RUNTIME_FILES_MIN_FREE_BYTES:-1073741824}"
[[ "$CAPACITY_RATIO_PERCENT" =~ ^[0-9]+$ ]] && [ "$CAPACITY_RATIO_PERCENT" -ge 110 ] \
  || fatal "RUNTIME_FILES_CAPACITY_RATIO_PERCENT must be at least 110"
[[ "$MIN_FREE_BYTES" =~ ^[0-9]+$ ]] && [ "$MIN_FREE_BYTES" -ge 1073741824 ] \
  || fatal "RUNTIME_FILES_MIN_FREE_BYTES must be at least 1073741824"
REQUIRED_FREE=$((SOURCE_BYTES * CAPACITY_RATIO_PERCENT / 100 + 536870912))
[ "$REQUIRED_FREE" -ge "$MIN_FREE_BYTES" ] || REQUIRED_FREE="$MIN_FREE_BYTES"
AVAILABLE_FREE="$(df -B1 --output=avail "$STATE_ROOT" | tail -n 1 | tr -d '[:space:]')"
[[ "$AVAILABLE_FREE" =~ ^[0-9]+$ ]] && [ "$AVAILABLE_FREE" -ge "$REQUIRED_FREE" ] \
  || fatal "insufficient disk for the temporary encrypted runtime-file archive"

INVENTORY_SHA256="$(sha256sum "$INVENTORY_BEFORE" | awk '{print $1}')"
printf '%s\n' \
  'FORMAT_VERSION=1' \
  "CREATED_AT_UTC=$TIMESTAMP" \
  'SOURCE_ROOT=/var/lib/leaddrive-v2' \
  'SOURCE_PATHS=uploads,help-videos' \
  "FILE_COUNT=$FILE_COUNT" \
  "SOURCE_BYTES=$SOURCE_BYTES" \
  "INVENTORY_SHA256=$INVENTORY_SHA256" \
  >"$MANIFEST"

log "encrypting stable runtime-file set ($FILE_COUNT files, $SOURCE_BYTES bytes)"
tar --format=pax --numeric-owner --xattrs --acls --sort=name --one-file-system \
  -C "$SOURCE_ROOT" -cf - "${SOURCE_PATHS[@]}" \
  -C "$WORK_DIR" manifest.env inventory.sha256z \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$ENCRYPTED_FILE"

create_inventory "$INVENTORY_AFTER"
cmp -s -- "$INVENTORY_BEFORE" "$INVENTORY_AFTER" \
  || fatal "runtime-file tree changed during snapshot; refusing a mixed-generation archive"
if find "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" -xdev \
    \( -type l -o \( ! -type f ! -type d \) \) -print -quit | grep -q .; then
  fatal "runtime-file tree type changed during snapshot"
fi
if find "${SOURCE_PATHS[@]/#/$SOURCE_ROOT/}" -xdev -type f -links +1 -print -quit | grep -q .; then
  fatal "runtime-file tree gained a multiply-linked file during snapshot"
fi

MONTH_KEY="$(date -u '+%Y-%m')"
WEEK_KEY="$(date -u '+%G-W%V')"
MONTH_MARKER="$STATE_ROOT/last-monthly-period"
WEEK_MARKER="$STATE_ROOT/last-weekly-period"
if [ -n "$FORCE_RETENTION_TIER" ]; then
  TIER="$FORCE_RETENTION_TIER"
elif [ "$(cat "$MONTH_MARKER" 2>/dev/null || true)" != "$MONTH_KEY" ]; then
  TIER=monthly
elif [ "$(cat "$WEEK_MARKER" 2>/dev/null || true)" != "$WEEK_KEY" ]; then
  TIER=weekly
else
  TIER=daily
fi
case "$TIER" in
  monthly) RETENTION_DAYS="${BACKUP_RETENTION_MONTHLY_DAYS:-400}" ;;
  weekly) RETENTION_DAYS="${BACKUP_RETENTION_WEEKLY_DAYS:-63}" ;;
  daily) RETENTION_DAYS="${BACKUP_RETENTION_DAILY_DAYS:-16}" ;;
  *) fatal "invalid runtime-file retention tier" ;;
esac

ENCRYPTED_BYTES="$(wc -c <"$ENCRYPTED_FILE" | tr -d '[:space:]')"
ENCRYPTED_SHA256="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"
S3_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" --no-cli-pager)
lock_state="$(aws s3api get-object-lock-configuration "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" \
  --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]' \
  --output text)"
read -r lock_enabled lock_mode lock_days <<<"$lock_state"
[ "$lock_enabled:$lock_mode" = Enabled:COMPLIANCE ] \
  && [[ "$lock_days" =~ ^[0-9]+$ ]] && [ "$lock_days" -ge 14 ] \
  || fatal "S3 bucket Object Lock is not COMPLIANCE for at least 14 days"

OBJECT_KEY="${RUNTIME_FILES_S3_PREFIX:-runtime-files}/$TIER/$(date -u '+%Y/%m')/leaddrive-runtime-files-${TIMESTAMP}-${OBJECT_NONCE}.tar.age"
log "uploading encrypted runtime files to s3://$BACKUP_S3_BUCKET/$OBJECT_KEY"
aws s3 cp "$ENCRYPTED_FILE" "s3://$BACKUP_S3_BUCKET/$OBJECT_KEY" \
  "${S3_ARGS[@]}" --only-show-errors --no-progress \
  --metadata "sha256=$ENCRYPTED_SHA256,tier=$TIER,format-version=1,files=$FILE_COUNT,inventory_sha256=$INVENTORY_SHA256"
head_state="$(aws s3api head-object "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" \
  --query '[ContentLength,VersionId,Metadata.sha256,Metadata.tier,Metadata.files,Metadata.inventory_sha256]' \
  --output text)"
read -r remote_bytes version_id remote_sha remote_tier remote_files remote_inventory <<<"$head_state"
[ "$remote_bytes" = "$ENCRYPTED_BYTES" ] \
  && [ "$remote_sha" = "$ENCRYPTED_SHA256" ] \
  && [ "$remote_tier" = "$TIER" ] \
  && [ "$remote_files" = "$FILE_COUNT" ] \
  && [ "$remote_inventory" = "$INVENTORY_SHA256" ] \
  && [ -n "$version_id" ] && [ "$version_id" != None ] \
  || fatal "uploaded runtime-file object metadata is incomplete or changed"

RETAIN_UNTIL="$(date -u -d "+${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ')"
aws s3api put-object-retention "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" --version-id="$version_id" \
  --retention "Mode=COMPLIANCE,RetainUntilDate=$RETAIN_UNTIL" >/dev/null
retention_state="$(aws s3api get-object-retention "${S3_ARGS[@]}" \
  --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" --version-id="$version_id" \
  --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)"
read -r remote_mode remote_until <<<"$retention_state"
requested_epoch="$(date -u -d "$RETAIN_UNTIL" '+%s')"
remote_epoch="$(date -u -d "$remote_until" '+%s')"
[ "$remote_mode" = COMPLIANCE ] && [ "$remote_epoch" -ge "$requested_epoch" ] \
  || fatal "runtime-file object retention is shorter than the selected policy"

case "$TIER" in
  monthly)
    printf '%s\n' "$MONTH_KEY" >"$MONTH_MARKER"
    sync -f -- "$MONTH_MARKER" "$STATE_ROOT" \
      || fatal "cannot persist the monthly runtime-file retention marker"
    ;;
  weekly)
    printf '%s\n' "$WEEK_KEY" >"$WEEK_MARKER"
    sync -f -- "$WEEK_MARKER" "$STATE_ROOT" \
      || fatal "cannot persist the weekly runtime-file retention marker"
    ;;
esac
rm -f -- "$ENCRYPTED_FILE"
ENCRYPTED_FILE=""
sync -f -- "$STATE_ROOT" || fatal "cannot persist runtime-file ciphertext cleanup"
SUCCESS=1
ping_healthcheck
log "SUMMARY key=$OBJECT_KEY version=$version_id tier=$TIER retention_days=$RETENTION_DAYS bytes=$ENCRYPTED_BYTES sha256=$ENCRYPTED_SHA256 retain_until=$remote_until files=$FILE_COUNT inventory_sha256=$INVENTORY_SHA256 source_bytes=$SOURCE_BYTES"
