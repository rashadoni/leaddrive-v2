#!/usr/bin/env bash
# Installs the TikTok access watch on this workstation as a user timer, beside the line and
# housekeeping watches: its own copy of the watcher, so a removed worktree cannot stop it.
# Idempotent; rerun after changing the watcher.
#
# What it watches and why a browser is needed — the header of
# scripts/tiktok/watch-business-messaging.mjs. Nothing is installed on production for this, and
# nothing here logs in to TikTok: it reads two public documentation pages.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd -- "$repo/.." && pwd)"
notify="${LD_TIKTOK_WATCH_NOTIFY:-$HOME/bin/notify-telegram}"
[ -x "$notify" ] || { echo "install-watch: no Telegram notifier at $notify" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' \
  || { echo "install-watch: Node.js 18+ needed" >&2; exit 1; }
# The watcher renders the pages with the browser this repository already installs for its
# end-to-end tests; without it there is nothing to read, so refuse rather than install a watch
# that will report a failure every morning.
node -e 'require("playwright-core")' 2>/dev/null \
  || { echo "install-watch: playwright-core is missing — run npm install in the repository first" >&2; exit 1; }

dest="$HOME/.local/share/ld-tiktok-watch"
install -D -m 0644 "$repo/scripts/tiktok/watch-business-messaging.mjs" "$dest/watch.mjs"
# The copy runs outside the repository, so the browser package has to be resolvable from there.
# Point at the package's real home rather than at this checkout's `node_modules`: a worktree can be
# deleted, and the watch has to survive that — that is why it is copied out at all.
browser_home="$(node -e 'const p=require("node:path"); console.log(p.dirname(p.dirname(require.resolve("playwright-core/package.json"))))')"
ln -sfn "$browser_home" "$dest/node_modules"

units="$HOME/.config/systemd/user"; mkdir -p "$units"
for unit in ld-tiktok-watch.service ld-tiktok-watch.timer ld-tiktok-watch-failed.service; do
  sed -e "s|@NODE@|$(command -v node)|g" -e "s|@WATCH@|$dest/watch.mjs|g" -e "s|@NOTIFY@|$notify|g" \
    "$repo/ops/tiktok/watch/$unit" >"$units/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now ld-tiktok-watch.timer >/dev/null
echo "ld-tiktok-watch installed; next run:"
systemctl --user list-timers ld-tiktok-watch.timer --no-pager | sed -n '2p'
