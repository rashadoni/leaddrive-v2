#!/usr/bin/env bash
set -Eeuo pipefail

# Run only on an independent offline workstation. The script proves that two
# age identity copies on separate mounted filesystems derive the commissioned
# recipient and can each decrypt a fresh canary. Physical/failure-domain
# separation remains an explicit signed operator attestation because st_dev
# and mount metadata cannot prove physical ancestry or administrative domains.

umask 077

IDENTITY_COPY_ONE="${1:-}"
IDENTITY_COPY_TWO="${2:-}"
EXPECTED_RECIPIENT_SHA256="${3:-}"
EVIDENCE_REF="${4:-}"
OFFLINE_OPERATOR="${5:-}"
SIGNING_KEY_FILE="${6:-}"
OUTPUT_FILE_INPUT="${7:-}"
REVIEWED_MAIN_SHA="${8:-}"
FAILURE_DOMAIN_ATTESTATION="${9:-}"

SCRATCH_ROOT_REAL=""
WORK_DIR=""
OUTPUT_STAGE_DIR=""
OUTPUT_FILE=""
OUTPUT_SIGNATURE=""
OUTPUT_BUNDLE=""
OUTPUT_BUNDLE_BASE64=""
OUTPUT_PARENT_REAL=""
PUBLISHED=0
PUBLISHED_EVIDENCE=0
PUBLISHED_SIGNATURE=0
PUBLISHED_BUNDLE=0
PUBLISHED_BUNDLE_BASE64=0

fatal() {
  printf '[age-key-custody] FATAL: %s\n' "$*" >&2
  exit 1
}

safe_remove_work_tree() {
  local path="$1"
  [ -n "$path" ] || return 0
  case "$path" in
    "$SCRATCH_ROOT_REAL"/.leaddrive-age-key-custody.*)
      [ -d "$path" ] && [ ! -L "$path" ] \
        || fatal "refusing cleanup of an unexpected scratch path"
      rm -rf --one-file-system -- "$path"
      ;;
    *) fatal "refusing cleanup outside the reviewed scratch root" ;;
  esac
}

safe_remove_output_stage() {
  local path="$1"
  [ -n "$path" ] || return 0
  case "$path" in
    "$OUTPUT_PARENT_REAL"/.leaddrive-age-key-custody-output.*)
      [ -d "$path" ] && [ ! -L "$path" ] \
        || fatal "refusing cleanup of an unexpected output stage"
      rm -rf --one-file-system -- "$path"
      ;;
    *) fatal "refusing cleanup outside the reviewed output parent" ;;
  esac
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
    [ -z "$OUTPUT_PARENT_REAL" ] || sync -f -- "$OUTPUT_PARENT_REAL" 2>/dev/null || true
  fi

  [ -z "$OUTPUT_STAGE_DIR" ] || safe_remove_output_stage "$OUTPUT_STAGE_DIR"
  [ -z "$WORK_DIR" ] || safe_remove_work_tree "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT

[ "$#" -eq 9 ] \
  || fatal "usage: verify-age-key-custody.sh COPY_ONE COPY_TWO RECIPIENT_SHA256 EVIDENCE_REF OFFLINE_OPERATOR SIGNING_KEY OUTPUT REVIEWED_MAIN_SHA FAILURE_DOMAIN_ATTESTATION"
