#!/usr/bin/env bash
# Offsite copy of the client files PostgreSQL only points at.
#
# The database comes back from object storage; until this existed, the files it
# references did not. Contracts, task and ticket attachments, MTM photos and
# documents and chat media live only below /var/lib/leaddrive-v2/uploads, on one
# disk, plus a pre-deploy copy on that same disk (docs/BACKUP_RUNBOOK.md,
# host-loss inventory).
#
# Why not scripts/backup/snapshot-runtime-files.sh, which was written for
# exactly this: it belongs to the commissioning ceremony. It needs the
# commissioned /etc/leaddrive/backup.env (BACKUP_AGE_RECIPIENT, BACKUP_S3_*,
# a healthcheck URL), it stages a FULL tar of the tree in tmpfs and demands
# 110 % of the content as free space there, and its unit is one of the four the
# deploy deliberately keeps stopped on this host. A growing tree of client
# files cannot be tarred into RAM nightly.
#
# So this does the one thing that is missing, in the cheapest honest way:
#   * per file, not per tree: whatever is new since the last run goes, so the
#     first catch-up can be spread over nights and a normal night is small;
#   * streamed through age straight into the bucket — no plaintext copy and no
#     ciphertext copy ever touches a disk here;
#   * the owner's age recipient, so recovery needs his key alone and not the
#     database it belongs to;
#   * the credentials already on this host, /etc/leaddrive/wal-archive.env —
#     the same file pgBackRest, the release artifact and the help-video masters
#     use. No ceremony, no second bucket, no new key.
#
# It walks the whole tree anyway, so it also answers the one question no code
# gate can: is a client's file sitting PLAIN on this disk (plain_unexpected)?
# tenant-file-readers-guard.test.ts proves the code seals what it writes; only
# the disk shows what was written before it, or by a path nobody added there.
#
# It never deletes anything in the bucket: a file deleted on production (a
# retention cron, a user) stays in the copy, because that is what a backup is.
#
# Deliberately NOT copied: uploads/call-recordings. The owner set a 90-day
# retention for call recordings and a cron enforces it; copying them offsite for
# ever would quietly overturn that decision, and a bucket lifecycle that expires
# one prefix is configuration this script cannot make. Raise it as its own
# question rather than deciding it here.
#
# Usage:
#   uploads-offsite-mirror.sh --plan                 # read-only: what is there
#   uploads-offsite-mirror.sh --run [--max-bytes N] [--max-seconds N]
#   uploads-offsite-mirror.sh --run --recipient age1…
#
# Exit 0 done (or nothing to do), 1 failure, 2 bad usage or setup.
set -Eeuo pipefail

umask 077

SOURCE_ROOT="${UPLOADS_OFFSITE_SOURCE_ROOT:-/var/lib/leaddrive-v2/uploads}"
STATE_ROOT="${UPLOADS_OFFSITE_STATE_ROOT:-/var/lib/leaddrive-uploads-offsite}"
WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
LEDGER="$STATE_ROOT/ledger.tsv"
STATE_FILE="$STATE_ROOT/state"
LOCK_FILE="$STATE_ROOT/mirror.lock"
# Its own 90-day retention; see the header.
SKIP_PATHS=(call-recordings)

# Top-level directories whose files are public by design and so plain on disk:
# they are served without a login, so the application never seals them
# (src/lib/crypto/tenant-file-locations.ts leaves them out on the writing side,
# and tenant-file-readers-guard.test.ts names each one with its reason). They
# are copied like everything else — this list only keeps them out of the count
# of plain files that should NOT be plain.
PLAIN_BY_DESIGN=(logos email-images social-logos social-media-previews)

MODE=""
RECIPIENT="${UPLOADS_OFFSITE_AGE_RECIPIENT:-}"
MAX_BYTES="${UPLOADS_OFFSITE_MAX_BYTES:-2147483648}"
MAX_SECONDS="${UPLOADS_OFFSITE_MAX_SECONDS:-1800}"

