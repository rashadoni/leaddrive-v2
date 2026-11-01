#!/usr/bin/env bash
# Put the release artifact that production ACCEPTED into the WAL archive
# bucket, so a full restore does not need GitHub.
#
# The build artifact lives only in GitHub Actions with retention 30 days.
# Thirty-one days after the last deploy, a full restore has nothing runnable:
# production cannot build itself, and that is deliberate — scripts/deploy.sh
# and server-build-deploy.sh fail on purpose. Measured 2026-11-01: everything
# irreplaceable (database 585 MB, client uploads 85 MB, secrets) is under a
# gigabyte and restores in minutes, while the one thing that could stall a
# restore for an afternoon was fetching a runnable application.
#
# This runs from server-deploy.sh AFTER the health, database and PII-key checks
# passed, so what lands in the backup is the artifact that actually served
# traffic — not merely one that compiled. It must also run BEFORE Step 10,
# which deletes the tarball.
#
# It rides on the WAL archive's bucket and credentials on purpose: pgBackRest
# is scoped to its own repo path and never looks at this prefix, the key
# already has write and delete there, and that bucket has no Object Lock, so
# pruning actually frees space. One bucket and one credential set then unlock
# both the database history and a runnable application — fewer moving parts in
# the hour when it matters. The immutable Object-Locked dump bucket stays what
# it is: the copy ransomware cannot touch.
set -Eeuo pipefail

umask 077

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
[ -f "$WAL_ENV_FILE" ] || {
  printf '[artifact-upload] FATAL missing %s\n' "$WAL_ENV_FILE" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

: "${WAL_REPO_BUCKET:?}" "${WAL_REPO_ENDPOINT:?}" "${WAL_REPO_REGION:?}"
: "${WAL_REPO_KEY:?}" "${WAL_REPO_KEY_SECRET:?}"
: "${WAL_ARTIFACT_PREFIX:=artifacts}"
: "${WAL_ARTIFACT_KEEP:=5}"
# Tests point this at a stub; production never sets it.
: "${AWS_BIN:=aws}"

TARBALL=""
SHA=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    *) printf '[artifact-upload] FATAL unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

