#!/bin/bash
# ═══════════════════════════════════════════════════════════
# LeadDrive CRM v2 — off-box log shipping
#
# Closes F-02 (docs/isms/ISMS-02-gap-analysis.md): application and cron logs
# live only on the production host. Losing the box loses the evidence; owning
# the box lets an attacker edit the very records used to find them.
#
# Design: reuse the backup ceremony rather than invent a second one. Same
# /etc/leaddrive/backup.env, same age recipient, same bucket, same COMPLIANCE
# Object Lock. That matters beyond convenience — a successfully verified
# object version cannot have its COMPLIANCE retention shortened through the
# writer account. This protects already-uploaded evidence; it does not make
# host-local logs, account closure, or a provider-wide failure impossible.
#
# DEPENDENCY: this script cannot run until F-09 is closed. It requires
# BACKUP_AGE_RECIPIENT, which does not exist until the age key ceremony in
# docs/isms/ISMS-04-backup-commissioning.md has been performed.
#
# Incremental by an authenticated cursor: device + inode + byte offset + a
# SHA-256 checkpoint of the bytes immediately before that offset. Device/inode
# catches rename/create rotation; the checkpoint also catches copytruncate even
# when the new file has already grown beyond the old offset. An unrecoverable
# previous tail is a hard failure and the cursor never advances.
# ═══════════════════════════════════════════════════════════
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/leaddrive/backup.env}"
# Space-separated. The first run shipped nothing but one unit's journal because
# this pointed at /var/log/leaddrive, which does not exist on this host. PM2
# now writes to the separate root-owned /var/lib/leaddrive-v2-logs authority,
# while nginx keeps the access log — the record of who reached what — under
# /var/log/nginx. A green run that ships an empty slice is worse than a failure;
# it reports success for evidence nobody collected.
# Production inventory is deliberately exact.  Never recurse through the whole
# of /var/log: the service has adm membership for nginx/postgresql and that
# would also make unrelated auth/syslog evidence readable.  The standalone
# resilience scheduler log lives directly below /var/log, so it is a separate
# exact-file authority rather than a reason to broaden the directory roots.
EXPECTED_LOG_DIRS="/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql"
EXPECTED_LOG_FILES="/var/log/leaddrive-resilience-cron.log"
EXPECTED_JOURNAL_UNITS="leaddrive-postgres-backup.service leaddrive-secrets-snapshot.service leaddrive-runtime-files-snapshot.service leaddrive-log-ship.service"
REVIEWED_LOG_CURSOR_AWK_RE='^(/var/lib/leaddrive-v2-logs/[^/]+[.]log|/var/log/nginx/[^/]+[.]log|/var/log/postgresql/[^/]+[.]log|/var/log/leaddrive-resilience-cron[.]log)$'

log() { echo "[$(date '+%H:%M:%S')] $1"; }
fatal() { log "FATAL: $1"; exit 1; }

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fatal "$name is required (set it in $BACKUP_ENV_FILE)"
}

for command_name in age awk aws basename cp curl dd df du find findmnt flock grep gzip journalctl mv \
  realpath sed sha256sum sort stat sync tail tar timeout tr wc; do
  command -v "$command_name" >/dev/null 2>&1 || fatal "missing required command: $command_name"
done

[ -r "$BACKUP_ENV_FILE" ] || fatal "cannot read $BACKUP_ENV_FILE"
[ "$BACKUP_ENV_FILE" = /etc/leaddrive/backup.env ] \
  || fatal "BACKUP_ENV_FILE must remain /etc/leaddrive/backup.env"
set -a
# shellcheck disable=SC1090
. "$BACKUP_ENV_FILE"
set +a

# Resolve every policy value only after reading the canonical root-controlled
# environment. Resolving these before sourcing the file silently ignored the
# reviewed production configuration.
LOG_DIRS="${LOG_SHIP_SOURCE_DIRS:-$EXPECTED_LOG_DIRS}"
LOG_FILES="${LOG_SHIP_SOURCE_FILES:-$EXPECTED_LOG_FILES}"
STATE_FILE="${LOG_SHIP_STATE_FILE:-/var/lib/leaddrive-log-ship/log-ship-offsets}"
WORK_ROOT="${LOG_SHIP_WORK_ROOT:-/run/leaddrive-log-ship}"
LOCK_FILE="${LOG_SHIP_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/log-ship.lock}"
JOURNAL_UNITS="${LOG_SHIP_JOURNAL_UNITS:-$EXPECTED_JOURNAL_UNITS}"
S3_PREFIX="${LOG_SHIP_S3_PREFIX:-logs}"

[ -z "${LOG_SHIP_SOURCE_DIR:-}" ] \
  || fatal "deprecated LOG_SHIP_SOURCE_DIR override is forbidden"
[ "$LOG_DIRS" = "$EXPECTED_LOG_DIRS" ] \
  || fatal "LOG_SHIP_SOURCE_DIRS differs from the reviewed authoritative roots"
[ "$LOG_FILES" = "$EXPECTED_LOG_FILES" ] \
  || fatal "LOG_SHIP_SOURCE_FILES differs from the reviewed exact file authority"
[ "$JOURNAL_UNITS" = "$EXPECTED_JOURNAL_UNITS" ] \
  || fatal "LOG_SHIP_JOURNAL_UNITS differs from the reviewed exact service inventory"
[ -z "${LOG_SHIP_JOURNAL_SINCE:-}" ] \
  || fatal "LOG_SHIP_JOURNAL_SINCE is forbidden; journal progress is cursor-based"

[ "${LOG_SHIP_STATE_FILE:-/var/lib/leaddrive-log-ship/log-ship-offsets}" = "/var/lib/leaddrive-log-ship/log-ship-offsets" ] \
  && [ "$STATE_FILE" = "/var/lib/leaddrive-log-ship/log-ship-offsets" ] \
  || fatal "LOG_SHIP_STATE_FILE override is forbidden"
[ "${LOG_SHIP_WORK_ROOT:-/run/leaddrive-log-ship}" = "/run/leaddrive-log-ship" ] \
  && [ "$WORK_ROOT" = "/run/leaddrive-log-ship" ] \
  || fatal "LOG_SHIP_WORK_ROOT override is forbidden"
[ "${LOG_SHIP_LOCK_FILE:-/var/lib/leaddrive-recovery-runner-locks/log-ship.lock}" = "/var/lib/leaddrive-recovery-runner-locks/log-ship.lock" ] \
  && [ "$LOCK_FILE" = "/var/lib/leaddrive-recovery-runner-locks/log-ship.lock" ] \
  || fatal "LOG_SHIP_LOCK_FILE override is forbidden"
[ "$S3_PREFIX" = logs ] || fatal "LOG_SHIP_S3_PREFIX must remain logs"

require_env BACKUP_AGE_RECIPIENT
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_REGION
require_env BACKUP_S3_BUCKET
require_env AWS_ACCESS_KEY_ID
require_env AWS_SECRET_ACCESS_KEY
require_env LOG_SHIP_HEALTHCHECK_URL
[[ "$LOG_SHIP_HEALTHCHECK_URL" =~ ^https://[^[:space:]]+$ ]] \
  && [[ "${LOG_SHIP_HEALTHCHECK_URL,,}" != *replace* ]] \
  && [[ "${LOG_SHIP_HEALTHCHECK_URL,,}" != *.example* ]] \
  || fatal "LOG_SHIP_HEALTHCHECK_URL must be a non-placeholder HTTPS URL"

S3_REGION="$BACKUP_S3_REGION"
S3_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT" --region "$S3_REGION" --no-cli-pager)
RETENTION_DAYS="${LOG_SHIP_RETENTION_DAYS:-400}"
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) fatal "LOG_SHIP_RETENTION_DAYS must be a number" ;;
esac
# Below the bucket default the retention call would be a downgrade attempt and
# the bucket would reject it — fail here with a readable reason instead.
[ "$RETENTION_DAYS" -ge 400 ] || fatal "log retention must be at least 400 days"

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
CURRENT_EVIDENCE_START_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
STATE_DIR="$(dirname -- "$STATE_FILE")"
BOOTSTRAP_TRANSACTION_DIR="$STATE_DIR/bootstrap-transaction"
BOOTSTRAP_TRANSACTION_PREPARE_DIR="$STATE_DIR/bootstrap-transaction.preparing"
mkdir -p -- "$WORK_ROOT" "$STATE_DIR"
[ -d "$WORK_ROOT" ] && [ ! -L "$WORK_ROOT" ] \
  && [ "$(realpath -e -- "$WORK_ROOT")" = "$WORK_ROOT" ] \
  && [ "$(findmnt -n -o FSTYPE --target "$WORK_ROOT")" = "tmpfs" ] \
  && [ "$(stat -c '%U:%G:%a' "$WORK_ROOT" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:750 ] \
  || fatal "plaintext log-shipping work root must be the reviewed tmpfs directory"
[ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] \
  && [ "$(realpath -e -- "$STATE_DIR")" = "$STATE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_DIR" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:750 ] \
  || fatal "log cursor directory must be the reviewed service-owned persistent directory"

# Single instance. The root-owned non-writable parent prevents the
# unprivileged runner from unlinking or replacing the persistent lock inode.
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
  && [ "$(realpath -e -- "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = /var/lib/leaddrive-recovery-runner-locks ] \
  && [ "$(stat -c '%U:%G:%a' "$(dirname -- "$LOCK_FILE")" 2>/dev/null || true)" = root:root:755 ] \
  && [ "$(stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null || true)" = root:leaddrive-backup:660 ] \
  || fatal "log-shipping lock is missing, symlinked, or has unsafe ownership/mode"
exec 9<"$LOCK_FILE"
flock -n 9 || fatal "another log-ship run holds the lock"
[ "$(stat -Lc '%d:%i' "$LOCK_FILE" 2>/dev/null || true)" = \
  "$(stat -Lc '%d:%i' "/proc/$$/fd/9" 2>/dev/null || true)" ] \
  || fatal "log-shipping lock inode changed while it was acquired"

WORK_DIR="$(mktemp -d "$WORK_ROOT/logship-${TIMESTAMP}.XXXXXX")"
STATE_STAGE=""
SUCCESS=0

ping_healthcheck() {
  local suffix="${1:-}"
  curl --fail --silent --show-error --retry 3 --max-time 10 \
    "${LOG_SHIP_HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$SUCCESS" -ne 1 ] || [ "$status" -ne 0 ]; then
    ping_healthcheck /fail || true
  fi
  if [ -n "$STATE_STAGE" ]; then
    case "$STATE_STAGE" in
      "$STATE_DIR"/.log-ship-offsets.stage.*) rm -f -- "$STATE_STAGE" ;;
      *) log "REFUSED unexpected state-stage cleanup: $STATE_STAGE" ;;
    esac
  fi
  rm -rf -- "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT
SLICE_DIR="$WORK_DIR/slice"
mkdir -p -- "$SLICE_DIR"
RANGE_INDEX="$WORK_DIR/RANGES.tsv"
printf 'TYPE\tSLICE\tSOURCE\tSTART\tEND\tBYTES\n' >"$RANGE_INDEX"

if [ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ]; then
  (set -o noclobber; : >"$STATE_FILE") 2>/dev/null || true