log() { printf '[uploads-offsite] %s\n' "$*"; }
fatal() { log "FATAL: $*" >&2; exit 1; }

# "LDFE" — the first four bytes the application writes on a sealed file
# (src/lib/crypto/tenant-file-encryption.ts). A builtin read rather than
# `head -c 4`: this runs once per file in the tree, and the tree only grows.
is_sealed() {
  local magic=''
  read -r -N 4 magic <"$1" 2>/dev/null || true
  [ "$magic" = LDFE ]
}

plain_by_design() {
  local top="${1%%/*}" name
  for name in "${PLAIN_BY_DESIGN[@]}"; do
    if [ "$top" = "$name" ]; then return 0; fi
  done
  return 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) MODE=plan; shift ;;
    --run) MODE=run; shift ;;
    --recipient) RECIPIENT="${2:-}"; shift 2 ;;
    --max-bytes) MAX_BYTES="${2:-}"; shift 2 ;;
    --max-seconds) MAX_SECONDS="${2:-}"; shift 2 ;;
    *) printf 'Usage: %s --plan | --run [--recipient age1…] [--max-bytes N] [--max-seconds N]\n' "$0" >&2; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { printf 'Usage: %s --plan | --run [--recipient age1…]\n' "$0" >&2; exit 2; }
case "$MAX_BYTES$MAX_SECONDS" in *[!0-9]*) log 'FATAL --max-bytes and --max-seconds are numbers'; exit 2 ;; esac

# The source is fixed on purpose: this script is handed a root key, and an
# overridable source root is how a backup job becomes an exfiltration tool.
[ "${UPLOADS_OFFSITE_SOURCE_ROOT:-/var/lib/leaddrive-v2/uploads}" = /var/lib/leaddrive-v2/uploads ] \
  || [ -n "${UPLOADS_OFFSITE_ALLOW_TEST_ROOT:-}" ] \
  || fatal "UPLOADS_OFFSITE_SOURCE_ROOT override is forbidden"

[ -d "$SOURCE_ROOT" ] || fatal "no $SOURCE_ROOT on this host"
install -d -m 0700 "$STATE_ROOT"
: >>"$LEDGER"

for command_name in age aws find sha256sum stat; do
  command -v "$command_name" >/dev/null 2>&1 || fatal "$command_name is required"
done

# One run at a time: the next timer tick must not start a second walk over the
# same tree while a slow upload is still going.
exec 9>"$LOCK_FILE"
flock -n 9 || { log 'another run holds the lock'; exit 0; }

# ── What is already copied ────────────────────────────────
# rel<TAB>size<TAB>mtime. A file whose size or mtime changed is copied again:
# these files are written once, so a change means a new object worth keeping.
declare -A COPIED=()
while IFS=$'\t' read -r rel size mtime || [ -n "${rel:-}" ]; do
  [ -n "${rel:-}" ] || continue
  COPIED["$rel"]="$size:$mtime"
done <"$LEDGER"

# ── What is on disk ───────────────────────────────────────
find_args=("$SOURCE_ROOT" -mindepth 1)
for skip in "${SKIP_PATHS[@]}"; do
  find_args+=(-path "$SOURCE_ROOT/$skip" -prune -o)
done
find_args+=(-type f -printf '%P\t%s\t%T@\n')

pending_files=0
pending_bytes=0
known_files=0
known_bytes=0
plain_public=0
plain_empty=0
plain_unexpected=0
declare -A PLAIN_DIRS=()
PENDING_LIST="$(mktemp)"
trap 'rm -f "$PENDING_LIST"' EXIT