[ -n "${OFFLINE_SCRATCH_ROOT:-}" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must name an operator-provided encrypted or ephemeral mount"

for command_name in age age-keygen base64 cmp dd findmnt ln mountpoint \
  realpath sha256sum ssh-keygen stat sync tar; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fatal "$command_name is required"
done

age_version="$(age --version 2>&1)" \
  || fatal "age version could not be determined"
age_keygen_version="$(age-keygen --version 2>&1)" \
  || fatal "age-keygen version could not be determined"
[[ "$age_version" =~ ^(age[[:space:]]+)?v?1\.3\.2$ ]] \
  && [[ "$age_keygen_version" =~ ^(age-keygen[[:space:]]+)?v?1\.3\.2$ ]] \
  || fatal "offline custody verification requires exact age and age-keygen 1.3.2"
unset age_version age_keygen_version

[[ "$EXPECTED_RECIPIENT_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fatal "expected recipient digest must be lowercase SHA-256"
[[ "$EVIDENCE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]] \
  || fatal "evidence reference has an unsafe shape"
[[ "$OFFLINE_OPERATOR" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$ ]] \
  || fatal "offline operator identifier has an unsafe shape"
[[ "$REVIEWED_MAIN_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fatal "reviewed main revision must be an exact lowercase Git SHA"
[ "$FAILURE_DOMAIN_ATTESTATION" = "TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED" ] \
  || fatal "operator must explicitly attest two physically separate offline media/failure domains"
[ -n "$OUTPUT_FILE_INPUT" ] || fatal "output evidence path is required"
[ -f "${BASH_SOURCE[0]}" ] && [ ! -L "${BASH_SOURCE[0]}" ] \
  || fatal "custody verifier itself must be a regular non-symlink file"
custody_verifier_sha256="$(sha256sum "${BASH_SOURCE[0]}" | awk '{print $1}')"

assert_private_file() {
  local label="$1"
  local file="$2"
  local mode
  [ -f "$file" ] && [ ! -L "$file" ] && [ -s "$file" ] && [ -r "$file" ] \
    || fatal "$label must be a readable non-empty regular non-symlink file"
  mode="$(stat -c '%a' -- "$file")" \
    || fatal "$label permissions could not be read"
  case "$mode" in
    400|600) ;;
    *) fatal "$label must use mode 0400 or 0600" ;;
  esac
  [ "$(stat -c '%u' -- "$file")" = "$(id -u)" ] \
    || fatal "$label must belong to the current offline operator"
}

assert_private_file "first age identity copy" "$IDENTITY_COPY_ONE"
assert_private_file "second age identity copy" "$IDENTITY_COPY_TWO"
assert_private_file "offline evidence signing key" "$SIGNING_KEY_FILE"

copy_one_real="$(realpath -e -- "$IDENTITY_COPY_ONE")" \
  || fatal "first identity canonical path could not be resolved"
copy_two_real="$(realpath -e -- "$IDENTITY_COPY_TWO")" \
  || fatal "second identity canonical path could not be resolved"
signing_key_real="$(realpath -e -- "$SIGNING_KEY_FILE")" \
  || fatal "signing key canonical path could not be resolved"
[ "$copy_one_real" != "$copy_two_real" ] \
  || fatal "the two identity copies resolve to the same canonical path"

copy_one_device="$(stat -c '%d' -- "$copy_one_real")"
copy_two_device="$(stat -c '%d' -- "$copy_two_real")"
copy_one_inode="$(stat -c '%i' -- "$copy_one_real")"
copy_two_inode="$(stat -c '%i' -- "$copy_two_real")"
[ "$copy_one_device:$copy_one_inode" != "$copy_two_device:$copy_two_inode" ] \
  || fatal "the two identity copies have the same filesystem identity"
[ "$copy_one_device" != "$copy_two_device" ] \
  || fatal "the two identity copies must reside on different filesystem devices"

root_device="$(stat -c '%d' -- /)"
copy_one_mount="$(findmnt -n -T "$copy_one_real" -o TARGET)" \
  || fatal "first identity filesystem could not be resolved"
copy_two_mount="$(findmnt -n -T "$copy_two_real" -o TARGET)" \
  || fatal "second identity filesystem could not be resolved"
[ -n "$copy_one_mount" ] && [ -n "$copy_two_mount" ] \
  && [[ "$copy_one_mount" != *$'\n'* ]] && [[ "$copy_two_mount" != *$'\n'* ]] \
  || fatal "identity copies must each resolve to one mounted filesystem"
[ "$copy_one_mount" != / ] && [ "$copy_two_mount" != / ] \
  && [ "$copy_one_device" != "$root_device" ] \
  && [ "$copy_two_device" != "$root_device" ] \
  || fatal "both identity copies must reside outside the workstation root filesystem"

SCRATCH_ROOT_REAL="$(realpath -e -- "$OFFLINE_SCRATCH_ROOT")" \
  || fatal "OFFLINE_SCRATCH_ROOT could not be resolved"
[ -d "$OFFLINE_SCRATCH_ROOT" ] && [ ! -L "$OFFLINE_SCRATCH_ROOT" ] \
  && [ -d "$SCRATCH_ROOT_REAL" ] && [ -w "$SCRATCH_ROOT_REAL" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must be a writable real directory"
[ "$SCRATCH_ROOT_REAL" != / ] \
  || fatal "the workstation root filesystem may not be used as offline scratch"
[ "$(stat -c '%u' -- "$SCRATCH_ROOT_REAL")" = "$(id -u)" ] \
  || fatal "OFFLINE_SCRATCH_ROOT must belong to the current offline operator"
scratch_mode="$(stat -c '%a' -- "$SCRATCH_ROOT_REAL")"
[[ "$scratch_mode" =~ ^[0-7]{3,4}$ ]] \
  || fatal "OFFLINE_SCRATCH_ROOT permissions could not be validated"
scratch_mode_decimal=$((8#$scratch_mode))
(( (scratch_mode_decimal & 0077) == 0 )) \
  || fatal "OFFLINE_SCRATCH_ROOT must not grant group or other permissions"
mountpoint -q -- "$SCRATCH_ROOT_REAL" \
  || fatal "OFFLINE_SCRATCH_ROOT itself must be a mounted encrypted or ephemeral filesystem"
scratch_mount="$(findmnt -n -T "$SCRATCH_ROOT_REAL" -o TARGET)" \
  || fatal "OFFLINE_SCRATCH_ROOT mount could not be resolved"
[ -n "$scratch_mount" ] && [[ "$scratch_mount" != *$'\n'* ]] \
  && [ "$scratch_mount" != / ] \
  || fatal "OFFLINE_SCRATCH_ROOT must resolve to one non-root mount"
scratch_device="$(stat -c '%d' -- "$SCRATCH_ROOT_REAL")"
[ "$scratch_device" != "$root_device" ] \
  && [ "$scratch_device" != "$copy_one_device" ] \
  && [ "$scratch_device" != "$copy_two_device" ] \
  || fatal "scratch must use a filesystem device separate from root and both identity copies"
unset scratch_mode scratch_mode_decimal scratch_mount root_device copy_one_mount copy_two_mount

output_parent_input="$(dirname -- "$OUTPUT_FILE_INPUT")"
output_name="$(basename -- "$OUTPUT_FILE_INPUT")"
[ "$output_name" != . ] && [ "$output_name" != .. ] && [ -n "$output_name" ] \
  || fatal "output evidence filename is invalid"
OUTPUT_PARENT_REAL="$(realpath -e -- "$output_parent_input")" \
  || fatal "output evidence parent could not be resolved"
[ -d "$output_parent_input" ] && [ ! -L "$output_parent_input" ] \
  && [ -d "$OUTPUT_PARENT_REAL" ] && [ -w "$OUTPUT_PARENT_REAL" ] \
  || fatal "output evidence parent must be a writable real directory"
[ "$(stat -c '%u' -- "$OUTPUT_PARENT_REAL")" = "$(id -u)" ] \
  || fatal "output evidence parent must belong to the current offline operator"
output_parent_mode="$(stat -c '%a' -- "$OUTPUT_PARENT_REAL")"
[[ "$output_parent_mode" =~ ^[0-7]{3,4}$ ]] \
  || fatal "output evidence parent permissions could not be validated"
output_parent_mode_decimal=$((8#$output_parent_mode))
(( (output_parent_mode_decimal & 0022) == 0 )) \
  || fatal "output evidence parent must not be group- or world-writable"
OUTPUT_FILE="$OUTPUT_PARENT_REAL/$output_name"
OUTPUT_SIGNATURE="$OUTPUT_FILE.sig"
OUTPUT_BUNDLE="$OUTPUT_FILE.bundle.tar"
OUTPUT_BUNDLE_BASE64="$OUTPUT_FILE.bundle.b64"
for output in "$OUTPUT_FILE" "$OUTPUT_SIGNATURE" "$OUTPUT_BUNDLE" "$OUTPUT_BUNDLE_BASE64"; do
  [ ! -e "$output" ] && [ ! -L "$output" ] \
    || fatal "refusing to overwrite an existing evidence output"
done
unset output_parent_input output_name output_parent_mode output_parent_mode_decimal

signing_public="$(ssh-keygen -y -f "$signing_key_real" 2>/dev/null)" \
  || fatal "offline evidence signing key could not derive a public key"
[[ "$signing_public" =~ ^ssh-ed25519[[:space:]]+AAAA[A-Za-z0-9+/=]+$ ]] \
  || fatal "offline evidence signing key must be Ed25519"
unset signing_public

copy_one_identity_before="$(stat -c '%d:%i:%s:%Y' -- "$copy_one_real")"
copy_two_identity_before="$(stat -c '%d:%i:%s:%Y' -- "$copy_two_real")"
copy_one_content_before="$(sha256sum "$copy_one_real" | awk '{print $1}')"
copy_two_content_before="$(sha256sum "$copy_two_real" | awk '{print $1}')"
recipient_one="$(age-keygen -y "$copy_one_real" 2>/dev/null)" \
  || fatal "first age identity copy could not derive its public recipient"
recipient_two="$(age-keygen -y "$copy_two_real" 2>/dev/null)" \
  || fatal "second age identity copy could not derive its public recipient"
[[ "$recipient_one" =~ ^age1[0-9a-z]{58}$ ]] \
  && [[ "$recipient_two" =~ ^age1[0-9a-z]{58}$ ]] \
  || fatal "both identity copies must contain native age X25519 identities"
[ "$recipient_one" = "$recipient_two" ] \
  || fatal "the two identity copies derive different recipients"
actual_recipient_sha256="$(printf '%s' "$recipient_one" | sha256sum | awk '{print $1}')"
[ "$actual_recipient_sha256" = "$EXPECTED_RECIPIENT_SHA256" ] \
  || fatal "identity copies belong to a different commissioned recipient"

WORK_DIR="$(mktemp -d "$SCRATCH_ROOT_REAL/.leaddrive-age-key-custody.XXXXXX")"
[ -d "$WORK_DIR" ] && [ ! -L "$WORK_DIR" ] \
  && [ "$(stat -c '%d' -- "$WORK_DIR")" = "$scratch_device" ] \
  || fatal "scratch work directory was not created on the reviewed mount"
chmod 0700 "$WORK_DIR"
printf '%s\n' "$recipient_one" >"$WORK_DIR/recipient.txt"
unset recipient_one recipient_two

dd if=/dev/urandom of="$WORK_DIR/canary.plain" bs=1024 count=1 status=none \
  || fatal "fresh random canary could not be created"
age --encrypt --recipients-file "$WORK_DIR/recipient.txt" \
  --output "$WORK_DIR/canary.age" "$WORK_DIR/canary.plain" \
  >/dev/null 2>&1 || fatal "fresh canary encryption failed"
age --decrypt --identity "$copy_one_real" \
  --output "$WORK_DIR/canary.copy-one" "$WORK_DIR/canary.age" \
  >/dev/null 2>&1 || fatal "first identity copy did not decrypt the fresh canary"
cmp -s -- "$WORK_DIR/canary.plain" "$WORK_DIR/canary.copy-one" \
  || fatal "first identity copy produced a different canary"
age --decrypt --identity "$copy_two_real" \
  --output "$WORK_DIR/canary.copy-two" "$WORK_DIR/canary.age" \
  >/dev/null 2>&1 || fatal "second identity copy did not decrypt the fresh canary"
cmp -s -- "$WORK_DIR/canary.plain" "$WORK_DIR/canary.copy-two" \
  || fatal "second identity copy produced a different canary"

[ "$(stat -c '%d:%i:%s:%Y' -- "$copy_one_real")" = "$copy_one_identity_before" ] \
  && [ "$(stat -c '%d:%i:%s:%Y' -- "$copy_two_real")" = "$copy_two_identity_before" ] \
  || fatal "an identity copy changed while custody verification was running"
[ "$(sha256sum "$copy_one_real" | awk '{print $1}')" = "$copy_one_content_before" ] \
  && [ "$(sha256sum "$copy_two_real" | awk '{print $1}')" = "$copy_two_content_before" ] \
  || fatal "identity-copy content changed while custody verification was running"
recipient_one_after="$(age-keygen -y "$copy_one_real" 2>/dev/null)" \
  || fatal "first identity copy could not re-derive its recipient"
recipient_two_after="$(age-keygen -y "$copy_two_real" 2>/dev/null)" \
  || fatal "second identity copy could not re-derive its recipient"
[ "$recipient_one_after" = "$recipient_two_after" ] \
  && [ "$(printf '%s' "$recipient_one_after" | sha256sum | awk '{print $1}')" = "$EXPECTED_RECIPIENT_SHA256" ] \
  || fatal "identity recipients changed during custody verification"
unset recipient_one_after recipient_two_after copy_one_content_before copy_two_content_before
[ "$(sha256sum "${BASH_SOURCE[0]}" | awk '{print $1}')" = "$custody_verifier_sha256" ] \
  || fatal "custody verifier bytes changed while verification was running"
unset copy_one_identity_before copy_two_identity_before copy_one_device copy_two_device
unset copy_one_inode copy_two_inode scratch_device

verified_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
evidence_file="$WORK_DIR/evidence.env"
printf '%s\n' \
  'FORMAT_VERSION=1' \
  'EVIDENCE_TYPE=age-key-custody' \
  'STATUS=verified' \
  'COPY_COUNT_MINIMUM=2' \
  'COPY_ONE_DECRYPT_STATUS=passed' \
  'COPY_TWO_DECRYPT_STATUS=passed' \
  'COPY_FILE_IDENTITY_STATUS=distinct' \
  'COPY_FILESYSTEM_DEVICE_STATUS=distinct' \
  'COPY_FAILURE_DOMAIN_ATTESTATION=TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED' \
  "RECIPIENT_SHA256=$actual_recipient_sha256" \
  'SCRATCH_MOUNT_STATUS=separate' \
  "CUSTODY_VERIFIER_SHA256=$custody_verifier_sha256" \
  "REVIEWED_MAIN_SHA=$REVIEWED_MAIN_SHA" \
  "EVIDENCE_REF=$EVIDENCE_REF" \
  "OFFLINE_OPERATOR=$OFFLINE_OPERATOR" \
  "VERIFIED_AT_UTC=$verified_at" >"$evidence_file"
chmod 0600 "$evidence_file"

ssh-keygen -Y sign -f "$signing_key_real" \
  -n leaddrive-backup-evidence "$evidence_file" >/dev/null \
  || fatal "offline custody evidence signing failed"
[ -s "$evidence_file.sig" ] && [ ! -L "$evidence_file.sig" ] \
  || fatal "offline custody evidence signature is missing"
chmod 0600 "$evidence_file.sig"

install -d -m 0700 "$WORK_DIR/bundle"
install -m 0600 "$evidence_file" "$WORK_DIR/bundle/evidence.env"
install -m 0600 "$evidence_file.sig" "$WORK_DIR/bundle/evidence.env.sig"
tar -C "$WORK_DIR/bundle" -cf "$WORK_DIR/evidence.bundle.tar" \
  evidence.env evidence.env.sig
base64 --wrap=0 "$WORK_DIR/evidence.bundle.tar" >"$WORK_DIR/evidence.bundle.b64"
printf '\n' >>"$WORK_DIR/evidence.bundle.b64"
chmod 0600 "$WORK_DIR/evidence.bundle.tar" "$WORK_DIR/evidence.bundle.b64"

OUTPUT_STAGE_DIR="$(mktemp -d "$OUTPUT_PARENT_REAL/.leaddrive-age-key-custody-output.XXXXXX")"
chmod 0700 "$OUTPUT_STAGE_DIR"
install -m 0600 "$evidence_file" "$OUTPUT_STAGE_DIR/evidence.env"
install -m 0600 "$evidence_file.sig" "$OUTPUT_STAGE_DIR/evidence.env.sig"
install -m 0600 "$WORK_DIR/evidence.bundle.tar" "$OUTPUT_STAGE_DIR/evidence.bundle.tar"
install -m 0600 "$WORK_DIR/evidence.bundle.b64" "$OUTPUT_STAGE_DIR/evidence.bundle.b64"
sync -f -- "$OUTPUT_STAGE_DIR/evidence.env" "$OUTPUT_STAGE_DIR/evidence.env.sig" \
  "$OUTPUT_STAGE_DIR/evidence.bundle.tar" "$OUTPUT_STAGE_DIR/evidence.bundle.b64" \
  "$OUTPUT_STAGE_DIR" "$OUTPUT_PARENT_REAL"

# Hard-link publication is an atomic no-clobber operation for every pathname.
# If a concurrent writer wins any name, cleanup rolls back only links whose
# inode is still one of this invocation's staged files.
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
printf '[age-key-custody] two filesystem-distinct, failure-domain-attested identity copies decrypted a fresh canary\n'
printf '[age-key-custody] evidence_at_utc=%s\n' "$verified_at"
printf '[age-key-custody] signed_evidence_sha256=%s\n' "$evidence_sha256"
printf '[age-key-custody] bundle_base64_file=%s\n' "$OUTPUT_BUNDLE_BASE64"
printf '[age-key-custody] recipient_sha256=%s\n' "$actual_recipient_sha256"
