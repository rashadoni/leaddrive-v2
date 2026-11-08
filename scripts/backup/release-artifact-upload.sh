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
# is scoped to its own repo path and never looks at this prefix, and the key
# already has write and delete there. One bucket and one credential set then
# unlock both the database history and a runnable application — fewer moving
# parts in the hour when it matters. The immutable Object-Locked dump bucket
# stays what it is: the copy ransomware cannot touch.
#
# Everything in that bucket shares one storage cap, and on 2026-11-03 and again
# on 2026-11-04 the cap tripped and production could not archive a single WAL
# segment. Both times the bucket was full of artifacts nobody could restore
# from, and the cap is a hard stop on writes, not a bill. Three lessons are
# built into the sweep below, and none of them is obvious from a listing:
#
#   1. The bucket is VERSIONED, so `s3 rm` only hides an object: its bytes stay
#      as a noncurrent version. Pruning therefore deletes VERSIONS.
#   2. A key whose newest version is a delete marker does not appear in
#      `list-objects-v2` AT ALL. Measured on production 2026-11-04: all 6.06
#      GiB of dead weight sat behind 35 such markers — invisible to a prune
#      that works from the object listing, waiting for a once-a-day lifecycle
#      sweep that the cap beat to it twice. So the sweep reads VERSIONS, not
#      objects, and the bucket's lifecycle rule is a backstop, not the plan.
#   3. The sweep runs BEFORE the upload as well as after it. With the cap
#      tripped the upload fails first, and a prune that only ever runs after a
#      successful upload can never dig the bucket out of its own hole. Note
#      that B2 accounts for the cap with a lag of minutes, so the deploy that
#      frees the space is usually not the one that gets to use it.
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
RECLAIM_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    # Free the dead bytes and stop. For the hour when the cap is already
    # tripped: it uploads nothing, enforces no retention, and touches no live
    # object, so it is safe to run by hand on production.
    --reclaim-only) RECLAIM_ONLY=1; shift ;;
    *) printf '[artifact-upload] FATAL unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if [ "$RECLAIM_ONLY" = 1 ]; then
  [ -z "$TARBALL" ] && [ -z "$SHA" ] || {
    printf '[artifact-upload] FATAL --reclaim-only takes no --tarball or --sha\n' >&2
    exit 1
  }
else
  [ -f "$TARBALL" ] || { printf '[artifact-upload] FATAL no tarball at %s\n' "$TARBALL" >&2; exit 1; }
  case "$SHA" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
    *) printf '[artifact-upload] FATAL --sha must be a hex commit sha, got %s\n' "$SHA" >&2; exit 1 ;;
  esac
fi
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

removed=0
purged=0
freed=0
tab="$(printf '\t')"

# What the sweep should do, decided from one listing. Printed as
# "PURGE<tab>key<tab>version<tab>bytes", "REMOVED<tab>key" (an artifact that
# left the keep window) and "REFUSE<tab>key" (something under our prefix that
# is not ours to delete).
#
# Rows are grouped by key, oldest version first and delete markers last:
# removing a marker while an older version of that key survives would
# RESURRECT the hidden artifact — back into the listing, back into retention,
# with a LastModified that is not the artifact's.
plan_sweep() {
  PREFIX="$WAL_ARTIFACT_PREFIX" KEEP="$WAL_ARTIFACT_KEEP" RETENTION="$1" python3 -I -c '
import json, os, sys

prefix = os.environ["PREFIX"]
keep = int(os.environ["KEEP"])
retention = os.environ["RETENTION"] == "1"
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(0)
versions = data.get("Versions") or []
markers = data.get("DeleteMarkers") or []

def ours(key):
    return key.startswith(prefix + "/") and (
        key.endswith(".tar.gz") or key == prefix + "/current.env"
    )

doomed = set()
if retention:
    live = sorted(
        (
            (v.get("LastModified") or "", v.get("Key") or "")
            for v in versions
            if v.get("IsLatest") and (v.get("Key") or "").endswith(".tar.gz")
        ),
        reverse=True,
    )
    doomed = {key for _when, key in live[keep:]}

groups = {}
for row in versions:
    groups.setdefault(row.get("Key") or "", ([], []))[0].append(row)
for row in markers:
    groups.setdefault(row.get("Key") or "", ([], []))[1].append(row)

out = []
refused = []
for key in sorted(groups):
    if not key:
        continue
    if not ours(key):
        refused.append(key)
        continue
    objects, tombs = groups[key]
    gone = False
    for row in sorted(objects, key=lambda r: r.get("LastModified") or ""):
        if row.get("IsLatest") and key not in doomed:
            continue
        version = row.get("VersionId") or ""
        if version:
            out.append("PURGE\t%s\t%s\t%s" % (key, version, row.get("Size", 0)))
            gone = True
    for row in tombs:
        version = row.get("VersionId") or ""
        if version:
            out.append("PURGE\t%s\t%s\t0" % (key, version))
            gone = True
    if gone and key in doomed:
        out.append("REMOVED\t%s" % key)
for key in refused:
    out.append("REFUSE\t%s" % key)
if out:
    print("\n".join(out))
'
}

