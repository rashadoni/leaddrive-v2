#!/usr/bin/env bash
# notify-telegram.sh TITLE TEXT: one message to the owner's Telegram. Installed
# as /usr/local/sbin/ld-kafka-notify on the backup watch host; the bot token and
# chat live in /etc/leaddrive-kafka/watch-notify.env (root, 0600), never here.
set -euo pipefail
config=/etc/leaddrive-kafka/watch-notify.env
[ -r "$config" ] || { echo "Telegram notification config is unavailable" >&2; exit 1; }
# shellcheck disable=SC1090
source "$config"
title="${1:?notification title is required}"
message="${2:?notification text is required}"
/usr/bin/curl --fail --silent --show-error --max-time 15 \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${title}

${message}" \
  --data-urlencode "disable_web_page_preview=true" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null