while IFS=$'\t' read -r rel size mtime; do
  [ -n "$rel" ] || continue
  # No .. and no absolute path can appear in find -printf '%P', but a name with
  # a tab or a newline would break the ledger — such a file is reported, never
  # silently skipped.
  case "$rel" in
    *$'\n'*|*$'\t'*) log "WARNING: skipping a name with a tab or newline: ${rel//[$'\n\t']/?}"; continue ;;
  esac
  mtime="${mtime%%.*}"
  known_files=$((known_files + 1))
  known_bytes=$((known_bytes + size))
  # Is a client's file sitting plain on this disk? Counted over the WHOLE tree,
  # and not over what is left to copy: a count of the copy queue reads 0 the
  # day after the first run, so it would say "all sealed" about a tree of plain
  # files. That is exactly how 36 by-design-plain files were read on
  # 2026-11-02 as a backfill that had stopped half way.
  if is_sealed "$SOURCE_ROOT/$rel"; then
    :
  elif [ "$size" = 0 ]; then
    # A placeholder (.gitkeep) or a failed upload: no bytes either way.
    plain_empty=$((plain_empty + 1))
  elif plain_by_design "$rel"; then
    plain_public=$((plain_public + 1))
  else
    plain_unexpected=$((plain_unexpected + 1))
    directory="${rel%/*}"
    [ "$directory" != "$rel" ] || directory=.
    PLAIN_DIRS["$directory"]=$(( ${PLAIN_DIRS["$directory"]:-0} + 1 ))
  fi
  if [ "${COPIED[$rel]:-}" = "$size:$mtime" ]; then
    continue
  fi
  pending_files=$((pending_files + 1))
  pending_bytes=$((pending_bytes + size))
  printf '%s\t%s\t%s\n' "$rel" "$size" "$mtime" >>"$PENDING_LIST"
done < <(find "${find_args[@]}")

# A plain client file is worth naming, and its directory names the upload path
# that wrote it. File names are not printed: the directory and the count are
# enough to act on, and this goes to the journal.
report_plain() {
  [ "$plain_unexpected" -gt 0 ] || return 0
  log "WARNING: незашифрованных файлов клиентов на диске: $plain_unexpected"
  while IFS= read -r directory; do
    log "  $directory — ${PLAIN_DIRS[$directory]}"
  done < <(printf '%s\n' "${!PLAIN_DIRS[@]}" | sort)
}

if [ "$MODE" = plan ]; then
  # Three kinds of plain file, because one number could not tell them apart:
  # public by design (PLAIN_BY_DESIGN), empty, and the one that matters —
  # a client's file that some upload path wrote without sealing it. The code
  # side cannot see that: tenant-file-readers-guard.test.ts reads code, this
  # reads the disk. Sealing changes nothing here either way: everything is
  # age-encrypted on the way out.
  printf 'SUMMARY uploads-offsite mode=plan files=%s bytes=%s pending_files=%s pending_bytes=%s plain_public=%s plain_empty=%s plain_unexpected=%s skipped=%s recipient=%s\n' \
    "$known_files" "$known_bytes" "$pending_files" "$pending_bytes" \
    "$plain_public" "$plain_empty" "$plain_unexpected" "${SKIP_PATHS[*]}" \
    "$([ -n "$RECIPIENT" ] && printf 'set' || printf 'MISSING')"
  log "каталог: $(numfmt --to=iec "$known_bytes" 2>/dev/null || printf '%s B' "$known_bytes") в $known_files файлах"
  log "к отправке: $(numfmt --to=iec "$pending_bytes" 2>/dev/null || printf '%s B' "$pending_bytes") в $pending_files файлах"
  report_plain
  exit 0
fi

# ── Credentials, the same file three other jobs already use ─
[ -f "$WAL_ENV_FILE" ] || fatal "missing $WAL_ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a
: "${WAL_REPO_BUCKET:?}" "${WAL_REPO_ENDPOINT:?}" "${WAL_REPO_REGION:?}" "${WAL_REPO_KEY:?}" "${WAL_REPO_KEY_SECRET:?}"
: "${UPLOADS_OFFSITE_PREFIX:=uploads-offsite}"
RECIPIENT="${RECIPIENT:-${UPLOADS_OFFSITE_AGE_RECIPIENT:-}}"

