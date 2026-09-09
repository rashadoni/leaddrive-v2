#!/usr/bin/env bash
# Refreshes only the locked [QA-SWISSMED] fixture set used by MTM browser
# evidence and guide capture. This script is intended for a disposable GitHub
# runner; it never accepts a customer tenant, arbitrary account, or a custom
# confirmation phrase.
set -euo pipefail

: "${MTM_EVIDENCE_ORG_SLUG:?MTM_EVIDENCE_ORG_SLUG is required}"
: "${MTM_EVIDENCE_FIXTURE_CONFIRMATION:?MTM_EVIDENCE_FIXTURE_CONFIRMATION is required}"
: "${MTM_EVIDENCE_ADMIN_EMAIL:?MTM_EVIDENCE_ADMIN_EMAIL is required}"
: "${MTM_EVIDENCE_ADMIN_PASSWORD:?MTM_EVIDENCE_ADMIN_PASSWORD is required}"
: "${MTM_EVIDENCE_AGENT_EMAIL:?MTM_EVIDENCE_AGENT_EMAIL is required}"
: "${MTM_EVIDENCE_AGENT_PASSWORD:?MTM_EVIDENCE_AGENT_PASSWORD is required}"
: "${SERVER_HOST:?SERVER_HOST is required}"
: "${SERVER_USER:?SERVER_USER is required}"
: "${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY is required}"
: "${SERVER_SSH_KNOWN_HOSTS:?SERVER_SSH_KNOWN_HOSTS is required}"

readonly fixture_seed_relative="scripts/seeds/zeytunpharm-swissmed-evidence.mjs"
readonly fixture_confirmation="leaddrive-swissmed-evidence"
readonly fixture_org_slug="leaddrive"
readonly fixture_admin_email="qa.swissmed.admin@leaddrivecrm.org"
readonly fixture_agent_email="qa.swissmed.agent@leaddrivecrm.org"
readonly expected_production_host="13.140.132.245"

if [[ "$SERVER_HOST" != "$expected_production_host" ]]; then
  echo "Refusing fixture refresh outside the reviewed production host" >&2
  exit 1
fi

if [[ "$MTM_EVIDENCE_ORG_SLUG" != "$fixture_org_slug" ]]; then
  echo "Refusing fixture refresh outside the locked leaddrive QA tenant" >&2
  exit 1
fi
if [[ "$MTM_EVIDENCE_FIXTURE_CONFIRMATION" != "$fixture_confirmation" ]]; then
  echo "Fixture refresh requires the exact locked confirmation" >&2
  exit 1
fi
if [[ "$MTM_EVIDENCE_ADMIN_EMAIL" != "$fixture_admin_email" || "$MTM_EVIDENCE_AGENT_EMAIL" != "$fixture_agent_email" ]]; then
  echo "Fixture refresh requires the dedicated SwissMed QA principals" >&2
  exit 1
