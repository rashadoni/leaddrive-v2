#!/usr/bin/env bash
# Ставит и гоняет ночную копию файлов клиентов, НЕ заходя на прод руками.
#
# Запускается на dev-боксе — ключ от прода лежит здесь, а не на Маке; с Мака
# одной строкой: `ssh remote-dev /home/rashad/bin/leaddrive-uploads-offsite …`
# (копия лежит там же; обновить её из репозитория — `install -m 0755
# scripts/ops/uploads-offsite-remote.sh ~/bin/leaddrive-uploads-offsite`).
#
#   --show-key   напечатать публичный age-ключ владельца, которым прод шифрует
#                ночные дампы (ничего не меняет)
#   --plan       сколько файлов и байтов в uploads (ничего не отправляет)
#   --install    поставить ночную копию файлов клиентов этим ключом
#   --run-now    прогнать копию сейчас, не дожидаясь ночи (прогон ограничен)
#   --check      что установлено и когда был последний прогон
#
# Перед каждым обращением печатает, что именно уйдёт на прод.
set -Eeuo pipefail

KEY="${LEADDRIVE_PROD_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
HOST="${LEADDRIVE_PROD_HOST:-root@13.140.132.245}"
OPS=/usr/local/lib/leaddrive-v2/ops/current/backup

on_prod() {
  printf '→ на проде: %s\n' "$1" >&2
  ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ControlMaster=no \
    -o ControlPath=none -o ConnectTimeout=15 "$HOST" "$1"
}

# Ключ владельца — тот, которым шифрует НОЧНОЙ СКРИПТ БЭКАПА ХОСТА: его
# закрытая часть есть только на Маке. Получатель `BACKUP_AGE_RECIPIENT` из
# /etc/leaddrive/backup.env — другой: его закрытый ключ лежит на dev-боксе,
# рядом с копиями бэкапов, и шифровать им копию файлов клиентов бессмысленно
# (CLAUDE.md, «Прод и деплой»). Поэтому берём только из скрипта бэкапа.
OWNER_KEY_SOURCE=/usr/local/sbin/leaddrive-backup.sh

find_recipient() {
  on_prod "grep -hoE 'age1[0-9a-z]{58}' $OWNER_KEY_SOURCE 2>/dev/null | sort -u"
}

show_keys() {
  on_prod "for f in $OWNER_KEY_SOURCE /etc/leaddrive/*.env; do [ -f \"\$f\" ] || continue; grep -hoE 'age1[0-9a-z]{58}' \"\$f\" 2>/dev/null | sort -u | sed \"s|^|\$f: |\"; done"
}

case "${1:---check}" in
  --show-key)
    # Все ключи с источниками, чтобы было видно, какой чей.
    show_keys
    ;;
  --plan)
    on_prod "$OPS/uploads-offsite-mirror.sh --plan"
    ;;
  --check)
    on_prod "bash $OPS/uploads-offsite-install.sh --check"
    ;;
  --run-now)
    # Таймер включается при установке, но первый прогон по расписанию —
    # в 05:20 UTC. Это запускает его сейчас; прогон ограничен по байтам и
    # времени, поэтому его можно повторять, пока очередь не кончится.
    on_prod "systemctl start leaddrive-uploads-offsite.service && journalctl -u leaddrive-uploads-offsite -n 15 --no-pager -o cat"
    ;;
  --install)
    keys="$(find_recipient)"
    count="$(printf '%s\n' "$keys" | grep -c . || true)"
    if [ "$count" != 1 ]; then
      printf 'Не могу выбрать ключ сам: в %s найдено %s штук(и).\n%s\n' "$OWNER_KEY_SOURCE" "$count" "$keys" >&2
      printf 'Запусти с нужным: leaddrive-uploads-offsite --install age1…\n' >&2
      exit 1
    fi
    [ -z "${2:-}" ] || keys="$2"
    printf 'Ключ владельца из %s: %s\n' "$OWNER_KEY_SOURCE" "$keys"
    on_prod "bash $OPS/uploads-offsite-install.sh --recipient $keys"
    on_prod "bash $OPS/uploads-offsite-install.sh --check"
    ;;
  *)
    printf 'Использование: leaddrive-uploads-offsite --show-key | --plan | --install | --run-now | --check\n' >&2
    exit 2
    ;;
esac