purge_one() {  # key, version-id, bytes
  if "$AWS_BIN" s3api delete-object "${S3[@]}" --bucket "$WAL_REPO_BUCKET" \
    --key "$1" --version-id "$2" >/dev/null 2>&1; then
    purged=$((purged + 1))
    freed=$((freed + ${3:-0}))
    return 0
  fi
  log "WARNING could not purge a version of $1"
  return 1
}

# Hiding is better than keeping — a stale artifact is a wrong restore — but it
# leaks bytes towards the cap, so it says so out loud. Only reachable when the
# bucket will not list its versions at all.
prune_without_versions() {
  local listing doomed k
  listing="$("$AWS_BIN" s3api list-objects-v2 "${S3[@]}" --bucket "$WAL_REPO_BUCKET" \
    --prefix "$WAL_ARTIFACT_PREFIX/" 2>&1)" || {
    log 'WARNING cannot list for pruning; leaving older artifacts'
    return 0
  }
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
  [ -n "$doomed" ] || return 0
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$k" in
      "$WAL_ARTIFACT_PREFIX"/*.tar.gz) ;;
      *) log "refusing to delete an unexpected key: $k"; continue ;;
    esac
    if "$AWS_BIN" s3 rm "s3://$WAL_REPO_BUCKET/$k" "${S3[@]}" --only-show-errors >/dev/null 2>&1; then
      removed=$((removed + 1))
      log "WARNING hid $k without purging its versions"
    else
      log "WARNING could not remove $k"
    fi
  done <<<"$doomed"
}

# One pass over the prefix. retention=0 frees only what nothing references and
# never touches a live object; retention=1 also enforces the keep window.
sweep() {
  local retention="$1" rows plan verb a b c fail_key=''
  rows="$("$AWS_BIN" s3api list-object-versions "${S3[@]}" --bucket "$WAL_REPO_BUCKET" \
    --prefix "$WAL_ARTIFACT_PREFIX/" 2>/dev/null || true)"
  plan="$(printf '%s' "$rows" | plan_sweep "$retention" || true)"
  if [ -z "$plan" ]; then
    # Nothing to do, or no version listing at all. Only retention has a
    # fallback worth running blind.
    if [ -z "$rows" ] && [ "$retention" = 1 ]; then
      prune_without_versions
    fi
    return 0
  fi
  while IFS="$tab" read -r verb a b c; do
    case "$verb" in
      PURGE)
        # A key whose first purge failed is left exactly as it is: deleting the
        # rest, above all its delete marker, could bring a stale artifact back.
        [ "$a" != "$fail_key" ] || continue
        purge_one "$a" "$b" "$c" || fail_key="$a"
        ;;
      REMOVED)
        if [ "$a" != "$fail_key" ]; then removed=$((removed + 1)); fi
        ;;
      REFUSE) log "refusing to delete versions of an unexpected key: $a" ;;
    esac
  done <<<"$plan"
}

# Before anything else, and before the upload that a tripped cap would refuse.
sweep 0

if [ "$RECLAIM_ONLY" = 1 ]; then
  log "reclaim only: purged $purged version(s), freed $freed bytes"
  printf 'SUMMARY artifact-upload reclaim-only versions=%s freed=%s\n' "$purged" "$freed"
  exit 0
fi

key="$WAL_ARTIFACT_PREFIX/$SHA.tar.gz"
bytes="$(stat -c %s -- "$TARBALL")"
digest="$(sha256sum -- "$TARBALL" | awk '{print $1}')"
log "uploading $bytes bytes, sha256 $digest -> s3://$WAL_REPO_BUCKET/$key"

"$AWS_BIN" s3 cp "$TARBALL" "s3://$WAL_REPO_BUCKET/$key" "${S3[@]}" \
  --metadata "sha256=$digest,deploysha=$SHA" --only-show-errors \
  || { log "FATAL upload failed (freed $freed bytes first; the storage cap is accounted with a lag of minutes)"; exit 1; }

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

# Now with retention: the tarball this run superseded, the pointer version it
# just replaced — rewritten on every deploy, so it leaks at exactly the same
# rate, 29 dead copies by 2026-11-03 — and the artifacts past the keep window.
sweep 1

log "kept the newest $WAL_ARTIFACT_KEEP artifacts, removed $removed, purged $purged version(s), freed $freed bytes"
printf 'SUMMARY artifact-upload sha=%s bytes=%s removed=%s versions=%s freed=%s\n' \
  "$SHA" "$bytes" "$removed" "$purged" "$freed"