fi
if [[ "$MTM_EVIDENCE_ADMIN_PASSWORD" != "$MTM_EVIDENCE_AGENT_PASSWORD" || ${#MTM_EVIDENCE_ADMIN_PASSWORD} -lt 24 ]]; then
  echo "Fixture refresh requires one shared QA password of at least 24 characters" >&2
  exit 1
fi
if [[ ! -f "$fixture_seed_relative" ]]; then
  echo "Fixture seed is missing from this checkout: $fixture_seed_relative" >&2
  exit 1
fi

fixture_runner_temp="${RUNNER_TEMP:-/tmp}"
fixture_temp_root="$(mktemp -d "$fixture_runner_temp/swissmed-mtm-fixture.XXXXXXXX")"
fixture_ssh_dir="$fixture_temp_root/ssh"
fixture_password_file="$fixture_temp_root/password"
fixture_remote_dir=""
fixture_remote_password_file=""

cleanup_fixture_access() {
  if [[ "$fixture_remote_dir" =~ ^/tmp/swissmed-mtm\.[A-Za-z0-9]{8}$ && "$fixture_remote_password_file" == "$fixture_remote_dir/password" ]]; then
    ssh "${fixture_ssh_options[@]}" "$SERVER_USER@$SERVER_HOST" \
      "rm -f '$fixture_remote_password_file'; rmdir '$fixture_remote_dir' 2>/dev/null || true" >/dev/null 2>&1 || true
  fi
  rm -f "$fixture_password_file" "$fixture_ssh_dir/deploy_key" "$fixture_ssh_dir/known_hosts"
  rmdir "$fixture_ssh_dir" 2>/dev/null || true
  rmdir "$fixture_temp_root" 2>/dev/null || true
}

mkdir -p "$fixture_ssh_dir"
chmod 700 "$fixture_ssh_dir"
umask 077
printf '%s\n' "$SSH_PRIVATE_KEY" > "$fixture_ssh_dir/deploy_key"
printf '%s\n' "$SERVER_SSH_KNOWN_HOSTS" > "$fixture_ssh_dir/known_hosts"
chmod 600 "$fixture_ssh_dir/deploy_key" "$fixture_ssh_dir/known_hosts"
ssh-keygen -F "$SERVER_HOST" -f "$fixture_ssh_dir/known_hosts" >/dev/null || {
  echo "Pinned known_hosts does not contain the production server" >&2
  exit 1
}
printf '%s' "$MTM_EVIDENCE_ADMIN_PASSWORD" > "$fixture_password_file"
chmod 600 "$fixture_password_file"

fixture_seed_sha="$(sha256sum "$fixture_seed_relative" | cut -d' ' -f1)"
fixture_ssh_options=(
  -o BatchMode=yes
  -o ConnectTimeout=30
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=2
  -o UserKnownHostsFile="$fixture_ssh_dir/known_hosts"
  -i "$fixture_ssh_dir/deploy_key"
)
trap cleanup_fixture_access EXIT

fixture_remote_dir="$(ssh "${fixture_ssh_options[@]}" "$SERVER_USER@$SERVER_HOST" 'umask 077; mktemp -d /tmp/swissmed-mtm.XXXXXXXX')"
[[ "$fixture_remote_dir" =~ ^/tmp/swissmed-mtm\.[A-Za-z0-9]{8}$ ]] || {
  echo "Production server returned an invalid fixture directory" >&2
  exit 1
}
fixture_remote_password_file="$fixture_remote_dir/password"
scp "${fixture_ssh_options[@]}" "$fixture_password_file" "$SERVER_USER@$SERVER_HOST:$fixture_remote_password_file"
ssh "${fixture_ssh_options[@]}" "$SERVER_USER@$SERVER_HOST" "chmod 600 '$fixture_remote_password_file'"

ssh "${fixture_ssh_options[@]}" "$SERVER_USER@$SERVER_HOST" 'bash -s' -- \
  "$MTM_EVIDENCE_ORG_SLUG" \
  "$MTM_EVIDENCE_FIXTURE_CONFIRMATION" \
  "$MTM_EVIDENCE_ADMIN_EMAIL" \
  "$MTM_EVIDENCE_AGENT_EMAIL" \
  "$fixture_seed_sha" \
  "$fixture_remote_password_file" <<'REMOTE'
set -euo pipefail
readonly app_dir="/opt/leaddrive-v2"
readonly app_env_file="${APP_ENV_FILE:-/etc/leaddrive/app.env}"
readonly seed="$app_dir/.next/standalone/scripts/seeds/zeytunpharm-swissmed-evidence.mjs"
organization_slug="$1"
confirmation="$2"
admin_email="$3"
agent_email="$4"
expected_seed_sha="$5"
password_file="$6"
password_dir="${password_file%/*}"
trap 'rm -f "$password_file"; rmdir "$password_dir" 2>/dev/null || true' EXIT

[[ -f "$seed" ]] || { echo "Deployed SwissMed fixture seed is missing" >&2; exit 1; }
[[ -f "$app_env_file" && ! -L "$app_env_file" ]] || { echo "Canonical app env is missing or is a symlink" >&2; exit 1; }
actual_seed_sha="$(sha256sum "$seed" | cut -d' ' -f1)"
[[ "$actual_seed_sha" == "$expected_seed_sha" ]] || {
  echo "Deployed fixture seed does not match this reviewed revision; deploy main first" >&2
  exit 1
}
chmod 600 "$password_file"
password="$(<"$password_file")"
rm -f "$password_file"
cd "$app_dir/.next/standalone"
env \
  CONFIRM_PROD="$confirmation" \
  MTM_EVIDENCE_ORG_SLUG="$organization_slug" \
  MTM_EVIDENCE_ADMIN_EMAIL="$admin_email" \
  MTM_EVIDENCE_AGENT_EMAIL="$agent_email" \
  MTM_EVIDENCE_PASSWORD="$password" \
  node --env-file="$app_env_file" "$seed"
REMOTE

echo "Scoped SwissMed QA fixtures refreshed"
