#!/usr/bin/env bash
# Ставит хуки репозитория в этот клон: копия в <git-dir>/hooks-leaddrive,
# core.hooksPath на неё.
#
# Почему копия, а не core.hooksPath = scripts/git-hooks: относительный путь
# разрешается от корня рабочего дерева, то есть хук пропадает в любом чекауте,
# чья ветка старше самого хука. Главный чекаут стоит ровно на такой ветке
# (`feat/chat-voice-parity`) — и это тот самый чекаут, из которого пуш
# опубликовал бы данные клиентов. Копия по абсолютному пути работает в каждом
# воркитри и на любой ветке; сама проверка при этом берётся из рабочего дерева,
# а если её там нет — из origin/main.
#
# Отдельный каталог, а не .git/hooks — намеренно: в .git/hooks лежит дремлющий
# pre-commit (gitleaks, fail closed), который сейчас не работает, потому что
# core.hooksPath уводит хуки в сторону. Включать его заодно — не дело этого
# скрипта: без установленного gitleaks он заблокировал бы каждый коммит.
#
# Usage:
#   bash scripts/git-hooks/install.sh             # поставить или обновить
#   bash scripts/git-hooks/install.sh --check     # только сказать, стоит ли
#   bash scripts/git-hooks/install.sh --force     # заменить чужой core.hooksPath
#   bash scripts/git-hooks/install.sh --uninstall
set -uo pipefail

HOOKS=(pre-push)

toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'install.sh: это не git-репозиторий\n' >&2
  exit 2
}
cd "$toplevel" || exit 2
common_dir=$(git rev-parse --path-format=absolute --git-common-dir) || exit 2
target="$common_dir/hooks-leaddrive"
source_dir="$toplevel/scripts/git-hooks"

mode=install
for arg in "$@"; do
  case "$arg" in
    --force) mode=force ;;
    --check) mode=check ;;
    --uninstall) mode=uninstall ;;
    *) printf 'install.sh: неизвестный аргумент %s\n' "$arg" >&2; exit 2 ;;
  esac
done

current=$(git config --get core.hooksPath || true)

if [ "$mode" = uninstall ]; then
  if [ "$current" = "$target" ]; then
    git config --unset core.hooksPath
    rm -rf "$target"
    printf 'Хуки репозитория сняты (core.hooksPath и %s).\n' "$target"
  else
    printf 'core.hooksPath = %s — не наш, ничего не меняю.\n' "${current:-(не задан)}"
  fi
  exit 0
fi

stale=0
for hook in "${HOOKS[@]}"; do
  cmp -s "$source_dir/$hook" "$target/$hook" || stale=1
done

if [ "$mode" = check ]; then
  if [ "$current" = "$target" ] && [ "$stale" -eq 0 ]; then
    printf 'Хуки стоят и совпадают с репозиторием: core.hooksPath = %s\n' "$current"
    exit 0
  fi
  if [ "$current" = "$target" ]; then
    printf 'Хуки стоят, но копия устарела — обновить: bash scripts/git-hooks/install.sh\n' >&2
  else
    printf 'Хуки НЕ стоят: core.hooksPath = %s (нужно %s)\n' "${current:-(не задан)}" "$target" >&2
    printf 'Поставить: bash scripts/git-hooks/install.sh%s\n' "$([ -n "$current" ] && printf ' --force')" >&2
  fi
  exit 1
fi

# Чужой core.hooksPath не затираем молча: вместе с ним перестанут работать
# хуки, которые там лежат. Называем их, чтобы ничего не пропало незаметно.
if [ -n "$current" ] && [ "$current" != "$target" ] && [ "$mode" != force ]; then
  printf 'core.hooksPath уже задан: %s\n' "$current" >&2
  if [ -d "$current" ]; then
    printf 'Там сейчас лежат хуки, и они перестанут работать:\n' >&2
    find "$current" -maxdepth 1 -type f ! -name '*.sample' -printf '   %f\n' 2>/dev/null >&2
  else
    printf 'Этого каталога нет — значит, хуки в этом репозитории сейчас НЕ работают вовсе.\n' >&2
  fi
  printf 'Заменить осознанно: bash scripts/git-hooks/install.sh --force\n' >&2
  exit 1
fi

mkdir -p "$target" || exit 2
for hook in "${HOOKS[@]}"; do
  cp "$source_dir/$hook" "$target/$hook" || exit 2
  chmod +x "$target/$hook" || exit 2
done
git config core.hooksPath "$target" || exit 2

printf 'core.hooksPath = %s\n' "$(git config --get core.hooksPath)"
printf 'Хуки: %s\n' "${HOOKS[*]}"
if [ -n "$current" ] && [ "$current" != "$target" ]; then
  printf 'Заменён прежний core.hooksPath: %s\n' "$current"
fi
printf 'Проверить: bash scripts/git-hooks/install.sh --check\n'
printf 'Снять: bash scripts/git-hooks/install.sh --uninstall\n'
