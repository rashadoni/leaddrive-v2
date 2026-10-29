#!/usr/bin/env bash
# Installs the backup copy of the Zeytun line watch on the Kafka backup watch
# host (OVH Gravelines, outside Contabo), as root, beside ld-kafka-backup-watch:
# it uses that watch's Telegram sender and the heartbeat the dev box leaves
# there, so it stands by while the dev box is alive. Run after
# `provision.sh install-backup-watch`. Idempotent; rerun after a watch.mjs change.
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
state="${LD_KAFKA_STATE:-$HOME/.leaddrive-kafka}"
key="${LD_KAFKA_SSH_KEY:-$HOME/.ssh/leaddrive_kafka_ops}"
name="$(node --input-type=module -e "import { BACKUP_WATCH_HOST } from '$repo/scripts/event-platform/cluster/watch.mjs'; console.log(BACKUP_WATCH_HOST)")"
ip="$(node -e 'const i = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hosts[process.argv[2]]; if (!i?.publicAddress) process.exit(1); console.log(i.publicAddress)' "$state/inventory.json" "$name")"
on() { ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o ControlMaster=no -o ControlPath=none \
  -o UserKnownHostsFile="$state/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=15 "root@$ip" "$@"; }
on 'test -x /usr/local/sbin/ld-kafka-notify && test -r /etc/leaddrive-kafka/watch-notify.env' \
  || { echo "install-backup-watch: the Kafka backup watch is not installed on $name" >&2; exit 1; }
on 'install -d -m 0700 /var/lib/ld-line-watch && install -d -m 0755 /opt/ld-line-watch'
on 'install -m 0644 /dev/stdin /opt/ld-line-watch/watch.mjs' <"$repo/scripts/zeytun-line/watch.mjs"
for unit in ld-line-backup-watch.service ld-line-backup-watch.timer ld-line-backup-watch-failed.service; do
  on "install -m 0644 /dev/stdin /etc/systemd/system/$unit" <"$repo/ops/zeytun-line/watch/$unit"
done
on 'systemctl daemon-reload && systemctl enable --now ld-line-backup-watch.timer >/dev/null && systemctl is-active ld-line-backup-watch.timer' \
  | sed "s/^/backup line watch timer on $name: /"
