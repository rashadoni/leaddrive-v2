#!/usr/bin/env bash
# Installs the offsite copy of client files on PRODUCTION. Run once, on the
# production host, as root. Idempotent.
#
# It installs only a timer and a unit: the program itself arrives with every
# deploy at /usr/local/lib/leaddrive-v2/ops/current/backup/, like the other
# backup scripts. It touches none of the four ceremony units the deploy keeps
# stopped, and needs no commissioning: the bucket credentials are the ones
# pgBackRest, the release artifact and the help-video masters already use.
#
#   bash uploads-offsite-install.sh --recipient age1…   # install and enable
#   bash uploads-offsite-install.sh --check             # say what is installed
#
# The recipient is the OWNER's age public key — the same shape the nightly dump
# is encrypted to. It is written to /etc/leaddrive/uploads-offsite.env (root,
# 0600). A public key is not a secret, but it belongs beside the other
# operational configuration rather than inside a unit file.
set -Eeuo pipefail

MODE=install
RECIPIENT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --recipient) RECIPIENT="${2:-}"; shift 2 ;;
    --check) MODE=check; shift ;;
    *) printf 'Usage: %s --recipient age1… | --check\n' "$0" >&2; exit 2 ;;
  esac
done

units=(leaddrive-uploads-offsite.service leaddrive-uploads-offsite.timer)
ops="/usr/local/lib/leaddrive-v2/ops/current"
env_file="/etc/leaddrive/uploads-offsite.env"
program="$ops/backup/uploads-offsite-mirror.sh"

if [ "$MODE" = check ]; then
  printf 'program: %s\n' "$([ -x "$program" ] && echo present || echo MISSING)"
  printf 'recipient: %s\n' "$([ -s "$env_file" ] && echo configured || echo MISSING)"
  printf 'timer: %s %s\n' "$(systemctl is-enabled leaddrive-uploads-offsite.timer 2>/dev/null || echo not-installed)" \
    "$(systemctl is-active leaddrive-uploads-offsite.timer 2>/dev/null || true)"
  if [ -s /var/lib/leaddrive-uploads-offsite/state ]; then
    printf 'last run:\n'
    sed 's/^/  /' /var/lib/leaddrive-uploads-offsite/state
  else
    printf 'last run: never\n'
  fi
  exit 0
fi

[ "$(id -u)" = 0 ] || { echo "uploads-offsite-install: run as root on production" >&2; exit 2; }
[[ "$RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] \
  || { echo "uploads-offsite-install: --recipient must be an age public key (age1…)" >&2; exit 2; }
[ -x "$program" ] \
  || { echo "uploads-offsite-install: $program is missing — deploy first" >&2; exit 2; }
[ -f /etc/leaddrive/wal-archive.env ] \
  || { echo "uploads-offsite-install: /etc/leaddrive/wal-archive.env is missing" >&2; exit 2; }
for command_name in age aws; do
  command -v "$command_name" >/dev/null 2>&1 \
    || { echo "uploads-offsite-install: $command_name is required on this host" >&2; exit 2; }
done

install -d -m 0700 /var/lib/leaddrive-uploads-offsite
umask 077
printf 'UPLOADS_OFFSITE_AGE_RECIPIENT=%s\n' "$RECIPIENT" >"$env_file.new"
chmod 0600 "$env_file.new"
mv -- "$env_file.new" "$env_file"
for unit in "${units[@]}"; do
  install -m 0644 -- "$ops/systemd/$unit" "/etc/systemd/system/$unit"
done
# The unit reads the recipient from the env file, so it is added here rather
# than baked into the shipped unit.
install -d -m 0755 /etc/systemd/system/leaddrive-uploads-offsite.service.d
printf '[Service]\nEnvironmentFile=%s\n' "$env_file" \
  >/etc/systemd/system/leaddrive-uploads-offsite.service.d/recipient.conf
systemctl daemon-reload
systemctl enable --now leaddrive-uploads-offsite.timer >/dev/null
printf 'uploads-offsite timer: %s\n' "$(systemctl is-active leaddrive-uploads-offsite.timer)"
printf 'first run: systemctl start leaddrive-uploads-offsite.service; journalctl -u leaddrive-uploads-offsite -n 20\n'
