#!/usr/bin/env bash
# Prove the two B2 backup keys behave as designed, with a synthetic file only.
#
#   bash scripts/backup/b2-verify-backup-keys.sh writer.env restore.env
#
# Uses the same AWS CLI v2 calls as scripts/backup/postgres-backup.sh: a
# multipart `s3 cp` with sha256 metadata, `head-object`, then a download with
# the restore key and a byte-for-byte comparison. Afterwards it checks what
# each key must NOT be able to do. Neither key can delete, so the synthetic
# object stays; the bucket lifecycle rule for the leaddrive-b2-synthetic-check
# prefix removes it after about two days.
#
# Prints PASS/FAIL lines and S3 error codes only — never keys, request IDs or
# raw CLI output. Exit status is non-zero if any expectation fails.
set -uo pipefail

[ $# -eq 2 ] || { echo "usage: $0 writer.env restore.env" >&2; exit 2; }
AWS_BIN="$(command -v aws)" || { echo "FATAL: aws CLI v2 is required" >&2; exit 2; }
# macOS has no coreutils timeout unless Homebrew's is installed.
TIMEOUT=""; command -v timeout >/dev/null && TIMEOUT="$(command -v timeout) 120"

read_env() {
  local file="$1" key="$2" line value=""
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^${key}=(.*)$ ]] && value="${BASH_REMATCH[1]}"
  done <"$file"
  [ -n "$value" ] || { echo "FATAL: $key missing in $file" >&2; exit 2; }
  printf '%s' "$value"
}

for file in "$1" "$2"; do
  [ -f "$file" ] || { echo "FATAL: $file not found" >&2; exit 2; }
  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")"
  [ "$mode" = 600 ] || [ "$mode" = 400 ] || { echo "FATAL: $file must be mode 0600" >&2; exit 2; }
done

