#!/usr/bin/env bash
# Fetch a runnable release artifact from the WAL archive bucket.
#
# This is the step that used to depend on GitHub. With the artifact retained
# only in GitHub Actions for 30 days, a restore made 31 days after the last
# deploy had nothing to run, and production cannot build itself by design.
#
# Read-only against the bucket: it downloads and verifies, and never writes,
# deletes or unpacks anything. Unpacking is the operator's next step, so a
# corrupt download cannot overwrite a live release on its own.
set -Eeuo pipefail

umask 077

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
[ -f "$WAL_ENV_FILE" ] || {
  printf '[artifact-restore] FATAL missing %s\n' "$WAL_ENV_FILE" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

: "${WAL_REPO_BUCKET:?}" "${WAL_REPO_ENDPOINT:?}" "${WAL_REPO_REGION:?}"
: "${WAL_REPO_KEY:?}" "${WAL_REPO_KEY_SECRET:?}"
: "${WAL_ARTIFACT_PREFIX:=artifacts}"
: "${AWS_BIN:=aws}"

SHA=""
DEST=""
LIST_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) SHA="${2:-}"; shift 2 ;;
    --dest) DEST="${2:-}"; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    *) printf '[artifact-restore] FATAL unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

log() { printf '[artifact-restore] %s\n' "$*"; }
command -v "$AWS_BIN" >/dev/null 2>&1 || { log 'FATAL aws CLI is required'; exit 1; }

export AWS_ACCESS_KEY_ID="$WAL_REPO_KEY"
export AWS_SECRET_ACCESS_KEY="$WAL_REPO_KEY_SECRET"
export AWS_DEFAULT_REGION="$WAL_REPO_REGION"
S3=(--endpoint-url "https://$WAL_REPO_ENDPOINT" --region "$WAL_REPO_REGION" --no-cli-pager)

if [ "$LIST_ONLY" = 1 ]; then
  "$AWS_BIN" s3 ls "s3://$WAL_REPO_BUCKET/$WAL_ARTIFACT_PREFIX/" "${S3[@]}"
  exit 0
fi

expected_digest=""
if [ -z "$SHA" ]; then
  # No sha asked for: take the one production last accepted, and take its
  # digest from the same pointer, so the check is against what was recorded at
  # upload and not against the object's own claim about itself.
  pointer="$(mktemp)"
  trap 'rm -f "$pointer" "${download:-}"' EXIT
  "$AWS_BIN" s3 cp "s3://$WAL_REPO_BUCKET/$WAL_ARTIFACT_PREFIX/current.env" "$pointer" \
    "${S3[@]}" --only-show-errors \
    || { log 'FATAL no pointer in the bucket; pass --sha, or --list to see what is there'; exit 1; }
  SHA="$(awk -F= '$1 == "ARTIFACT_DEPLOY_SHA" {print $2}' "$pointer" | tr -d '\r')"
  expected_digest="$(awk -F= '$1 == "ARTIFACT_SHA256" {print $2}' "$pointer" | tr -d '\r')"
  expected_bytes="$(awk -F= '$1 == "ARTIFACT_BYTES" {print $2}' "$pointer" | tr -d '\r')"
  accepted="$(awk -F= '$1 == "ARTIFACT_ACCEPTED_AT" {print $2}' "$pointer" | tr -d '\r')"
  log "pointer names $SHA, accepted by production at ${accepted:-unknown}"
else
  trap 'rm -f "${download:-}"' EXIT
fi

case "$SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) log "FATAL not a hex commit sha: $SHA"; exit 1 ;;
esac

key="$WAL_ARTIFACT_PREFIX/$SHA.tar.gz"
DEST="${DEST:-/tmp/leaddrive-restore-$SHA.tar.gz}"
download="$DEST.partial"
log "downloading s3://$WAL_REPO_BUCKET/$key"
"$AWS_BIN" s3 cp "s3://$WAL_REPO_BUCKET/$key" "$download" "${S3[@]}" --only-show-errors \
  || { log 'FATAL download failed'; exit 1; }

actual_bytes="$(stat -c %s -- "$download")"
actual_digest="$(sha256sum -- "$download" | awk '{print $1}')"
if [ -n "$expected_digest" ]; then
  [ "$actual_digest" = "$expected_digest" ] \
    || { log "FATAL sha256 differs from the pointer: got $actual_digest"; exit 1; }
  [ "${expected_bytes:-$actual_bytes}" = "$actual_bytes" ] \
    || { log 'FATAL size differs from the pointer'; exit 1; }
  log 'verified against the pointer recorded at upload'
else
  # An explicit --sha has no pointer to check against, so fall back to the
  # object's own metadata and say so: it is weaker evidence.
  meta_digest="$("$AWS_BIN" s3api head-object "${S3[@]}" --bucket "$WAL_REPO_BUCKET" --key "$key" \
    2>/dev/null | python3 -I -c 'import json,sys; print((json.load(sys.stdin).get("Metadata") or {}).get("sha256",""))' 2>/dev/null || true)"
  if [ -n "$meta_digest" ]; then
    [ "$actual_digest" = "$meta_digest" ] || { log 'FATAL sha256 differs from object metadata'; exit 1; }
    log 'verified against the object metadata (weaker than the pointer)'
  else
    log 'WARNING no recorded digest to verify against'
  fi
fi

# gzip itself gets the last word on whether the bytes are a usable archive.
gzip -t -- "$download" || { log 'FATAL the download is not a valid gzip archive'; exit 1; }
mv -- "$download" "$DEST"
log "ready: $DEST"
printf 'SUMMARY artifact-restore sha=%s bytes=%s path=%s\n' "$SHA" "$actual_bytes" "$DEST"
