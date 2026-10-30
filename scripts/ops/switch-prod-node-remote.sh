#!/bin/bash
# Runs switch-prod-node.sh on production, detached from this connection.
#   bash scripts/ops/switch-prod-node-remote.sh check|apply|rollback
#
# Piping the script into `ssh … bash -s` ties it to the connection: the dev
# box's terminal dropped its link mid-session on 2026-10-29, and a switch killed
# between the package install and the pm2 restart would leave production half
# done. So the script is copied to the host, started there under setsid, and
# this side only follows its log — losing the connection loses the view, not
# the switch. Reconnect and read /var/log/leaddrive-node-switch.log.
set -euo pipefail

MODE="${1:?usage: switch-prod-node-remote.sh check|apply|rollback}"
case "$MODE" in check | apply | rollback) ;; *) echo "mode must be check, apply or rollback" >&2; exit 1 ;; esac
KEY="${PROD_SSH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
HOST="${PROD_SSH_HOST:-root@13.140.132.245}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -i "$KEY" -o ControlMaster=no "$HOST")

"${SSH[@]}" 'cat > /root/switch-prod-node.sh && chmod 700 /root/switch-prod-node.sh' < "$HERE/switch-prod-node.sh"
"${SSH[@]}" "
  log=/var/log/leaddrive-node-switch.log
  n=\$(wc -l < \$log 2>/dev/null || echo 0)
  setsid nohup bash /root/switch-prod-node.sh $MODE </dev/null >/var/log/leaddrive-node-switch.out 2>&1 &
  pid=\$!
  sleep 1
  tail --pid=\$pid -n +\$((n + 1)) -f \$log
  # Anything the script did not log itself (an unexpected failure under set -e).
  grep -v '^\[20' /var/log/leaddrive-node-switch.out | tail -n 5 || true
"