ENDPOINT="$(read_env "$1" BACKUP_S3_ENDPOINT)"
REGION="$(read_env "$1" BACKUP_S3_REGION)"
BUCKET="$(read_env "$1" BACKUP_S3_BUCKET)"
[ "$(read_env "$2" BACKUP_S3_BUCKET)" = "$BUCKET" ] || { echo "FATAL: the two files name different buckets" >&2; exit 2; }
[[ "$REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]{3}$ ]] && [ "$ENDPOINT" = "https://s3.$REGION.backblazeb2.com" ] \
  || { echo "FATAL: endpoint is not the B2 S3 endpoint of its region" >&2; exit 2; }

WRITER_ID="$(read_env "$1" AWS_ACCESS_KEY_ID)"; WRITER_SECRET="$(read_env "$1" AWS_SECRET_ACCESS_KEY)"
RESTORE_ID="$(read_env "$2" AWS_ACCESS_KEY_ID)"; RESTORE_SECRET="$(read_env "$2" AWS_SECRET_ACCESS_KEY)"

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
CHECKSUM_MODE=when_supported

pass() { echo "PASS $1"; }
failed() { echo "FAIL $1"; FAILURES=$((FAILURES + 1)); }
error_code() { grep -oE '\(([A-Za-z]+)\)' "$WORK/stderr" | head -1 | tr -d '()' || true; }

# env -i: no profile, no shared credentials, no instance metadata, nothing
# inherited from the caller's shell.
as_key() {
  local id="$1" secret="$2"; shift 2
  env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin HOME="$WORK" \
    AWS_ACCESS_KEY_ID="$id" AWS_SECRET_ACCESS_KEY="$secret" \
    AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    AWS_REQUEST_CHECKSUM_CALCULATION="$CHECKSUM_MODE" \
    AWS_RESPONSE_CHECKSUM_VALIDATION="$CHECKSUM_MODE" \
    $TIMEOUT "$AWS_BIN" --endpoint-url "$ENDPOINT" --region "$REGION" --no-cli-pager "$@" 2>"$WORK/stderr"
}
writer() { as_key "$WRITER_ID" "$WRITER_SECRET" "$@"; }
restore() { as_key "$RESTORE_ID" "$RESTORE_SECRET" "$@"; }

# 9 MiB of random bytes: above the CLI's 8 MiB multipart threshold, so the
# multipart path the real 40+ MiB dumps take is exercised too.
SYNTHETIC="$WORK/synthetic.bin"
head -c 9437184 /dev/urandom >"$SYNTHETIC"
SHA256="$(sha256sum "$SYNTHETIC" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$SYNTHETIC" | awk '{print $1}')"
BYTES="$(wc -c <"$SYNTHETIC" | tr -d '[:space:]')"
KEY="leaddrive-b2-synthetic-check/$(date -u '+%Y%m%dT%H%M%SZ')-$RANDOM$RANDOM.bin"

if writer s3 cp "$SYNTHETIC" "s3://$BUCKET/$KEY" --only-show-errors --no-progress --metadata "sha256=$SHA256,tier=synthetic"; then
  pass "writer multipart upload (AWS CLI default checksums accepted)"
else
  code="$(error_code)"
  CHECKSUM_MODE=when_required
  if writer s3 cp "$SYNTHETIC" "s3://$BUCKET/$KEY" --only-show-errors --no-progress --metadata "sha256=$SHA256,tier=synthetic"; then
    failed "writer upload needs AWS_REQUEST_CHECKSUM_CALCULATION=when_required (default refused: ${code:-unknown})"
  else
    failed "writer upload refused: $(error_code)"
    echo "RESULT: $FAILURES failure(s)"; exit 1
  fi
fi

if head_state="$(writer s3api head-object --bucket "$BUCKET" --key "$KEY" --query '[ContentLength,VersionId,Metadata.sha256]' --output text)"; then
  read -r remote_bytes version_id remote_sha <<<"$head_state"
  [ "$remote_bytes" = "$BYTES" ] && [ "$remote_sha" = "$SHA256" ] && [ -n "$version_id" ] && [ "$version_id" != None ] \
    && pass "writer head-object: size, sha256 metadata and version id" \
    || failed "writer head-object returned unexpected size/metadata/version"
else
  failed "writer head-object refused: $(error_code)"; version_id=""
fi

if restore s3api get-object --bucket "$BUCKET" --key "$KEY" ${version_id:+--version-id="$version_id"} "$WORK/downloaded.bin" >/dev/null; then
  cmp -s "$SYNTHETIC" "$WORK/downloaded.bin" \
    && pass "restore key download is byte-identical" \
    || failed "restore key download differs from the upload"
else
  failed "restore key download refused: $(error_code)"
fi

if lock="$(writer s3api get-object-lock-configuration --bucket "$BUCKET" --query 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]' --output text)"; then
  echo "INFO bucket Object Lock: $lock"
else
  echo "INFO bucket Object Lock not configured ($(error_code)); the pipeline refuses to upload until it is Enabled/COMPLIANCE/>=14"
fi

expect_denied() {
  local label="$1"; shift
  if "$@" >/dev/null; then failed "$label was allowed"; else pass "$label denied ($(error_code))"; fi
}
expect_denied "writer delete of the exact version" writer s3api delete-object --bucket "$BUCKET" --key "$KEY" ${version_id:+--version-id="$version_id"}
expect_denied "writer listing" writer s3api list-objects-v2 --bucket "$BUCKET" --max-items 1
expect_denied "restore key upload" restore s3api put-object --bucket "$BUCKET" --key "$KEY.restore-write" --body "$SYNTHETIC"
expect_denied "restore key delete" restore s3api delete-object --bucket "$BUCKET" --key "$KEY" ${version_id:+--version-id="$version_id"}

if restore s3api head-object --bucket "$BUCKET" --key "$KEY" >/dev/null; then
  pass "synthetic object still present after the delete attempts"
else
  failed "synthetic object disappeared: $(error_code)"
fi

echo "INFO object key: $KEY"
echo "RESULT: $FAILURES failure(s)"
[ "$FAILURES" -eq 0 ]