fi
[ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_FILE" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600 ] \
  || fatal "log cursor must be a service-owned regular file with mode 0600"
state_bytes="$(wc -c <"$STATE_FILE" | tr -d '[:space:]')"
state_rows="$(wc -l <"$STATE_FILE" | tr -d '[:space:]')"
[[ "$state_bytes" =~ ^[0-9]+$ ]] && [ "$state_bytes" -le 4194304 ] \
  && [[ "$state_rows" =~ ^[0-9]+$ ]] && [ "$state_rows" -le 100000 ] \
  || fatal "log cursor exceeds the reviewed 4 MiB/100000-row bound"
SELF_PATH="$(realpath -e -- "$0")" || fatal "cannot resolve the running log-shipping program"
[[ "$SELF_PATH" =~ ^/usr/local/lib/leaddrive-v2/ops/releases/([0-9a-f]{40})/backup/ship-logs\.sh$ ]] \
  || fatal "running log-shipping program is outside the immutable operations release"
SELF_RELEASE_SHA="${BASH_REMATCH[1]}"
SELF_SHA256="$(sha256sum "$SELF_PATH" | awk '{print $1}')"
PROGRAM_SET_RECORD="$(dirname -- "$(dirname -- "$SELF_PATH")")/recovery-program-set.sha256"
[ -f "$PROGRAM_SET_RECORD" ] && [ ! -L "$PROGRAM_SET_RECORD" ] \
  && [ "$(stat -c '%U:%G:%a' "$PROGRAM_SET_RECORD" 2>/dev/null || true)" = root:root:444 ] \
  || fatal "immutable recovery-program digest record is missing or unsafe"
ACTIVE_RECOVERY_PROGRAM_SET_SHA256="$(tr -d '\r\n' <"$PROGRAM_SET_RECORD")"
[[ "$SELF_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  && [[ "$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fatal "immutable log-shipping program identity is malformed"

# The source authority is root-owned under /etc and is exposed to this
# unprivileged service only through systemd's read-only credential mount. A
# PENDING credential authorizes exactly one prescribed bootstrap key/start;
# COMMITTED is the monotonic local genesis anchor. Neither may be replaced by
# the backup user or by values injected through backup.env.
EXPECTED_CREDENTIALS_DIRECTORY=/run/credentials/leaddrive-log-ship.service
[ "${CREDENTIALS_DIRECTORY:-}" = "$EXPECTED_CREDENTIALS_DIRECTORY" ] \
  || fatal "log evidence genesis must be supplied by the reviewed systemd credential mount"
GENESIS_CREDENTIAL="$CREDENTIALS_DIRECTORY/log-evidence-genesis"
[ -f "$GENESIS_CREDENTIAL" ] && [ ! -L "$GENESIS_CREDENTIAL" ] \
  && [ "$(realpath -e -- "$GENESIS_CREDENTIAL" 2>/dev/null || true)" = "$GENESIS_CREDENTIAL" ] \
  && [ "$(wc -c <"$GENESIS_CREDENTIAL" | tr -d '[:space:]')" -le 16384 ] \
  || fatal "root log-evidence genesis credential is missing, symlinked, or oversized"
genesis_credential_mode="$(stat -c '%a' "$GENESIS_CREDENTIAL" 2>/dev/null || true)"
[[ "$genesis_credential_mode" =~ ^[0-7]{3,4}$ ]] \
  && [ $((8#$genesis_credential_mode & 0022)) -eq 0 ] \
  || fatal "root log-evidence genesis credential is writable outside its owner"

credential_value() {
  local key="$1"
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      if (found) exit 2
      print substr($0, length(wanted) + 2)
      found=1
    }
    END { if (!found) exit 3 }
  ' "$GENESIS_CREDENTIAL"
}

GENESIS_CREDENTIAL_STATUS="$(credential_value STATUS 2>/dev/null || true)"
case "$GENESIS_CREDENTIAL_STATUS" in
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
    ' "$GENESIS_CREDENTIAL" || fatal "pending log-evidence genesis credential is malformed"
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
    ' "$GENESIS_CREDENTIAL" || fatal "committed log-evidence genesis credential is malformed"
    ;;
  *) fatal "log-evidence genesis credential has an unknown status" ;;
esac
GENESIS_CREDENTIAL_START_AT="$(credential_value LOG_EVIDENCE_START_AT)" \
  || fatal "log-evidence genesis credential has no unique start watermark"
GENESIS_CREDENTIAL_OBJECT_KEY="$(credential_value LOG_EVIDENCE_FIRST_OBJECT_KEY)" \
  || fatal "log-evidence genesis credential has no unique object key"
GENESIS_CREDENTIAL_PROGRAM_SHA256="$(credential_value BOOTSTRAP_RECOVERY_PROGRAM_SET_SHA256)" \
  || fatal "log-evidence genesis credential has no unique recovery-program identity"
if [ "$GENESIS_CREDENTIAL_STATUS" = PENDING ]; then
  [ "$(credential_value BOOTSTRAP_DEPLOY_SHA)" = "$SELF_RELEASE_SHA" ] \
    || fatal "pending log genesis belongs to another immutable deployment release"
  [ "$GENESIS_CREDENTIAL_PROGRAM_SHA256" = "$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" ] \
    || fatal "pending log genesis belongs to another recovery-program set"
else
  GENESIS_ANCHOR_VERSION_ID="$(credential_value LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)"
  GENESIS_ANCHOR_SHA256="$(credential_value LOG_EVIDENCE_FIRST_OBJECT_SHA256)"
  GENESIS_ANCHOR_BYTES="$(credential_value LOG_EVIDENCE_FIRST_OBJECT_BYTES)"
  GENESIS_ANCHOR_FORMAT_VERSION="$(credential_value LOG_EVIDENCE_OBJECT_FORMAT_VERSION)"
  GENESIS_ANCHOR_RANGES_SHA256="$(credential_value BOOTSTRAP_RANGES_SHA256)"
  GENESIS_ANCHOR_FILE_RANGE_COUNT="$(credential_value BOOTSTRAP_FILE_RANGE_COUNT)"
  GENESIS_ANCHOR_FILE_RANGE_BYTES="$(credential_value BOOTSTRAP_FILE_RANGE_BYTES)"
  GENESIS_ANCHOR_JOURNAL_RANGE_COUNT="$(credential_value BOOTSTRAP_JOURNAL_RANGE_COUNT)"
  GENESIS_ANCHOR_CURSOR_SHA256="$(credential_value BOOTSTRAP_CURSOR_SHA256)"
  GENESIS_ANCHOR_CREATED_AT="$(credential_value OBJECT_CREATED_AT)"
fi

if [ ! -s "$STATE_FILE" ]; then
  STATE_FORMAT=0
elif [ "$(head -n 1 -- "$STATE_FILE")" = "FORMAT_VERSION=4" ]; then
  STATE_FORMAT=4
  awk -F '\t' -v expected="$EXPECTED_JOURNAL_UNITS" -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
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
  ' "$STATE_FILE" || fatal "version 4 log/journal evidence state is malformed, incomplete or duplicated"
elif [ "$(head -n 1 -- "$STATE_FILE")" = "FORMAT_VERSION=3" ]; then
  STATE_FORMAT=3
  awk -F '\t' -v expected="$EXPECTED_JOURNAL_UNITS" -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    BEGIN {
      count=split(expected, units, " ")
      for (i=1; i<=count; i++) allowed[units[i]]=1
    }
    NR == 1 { if ($0 != "FORMAT_VERSION=3") bad=1; next }
    NR == 2 { if ($0 !~ /^SHIP_LOGS_SHA256=[0-9a-f]{64}$/) bad=1; next }
    NR == 3 { if ($0 !~ /^RECOVERY_PROGRAM_SET_SHA256=[0-9a-f]{64}$/) bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || $2 !~ reviewed ||
          $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ ||
          $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/ || $7 !~ /^[0-9a-f]{64}$/ ||
          ($5 == 0 && $6 != 0) || ($5 > 0 && ($6 < 1 || $6 > 4096 || $6 > $5))) bad=1
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
      if (NR < 7 || bad) exit 1
    }
  ' "$STATE_FILE" || fatal "version 3 log/journal cursor is malformed, incomplete or duplicated"
elif [ "$(head -n 1 -- "$STATE_FILE")" = "FORMAT_VERSION=2" ]; then
  STATE_FORMAT=2
  awk -F '\t' -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    NR == 1 { next }
    NF != 6 || $1 !~ reviewed ||
      $2 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ ||
      $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9a-f]{64}$/ ||
      ($4 == 0 && $5 != 0) || ($4 > 0 && ($5 < 1 || $5 > 4096 || $5 > $4)) { bad=1 }
    seen[$1]++ { bad=1 }
    END { if (bad) exit 1 }
  ' "$STATE_FILE" || fatal "version 2 log cursor is malformed or contains duplicate paths"
else
  STATE_FORMAT=1
  awk -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    NF != 2 || $1 !~ reviewed ||
      $2 !~ /^[0-9]+$/ { bad=1 }
    seen[$1]++ { bad=1 }
    END { if (bad) exit 1 }
  ' "$STATE_FILE" || fatal "legacy log cursor is malformed or contains duplicate paths"
  log "migrating legacy path/offset cursor by conservatively re-shipping current and .1 files"
fi

state_header_value() {
  local key="$1"
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      if (found) exit 2
      print substr($0, length(wanted) + 2)
      found=1
    }
    END { if (!found) exit 3 }
  ' "$STATE_FILE"
}

EVIDENCE_BOOTSTRAP=0
PRESCRIBED_BOOTSTRAP_OBJECT_KEY=""
if [ "$STATE_FORMAT" = 4 ]; then
  LOG_EVIDENCE_START_AT="$(state_header_value LOG_EVIDENCE_START_AT)" \
    || fatal "log evidence state has a duplicate or missing start watermark"
  LOG_EVIDENCE_FIRST_OBJECT_KEY="$(state_header_value LOG_EVIDENCE_FIRST_OBJECT_KEY)" \
    || fatal "log evidence state has a duplicate or missing first-object key"
  LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID="$(state_header_value LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)" \
    || fatal "log evidence state has a duplicate or missing first-object version"
  LOG_EVIDENCE_FIRST_OBJECT_SHA256="$(state_header_value LOG_EVIDENCE_FIRST_OBJECT_SHA256)" \
    || fatal "log evidence state has a duplicate or missing first-object digest"
else
  [ "$GENESIS_CREDENTIAL_STATUS" = PENDING ] \
    || fatal "committed log genesis exists but its durable cursor state is missing; an explicit discontinuity ceremony is required"
  EVIDENCE_BOOTSTRAP=1
  LOG_EVIDENCE_START_AT="$GENESIS_CREDENTIAL_START_AT"
  PRESCRIBED_BOOTSTRAP_OBJECT_KEY="$GENESIS_CREDENTIAL_OBJECT_KEY"
  LOG_EVIDENCE_FIRST_OBJECT_KEY=PENDING
  LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=PENDING
  LOG_EVIDENCE_FIRST_OBJECT_SHA256=PENDING
fi
[[ "$LOG_EVIDENCE_START_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || fatal "log evidence start watermark is malformed"
if [ "$EVIDENCE_BOOTSTRAP" -eq 0 ]; then
  [[ "$LOG_EVIDENCE_FIRST_OBJECT_KEY" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$ ]] \
    && [[ "$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [ "$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" != None ] \
    && [ "$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" != null ] \
    && [[ "$LOG_EVIDENCE_FIRST_OBJECT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "log evidence first-object authority is malformed"
  [ "$LOG_EVIDENCE_START_AT" = "$GENESIS_CREDENTIAL_START_AT" ] \
    && [ "$LOG_EVIDENCE_FIRST_OBJECT_KEY" = "$GENESIS_CREDENTIAL_OBJECT_KEY" ] \
    || fatal "service cursor diverges from the root log-evidence genesis authority"
  if [ "$GENESIS_CREDENTIAL_STATUS" = COMMITTED ]; then
    [ "$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" = "$(credential_value LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID)" ] \
      && [ "$LOG_EVIDENCE_FIRST_OBJECT_SHA256" = "$(credential_value LOG_EVIDENCE_FIRST_OBJECT_SHA256)" ] \
      || fatal "service cursor diverges from the committed root log-evidence object authority"
  fi
fi

NEW_STATE="$WORK_DIR/offsets.next"
printf 'FORMAT_VERSION=4\nSHIP_LOGS_SHA256=%s\nRECOVERY_PROGRAM_SET_SHA256=%s\nLOG_EVIDENCE_START_AT=%s\nLOG_EVIDENCE_FIRST_OBJECT_KEY=%s\nLOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=%s\nLOG_EVIDENCE_FIRST_OBJECT_SHA256=%s\n' \
  "$SELF_SHA256" "$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" "$LOG_EVIDENCE_START_AT" \
  "$LOG_EVIDENCE_FIRST_OBJECT_KEY" "$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" \
  "$LOG_EVIDENCE_FIRST_OBJECT_SHA256" >"$NEW_STATE"

stored_legacy_offset() {
  local path="$1"
  awk -v want="$path" '$1 == want { value = $2; found = 1 } END { if (found) print value + 0; else print 0 }' "$STATE_FILE"
}

stored_cursor() {
  local path="$1"
  awk -F '\t' -v want="$path" -v format="$STATE_FORMAT" '
    NR == 1 && format != 1 { next }
    (format == 3 || format == 4) && $1 == "FILE" && $2 == want {
      if (found) exit 2
      printf "%s\t%s\t%s\t%s\t%s\n", $3, $4, $5, $6, $7
      found=1
      next
    }
    format == 2 && $1 == want {
      if (found) exit 2
      printf "%s\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5, $6
      found=1
    }
  ' "$STATE_FILE"
}

stored_journal_cursor() {
  local unit="$1"
  { [ "$STATE_FORMAT" = 3 ] || [ "$STATE_FORMAT" = 4 ]; } || {
    printf 'NO_CURSOR'
    return 0
  }
  awk -F '\t' -v want="$unit" '
    NR == 1 { next }
    $1 == "JOURNAL" && $2 == want {
      if (found) exit 2
      print $3
      found=1
    }
    END { if (!found) exit 3 }
  ' "$STATE_FILE"
}

slice_name() {
  # A path-to-underscore transform is not injective (`a__b/c` collides with
  # `a/b__c`) and would let a later dd silently replace an earlier audit
  # slice. Hash the exact logical range name instead.
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

assert_work_capacity() {
  local requested="$1" phase="$2" available
  [[ "$requested" =~ ^[0-9]+$ ]] \
    || fatal "$phase requested an invalid tmpfs capacity"
  available="$(df -B1 --output=avail "$WORK_ROOT" | tail -n 1 | tr -d '[:space:]')"
  [[ "$available" =~ ^[0-9]+$ ]] && [ "$available" -ge "$requested" ] \
    || fatal "$phase would exceed the reviewed log-shipping tmpfs capacity"
}

assert_safe_log_path() {
  local path="$1" parent canonical_parent
  [[ "$path" = /* ]] && [[ "$path" != *$'\t'* ]] && [[ "$path" != *$'\n'* ]] \
    && [[ "$path" != *$'\r'* ]] && [[ "$path" != *'//'* ]] \
    && [[ "$path" != */../* ]] && [[ "$path" != */./* ]] \
    && [[ "$path" != *'*'* ]] && [[ "$path" != *'?'* ]] && [[ "$path" != *'['* ]] \
    && [ "$(realpath -m -- "$path" 2>/dev/null || true)" = "$path" ] \
    || fatal "log path is not a safe canonical lexical path: $path"
  case "$path" in
    /var/lib/leaddrive-v2-logs/*/*|/var/log/nginx/*/*|/var/log/postgresql/*/*|\
    /var/log/leaddrive-resilience-cron.log*/*)
      fatal "nested log paths are outside the reviewed inventory: $path"
      ;;
  esac
  case "$path" in
    /var/lib/leaddrive-v2-logs/*.log|\
    /var/lib/leaddrive-v2-logs/*.log.*|\
    /var/lib/leaddrive-v2-logs/*.log-*|\
    /var/log/nginx/*.log|/var/log/nginx/*.log.*|/var/log/nginx/*.log-*|\
    /var/log/postgresql/*.log|/var/log/postgresql/*.log.*|/var/log/postgresql/*.log-*|\
    /var/log/leaddrive-resilience-cron.log|\
    /var/log/leaddrive-resilience-cron.log.*|\
    /var/log/leaddrive-resilience-cron.log-*) ;;
    *) fatal "log path is outside the reviewed roots: $path" ;;
  esac
  parent="$(dirname -- "$path")"
  canonical_parent="$(realpath -e -- "$parent" 2>/dev/null || true)"
  [ "$canonical_parent" = "$parent" ] \
    || fatal "log path parent is absent, symlinked, or non-canonical: $path"
}

# Copy exactly bytes [offset, captured_size) out of an already-open descriptor.
# Reading to EOF would race an append and then advance the cursor to an earlier
# size, creating confusing overlap on every busy log.
ship_range() {
  local source="$1" name="$2" offset="$3" size="$4"
  local expected actual destination slice_file
  [ "$size" -gt "$offset" ] || return 0
  [[ "$name" != *$'\t'* ]] && [[ "$name" != *$'\n'* ]] && [[ "$name" != *$'\r'* ]] \
    || fatal "log range name cannot be represented safely in the evidence index"
  expected=$((size - offset))
  assert_work_capacity $((expected + 268435456)) "log range staging"
  destination="$SLICE_DIR/$(slice_name "$name").slice"
  [ ! -e "$destination" ] && [ ! -L "$destination" ] \
    || fatal "duplicate logical log range would overwrite a prepared slice: $name"
  (set -o noclobber; : >"$destination") 2>/dev/null \
    || fatal "cannot exclusively reserve the prepared log slice: $name"
  dd if="$source" of="$destination" iflag=skip_bytes,count_bytes \
    conv=notrunc skip="$offset" count="$expected" status=none \
    || fatal "cannot read the bounded log range: $name"
  actual="$(wc -c <"$destination" | tr -d '[:space:]')"
  [ "$actual" = "$expected" ] \
    || fatal "log changed below its captured EOF while being read: $name"
  slice_file="$(basename -- "$destination")"
  printf 'FILE\t%s\t%s\t%s\t%s\t%s\n' \
    "$slice_file" "$name" "$offset" "$size" "$expected" >>"$RANGE_INDEX"
  SHIPPED_BYTES=$((SHIPPED_BYTES + expected))
}

checkpoint_sha() {
  local source="$1" offset="$2" window="$3" start checkpoint_file actual digest
  [ "$window" -gt 0 ] && [ "$offset" -ge "$window" ] \
    || fatal "invalid non-empty log checkpoint range"
  start=$((offset - window))
  checkpoint_file="$(mktemp "$WORK_DIR/.checkpoint.XXXXXX")" \
    || fatal "cannot stage a log cursor checkpoint"
  if ! dd if="$source" of="$checkpoint_file" iflag=skip_bytes,count_bytes \
      skip="$start" count="$window" status=none; then
    rm -f -- "$checkpoint_file"
    return 1
  fi
  actual="$(wc -c <"$checkpoint_file" | tr -d '[:space:]')"
  if [ "$actual" != "$window" ]; then
    rm -f -- "$checkpoint_file"
    return 1
  fi
  digest="$(sha256sum "$checkpoint_file" | awk '{print $1}')"
  rm -f -- "$checkpoint_file"
  printf '%s' "$digest"
}

write_cursor() {
  local path="$1" source="$2" device="$3" inode="$4" size="$5" window="$6" checkpoint="$7"
  local final_size final_checkpoint
  final_size="$(stat -Lc '%s' "$source" 2>/dev/null || true)"
  [[ "$final_size" =~ ^[0-9]+$ ]] && [ "$final_size" -ge "$size" ] \
    || fatal "log truncated while its bounded slice was being prepared: $path"
  if [ "$window" -eq 0 ]; then
    final_checkpoint="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  else
    final_checkpoint="$(checkpoint_sha "$source" "$size" "$window")" \
      || fatal "log checkpoint became unreadable before cursor commit: $path"
  fi
  [ "$final_checkpoint" = "$checkpoint" ] \
    || fatal "log changed below its captured EOF; cursor will not advance: $path"
  assert_safe_log_path "$path"
  printf 'FILE\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$path" "$device" "$inode" "$size" "$window" "$checkpoint" >>"$NEW_STATE"
}

recover_previous_tail() {
  local source_path="$1" stored_device="$2" stored_inode="$3" stored_offset="$4"
  local stored_window="$5" stored_checkpoint="$6" require_zero_candidate="${7:-0}"
  local directory basename candidate candidate_name candidate_fd candidate_ref candidate_content_ref
  local candidate_device candidate_inode candidate_size candidate_checkpoint candidate_label
  local decompressed_file="" available_bytes decompress_limit_bytes decompress_limit_blocks decompress_status
  local matches=0

  assert_safe_log_path "$source_path"
  directory="$(dirname -- "$source_path")"
  basename="$(basename -- "$source_path")"
  while IFS= read -r -d '' candidate; do
    candidate_name="$(basename -- "$candidate")"
    case "$candidate_name" in
      "$basename".*|"$basename"-*) ;;
      *) continue ;;
    esac
    assert_safe_log_path "$candidate"
    exec {candidate_fd}<"$candidate" || continue
    candidate_ref="/proc/self/fd/$candidate_fd"
    candidate_device="$(stat -Lc '%d' "$candidate_ref" 2>/dev/null || true)"
    candidate_inode="$(stat -Lc '%i' "$candidate_ref" 2>/dev/null || true)"
    candidate_content_ref="$candidate_ref"
    candidate_label="$candidate"
    decompressed_file=""
    case "$candidate" in
      *.gz)
        available_bytes="$(df -B1 --output=avail "$WORK_ROOT" | tail -n 1 | tr -d '[:space:]')"
        [[ "$available_bytes" =~ ^[0-9]+$ ]] && [ "$available_bytes" -gt 268435456 ] \
          || fatal "insufficient tmpfs headroom to authenticate compressed rotation: $candidate"
        decompress_limit_bytes=$((available_bytes - 268435456))
        [ "$decompress_limit_bytes" -le 4294967296 ] || decompress_limit_bytes=4294967296
        [ "$decompress_limit_bytes" -ge "$stored_offset" ] \
          || fatal "compressed rotation cannot fit the authenticated prior offset: $candidate"
        decompress_limit_blocks=$((decompress_limit_bytes / 1024))
        [ "$decompress_limit_blocks" -ge 1 ] \
          || fatal "compressed rotation has no safe decompression budget: $candidate"
        decompressed_file="$(mktemp "$WORK_DIR/.decompressed-log.XXXXXX")" \
          || fatal "cannot reserve bounded decompression staging"
        set +e
        (ulimit -f "$decompress_limit_blocks"; timeout 300 gzip -cd -- "$candidate_ref" >"$decompressed_file")
        decompress_status=$?
        set -e
        [ "$decompress_status" -eq 0 ] \
          || fatal "compressed rotation is invalid or exceeds the bounded decompression budget: $candidate"
        candidate_content_ref="$decompressed_file"
        candidate_label="${candidate}#decompressed"
        ;;
    esac
    candidate_size="$(stat -Lc '%s' "$candidate_content_ref" 2>/dev/null || true)"
    if [ "$stored_offset" -eq 0 ] && [[ "$candidate_size" =~ ^[0-9]+$ ]]; then
      # An empty checkpoint authenticates no content. The old inode proves a
      # rename/create rotation, but copytruncate creates the rotated copy on a
      # different inode. Conservatively ship every retained sibling once the
      # zero-offset cursor is observed; duplicates are acceptable, gaps are not.
      if [ "$candidate_device:$candidate_inode" = "$stored_device:$stored_inode" ]; then
        log "recovered zero-offset rotated file by device/inode: $candidate"
      else
        log "conservatively replaying rotated sibling after a zero-offset cursor: $candidate"
      fi
      matches=$((matches + 1))
      ship_range "$candidate_content_ref" "$candidate_label" 0 "$candidate_size"
      [ -z "$decompressed_file" ] || rm -f -- "$decompressed_file"
      exec {candidate_fd}<&-
      continue
    fi
    if [[ "$candidate_size" =~ ^[0-9]+$ ]] && [ "$candidate_size" -ge "$stored_offset" ]; then
      candidate_checkpoint="$(checkpoint_sha "$candidate_content_ref" "$stored_offset" "$stored_window" 2>/dev/null || true)"
      if [ "$candidate_checkpoint" = "$stored_checkpoint" ]; then
        # A renamed file normally has the same device/inode. copytruncate makes
        # .1 a copy with another inode, so the checkpoint is the authority in
        # that case. Record identity agreement in the log for incident review.
        if [ "$candidate_device:$candidate_inode" = "$stored_device:$stored_inode" ]; then
          log "recovered rotated tail by device/inode: $candidate"
        else
          log "recovered copytruncate tail by checkpoint: $candidate"
        fi
        matches=$((matches + 1))
        [ "$matches" -eq 1 ] || fatal "multiple rotated files match the previous cursor for $source_path"
        ship_range "$candidate_content_ref" "${candidate_label}#tail-from-${stored_offset}" \
          "$stored_offset" "$candidate_size"
      fi
    fi
    [ -z "$decompressed_file" ] || rm -f -- "$decompressed_file"
    exec {candidate_fd}<&-
  done < <(find "$directory" -xdev -maxdepth 1 -type f -print0)
  if [ "$stored_offset" -eq 0 ]; then
    [ "$require_zero_candidate" -eq 0 ] || [ "$matches" -ge 1 ] \
      || fatal "zero-offset log path disappeared without a recoverable rotated sibling: $source_path"
    return 0
  fi
  [ "$matches" -eq 1 ] \
    || fatal "cannot recover the previous log tail for $source_path; cursor will not advance"
}

commit_state() {
  STATE_STAGE="$(mktemp "$STATE_DIR/.log-ship-offsets.stage.XXXXXX")" \
    || fatal "cannot stage the next log cursor"
  cp -- "$NEW_STATE" "$STATE_STAGE"
  chmod 0600 "$STATE_STAGE"
  sync -f -- "$STATE_STAGE" "$STATE_DIR" \
    || fatal "cannot persist the staged log cursor"
  mv -- "$STATE_STAGE" "$STATE_FILE"
  STATE_STAGE=""
  sync -f -- "$STATE_FILE" "$STATE_DIR" \
    || fatal "cannot persist the committed log cursor"
}

finalize_evidence_bootstrap_state() {
  local object_key="$1" object_version="$2" object_sha="$3"
  local final_state="$WORK_DIR/offsets.final"
  [ "$EVIDENCE_BOOTSTRAP" -eq 1 ] || return 0
  [[ "$object_key" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$ ]] \
    && [[ "$object_version" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [[ "$object_sha" =~ ^[0-9a-f]{64}$ ]] \
    || fatal "verified first log-evidence object has an unsafe identity"
  awk -v key="$object_key" -v version="$object_version" -v digest="$object_sha" '
    NR == 5 { print "LOG_EVIDENCE_FIRST_OBJECT_KEY=" key; next }
    NR == 6 { print "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=" version; next }
    NR == 7 { print "LOG_EVIDENCE_FIRST_OBJECT_SHA256=" digest; next }
    { print }
  ' "$NEW_STATE" >"$final_state" \
    || fatal "cannot render the immutable log-evidence watermark state"
  [ "$(grep -Fxc 'LOG_EVIDENCE_FIRST_OBJECT_KEY=PENDING' "$final_state" || true)" = 0 ] \
    && [ "$(grep -Fxc 'LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=PENDING' "$final_state" || true)" = 0 ] \
    && [ "$(grep -Fxc 'LOG_EVIDENCE_FIRST_OBJECT_SHA256=PENDING' "$final_state" || true)" = 0 ] \
    || fatal "initial log-evidence state still contains a pending object authority"
  mv -- "$final_state" "$NEW_STATE" \
    || fatal "cannot finalize the initial log-evidence state"
  LOG_EVIDENCE_FIRST_OBJECT_KEY="$object_key"
  LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID="$object_version"
  LOG_EVIDENCE_FIRST_OBJECT_SHA256="$object_sha"
}

maintain_first_evidence_retention() {
  local head_state remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges remote_modified
  local remote_file_count remote_file_bytes remote_journal_count remote_cursor
  local start_epoch modified_epoch now_epoch retention_state remote_mode remote_until remote_epoch
  local minimum_epoch requested_until requested_epoch required_epoch
  [ "$EVIDENCE_BOOTSTRAP" -eq 0 ] || return 0
  [ "$GENESIS_CREDENTIAL_STATUS" = COMMITTED ] \
    || fatal "routine log shipping requires a committed root genesis anchor"

  head_state="$(aws s3api head-object "${S3_ARGS[@]}" \
    --bucket "$BACKUP_S3_BUCKET" --key "$LOG_EVIDENCE_FIRST_OBJECT_KEY" \
    --version-id="$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" \
    --query '[ContentLength,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256,LastModified]' \
    --output text)" \
    || fatal "cannot read the exact first log-evidence object version"
  read -r remote_bytes remote_sha remote_format remote_start remote_bootstrap remote_program remote_ranges \
    remote_file_count remote_file_bytes remote_journal_count remote_cursor remote_modified <<<"$head_state"
  start_epoch="$(date -u -d "$LOG_EVIDENCE_START_AT" '+%s' 2>/dev/null || true)"
  modified_epoch="$(date -u -d "$remote_modified" '+%s' 2>/dev/null || true)"
  now_epoch="$(date -u '+%s')"
  [[ "$remote_bytes" =~ ^[1-9][0-9]*$ ]] && [ "$remote_bytes" -le 2199023255552 ] \
    && [ "$remote_bytes" = "$GENESIS_ANCHOR_BYTES" ] \
    && [ "$remote_sha" = "$LOG_EVIDENCE_FIRST_OBJECT_SHA256" ] \
    && [ "$remote_sha" = "$GENESIS_ANCHOR_SHA256" ] \
    && [ "$remote_format" = "$GENESIS_ANCHOR_FORMAT_VERSION" ] \
    && [ "$remote_start" = "$LOG_EVIDENCE_START_AT" ] \
    && [ "$remote_bootstrap" = 1 ] \
    && [ "$remote_program" = "$GENESIS_CREDENTIAL_PROGRAM_SHA256" ] \
    && [ "$remote_ranges" = "$GENESIS_ANCHOR_RANGES_SHA256" ] \
    && [ "$remote_file_count" = "$GENESIS_ANCHOR_FILE_RANGE_COUNT" ] \
    && [ "$remote_file_bytes" = "$GENESIS_ANCHOR_FILE_RANGE_BYTES" ] \
    && [ "$remote_journal_count" = "$GENESIS_ANCHOR_JOURNAL_RANGE_COUNT" ] \
    && [ "$remote_cursor" = "$GENESIS_ANCHOR_CURSOR_SHA256" ] \
    && [[ "$remote_file_count" =~ ^[0-9]+$ ]] && [ "$remote_file_count" -le 100000 ] \
    && [[ "$remote_file_bytes" =~ ^[0-9]+$ ]] && [ "$remote_file_bytes" -le 1099511627776 ] \
    && [[ "$remote_journal_count" =~ ^[0-9]+$ ]] && [ "$remote_journal_count" -le 1000 ] \
    && [ $((remote_file_count + remote_journal_count)) -ge 1 ] \
    && [ "$remote_modified" = "$GENESIS_ANCHOR_CREATED_AT" ] \
    && [[ "$start_epoch" =~ ^[0-9]+$ ]] && [[ "$modified_epoch" =~ ^[0-9]+$ ]] \
    && [ "$modified_epoch" -ge $((start_epoch - 60)) ] \
    && [ "$modified_epoch" -le $((now_epoch + 300)) ] \
    || fatal "first log-evidence object no longer matches its immutable bootstrap watermark"

  retention_state="$(aws s3api get-object-retention "${S3_ARGS[@]}" \
    --bucket "$BACKUP_S3_BUCKET" --key "$LOG_EVIDENCE_FIRST_OBJECT_KEY" \
    --version-id="$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" \
    --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)" \
    || fatal "cannot read first log-evidence retention"
  read -r remote_mode remote_until <<<"$retention_state"
  remote_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null || true)"
  requested_until="$(date -u -d "+${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ')" \
    || fatal "cannot calculate rolling first-object retention"
  requested_epoch="$(date -u -d "$requested_until" '+%s')"
  minimum_epoch="$(date -u -d "+$((RETENTION_DAYS - 30)) days" '+%s')" \
    || fatal "cannot calculate first-object retention extension threshold"
  required_epoch="$minimum_epoch"
  [ "$remote_mode" = COMPLIANCE ] && [[ "$remote_epoch" =~ ^[0-9]+$ ]] \
    || fatal "first log-evidence object is not under COMPLIANCE retention"
  if [ "$remote_epoch" -lt "$minimum_epoch" ]; then
    required_epoch="$requested_epoch"
    aws s3api put-object-retention "${S3_ARGS[@]}" \
      --bucket "$BACKUP_S3_BUCKET" --key "$LOG_EVIDENCE_FIRST_OBJECT_KEY" \
      --version-id="$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" \
      --retention "Mode=COMPLIANCE,RetainUntilDate=$requested_until" >/dev/null \
      || fatal "cannot extend first log-evidence COMPLIANCE retention"
    retention_state="$(aws s3api get-object-retention "${S3_ARGS[@]}" \
      --bucket "$BACKUP_S3_BUCKET" --key "$LOG_EVIDENCE_FIRST_OBJECT_KEY" \
      --version-id="$LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID" \
      --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)" \
      || fatal "cannot verify extended first log-evidence retention"
    read -r remote_mode remote_until <<<"$retention_state"
    remote_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null || true)"
  fi
  [ "$remote_mode" = COMPLIANCE ] && [[ "$remote_epoch" =~ ^[0-9]+$ ]] \
    && [ "$remote_epoch" -ge "$required_epoch" ] \
    || fatal "first log-evidence retention was not extended to the rolling policy horizon"
}

transaction_value() {
  local transaction_env="$1" key="$2"
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      if (found) exit 2
      print substr($0, length(wanted) + 2)
      found=1
    }
    END { if (!found) exit 3 }
  ' "$transaction_env"
}

load_bootstrap_transaction() {
  local transaction_dir="$1" transaction_env="$transaction_dir/transaction.env"
  local offsets_file="$transaction_dir/offsets.next" payload_file="$transaction_dir/payload.age"
  local transaction_bytes transaction_rows transaction_file transaction_members nested_mount

  [ "$GENESIS_CREDENTIAL_STATUS" = PENDING ] \
    || fatal "a bootstrap transaction exists after the root genesis was committed"
  [ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] \
    && [ "$(realpath -e -- "$transaction_dir" 2>/dev/null || true)" = "$transaction_dir" ] \
    && [ "$(stat -c '%U:%G:%a' "$transaction_dir" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:700 ] \
    || fatal "bootstrap transaction directory is missing, symlinked, or unsafe"
  transaction_members="$(find "$transaction_dir" -xdev -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" \
    || fatal "cannot inventory bootstrap transaction members"
  [ "$transaction_members" = $'offsets.next\npayload.age\ntransaction.env' ] \
    && [ -z "$(find "$transaction_dir" -xdev -mindepth 2 -print -quit)" ] \
    || fatal "bootstrap transaction contains unexpected or nested members"
  nested_mount="$(findmnt -rn -o TARGET | awk -v root="$transaction_dir/" 'index($0, root) == 1 { print; exit }')"
  [ -z "$nested_mount" ] || fatal "bootstrap transaction contains a nested mount: $nested_mount"
  for transaction_file in "$transaction_env" "$offsets_file" "$payload_file"; do
    [ -f "$transaction_file" ] && [ ! -L "$transaction_file" ] \
      && [ "$(realpath -e -- "$transaction_file" 2>/dev/null || true)" = "$transaction_file" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$transaction_file" 2>/dev/null || true)" = leaddrive-backup:leaddrive-backup:600:1 ] \
      || fatal "bootstrap transaction member is missing, symlinked, or unsafe"
  done
  transaction_bytes="$(wc -c <"$transaction_env" | tr -d '[:space:]')"
  transaction_rows="$(wc -l <"$transaction_env" | tr -d '[:space:]')"
  [ "$transaction_bytes" -le 16384 ] && [ "$transaction_rows" -eq 14 ] \
    || fatal "bootstrap transaction manifest exceeds its exact bound"
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
  ' "$transaction_env" || fatal "bootstrap transaction manifest is malformed"

  TX_EVIDENCE_START_AT="$(transaction_value "$transaction_env" LOG_EVIDENCE_START_AT)" \
    || fatal "bootstrap transaction has no unique evidence start"
  TX_OBJECT_KEY="$(transaction_value "$transaction_env" OBJECT_KEY)" \
    || fatal "bootstrap transaction has no unique object key"
  TX_CIPHERTEXT_SHA256="$(transaction_value "$transaction_env" CIPHERTEXT_SHA256)" \
    || fatal "bootstrap transaction has no unique ciphertext digest"
  TX_CIPHERTEXT_BYTES="$(transaction_value "$transaction_env" CIPHERTEXT_BYTES)" \
    || fatal "bootstrap transaction has no unique ciphertext size"
  TX_SHIP_LOGS_SHA256="$(transaction_value "$transaction_env" SHIP_LOGS_SHA256)" \
    || fatal "bootstrap transaction has no unique script digest"
  TX_PROGRAM_SHA256="$(transaction_value "$transaction_env" RECOVERY_PROGRAM_SET_SHA256)" \
    || fatal "bootstrap transaction has no unique program-set digest"
  TX_RANGES_SHA256="$(transaction_value "$transaction_env" RANGES_SHA256)" \
    || fatal "bootstrap transaction has no unique ranges digest"
  TX_FILE_RANGE_COUNT="$(transaction_value "$transaction_env" FILE_RANGE_COUNT)" \
    || fatal "bootstrap transaction has no unique file-range count"
  TX_FILE_RANGE_BYTES="$(transaction_value "$transaction_env" FILE_RANGE_BYTES)" \
    || fatal "bootstrap transaction has no unique file-range byte count"
  TX_JOURNAL_RANGE_COUNT="$(transaction_value "$transaction_env" JOURNAL_RANGE_COUNT)" \
    || fatal "bootstrap transaction has no unique journal-range count"
  TX_CURSOR_SHA256="$(transaction_value "$transaction_env" CURSOR_SHA256)" \
    || fatal "bootstrap transaction has no unique cursor digest"
  TX_RETENTION_DAYS="$(transaction_value "$transaction_env" RETENTION_DAYS)" \
    || fatal "bootstrap transaction has no unique retention policy"
  TX_PAYLOAD_FILE="$payload_file"
  TX_OFFSETS_FILE="$offsets_file"

  [ "$TX_EVIDENCE_START_AT" = "$GENESIS_CREDENTIAL_START_AT" ] \
    && [ "$TX_OBJECT_KEY" = "$GENESIS_CREDENTIAL_OBJECT_KEY" ] \
    && [ "$TX_SHIP_LOGS_SHA256" = "$SELF_SHA256" ] \
    && [ "$TX_PROGRAM_SHA256" = "$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" ] \
    && [ "$TX_PROGRAM_SHA256" = "$GENESIS_CREDENTIAL_PROGRAM_SHA256" ] \
    && [ "$TX_RETENTION_DAYS" = "$RETENTION_DAYS" ] \
    || fatal "bootstrap transaction diverges from the root credential or active recovery program"
  [[ "$TX_CIPHERTEXT_BYTES" =~ ^[1-9][0-9]*$ ]] \
    && [ "$TX_CIPHERTEXT_BYTES" -le 2199023255552 ] \
    && [[ "$TX_FILE_RANGE_COUNT" =~ ^[0-9]+$ ]] && [ "$TX_FILE_RANGE_COUNT" -le 100000 ] \
    && [[ "$TX_FILE_RANGE_BYTES" =~ ^[0-9]+$ ]] && [ "$TX_FILE_RANGE_BYTES" -le 1099511627776 ] \
    && [[ "$TX_JOURNAL_RANGE_COUNT" =~ ^[0-9]+$ ]] && [ "$TX_JOURNAL_RANGE_COUNT" -le 1000 ] \
    || fatal "bootstrap transaction counts exceed reviewed bounds"
  [ "$(stat -c '%s' "$payload_file")" = "$TX_CIPHERTEXT_BYTES" ] \
    && [ "$(sha256sum "$payload_file" | awk '{print $1}')" = "$TX_CIPHERTEXT_SHA256" ] \
    && [ "$(sha256sum "$offsets_file" | awk '{print $1}')" = "$TX_CURSOR_SHA256" ] \
    || fatal "bootstrap transaction payload or cursor digest is invalid"
  [ "$(wc -c <"$offsets_file" | tr -d '[:space:]')" -le 4194304 ] \
    && [ "$(wc -l <"$offsets_file" | tr -d '[:space:]')" -le 100000 ] \
    || fatal "bootstrap transaction cursor exceeds its reviewed bound"
  awk -F '\t' -v expected="$EXPECTED_JOURNAL_UNITS" \
    -v script_sha="$SELF_SHA256" -v program_sha="$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" \
    -v start="$TX_EVIDENCE_START_AT" -v reviewed="$REVIEWED_LOG_CURSOR_AWK_RE" '
    BEGIN {
      count=split(expected, units, " ")
      for (i=1; i<=count; i++) allowed[units[i]]=1
    }
    NR == 1 { if ($0 != "FORMAT_VERSION=4") bad=1; next }
    NR == 2 { if ($0 != "SHIP_LOGS_SHA256=" script_sha) bad=1; next }
    NR == 3 { if ($0 != "RECOVERY_PROGRAM_SET_SHA256=" program_sha) bad=1; next }
    NR == 4 { if ($0 != "LOG_EVIDENCE_START_AT=" start) bad=1; next }
    NR == 5 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_KEY=PENDING") bad=1; next }
    NR == 6 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_VERSION_ID=PENDING") bad=1; next }
    NR == 7 { if ($0 != "LOG_EVIDENCE_FIRST_OBJECT_SHA256=PENDING") bad=1; next }
    $1 == "FILE" {
      if (NF != 7 || $2 !~ reviewed ||
          $3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/ ||
          $6 !~ /^[0-9]+$/ || $7 !~ /^[0-9a-f]{64}$/) bad=1
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
  ' "$offsets_file" || fatal "bootstrap transaction cursor is malformed or incomplete"
}

persist_bootstrap_transaction() {
  local available transaction_cursor_sha
  [ "$EVIDENCE_BOOTSTRAP" -eq 1 ] \
    || fatal "only the initial evidence epoch may create a bootstrap transaction"
  [ ! -e "$BOOTSTRAP_TRANSACTION_DIR" ] && [ ! -L "$BOOTSTRAP_TRANSACTION_DIR" ] \
    && [ ! -e "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" ] && [ ! -L "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" ] \
    || fatal "a bootstrap transaction already exists"
  available="$(df -B1 --output=avail "$STATE_DIR" | tail -n 1 | tr -d '[:space:]')"
  [[ "$available" =~ ^[0-9]+$ ]] && [ "$available" -ge $((ENCRYPTED_BYTES + 67108864)) ] \
    || fatal "persistent state filesystem cannot hold the encrypted bootstrap transaction"
  mkdir -m 0700 -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" \
    || fatal "cannot create durable bootstrap transaction staging"
  [ "$(stat -c '%U:%G:%a' "$BOOTSTRAP_TRANSACTION_PREPARE_DIR")" = leaddrive-backup:leaddrive-backup:700 ] \
    || fatal "bootstrap transaction staging has unsafe ownership or mode"
  cp -- "$ENCRYPTED_FILE" "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/payload.age"
  cp -- "$NEW_STATE" "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/offsets.next"
  chmod 0600 -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/payload.age" \
    "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/offsets.next"
  transaction_cursor_sha="$(sha256sum "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/offsets.next" | awk '{print $1}')"
  [ "$transaction_cursor_sha" = "$EVIDENCE_CURSOR_SHA256" ] \
    || fatal "durable bootstrap cursor differs from the cursor sealed in the encrypted payload"
  printf '%s\n' \
    'FORMAT_VERSION=1' \
    'STATUS=PREPARED' \
    "LOG_EVIDENCE_START_AT=$LOG_EVIDENCE_START_AT" \
    "OBJECT_KEY=$OBJECT_KEY" \
    "CIPHERTEXT_SHA256=$ENCRYPTED_SHA256" \
    "CIPHERTEXT_BYTES=$ENCRYPTED_BYTES" \
    "SHIP_LOGS_SHA256=$SELF_SHA256" \
    "RECOVERY_PROGRAM_SET_SHA256=$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" \
    "RANGES_SHA256=$RANGES_SHA256" \
    "FILE_RANGE_COUNT=$EVIDENCE_FILE_RANGE_COUNT" \
    "FILE_RANGE_BYTES=$EVIDENCE_FILE_RANGE_BYTES" \
    "JOURNAL_RANGE_COUNT=$EVIDENCE_JOURNAL_RANGE_COUNT" \
    "CURSOR_SHA256=$transaction_cursor_sha" \
    "RETENTION_DAYS=$RETENTION_DAYS" \
    >"$BOOTSTRAP_TRANSACTION_PREPARE_DIR/transaction.env"
  chmod 0600 -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/transaction.env"
  sync -f -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/payload.age" \
    "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/offsets.next" \
    "$BOOTSTRAP_TRANSACTION_PREPARE_DIR/transaction.env" \
    "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" \
    || fatal "cannot durably stage the bootstrap transaction"
  load_bootstrap_transaction "$BOOTSTRAP_TRANSACTION_PREPARE_DIR"
  mv -T -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" "$BOOTSTRAP_TRANSACTION_DIR" \
    || fatal "cannot atomically publish the bootstrap transaction"
  sync -f -- "$BOOTSTRAP_TRANSACTION_DIR" "$STATE_DIR" \
    || fatal "cannot persist the published bootstrap transaction"
}

resume_bootstrap_transaction() {
  local head_state remote_bytes version_id remote_sha remote_format remote_start remote_bootstrap
  local remote_program remote_ranges remote_file_count remote_file_bytes remote_journal_count remote_cursor
  local retain_until retention_state remote_mode remote_until requested_epoch remote_epoch
  local head_status head_error="$WORK_DIR/bootstrap-head.err"
  local resumed_state="$WORK_DIR/bootstrap-offsets.next"

  load_bootstrap_transaction "$BOOTSTRAP_TRANSACTION_DIR"
  set +e
  head_state="$(aws s3api head-object "${S3_ARGS[@]}" \
    --bucket "$BACKUP_S3_BUCKET" --key "$TX_OBJECT_KEY" \
    --query '[ContentLength,VersionId,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256]' \
    --output text 2>"$head_error")"
  head_status=$?
  set -e
  if [ "$head_status" -eq 0 ]; then
    log "adopting the already uploaded exact bootstrap object after a prior interrupted run"
  elif grep -Eq '(\(404\)|Not Found|NoSuchKey)' "$head_error"; then
    log "uploading durable bootstrap log evidence to s3://$BACKUP_S3_BUCKET/$TX_OBJECT_KEY"
    aws s3 cp "$TX_PAYLOAD_FILE" "s3://$BACKUP_S3_BUCKET/$TX_OBJECT_KEY" \
      "${S3_ARGS[@]}" --only-show-errors --no-progress \
      --metadata "sha256=$TX_CIPHERTEXT_SHA256,format-version=4,evidence_start_at=$TX_EVIDENCE_START_AT,evidence_bootstrap=1,recovery_program_set_sha256=$TX_PROGRAM_SHA256,ranges_sha256=$TX_RANGES_SHA256,file_range_count=$TX_FILE_RANGE_COUNT,file_range_bytes=$TX_FILE_RANGE_BYTES,journal_range_count=$TX_JOURNAL_RANGE_COUNT,cursor_sha256=$TX_CURSOR_SHA256"
    head_state="$(aws s3api head-object "${S3_ARGS[@]}" \
      --bucket "$BACKUP_S3_BUCKET" --key "$TX_OBJECT_KEY" \
      --query '[ContentLength,VersionId,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256]' \
      --output text)" || fatal "cannot verify uploaded bootstrap log-evidence object"
  else
    fatal "cannot distinguish an absent bootstrap object from an S3/API failure"
  fi
  read -r remote_bytes version_id remote_sha remote_format remote_start remote_bootstrap \
    remote_program remote_ranges remote_file_count remote_file_bytes remote_journal_count remote_cursor \
    <<<"$head_state"
  [ "$remote_bytes" = "$TX_CIPHERTEXT_BYTES" ] \
    && [[ "$version_id" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
    && [ "$version_id" != None ] && [ "$version_id" != null ] \
    && [ "$remote_sha" = "$TX_CIPHERTEXT_SHA256" ] \
    && [ "$remote_format" = 4 ] \
    && [ "$remote_start" = "$TX_EVIDENCE_START_AT" ] \
    && [ "$remote_bootstrap" = 1 ] \
    && [ "$remote_program" = "$TX_PROGRAM_SHA256" ] \
    && [ "$remote_ranges" = "$TX_RANGES_SHA256" ] \
    && [ "$remote_file_count" = "$TX_FILE_RANGE_COUNT" ] \
    && [ "$remote_file_bytes" = "$TX_FILE_RANGE_BYTES" ] \
    && [ "$remote_journal_count" = "$TX_JOURNAL_RANGE_COUNT" ] \
    && [ "$remote_cursor" = "$TX_CURSOR_SHA256" ] \
    || fatal "uploaded bootstrap object differs from its durable transaction"
  retain_until="$(date -u -d "+$TX_RETENTION_DAYS days" '+%Y-%m-%dT%H:%M:%SZ')" \
    || fatal "cannot calculate bootstrap retention"
  aws s3api put-object-retention "${S3_ARGS[@]}" \
    --bucket "$BACKUP_S3_BUCKET" --key "$TX_OBJECT_KEY" --version-id="$version_id" \
    --retention "Mode=COMPLIANCE,RetainUntilDate=$retain_until" >/dev/null \
    || fatal "cannot lock uploaded bootstrap log evidence"
  retention_state="$(aws s3api get-object-retention "${S3_ARGS[@]}" \
    --bucket "$BACKUP_S3_BUCKET" --key "$TX_OBJECT_KEY" --version-id="$version_id" \
    --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)" \
    || fatal "cannot verify bootstrap log-evidence retention"
  read -r remote_mode remote_until <<<"$retention_state"
  requested_epoch="$(date -u -d "$retain_until" '+%s' 2>/dev/null || true)"
  remote_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null || true)"
  [ "$remote_mode" = COMPLIANCE ] && [[ "$remote_epoch" =~ ^[0-9]+$ ]] \
    && [[ "$requested_epoch" =~ ^[0-9]+$ ]] && [ "$remote_epoch" -ge "$requested_epoch" ] \
    || fatal "bootstrap log-evidence retention is shorter than the reviewed policy"

  cp -- "$TX_OFFSETS_FILE" "$resumed_state"
  NEW_STATE="$resumed_state"
  EVIDENCE_BOOTSTRAP=1
  LOG_EVIDENCE_START_AT="$TX_EVIDENCE_START_AT"
  finalize_evidence_bootstrap_state "$TX_OBJECT_KEY" "$version_id" "$TX_CIPHERTEXT_SHA256"
  commit_state
  sync -f -- "$STATE_FILE" "$STATE_DIR" \
    || fatal "cannot persist bootstrap transaction completion"
  # Keep the complete immutable transaction until the root deploy process has
  # independently proved cursor + exact S3 version + COMPLIANCE retention and
  # promoted the PENDING credential to a root-owned COMMITTED anchor. This
  # makes every crash boundary idempotently resumable; the unprivileged
  # shipper never tears down its own bootstrap evidence piecemeal.
  log "SUMMARY key=$TX_OBJECT_KEY version=$version_id bytes=$TX_CIPHERTEXT_BYTES bootstrap=1 retain_until=$remote_until"
}

# A crash after the encrypted payload is frozen must resume that exact payload
# and prescribed key. Never rescan into a second, silently shifted genesis.
if [ -e "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" ] || [ -L "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" ]; then
  [ ! -e "$BOOTSTRAP_TRANSACTION_DIR" ] && [ ! -L "$BOOTSTRAP_TRANSACTION_DIR" ] \
    || fatal "both preparing and published bootstrap transactions exist"
  load_bootstrap_transaction "$BOOTSTRAP_TRANSACTION_PREPARE_DIR"
  mv -T -- "$BOOTSTRAP_TRANSACTION_PREPARE_DIR" "$BOOTSTRAP_TRANSACTION_DIR" \
    || fatal "cannot publish recovered prepared bootstrap transaction"
  sync -f -- "$BOOTSTRAP_TRANSACTION_DIR" "$STATE_DIR" \
    || fatal "cannot persist recovered bootstrap transaction"
fi
if [ -e "$BOOTSTRAP_TRANSACTION_DIR" ] || [ -L "$BOOTSTRAP_TRANSACTION_DIR" ]; then
  resume_bootstrap_transaction
  ping_healthcheck || fatal "log-shipping success healthcheck did not acknowledge resumed bootstrap"
  SUCCESS=1
  exit 0
fi
if [ "$STATE_FORMAT" = 4 ] && [ "$GENESIS_CREDENTIAL_STATUS" = PENDING ]; then
  fatal "v4 cursor exists under a pending root genesis but its durable bootstrap transaction is missing"
fi

SHIPPED_BYTES=0
declare -a LOG_SOURCE_DIRS=()
declare -a LOG_SOURCE_FILES=()
declare -A SEEN_LOG_PATHS=()
declare -A SEEN_LOG_IDENTITIES=()
declare -A ACTIVE_CAPTURED_SIZES=()
declare -A ACTIVE_CAPTURED_WINDOWS=()
declare -A ACTIVE_CAPTURED_CHECKPOINTS=()
for LOG_DIR in $LOG_DIRS; do
  [ -d "$LOG_DIR" ] || fatal "configured log source directory is absent: $LOG_DIR"
  canonical_log_dir="$(realpath -e -- "$LOG_DIR")" || fatal "cannot canonicalize log source directory: $LOG_DIR"
  for prior_log_dir in "${LOG_SOURCE_DIRS[@]}"; do
    case "$canonical_log_dir" in
      "$prior_log_dir"|"$prior_log_dir"/*) fatal "overlapping log source directories are not allowed: $canonical_log_dir and $prior_log_dir" ;;
    esac
    case "$prior_log_dir" in
      "$canonical_log_dir"/*) fatal "overlapping log source directories are not allowed: $canonical_log_dir and $prior_log_dir" ;;
    esac
  done
  nested_log_mount="$(findmnt -rn -o TARGET | awk -v root="$canonical_log_dir/" '
    index($0, root) == 1 && $0 != "/var/log/journal" { print; exit }
  ')"
  [ -z "$nested_log_mount" ] \
    || fatal "log source root contains an unreviewed nested mount: $nested_log_mount"
  LOG_SOURCE_DIRS+=("$canonical_log_dir")
done
for LOG_FILE in $LOG_FILES; do
  [ -f "$LOG_FILE" ] && [ ! -L "$LOG_FILE" ] \
    || fatal "configured exact log source is absent, non-regular, or symlinked: $LOG_FILE"
  canonical_log_file="$(realpath -e -- "$LOG_FILE")" \
    || fatal "cannot canonicalize exact log source: $LOG_FILE"
  [ "$canonical_log_file" = "$LOG_FILE" ] \
    || fatal "configured exact log source is not canonical: $LOG_FILE"
  assert_safe_log_path "$canonical_log_file"
  LOG_SOURCE_FILES+=("$canonical_log_file")
done

[ -d /var/log/journal ] && [ ! -L /var/log/journal ] \
  && [ "$(realpath -e -- /var/log/journal 2>/dev/null || true)" = /var/log/journal ] \
  && [ "$(findmnt -n -o FSTYPE --target /var/log/journal 2>/dev/null || true)" != tmpfs ] \
  || fatal "systemd journal must have the reviewed persistent-storage directory"

if [ "$STATE_FORMAT" = 2 ]; then
  while IFS=$'\t' read -r prior_path _; do
    [ -n "$prior_path" ] || continue
    assert_safe_log_path "$prior_path"
  done < <(tail -n +2 -- "$STATE_FILE")
elif [ "$STATE_FORMAT" = 3 ] || [ "$STATE_FORMAT" = 4 ]; then
  while IFS= read -r prior_path; do
    [ -n "$prior_path" ] || continue
    assert_safe_log_path "$prior_path"
  done < <(awk -F '\t' '$1 == "FILE" { print $2 }' "$STATE_FILE")
elif [ "$STATE_FORMAT" = 1 ]; then
  while read -r prior_path _; do
    [ -n "$prior_path" ] || continue
    assert_safe_log_path "$prior_path"
  done <"$STATE_FILE"
fi

BOOTSTRAP_FILE_COUNT=0
BOOTSTRAP_SOURCE_BYTES=0
BOOTSTRAP_JOURNAL_STORAGE_BYTES=0
if [ "$EVIDENCE_BOOTSTRAP" -eq 1 ]; then
  BOOTSTRAP_ALL_INVENTORY="$WORK_DIR/bootstrap-all-logs.nul"
  : >"$BOOTSTRAP_ALL_INVENTORY"
  for LOG_DIR in "${LOG_SOURCE_DIRS[@]}"; do
    find "$LOG_DIR" -xdev -maxdepth 1 -type f \
      \( -name '*.log' -o -name '*.log.*' -o -name '*.log-*' \) \
      -print0 >>"$BOOTSTRAP_ALL_INVENTORY" \
      || fatal "cannot inventory bootstrap log evidence below $LOG_DIR"
  done
  for LOG_FILE in "${LOG_SOURCE_FILES[@]}"; do
    printf '%s\0' "$LOG_FILE" >>"$BOOTSTRAP_ALL_INVENTORY"
    log_parent="$(dirname -- "$LOG_FILE")"
    log_basename="$(basename -- "$LOG_FILE")"
    find "$log_parent" -xdev -maxdepth 1 -type f \
      \( -name "$log_basename.*" -o -name "$log_basename-*" \) \
      -print0 >>"$BOOTSTRAP_ALL_INVENTORY" \
      || fatal "cannot inventory rotations for exact log source $LOG_FILE"
  done
  declare -A BOOTSTRAP_PREFLIGHT_IDENTITIES=()
  while IFS= read -r -d '' bootstrap_source; do
    [[ "$bootstrap_source" != *$'\t'* ]] && [[ "$bootstrap_source" != *$'\n'* ]] \
      && [[ "$bootstrap_source" != *$'\r'* ]] \
      || fatal "bootstrap log path cannot be represented safely in evidence"
      assert_safe_log_path "$bootstrap_source"
      [ -r "$bootstrap_source" ] && [ ! -L "$bootstrap_source" ] \
      && [ "$(realpath -e -- "$bootstrap_source" 2>/dev/null || true)" = "$bootstrap_source" ] \
      || fatal "bootstrap log source is unreadable, symlinked, or non-canonical: $bootstrap_source"
    bootstrap_identity="$(stat -Lc '%d:%i' "$bootstrap_source")"
    [ -z "${BOOTSTRAP_PREFLIGHT_IDENTITIES[$bootstrap_identity]:-}" ] \
      || fatal "bootstrap log paths alias one inode: $bootstrap_source"
    BOOTSTRAP_PREFLIGHT_IDENTITIES["$bootstrap_identity"]="$bootstrap_source"
    bootstrap_size="$(stat -Lc '%s' "$bootstrap_source")"
    [[ "$bootstrap_size" =~ ^[0-9]+$ ]] \
      || fatal "bootstrap log source has an invalid size: $bootstrap_source"
    BOOTSTRAP_FILE_COUNT=$((BOOTSTRAP_FILE_COUNT + 1))
    [ "$BOOTSTRAP_FILE_COUNT" -le 100000 ] \
      || fatal "bootstrap log inventory exceeds the reviewed 100000-file bound"
    BOOTSTRAP_SOURCE_BYTES=$((BOOTSTRAP_SOURCE_BYTES + bootstrap_size))
    [ "$BOOTSTRAP_SOURCE_BYTES" -le 1099511627776 ] \
      || fatal "bootstrap log inventory exceeds the reviewed 1 TiB source bound"
  done <"$BOOTSTRAP_ALL_INVENTORY"
  BOOTSTRAP_JOURNAL_STORAGE_BYTES="$(du -sb -- /var/log/journal | awk '{print $1}')"
  [[ "$BOOTSTRAP_JOURNAL_STORAGE_BYTES" =~ ^[0-9]+$ ]] \
    && [ "$BOOTSTRAP_JOURNAL_STORAGE_BYTES" -le 1099511627776 ] \
    || fatal "persistent journal storage exceeds the reviewed bootstrap bound"
  bootstrap_required_bytes=$((
    (BOOTSTRAP_SOURCE_BYTES * 3) +
    (BOOTSTRAP_JOURNAL_STORAGE_BYTES * 5) +
    536870912
  ))
  bootstrap_available_bytes="$(df -B1 --output=avail "$WORK_ROOT" | tail -n 1 | tr -d '[:space:]')"
  [[ "$bootstrap_available_bytes" =~ ^[0-9]+$ ]] \
    && [ "$bootstrap_available_bytes" -ge "$bootstrap_required_bytes" ] \
    || fatal "log-evidence bootstrap tmpfs capacity is below the conservative source+journal packaging bound"
fi

# The first v4 evidence object establishes an honest coverage watermark. Ship
# every retained rotation below the reviewed roots once, including orphaned
# .log.N/.gz files whose active .log no longer exists. Later runs follow only
# authenticated active-file cursors and recover rotations from those cursors.
if [ "$EVIDENCE_BOOTSTRAP" -eq 1 ]; then
  declare -A BOOTSTRAP_ROTATION_IDENTITIES=()
  declare -A BOOTSTRAP_ROTATION_SIZES=()
  declare -A BOOTSTRAP_ROTATION_WINDOWS=()
  declare -A BOOTSTRAP_ROTATION_CHECKPOINTS=()
  BOOTSTRAP_INDEX=0
  for LOG_DIR in "${LOG_SOURCE_DIRS[@]}"; do
    BOOTSTRAP_INDEX=$((BOOTSTRAP_INDEX + 1))
    BOOTSTRAP_INVENTORY="$WORK_DIR/bootstrap-rotations-${BOOTSTRAP_INDEX}.nul"
    find "$LOG_DIR" -xdev -maxdepth 1 -type f \
      \( -name '*.log.*' -o -name '*.log-*' \) -print0 | sort -z >"$BOOTSTRAP_INVENTORY" \
      || fatal "cannot enumerate retained log rotations below $LOG_DIR"
    while IFS= read -r -d '' rotated; do
      [[ "$rotated" != *$'\t'* ]] && [[ "$rotated" != *$'\n'* ]] && [[ "$rotated" != *$'\r'* ]] \
        || fatal "retained log path cannot be represented safely in evidence"
      assert_safe_log_path "$rotated"
      [ -r "$rotated" ] && [ ! -L "$rotated" ] \
        && [ "$(realpath -e -- "$rotated" 2>/dev/null || true)" = "$rotated" ] \
        || fatal "retained log rotation is unreadable, symlinked, or non-canonical: $rotated"
      exec {rotated_fd}<"$rotated" || fatal "cannot open retained log rotation: $rotated"
      rotated_ref="/proc/self/fd/$rotated_fd"
      rotated_identity="$(stat -Lc '%d:%i' "$rotated_ref")"
      [ -z "${BOOTSTRAP_ROTATION_IDENTITIES[$rotated_identity]:-}" ] \
        || fatal "retained log rotations alias one inode: $rotated"
      BOOTSTRAP_ROTATION_IDENTITIES["$rotated_identity"]="$rotated"
      rotated_size="$(stat -Lc '%s' "$rotated_ref")"
      BOOTSTRAP_ROTATION_SIZES["$rotated_identity"]="$rotated_size"
      [ "$rotated_size" -gt 4096 ] && rotated_window=4096 || rotated_window="$rotated_size"
      if [ "$rotated_window" -eq 0 ]; then
        rotated_checkpoint=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      else
        rotated_checkpoint="$(checkpoint_sha "$rotated_ref" "$rotated_size" "$rotated_window")" \
          || fatal "cannot authenticate retained log rotation during bootstrap: $rotated"
      fi
      BOOTSTRAP_ROTATION_WINDOWS["$rotated_identity"]="$rotated_window"
      BOOTSTRAP_ROTATION_CHECKPOINTS["$rotated_identity"]="$rotated_checkpoint"
      ship_range "$rotated_ref" "$rotated" 0 "$rotated_size"
      exec {rotated_fd}<&-
    done <"$BOOTSTRAP_INVENTORY"
  done
  for LOG_FILE in "${LOG_SOURCE_FILES[@]}"; do
    BOOTSTRAP_INDEX=$((BOOTSTRAP_INDEX + 1))
    BOOTSTRAP_INVENTORY="$WORK_DIR/bootstrap-rotations-${BOOTSTRAP_INDEX}.nul"
    log_parent="$(dirname -- "$LOG_FILE")"
    log_basename="$(basename -- "$LOG_FILE")"
    find "$log_parent" -xdev -maxdepth 1 -type f \
      \( -name "$log_basename.*" -o -name "$log_basename-*" \) \
      -print0 | sort -z >"$BOOTSTRAP_INVENTORY" \
      || fatal "cannot enumerate retained rotations for exact log source $LOG_FILE"
    while IFS= read -r -d '' rotated; do
      [[ "$rotated" != *$'\t'* ]] && [[ "$rotated" != *$'\n'* ]] && [[ "$rotated" != *$'\r'* ]] \
        || fatal "retained log path cannot be represented safely in evidence"
      assert_safe_log_path "$rotated"
      [ -r "$rotated" ] && [ ! -L "$rotated" ] \
        && [ "$(realpath -e -- "$rotated" 2>/dev/null || true)" = "$rotated" ] \
        || fatal "retained log rotation is unreadable, symlinked, or non-canonical: $rotated"
      exec {rotated_fd}<"$rotated" || fatal "cannot open retained log rotation: $rotated"
      rotated_ref="/proc/self/fd/$rotated_fd"
      rotated_identity="$(stat -Lc '%d:%i' "$rotated_ref")"
      [ -z "${BOOTSTRAP_ROTATION_IDENTITIES[$rotated_identity]:-}" ] \
        || fatal "retained log rotations alias one inode: $rotated"
      BOOTSTRAP_ROTATION_IDENTITIES["$rotated_identity"]="$rotated"
      rotated_size="$(stat -Lc '%s' "$rotated_ref")"
      BOOTSTRAP_ROTATION_SIZES["$rotated_identity"]="$rotated_size"
      [ "$rotated_size" -gt 4096 ] && rotated_window=4096 || rotated_window="$rotated_size"
      if [ "$rotated_window" -eq 0 ]; then
        rotated_checkpoint=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      else
        rotated_checkpoint="$(checkpoint_sha "$rotated_ref" "$rotated_size" "$rotated_window")" \
          || fatal "cannot authenticate retained log rotation during bootstrap: $rotated"
      fi
      BOOTSTRAP_ROTATION_WINDOWS["$rotated_identity"]="$rotated_window"
      BOOTSTRAP_ROTATION_CHECKPOINTS["$rotated_identity"]="$rotated_checkpoint"
      ship_range "$rotated_ref" "$rotated" 0 "$rotated_size"
      exec {rotated_fd}<&-
    done <"$BOOTSTRAP_INVENTORY"
  done
fi

SOURCE_INVENTORY="$WORK_DIR/log-sources.nul"
: >"$SOURCE_INVENTORY"
for LOG_DIR in "${LOG_SOURCE_DIRS[@]}"; do
  find "$LOG_DIR" -xdev -maxdepth 1 -type f -name '*.log' -print0 >>"$SOURCE_INVENTORY" \
    || fatal "cannot enumerate every configured log source below $LOG_DIR"
done
for LOG_FILE in "${LOG_SOURCE_FILES[@]}"; do
  printf '%s\0' "$LOG_FILE" >>"$SOURCE_INVENTORY"
done
while IFS= read -r -d '' source; do
    local_cursor=""
    assert_safe_log_path "$source"
    [ -r "$source" ] && [ ! -L "$source" ] \
      && [ "$(realpath -e -- "$source" 2>/dev/null || true)" = "$source" ] \
      || fatal "configured log source is unreadable, symlinked, non-canonical, or unsafe: $source"
    SEEN_LOG_PATHS["$source"]=1
    exec {source_fd}<"$source" || fatal "cannot open log source: $source"
    source_ref="/proc/self/fd/$source_fd"
    device="$(stat -Lc '%d' "$source_ref")"
    inode="$(stat -Lc '%i' "$source_ref")"
    [ -z "${SEEN_LOG_IDENTITIES[$device:$inode]:-}" ] \
      || fatal "active log paths alias one inode: $source"
    SEEN_LOG_IDENTITIES["$device:$inode"]="$source"
    size="$(stat -Lc '%s' "$source_ref")"
    ACTIVE_CAPTURED_SIZES["$device:$inode"]="$size"
    [ "$size" -gt 4096 ] && cursor_window=4096 || cursor_window="$size"
    if [ "$cursor_window" -eq 0 ]; then
      captured_checkpoint="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    else
      captured_checkpoint="$(checkpoint_sha "$source_ref" "$size" "$cursor_window")" \
        || fatal "cannot capture a stable initial checkpoint for $source"
    fi
    ACTIVE_CAPTURED_WINDOWS["$device:$inode"]="$cursor_window"
    ACTIVE_CAPTURED_CHECKPOINTS["$device:$inode"]="$captured_checkpoint"

    if [ "$EVIDENCE_BOOTSTRAP" -eq 1 ]; then
      ship_range "$source_ref" "$source" 0 "$size"
    elif [ "$STATE_FORMAT" = "1" ]; then
      offset="$(stored_legacy_offset "$source")"
      if [ "$offset" -gt 0 ] && [ -r "$source.1" ]; then
        exec {rotated_fd}<"$source.1" || fatal "cannot open legacy rotated log: $source.1"
        rotated_ref="/proc/self/fd/$rotated_fd"
        rotated_size="$(stat -Lc '%s' "$rotated_ref")"
        if [ "$rotated_size" -ge "$offset" ]; then
          ship_range "$rotated_ref" "${source}.1#legacy-tail-from-${offset}" "$offset" "$rotated_size"
        fi
        exec {rotated_fd}<&-
      fi
      # The legacy cursor has no identity/checkpoint, so replay the complete
      # current file. Duplicates are safe; guessing an offset is not.
      ship_range "$source_ref" "$source" 0 "$size"
    else
      local_cursor="$(stored_cursor "$source")" \
        || fatal "duplicate or unreadable log cursor for $source"
      if [ -z "$local_cursor" ]; then
        ship_range "$source_ref" "$source" 0 "$size"
      else
        IFS=$'\t' read -r stored_device stored_inode offset stored_window stored_checkpoint \
          <<<"$local_cursor"
        if [ "$offset" -eq 0 ]; then
          # The empty SHA-256 checkpoint cannot reveal a copytruncate that
          # happened between runs. Replay retained siblings conservatively
          # before reading the current inode from byte zero.
          recover_previous_tail "$source" "$stored_device" "$stored_inode" \
            "$offset" "$stored_window" "$stored_checkpoint" 0
          ship_range "$source_ref" "$source" 0 "$size"
          write_cursor "$source" "$source_ref" "$device" "$inode" "$size" \
            "$cursor_window" "$captured_checkpoint"
          exec {source_fd}<&-
          continue
        fi
        current_checkpoint=""
        if [ "$size" -ge "$offset" ] && [ "$stored_window" -le "$offset" ]; then
          if [ "$stored_window" -eq 0 ]; then
            current_checkpoint="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
          else
            current_checkpoint="$(checkpoint_sha "$source_ref" "$offset" "$stored_window" 2>/dev/null || true)"
          fi
        fi
        if [ "$device:$inode" = "$stored_device:$stored_inode" ] \
          && [ "$current_checkpoint" = "$stored_checkpoint" ]; then
          ship_range "$source_ref" "$source" "$offset" "$size"
        else
          recover_previous_tail "$source" "$stored_device" "$stored_inode" \
            "$offset" "$stored_window" "$stored_checkpoint"
          ship_range "$source_ref" "$source" 0 "$size"
        fi
      fi
    fi
    write_cursor "$source" "$source_ref" "$device" "$inode" "$size" \
      "$cursor_window" "$captured_checkpoint"
    exec {source_fd}<&-
done <"$SOURCE_INVENTORY"

# Close the bootstrap rotation window. A busy log can be renamed after the
# retained-rotation inventory but before (or while) the active file is opened.
# Rescan every reviewed directory after active capture and ship either the
# newly observed rotation or the bytes appended to an already captured inode.
# A later run may conservatively duplicate the same tail from its cursor; that
# is preferable to an unadvertised gap in the first immutable evidence object.
bootstrap_rescan_rotations() {
  [ "$EVIDENCE_BOOTSTRAP" -eq 1 ] || return 0
  local LOG_DIR LOG_FILE log_parent log_basename rotated rotated_fd rotated_ref rotated_identity rotated_size prior_size
  local prior_window prior_checkpoint observed_checkpoint
  local BOOTSTRAP_RESCAN_INVENTORY="$WORK_DIR/bootstrap-rotation-rescan.nul"
  local -A BOOTSTRAP_RESCAN_IDENTITIES=()
  : >"$BOOTSTRAP_RESCAN_INVENTORY"
  for LOG_DIR in "${LOG_SOURCE_DIRS[@]}"; do
    find "$LOG_DIR" -xdev -maxdepth 1 -type f \
      \( -name '*.log.*' -o -name '*.log-*' \) -print0 >>"$BOOTSTRAP_RESCAN_INVENTORY" \
      || fatal "cannot rescan retained log rotations below $LOG_DIR"
  done
  for LOG_FILE in "${LOG_SOURCE_FILES[@]}"; do
    log_parent="$(dirname -- "$LOG_FILE")"
    log_basename="$(basename -- "$LOG_FILE")"
    find "$log_parent" -xdev -maxdepth 1 -type f \
      \( -name "$log_basename.*" -o -name "$log_basename-*" \) \
      -print0 >>"$BOOTSTRAP_RESCAN_INVENTORY" \
      || fatal "cannot rescan retained rotations for exact log source $LOG_FILE"
  done
  while IFS= read -r -d '' rotated; do
      assert_safe_log_path "$rotated"
      [ -r "$rotated" ] && [ ! -L "$rotated" ] \
        && [ "$(realpath -e -- "$rotated" 2>/dev/null || true)" = "$rotated" ] \
        || fatal "rescanned log rotation is unreadable, symlinked, or non-canonical: $rotated"
      exec {rotated_fd}<"$rotated" || fatal "cannot open rescanned log rotation: $rotated"
      rotated_ref="/proc/self/fd/$rotated_fd"
      rotated_identity="$(stat -Lc '%d:%i' "$rotated_ref")"
      [ -z "${BOOTSTRAP_RESCAN_IDENTITIES[$rotated_identity]:-}" ] \
        || fatal "rescanned log rotations alias one inode: $rotated"
      BOOTSTRAP_RESCAN_IDENTITIES["$rotated_identity"]="$rotated"
      rotated_size="$(stat -Lc '%s' "$rotated_ref")"
      if [ -n "${BOOTSTRAP_ROTATION_SIZES[$rotated_identity]:-}" ]; then
        prior_size="${BOOTSTRAP_ROTATION_SIZES[$rotated_identity]}"
        prior_window="${BOOTSTRAP_ROTATION_WINDOWS[$rotated_identity]}"
        prior_checkpoint="${BOOTSTRAP_ROTATION_CHECKPOINTS[$rotated_identity]}"
        observed_checkpoint=""
        if [ "$prior_size" -gt 0 ] && [ "$rotated_size" -ge "$prior_size" ]; then
          observed_checkpoint="$(checkpoint_sha "$rotated_ref" "$prior_size" "$prior_window" 2>/dev/null || true)"
        fi
        if [ "$observed_checkpoint" = "$prior_checkpoint" ] && [ "$prior_size" -gt 0 ]; then
          ship_range "$rotated_ref" "${rotated}#bootstrap-rescan-tail-from-${prior_size}" \
            "$prior_size" "$rotated_size"
        else
          log "rotation identity was reused or changed during bootstrap; replaying complete file: $rotated"
          ship_range "$rotated_ref" "${rotated}#bootstrap-rescan-conservative" 0 "$rotated_size"
        fi
      elif [ -n "${ACTIVE_CAPTURED_SIZES[$rotated_identity]:-}" ]; then
        prior_size="${ACTIVE_CAPTURED_SIZES[$rotated_identity]}"
        prior_window="${ACTIVE_CAPTURED_WINDOWS[$rotated_identity]}"
        prior_checkpoint="${ACTIVE_CAPTURED_CHECKPOINTS[$rotated_identity]}"
        observed_checkpoint=""
        if [ "$prior_size" -gt 0 ] && [ "$rotated_size" -ge "$prior_size" ]; then
          observed_checkpoint="$(checkpoint_sha "$rotated_ref" "$prior_size" "$prior_window" 2>/dev/null || true)"
        fi
        if [ "$observed_checkpoint" = "$prior_checkpoint" ] && [ "$prior_size" -gt 0 ]; then
          ship_range "$rotated_ref" "${rotated}#bootstrap-post-active-tail-from-${prior_size}" \
            "$prior_size" "$rotated_size"
        else
          log "active-log identity was reused or changed during bootstrap; replaying complete rotation: $rotated"
          ship_range "$rotated_ref" "${rotated}#bootstrap-post-active-conservative" 0 "$rotated_size"
        fi
      else
        ship_range "$rotated_ref" "${rotated}#bootstrap-post-active" 0 "$rotated_size"
      fi
      exec {rotated_fd}<&-
  done < <(sort -zu -- "$BOOTSTRAP_RESCAN_INVENTORY")
}

bootstrap_rescan_rotations

# Never let a temporary missing active path or a discovery regression silently
# delete its durable cursor. Recover the last known tail from a rotated sibling
# now; if that is impossible, fail before upload and keep the old state intact.
# A v4 bootstrap deliberately begins a new, explicit evidence watermark and
# has already copied every retained rotation; it does not claim deleted history.
if [ "$EVIDENCE_BOOTSTRAP" -eq 0 ] && [ "$STATE_FORMAT" = "2" ]; then
  while IFS=$'\t' read -r prior_path stored_device stored_inode offset stored_window stored_checkpoint; do
    [ -n "$prior_path" ] || continue
    [ -z "${SEEN_LOG_PATHS[$prior_path]:-}" ] || continue
    recover_previous_tail "$prior_path" "$stored_device" "$stored_inode" \
      "$offset" "$stored_window" "$stored_checkpoint" 1
    log "retiring recovered cursor whose active path is absent: $prior_path"
  done < <(tail -n +2 -- "$STATE_FILE")
elif [ "$EVIDENCE_BOOTSTRAP" -eq 0 ] \
    && { [ "$STATE_FORMAT" = "3" ] || [ "$STATE_FORMAT" = "4" ]; }; then
  while IFS=$'\t' read -r prior_path stored_device stored_inode offset stored_window stored_checkpoint; do
    [ -n "$prior_path" ] || continue
    [ -z "${SEEN_LOG_PATHS[$prior_path]:-}" ] || continue
    recover_previous_tail "$prior_path" "$stored_device" "$stored_inode" \
      "$offset" "$stored_window" "$stored_checkpoint" 1
    log "retiring recovered cursor whose active path is absent: $prior_path"
  done < <(awk -F '\t' '$1 == "FILE" { print $2 "\t" $3 "\t" $4 "\t" $5 "\t" $6 "\t" $7 }' "$STATE_FILE")
elif [ "$EVIDENCE_BOOTSTRAP" -eq 0 ] && [ "$STATE_FORMAT" = "1" ]; then
  while read -r prior_path offset extra; do
    [ -n "$prior_path" ] || continue
    [ -z "$extra" ] || fatal "legacy log cursor contains an unsafe path"
    [ -z "${SEEN_LOG_PATHS[$prior_path]:-}" ] || continue
    [ "$offset" -eq 0 ] \
      || fatal "legacy cursor path disappeared before an authenticated checkpoint could recover it: $prior_path"
  done <"$STATE_FILE"
fi

# A wall-clock lookback loses evidence after one delayed or failed upload.
# Export each reviewed unit from its opaque journald cursor and stage the next
# cursor from the terminal marker produced by that same command. The marker is
# committed together with file offsets only after the exact immutable object is
# verified below. A vacuumed/invalid cursor is a hard failure: silently falling
# back to time would hide a gap.
SHIPPED_JOURNAL_BYTES=0
read -r -a REVIEWED_JOURNAL_UNITS <<<"$JOURNAL_UNITS"
for unit in "${REVIEWED_JOURNAL_UNITS[@]}"; do
  if [ "$EVIDENCE_BOOTSTRAP" -eq 1 ]; then
    old_journal_cursor=NO_CURSOR
  else
    old_journal_cursor="$(stored_journal_cursor "$unit")" \
      || fatal "required journal cursor is missing or duplicated for $unit"
  fi
  journal_raw="$WORK_DIR/journal-${unit}.raw"
  journal_slice="$SLICE_DIR/journal__${unit}.log"
  journal_args=(-q -u "$unit" --no-pager --output=short-iso-precise --show-cursor)
  if [ "$old_journal_cursor" != NO_CURSOR ]; then
    journal_args+=(--after-cursor="$old_journal_cursor")
  fi
  journal_available_bytes="$(df -B1 --output=avail "$WORK_ROOT" | tail -n 1 | tr -d '[:space:]')"
  [[ "$journal_available_bytes" =~ ^[0-9]+$ ]] && [ "$journal_available_bytes" -gt 268435456 ] \
    || fatal "journal export has insufficient tmpfs headroom for $unit"
  journal_limit_blocks=$(((journal_available_bytes - 268435456) / 1024))
  [ "$journal_limit_blocks" -ge 1 ] \
    || fatal "journal export has no bounded file budget for $unit"
  set +e
  (ulimit -f "$journal_limit_blocks"; journalctl "${journal_args[@]}" >"$journal_raw" 2>/dev/null)
  journal_status=$?
  set -e
  [ "$journal_status" -eq 0 ] \
    || fatal "cannot continue required bounded systemd journal cursor for $unit"
  terminal_line="$(tail -n 1 -- "$journal_raw" 2>/dev/null || true)"
  if [[ "$terminal_line" =~ ^--\ cursor:\ (.+)$ ]]; then
    next_journal_cursor="${BASH_REMATCH[1]}"
    [[ "$next_journal_cursor" =~ ^[!-~]{1,2048}$ ]] \
      || fatal "journalctl returned an unsafe cursor for $unit"
    journal_raw_bytes="$(wc -c <"$journal_raw" | tr -d '[:space:]')"
    assert_work_capacity $((journal_raw_bytes + 268435456)) "journal slice staging"
    sed '$d' "$journal_raw" >"$journal_slice" \
      || fatal "cannot remove terminal journal cursor marker for $unit"
  elif [ "$old_journal_cursor" = NO_CURSOR ] \
      && { [ ! -s "$journal_raw" ] || [ "$terminal_line" = "-- No entries --" ]; }; then
    # The unit has never written a retained record. Preserve an explicit
    # bootstrap sentinel and retry the full retained history next run.
    next_journal_cursor=NO_CURSOR
    : >"$journal_slice"
  else
    fatal "journal export for $unit has no terminal cursor; refusing a gap-prone fallback"
  fi
  printf 'JOURNAL\t%s\t%s\n' "$unit" "$next_journal_cursor" >>"$NEW_STATE"
  journal_bytes="$(wc -c <"$journal_slice" | tr -d '[:space:]')"
  if [ "$journal_bytes" -gt 0 ]; then
    printf 'JOURNAL\t%s\t%s\t%s\t%s\t%s\n' \
      "$(basename -- "$journal_slice")" "$unit" "$old_journal_cursor" \
      "$next_journal_cursor" "$journal_bytes" >>"$RANGE_INDEX"
  fi
  SHIPPED_JOURNAL_BYTES=$((SHIPPED_JOURNAL_BYTES + journal_bytes))
done

maintain_first_evidence_retention

if [ -z "$(find "$SLICE_DIR" -type f -size +0c -print -quit)" ]; then
  [ "$EVIDENCE_BOOTSTRAP" -eq 0 ] \
    || fatal "cannot establish the initial immutable log-evidence watermark from an empty export"
  log "nothing new to ship"
  commit_state
  ping_healthcheck
  SUCCESS=1
  exit 0
fi

EVIDENCE_FILE_RANGE_COUNT="$(awk -F '\t' '$1 == "FILE" { count++ } END { print count + 0 }' "$RANGE_INDEX")"
EVIDENCE_FILE_RANGE_BYTES="$(awk -F '\t' '$1 == "FILE" { total += $6 } END { printf "%.0f\n", total + 0 }' "$RANGE_INDEX")"
EVIDENCE_JOURNAL_RANGE_COUNT="$(awk -F '\t' '$1 == "JOURNAL" { count++ } END { print count + 0 }' "$RANGE_INDEX")"
[[ "$EVIDENCE_FILE_RANGE_COUNT" =~ ^[0-9]+$ ]] \
  && [[ "$EVIDENCE_FILE_RANGE_BYTES" =~ ^[0-9]+$ ]] \
  && [[ "$EVIDENCE_JOURNAL_RANGE_COUNT" =~ ^[0-9]+$ ]] \
  || fatal "log evidence range counts are malformed"
cp -- "$RANGE_INDEX" "$SLICE_DIR/RANGES.tsv"
RANGES_SHA256="$(sha256sum "$SLICE_DIR/RANGES.tsv" | awk '{print $1}')"
[[ "$RANGES_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fatal "log evidence range index digest is malformed"
cp -- "$NEW_STATE" "$SLICE_DIR/cursor.next"
EVIDENCE_CURSOR_SHA256="$(sha256sum "$SLICE_DIR/cursor.next" | awk '{print $1}')"
[[ "$EVIDENCE_CURSOR_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fatal "next log-evidence cursor digest is malformed"

cat >"$SLICE_DIR/manifest.env" <<MANIFEST
TIMESTAMP=$TIMESTAMP
HOSTNAME=$(hostname)
SOURCE_DIRS=$LOG_DIRS
SOURCE_FILES=$LOG_FILES
JOURNAL_UNITS=$JOURNAL_UNITS
APPENDED_BYTES=$SHIPPED_BYTES
JOURNAL_BYTES=$SHIPPED_JOURNAL_BYTES
LOG_EVIDENCE_START_AT=$LOG_EVIDENCE_START_AT
EVIDENCE_BOOTSTRAP=$EVIDENCE_BOOTSTRAP
FILE_RANGE_COUNT=$EVIDENCE_FILE_RANGE_COUNT
FILE_RANGE_BYTES=$EVIDENCE_FILE_RANGE_BYTES
JOURNAL_RANGE_COUNT=$EVIDENCE_JOURNAL_RANGE_COUNT
CURSOR_SHA256=$EVIDENCE_CURSOR_SHA256
RETENTION_DAYS=$RETENTION_DAYS
FORMAT_VERSION=4
MANIFEST

staged_payload_bytes="$(du -sb -- "$SLICE_DIR" | awk '{print $1}')"
[[ "$staged_payload_bytes" =~ ^[0-9]+$ ]] \
  || fatal "staged log-evidence payload size is invalid"
assert_work_capacity $(((staged_payload_bytes * 3) + 268435456)) \
  "compressed and encrypted log packaging"

(cd "$SLICE_DIR" && sha256sum -- * >SHA256SUMS)

# gzip before age, never after: ciphertext does not compress. Logs are text and
# shrink roughly tenfold, which is the difference between shipping the day's
# rotated access log in seconds and in minutes.
PACKAGE_FILE="$WORK_DIR/leaddrive-logs-${TIMESTAMP}.tar.gz"
ENCRYPTED_FILE="$PACKAGE_FILE.age"
tar -C "$SLICE_DIR" -czf "$PACKAGE_FILE" .
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$ENCRYPTED_FILE" "$PACKAGE_FILE"
rm -f -- "$PACKAGE_FILE"

ENCRYPTED_BYTES="$(wc -c <"$ENCRYPTED_FILE" | tr -d '[:space:]')"
ENCRYPTED_SHA256="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"

lock_state="$(aws s3api get-object-lock-configuration \
  "${S3_ARGS[@]}" --bucket "$BACKUP_S3_BUCKET" \
  --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode]' \
  --output text)"
read -r lock_enabled lock_mode <<<"$lock_state"
[ "$lock_enabled" = "Enabled" ] || fatal "S3 bucket Object Lock is not enabled"
[ "$lock_mode" = "COMPLIANCE" ] || fatal "S3 bucket default retention must use COMPLIANCE mode"

if [ "$EVIDENCE_BOOTSTRAP" -eq 1 ]; then
  OBJECT_KEY="$PRESCRIBED_BOOTSTRAP_OBJECT_KEY"
  [[ "$OBJECT_KEY" =~ ^logs/[0-9]{4}/[0-9]{2}/leaddrive-logs-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$ ]] \
    || fatal "root-prescribed bootstrap object key is malformed"
  persist_bootstrap_transaction
  resume_bootstrap_transaction
  ping_healthcheck || fatal "log-shipping success healthcheck did not acknowledge bootstrap"
  SUCCESS=1
  exit 0
fi
IFS= read -r OBJECT_NONCE </proc/sys/kernel/random/uuid \
  || fatal "cannot allocate a cryptographically random object-key nonce"
[[ "$OBJECT_NONCE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fatal "kernel object-key nonce has an unexpected format"
OBJECT_KEY="$S3_PREFIX/$(date -u '+%Y/%m')/leaddrive-logs-${TIMESTAMP}-${OBJECT_NONCE}.tar.gz.age"
log "uploading encrypted log slice to s3://$BACKUP_S3_BUCKET/$OBJECT_KEY"
aws s3 cp "$ENCRYPTED_FILE" "s3://$BACKUP_S3_BUCKET/$OBJECT_KEY" \
  "${S3_ARGS[@]}" --only-show-errors --no-progress \
  --metadata "sha256=$ENCRYPTED_SHA256,format-version=4,evidence_start_at=$LOG_EVIDENCE_START_AT,evidence_bootstrap=$EVIDENCE_BOOTSTRAP,recovery_program_set_sha256=$ACTIVE_RECOVERY_PROGRAM_SET_SHA256,ranges_sha256=$RANGES_SHA256,file_range_count=$EVIDENCE_FILE_RANGE_COUNT,file_range_bytes=$EVIDENCE_FILE_RANGE_BYTES,journal_range_count=$EVIDENCE_JOURNAL_RANGE_COUNT,cursor_sha256=$EVIDENCE_CURSOR_SHA256"

head_state="$(aws s3api head-object \
  "${S3_ARGS[@]}" --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" \
  --query '[ContentLength,VersionId,Metadata.sha256,Metadata."format-version",Metadata.evidence_start_at,Metadata.evidence_bootstrap,Metadata.recovery_program_set_sha256,Metadata.ranges_sha256,Metadata.file_range_count,Metadata.file_range_bytes,Metadata.journal_range_count,Metadata.cursor_sha256]' \
  --output text)"
read -r remote_bytes version_id remote_sha256 remote_format_version remote_evidence_start remote_evidence_bootstrap \
  remote_program_set remote_ranges_sha remote_file_range_count remote_file_range_bytes \
  remote_journal_range_count remote_cursor_sha <<<"$head_state"
[ "$remote_bytes" = "$ENCRYPTED_BYTES" ] || fatal "uploaded object size mismatch: local=$ENCRYPTED_BYTES remote=$remote_bytes"
[ "$remote_sha256" = "$ENCRYPTED_SHA256" ] || fatal "uploaded object SHA-256 metadata mismatch"
[ "$remote_format_version" = 4 ] \
  && [ "$remote_evidence_start" = "$LOG_EVIDENCE_START_AT" ] \
  && [ "$remote_evidence_bootstrap" = "$EVIDENCE_BOOTSTRAP" ] \
  && [ "$remote_program_set" = "$ACTIVE_RECOVERY_PROGRAM_SET_SHA256" ] \
  && [ "$remote_ranges_sha" = "$RANGES_SHA256" ] \
  && [ "$remote_file_range_count" = "$EVIDENCE_FILE_RANGE_COUNT" ] \
  && [ "$remote_file_range_bytes" = "$EVIDENCE_FILE_RANGE_BYTES" ] \
  && [ "$remote_journal_range_count" = "$EVIDENCE_JOURNAL_RANGE_COUNT" ] \
  && [ "$remote_cursor_sha" = "$EVIDENCE_CURSOR_SHA256" ] \
  || fatal "uploaded object evidence metadata mismatch"
[[ "$version_id" =~ ^[-A-Za-z0-9._~+/=]{1,1024}$ ]] \
  && [ "$version_id" != "None" ] \
  && [ "$version_id" != "null" ] \
  || fatal "uploaded object has no safe version ID; Object Lock may be misconfigured"

RETAIN_UNTIL="$(date -u -d "+${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ')"
# --version-id=VALUE, not --version-id VALUE: S3 version IDs may begin with a
# hyphen (observed: -TG2lbh8Z9QB5M8XlkzgGCRkYgNG08D), and argparse then reads the
# value as the next option and fails with "expected one argument". It is
# intermittent — roughly one upload in thirty — so it looks like a transient S3
# problem rather than a quoting bug, and the object silently keeps only the
# bucket's default retention instead of the one this script meant to set.
aws s3api put-object-retention \
  "${S3_ARGS[@]}" --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" \
  --version-id="$version_id" \
  --retention "Mode=COMPLIANCE,RetainUntilDate=$RETAIN_UNTIL" >/dev/null

retention_state="$(aws s3api get-object-retention \
  "${S3_ARGS[@]}" --bucket "$BACKUP_S3_BUCKET" --key "$OBJECT_KEY" \
  --version-id="$version_id" \
  --query '[Retention.Mode,Retention.RetainUntilDate]' --output text)"
read -r remote_mode remote_until <<<"$retention_state"
[ "$remote_mode" = "COMPLIANCE" ] \
  || fatal "uploaded log object is not COMPLIANCE-locked"
requested_retention_epoch="$(date -u -d "$RETAIN_UNTIL" '+%s' 2>/dev/null)" \
  || fatal "requested log-retention deadline is invalid"
remote_retention_epoch="$(date -u -d "$remote_until" '+%s' 2>/dev/null)" \
  || fatal "uploaded log object retain-until date is invalid"
[ "$remote_retention_epoch" -ge "$requested_retention_epoch" ] \
  || fatal "uploaded log retention is shorter than the reviewed policy"

finalize_evidence_bootstrap_state "$OBJECT_KEY" "$version_id" "$ENCRYPTED_SHA256"

# Cursors advance only now. An upload that failed anywhere above leaves the old
# offsets in place, so the next run re-ships the same bytes — duplicated log
# lines are recoverable, missing ones are not.
commit_state

log "SUMMARY key=$OBJECT_KEY version=$version_id bytes=$ENCRYPTED_BYTES appended=$SHIPPED_BYTES retain_until=$remote_until"
ping_healthcheck || fatal "log-shipping success healthcheck did not acknowledge the run"
SUCCESS=1
