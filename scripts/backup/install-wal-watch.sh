#!/usr/bin/env bash
# Installs the WAL archive watch on this workstation as a user timer, beside
# the Kafka and Zeytun line watches: its own copy of the watcher, so a removed
# worktree cannot stop it. Idempotent; rerun after changing the watcher.
# Telegram goes through ~/bin/notify-telegram, the same as the other watches.
#
# The watch lives here and not on production because the bot token lives here
# (owner's decision, 2026-11-01). It only READS production's state file over
# ssh; the check itself runs on production, on its own timer.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd -- "$repo/.." && pwd)"
notify="${LD_WAL_WATCH_NOTIFY:-$HOME/bin/notify-telegram}"
[ -x "$notify" ] || { echo "install-wal-watch: no Telegram notifier at $notify" >&2; exit 1; }
key="${LD_WAL_WATCH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
[ -r "$key" ] || { echo "install-wal-watch: no production key at $key" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "install-wal-watch: Node.js 18+ needed" >&2; exit 1; }
dest="$HOME/.local/share/ld-wal-watch"
install -D -m 0644 "$repo/scripts/backup/wal-archive-watch.mjs" "$dest/watch.mjs"
units="$HOME/.config/systemd/user"; mkdir -p "$units"
for unit in ld-wal-watch.service ld-wal-watch.timer ld-wal-watch-failed.service; do
  sed -e "s|@NODE@|$(command -v node)|g" -e "s|@WATCH@|$dest/watch.mjs|g" "$repo/ops/backup/watch/$unit" >"$units/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now ld-wal-watch.timer >/dev/null
echo "wal watch timer: $(systemctl --user is-active ld-wal-watch.timer)"