[[ "$RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] \
  || fatal "an age recipient is required: --recipient age1… or UPLOADS_OFFSITE_AGE_RECIPIENT"
case "$UPLOADS_OFFSITE_PREFIX" in
  */*|''|/*) fatal "the prefix must be a single path segment" ;;
esac
case "/$UPLOADS_OFFSITE_PREFIX" in
  "${WAL_REPO_PATH:-/pgbackrest}") fatal "the prefix collides with the pgBackRest repository path" ;;
esac

export AWS_ACCESS_KEY_ID="$WAL_REPO_KEY"
export AWS_SECRET_ACCESS_KEY="$WAL_REPO_KEY_SECRET"
export AWS_DEFAULT_REGION="$WAL_REPO_REGION"
S3=(--endpoint-url "https://$WAL_REPO_ENDPOINT" --region "$WAL_REPO_REGION" --no-cli-pager)

started="$(date +%s)"
sent_files=0
sent_bytes=0
failures=0
stopped=""

while IFS=$'\t' read -r rel size mtime; do
  [ -n "$rel" ] || continue
  if [ "$sent_bytes" -ge "$MAX_BYTES" ]; then stopped="max-bytes"; break; fi
  if [ $(( $(date +%s) - started )) -ge "$MAX_SECONDS" ]; then stopped="max-seconds"; break; fi
  # Streamed: age reads the file, aws reads age. Nothing lands on a disk here,
  # so a run that dies leaves no copy of a client's file behind.
  if age -r "$RECIPIENT" <"$SOURCE_ROOT/$rel" \
    | aws s3 cp - "s3://$WAL_REPO_BUCKET/$UPLOADS_OFFSITE_PREFIX/$rel.age" "${S3[@]}" --only-show-errors; then
    printf '%s\t%s\t%s\n' "$rel" "$size" "$mtime" >>"$LEDGER"
    sent_files=$((sent_files + 1))
    sent_bytes=$((sent_bytes + size))
  else
    failures=$((failures + 1))
    log "WARNING: не удалось отправить $rel"
    # Three failures in a row is a broken destination, not a bad file.
    [ "$failures" -lt 3 ] || { stopped="failures"; break; }
  fi
done <"$PENDING_LIST"

left_files=$((pending_files - sent_files))
status=ok
message="скопировано $sent_files файл(ов)"
if [ "$failures" -gt 0 ] && [ "$sent_files" -eq 0 ]; then
  status=crit
  message="ни один файл не отправился ($failures отказ(ов))"
elif [ "$failures" -gt 0 ]; then
  status=warn
  message="скопировано $sent_files, отказов $failures"
fi

# State for the host health watch, flat on purpose: the watch reads it over
# ssh with the same key=value parser it uses for everything else, so nothing
# has to parse JSON on either side. The message is not here — a value with
# spaces would break that parser, and the wording the owner reads is composed
# by the watch from the status, the backlog and the age of this file.
{
  printf 'offsite=present\n'
  printf 'offsite_ran_at=%s\n' "$(date -u +%s)"
  printf 'offsite_status=%s\n' "$status"
  printf 'offsite_sent=%s\n' "$sent_files"
  printf 'offsite_pending=%s\n' "$left_files"
  printf 'offsite_known=%s\n' "$known_files"
  printf 'offsite_bytes=%s\n' "$known_bytes"
  printf 'offsite_stopped=%s\n' "${stopped:-no}"
  printf 'offsite_failures=%s\n' "$failures"
  printf 'offsite_plain_unexpected=%s\n' "$plain_unexpected"
} >"$STATE_FILE.new"
chmod 0640 "$STATE_FILE.new"
# Replaced in one step: a watch that caught a half-written file would read a
# missing age and call it an incident.
mv -- "$STATE_FILE.new" "$STATE_FILE"

report_plain
printf 'SUMMARY uploads-offsite mode=run status=%s sent_files=%s sent_bytes=%s pending_files=%s stopped=%s failures=%s plain_unexpected=%s\n' \
  "$status" "$sent_files" "$sent_bytes" "$left_files" "${stopped:-no}" "$failures" "$plain_unexpected"
[ "$status" != crit ] || exit 1
