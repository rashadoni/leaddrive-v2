#!/usr/bin/env bash
# Keep the help-video masters in object storage and the runtime copy in step
# with them, in whichever direction is needed.
#
# Why they leave the repository at all: `video/player` is 285 MB of tracked
# files, and video plus wallpapers already account for 541 MB of the 1.34 GiB
# git history — every re-record adds another copy for ever. The same 266 MB
# also rides inside every release artifact and lands twice on the production
# disk. None of it is needed to bring the service back up.
#
# Why NOT a signed URL: the files are served by the application itself
# (`/api/help-videos/[file]`), behind `requireAuth`, streamed from disk with
# Range support. Handing the browser a presigned URL would turn each file into
# a bearer link for as long as it lives. Keeping the masters in storage and the
# bytes on the production disk changes nothing about who may watch them
# (owner's decision, 2026-11-01).
#
# One mode, both directions, idempotent — so the migration needs no flag day:
#   * storage has the manifest, disk does not match it  -> pull
#   * disk has the files, storage has no manifest       -> publish
#   * both agree                                        -> do nothing
# Stage one ran this while the artifact still carried the videos, so it
# published. Now the videos are gone from the artifact and the same call pulls.
#
# Two flags exist for the deploy path, and both are about the window before PM2
# stops:
#   --pull-only  never upload here. The pre-stop call must not push 265 MB
#                while the old release is still serving; publishing belongs
#                after the health checks, where nothing waits on us.
#   --expect F   the manifest must equal F byte for byte, or nothing is written.
#                F is the master set this release was built against
#                (video/player/masters.sha256, shipped in the bundle). Without
#                it a release would serve whatever set happens to sit in the
#                bucket, including a half-published or a newer one, and the
#                per-file sha256 check cannot see that: it only proves the bytes
#                match the manifest it was handed.
set -Eeuo pipefail

umask 077

WAL_ENV_FILE="${WAL_ENV_FILE:-/etc/leaddrive/wal-archive.env}"
[ -f "$WAL_ENV_FILE" ] || {
  printf '[help-video-sync] FATAL missing %s\n' "$WAL_ENV_FILE" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
source "$WAL_ENV_FILE"
set +a

: "${WAL_REPO_BUCKET:?}" "${WAL_REPO_ENDPOINT:?}" "${WAL_REPO_REGION:?}"
: "${WAL_REPO_KEY:?}" "${WAL_REPO_KEY_SECRET:?}"
: "${HELP_VIDEO_OBJECT_PREFIX:=help-videos}"
: "${AWS_BIN:=aws}"

VERSION=""
LOCAL_DIR=""
DRY_RUN=0
PULL_ONLY=0
EXPECT_FILE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --dir) LOCAL_DIR="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --pull-only) PULL_ONLY=1; shift ;;
    --expect) EXPECT_FILE="${2:-}"; shift 2 ;;
    *) printf '[help-video-sync] FATAL unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

# The version is a directory name in the bucket, so it may not wander.
case "$VERSION" in
  '' | *[!A-Za-z0-9._-]*) printf '[help-video-sync] FATAL --version must be [A-Za-z0-9._-]+, got "%s"\n' "$VERSION" >&2; exit 1 ;;
esac
[ -n "$LOCAL_DIR" ] || { printf '[help-video-sync] FATAL --dir is required\n' >&2; exit 1; }
if [ -n "$EXPECT_FILE" ]; then
  [ -s "$EXPECT_FILE" ] || { printf '[help-video-sync] FATAL --expect %s is missing or empty\n' "$EXPECT_FILE" >&2; exit 1; }
