#!/usr/bin/env bash
# Installs the production housekeeping watch on this workstation as a user
# timer, beside the WAL archive, Kafka and Zeytun line watches: its own copy of
# the watcher, so a removed worktree cannot stop it. Idempotent; rerun after
# changing the watcher. Telegram goes through ~/bin/notify-telegram, like the
# others.
#
# It watches three things nothing watched before (docs/BACKUP_RUNBOOK.md): the
# login page as a person reaches it, last night's backups, and free disk space.
# Nothing is installed on production for this — the page is fetched over HTTPS
# and the rest is one read-only ssh call.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd -- "$repo/.." && pwd)"
notify="${LD_HOST_WATCH_NOTIFY:-$HOME/bin/notify-telegram}"
[ -x "$notify" ] || { echo "install-host-watch: no Telegram notifier at $notify" >&2; exit 1; }
key="${LD_HOST_WATCH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
[ -r "$key" ] || { echo "install-host-watch: no production key at $key" >&2; exit 1; }
# fetch() and AbortController, so the page check needs no dependency.
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' \
  || { echo "install-host-watch: Node.js 18+ needed" >&2; exit 1; }
dest="$HOME/.local/share/ld-host-watch"
install -D -m 0644 "$repo/scripts/backup/watch-delivery.mjs" "$dest/watch-delivery.mjs"
install -D -m 0644 "$repo/scripts/backup/host-health-watch.mjs" "$dest/watch.mjs"
units="$HOME/.config/systemd/user"; mkdir -p "$units"
for unit in ld-host-watch.service ld-host-watch.timer ld-host-watch-failed.service; do
  sed -e "s|@NODE@|$(command -v node)|g" -e "s|@WATCH@|$dest/watch.mjs|g" "$repo/ops/backup/watch/$unit" >"$units/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now ld-host-watch.timer >/dev/null
echo "host watch timer: $(systemctl --user is-active ld-host-watch.timer)"