[ -f "$TARBALL" ] || { printf '[artifact-upload] FATAL no tarball at %s\n' "$TARBALL" >&2; exit 1; }
case "$SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) printf '[artifact-upload] FATAL --sha must be a hex commit sha, got %s\n' "$SHA" >&2; exit 1 ;;
esac
case "$WAL_ARTIFACT_PREFIX" in
  */* | '' | /*) printf '[artifact-upload] FATAL prefix must be a single path segment\n' >&2; exit 1 ;;
esac
# The prefix must never collide with the pgBackRest repository path, or pruning
# here would delete WAL.
case "/$WAL_ARTIFACT_PREFIX" in
  "${WAL_REPO_PATH:-/pgbackrest}") printf '[artifact-upload] FATAL prefix collides with the pgBackRest repo path\n' >&2; exit 1 ;;
esac
case "$WAL_ARTIFACT_KEEP" in
  [1-9] | [1-9][0-9]) ;;
  *) printf '[artifact-upload] FATAL WAL_ARTIFACT_KEEP must be 1..99\n' >&2; exit 1 ;;
esac

log() { printf '[artifact-upload] %s\n' "$*"; }

command -v "$AWS_BIN" >/dev/null 2>&1 || { log 'FATAL aws CLI is required'; exit 1; }

export AWS_ACCESS_KEY_ID="$WAL_REPO_KEY"
export AWS_SECRET_ACCESS_KEY="$WAL_REPO_KEY_SECRET"
export AWS_DEFAULT_REGION="$WAL_REPO_REGION"
S3=(--endpoint-url "https://$WAL_REPO_ENDPOINT" --region "$WAL_REPO_REGION" --no-cli-pager)

key="$WAL_ARTIFACT_PREFIX/$SHA.tar.gz"
bytes="$(stat -c %s -- "$TARBALL")"
digest="$(sha256sum -- "$TARBALL" | awk '{print $1}')"
log "uploading $bytes bytes, sha256 $digest -> s3://$WAL_REPO_BUCKET/$key"

"$AWS_BIN" s3 cp "$TARBALL" "s3://$WAL_REPO_BUCKET/$key" "${S3[@]}" \
  --metadata "sha256=$digest,deploysha=$SHA" --only-show-errors \
  || { log 'FATAL upload failed'; exit 1; }

# Read it back. An upload that reports success and stored something else is the
# failure this exists to prevent: the restore would find a corrupt artifact at
# the worst possible moment.
head_json="$("$AWS_BIN" s3api head-object "${S3[@]}" --bucket "$WAL_REPO_BUCKET" --key "$key" 2>&1)" \
  || { log "FATAL cannot read back the uploaded object: $(printf '%s' "$head_json" | tail -1)"; exit 1; }
remote="$(printf '%s' "$head_json" | python3 -I -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("unreadable||")
    raise SystemExit(0)
meta = d.get("Metadata") or {}
print("%s|%s|%s" % (d.get("ContentLength", -1), meta.get("sha256", ""), meta.get("deploysha", "")))
' 2>/dev/null || printf 'unreadable||')"
IFS='|' read -r remote_bytes remote_digest remote_sha <<<"$remote"
[ "$remote_bytes" = "$bytes" ] || { log "FATAL size mismatch: local=$bytes remote=$remote_bytes"; exit 1; }
[ "$remote_digest" = "$digest" ] || { log 'FATAL stored sha256 metadata differs'; exit 1; }
[ "$remote_sha" = "$SHA" ] || { log 'FATAL stored deploy sha differs'; exit 1; }
log 'read back and verified'

# The pointer says which artifact production last accepted. A restore reads it
# instead of guessing from timestamps.
pointer="$(mktemp)"
trap 'rm -f "$pointer"' EXIT
{
  printf 'ARTIFACT_DEPLOY_SHA=%s\n' "$SHA"
  printf 'ARTIFACT_KEY=%s\n' "$key"
  printf 'ARTIFACT_BYTES=%s\n' "$bytes"
  printf 'ARTIFACT_SHA256=%s\n' "$digest"
  printf 'ARTIFACT_ACCEPTED_AT=%s\n' "$(date -u +%FT%TZ)"
} >"$pointer"
"$AWS_BIN" s3 cp "$pointer" "s3://$WAL_REPO_BUCKET/$WAL_ARTIFACT_PREFIX/current.env" "${S3[@]}" \
  --only-show-errors || { log 'FATAL cannot publish the pointer'; exit 1; }

# Prune by what the bucket says, not by what we think we uploaded. The pointer
# is never a candidate.
listing="$("$AWS_BIN" s3api list-objects-v2 "${S3[@]}" --bucket "$WAL_REPO_BUCKET" \
  --prefix "$WAL_ARTIFACT_PREFIX/" 2>&1)" || { log 'WARNING cannot list for pruning; leaving older artifacts'; exit 0; }
doomed="$(printf '%s' "$listing" | WAL_ARTIFACT_KEEP="$WAL_ARTIFACT_KEEP" python3 -I -c '
import json, os, sys

keep = int(os.environ["WAL_ARTIFACT_KEEP"])
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(0)
objects = [o for o in data.get("Contents", []) if o.get("Key", "").endswith(".tar.gz")]
objects.sort(key=lambda o: o.get("LastModified", ""), reverse=True)
for o in objects[keep:]:
    print(o["Key"])
' 2>/dev/null || true)"
removed=0
if [ -n "$doomed" ]; then
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$k" in
      "$WAL_ARTIFACT_PREFIX"/*.tar.gz) ;;
      *) log "refusing to delete an unexpected key: $k"; continue ;;
    esac
    "$AWS_BIN" s3 rm "s3://$WAL_REPO_BUCKET/$k" "${S3[@]}" --only-show-errors >/dev/null 2>&1 \
      && removed=$((removed + 1)) || log "WARNING could not remove $k"
  done <<<"$doomed"
fi

log "kept the newest $WAL_ARTIFACT_KEEP artifacts, removed $removed"
printf 'SUMMARY artifact-upload sha=%s bytes=%s removed=%s\n' "$SHA" "$bytes" "$removed"