fi
case "$HELP_VIDEO_OBJECT_PREFIX" in
  */* | '' | /*) printf '[help-video-sync] FATAL prefix must be a single path segment\n' >&2; exit 1 ;;
esac
case "/$HELP_VIDEO_OBJECT_PREFIX" in
  "${WAL_REPO_PATH:-/pgbackrest}") printf '[help-video-sync] FATAL prefix collides with the pgBackRest repo path\n' >&2; exit 1 ;;
esac

log() { printf '[help-video-sync] %s\n' "$*"; }
command -v "$AWS_BIN" >/dev/null 2>&1 || { log 'FATAL aws CLI is required'; exit 1; }

export AWS_ACCESS_KEY_ID="$WAL_REPO_KEY"
export AWS_SECRET_ACCESS_KEY="$WAL_REPO_KEY_SECRET"
export AWS_DEFAULT_REGION="$WAL_REPO_REGION"
S3=(--endpoint-url "https://$WAL_REPO_ENDPOINT" --region "$WAL_REPO_REGION" --no-cli-pager)

base="$HELP_VIDEO_OBJECT_PREFIX/$VERSION"
manifest_key="$base/manifest.sha256"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Only these names are ever read or written. It is the same shape the serving
# route admits, so a stray file on either side cannot travel.
# Exactly HELP_VIDEO_FILE_PATTERN from src/lib/help-videos/serve.ts. Stated as
# the same shape, not re-invented: a hand-written variant of it already cost a
# pass here, because `VOICE` is upper case and a lower-case-only guard quietly
# admitted nothing but the posters.
name_is_allowed() {
  [[ "$1" =~ ^[a-z0-9-]+\.(az|en|ru)\.(VOICE\.mp4|poster\.jpg)$ ]]
}

local_manifest() {
  [ -d "$LOCAL_DIR" ] || return 0
  local f name
  while IFS= read -r f; do
    name="$(basename -- "$f")"
    name_is_allowed "$name" || continue
    printf '%s  %s\n' "$(sha256sum -- "$f" | awk '{print $1}')" "$name"
  done < <(find "$LOCAL_DIR" -maxdepth 1 -type f 2>/dev/null | LC_ALL=C sort)
}

local_manifest >"$work/local.sha256"
local_count="$(grep -c . <"$work/local.sha256" || true)"

remote_manifest=0
if "$AWS_BIN" s3 cp "s3://$WAL_REPO_BUCKET/$manifest_key" "$work/remote.sha256" "${S3[@]}" --only-show-errors >/dev/null 2>&1; then
  remote_manifest=1
fi

if [ "$remote_manifest" = 1 ]; then
  remote_count="$(grep -c . <"$work/remote.sha256" || true)"
  log "storage holds $remote_count files for version $VERSION; disk holds ${local_count:-0}"
  if [ -n "$EXPECT_FILE" ] && ! cmp -s "$EXPECT_FILE" "$work/remote.sha256"; then
    log "FATAL storage holds a different master set for version $VERSION than this release was built with"
    log "expected $(grep -c . <"$EXPECT_FILE" || true) file(s) per $EXPECT_FILE; refusing to pull"
    exit 1
  fi
  # Pull: fetch only what is missing or different, verify each file against the
  # manifest, and move it into place only after it verifies. A half-written
  # video must never be served. Files on disk that storage does not list are
  # left alone — they are a previous release's clips, not our business.
  install -d -m 0755 "$LOCAL_DIR"
  pulled=0
  while read -r digest name; do
    [ -n "${name:-}" ] || continue
    name_is_allowed "$name" || { log "refusing an unexpected name in the manifest: $name"; continue; }
    if [ -f "$LOCAL_DIR/$name" ] && [ "$(sha256sum -- "$LOCAL_DIR/$name" | awk '{print $1}')" = "$digest" ]; then
      continue
    fi
    [ "$DRY_RUN" = 0 ] || { log "would pull $name"; pulled=$((pulled + 1)); continue; }
    "$AWS_BIN" s3 cp "s3://$WAL_REPO_BUCKET/$base/$name" "$work/$name" "${S3[@]}" --only-show-errors \
      || { log "FATAL cannot download $name"; exit 1; }
    got="$(sha256sum -- "$work/$name" | awk '{print $1}')"
    [ "$got" = "$digest" ] || { log "FATAL $name does not match the manifest"; exit 1; }
    install -m 0644 "$work/$name" "$LOCAL_DIR/$name"
    rm -f "$work/$name"
    pulled=$((pulled + 1))
  done <"$work/remote.sha256"
  if [ "$pulled" -eq 0 ]; then
    log 'disk already holds every file storage lists'
    printf 'SUMMARY help-video-sync version=%s action=none files=%s\n' "$VERSION" "${remote_count:-0}"
    exit 0
  fi
  log "pulled $pulled file(s) into $LOCAL_DIR"
  printf 'SUMMARY help-video-sync version=%s action=pull files=%s\n' "$VERSION" "$pulled"
  exit 0
fi

# No manifest in storage: this release still carries the masters, so publish
# them. Nothing is published without files to publish — an empty directory
# would otherwise record an empty manifest and make the pull a no-op for ever.
if [ "$PULL_ONLY" = 1 ]; then
  log "no manifest in storage for version $VERSION and --pull-only was given; leaving the disk alone"
  printf 'SUMMARY help-video-sync version=%s action=none reason=no-manifest files=%s\n' "$VERSION" "${local_count:-0}"
  exit 0
fi
[ "${local_count:-0}" -gt 0 ] || {
  log "FATAL storage has no manifest for $VERSION and $LOCAL_DIR has no help-video files"
  exit 1
}
if [ -n "$EXPECT_FILE" ]; then
  # Publish exactly the set this release was built with, and nothing else.
  # Not the directory listing: production keeps the clips of every release it
  # has ever served, so demanding an identical directory would refuse the very
  # first publish and leave the bucket empty for ever. Extras are ignored; an
  # expected file that is missing or does not match its digest is a refusal,
  # because publishing it would hand the next host bytes nobody reviewed.
  # Uploading the expected file itself as the manifest also makes the stored
  # manifest byte-identical to the committed one by construction — which is
  # precisely what the pull compares.
  missing=0
  while read -r digest name; do
    [ -n "${name:-}" ] || continue
    if [ ! -f "$LOCAL_DIR/$name" ]; then
      log "expected master missing on disk: $name"
      missing=$((missing + 1))
      continue
    fi
    got="$(sha256sum -- "$LOCAL_DIR/$name" | awk '{print $1}')"
    [ "$got" = "$digest" ] || {
      log "expected master does not match its digest: $name"
      missing=$((missing + 1))
    }
  done <"$EXPECT_FILE"
  [ "$missing" -eq 0 ] || {
    log "FATAL $missing of the master(s) this release expects are missing or changed in $LOCAL_DIR; refusing to publish"
    exit 1
  }
  cp -- "$EXPECT_FILE" "$work/local.sha256"
  local_count="$(grep -c . <"$work/local.sha256" || true)"
fi
[ "$DRY_RUN" = 0 ] || {
  log "would publish ${local_count} file(s) as version $VERSION"
  printf 'SUMMARY help-video-sync version=%s action=would-publish files=%s\n' "$VERSION" "$local_count"
  exit 0
}
log "publishing $local_count file(s) as version $VERSION"
while read -r digest name; do
  [ -n "${name:-}" ] || continue
  "$AWS_BIN" s3 cp "$LOCAL_DIR/$name" "s3://$WAL_REPO_BUCKET/$base/$name" "${S3[@]}" \
    --metadata "sha256=$digest" --only-show-errors \
    || { log "FATAL cannot upload $name"; exit 1; }
done <"$work/local.sha256"
# The manifest goes last, on purpose: until it exists a pull will not start, so
# an interrupted publish cannot be read as a complete set.
"$AWS_BIN" s3 cp "$work/local.sha256" "s3://$WAL_REPO_BUCKET/$manifest_key" "${S3[@]}" --only-show-errors \
  || { log 'FATAL cannot publish the manifest'; exit 1; }
log 'manifest published last, so an interrupted upload is never read as complete'
printf 'SUMMARY help-video-sync version=%s action=publish files=%s\n' "$VERSION" "$local_count"
