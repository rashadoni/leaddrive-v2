#!/usr/bin/env bash
# Installs the Zeytun line watch on this workstation as a user timer, beside
# the Kafka watch (provision.sh install-watch): its own copy of watch.mjs, so a
# removed worktree cannot stop it. Idempotent; rerun after changing watch.mjs.
# Telegram goes through ~/bin/notify-telegram, the same as the Kafka watch.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
notify="${LD_LINE_WATCH_NOTIFY:-$HOME/bin/notify-telegram}"
[ -x "$notify" ] || { echo "install-watch: no Telegram notifier at $notify" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "install-watch: Node.js 18+ needed" >&2; exit 1; }
dest="$HOME/.local/share/ld-line-watch"
install -D -m 0644 "$repo/scripts/zeytun-line/watch.mjs" "$dest/watch.mjs"
units="$HOME/.config/systemd/user"; mkdir -p "$units"
for unit in ld-line-watch.service ld-line-watch.timer ld-line-watch-failed.service; do
  sed -e "s|@NODE@|$(command -v node)|g" -e "s|@WATCH@|$dest/watch.mjs|g" "$repo/ops/zeytun-line/watch/$unit" >"$units/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now ld-line-watch.timer >/dev/null
echo "line watch timer: $(systemctl --user is-active ld-line-watch.timer)"
