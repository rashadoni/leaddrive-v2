#!/usr/bin/env bash
# Ставит хуки репозитория в этот клон — копией по абсолютному пути.
#
# Почему копия, а не core.hooksPath = scripts/git-hooks: относительный путь
# разрешается от корня рабочего дерева, то есть хук пропадает в любом чекауте,
# чья ветка старше самого хука. Главный чекаут стоит ровно на такой ветке
# (`feat/chat-voice-parity`) — и это тот самый чекаут, из которого пуш
# опубликовал бы данные клиентов. Копия по абсолютному пути работает в каждом
# воркитри и на любой ветке; сама проверка при этом берётся из рабочего дерева,
# а если её там нет — из origin/main.
#
# **Куда ставим — туда, куда git уже смотрит, если этот каталог существует.**
# На Маке владельца `core.hooksPath` указывает на `.git/hooks`, где лежит
# РАБОТАЮЩИЙ gitleaks-pre-commit; увести оттуда hooksPath значит молча его
# выключить. Поэтому свой каталог (`<git-dir>/hooks-leaddrive`) заводится
# только когда идти некуда: настроенного каталога нет на диске — ровно случай
# dev-бокса, где `core.hooksPath` показывает на путь с Мака и не работает
# ни один хук. Тогда и только тогда нужен `--force`.
#
# Чужие хуки мы не переносим и не включаем: дремлющий в `.git/hooks` pre-commit
# на боксе без установленного gitleaks заблокировал бы каждый коммит, а это не
# дело этого скрипта.
#
# Usage:
#   bash scripts/git-hooks/install.sh             # поставить или обновить
#   bash scripts/git-hooks/install.sh --check     # только сказать, стоит ли
#   bash scripts/git-hooks/install.sh --force     # завести свой каталог вместо
#                                                 # настроенного, которого нет
#   bash scripts/git-hooks/install.sh --uninstall
set -uo pipefail

HOOKS=(pre-push)

toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'install.sh: это не git-репозиторий\n' >&2
  exit 2
}
cd "$toplevel" || exit 2
common_dir=$(git rev-parse --path-format=absolute --git-common-dir) || exit 2
own_dir="$common_dir/hooks-leaddrive"
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

# Относительный core.hooksPath git разрешает от корня рабочего дерева.
resolved="$current"
case "$current" in
  ''|/*) ;;
  *) resolved="$toplevel/$current" ;;
esac

# Куда git смотрит сейчас: настроенный каталог, иначе каталог хуков по
# умолчанию. Ставим туда, если он есть на диске, — тогда ничего чужого не
# выключаем и config не трогаем вовсе.
if [ -n "$current" ]; then
  git_looks_at="$resolved"
else
  git_looks_at="$common_dir/hooks"
fi

if [ -d "$git_looks_at" ]; then
  target="$git_looks_at"
  needs_config=0
else
  target="$own_dir"
  needs_config=1
fi

if [ "$mode" = uninstall ]; then
  removed=0
  for hook in "${HOOKS[@]}"; do
    if cmp -s "$source_dir/$hook" "$target/$hook"; then
      rm -f "$target/$hook" && removed=1
    fi
  done
  # Снимаем только СВОЮ настройку: чужой core.hooksPath не наш, чтобы его трогать.
  if [ "$resolved" = "$own_dir" ]; then
    git config --unset core.hooksPath
    rm -rf "$own_dir"
    printf 'Хуки репозитория сняты (core.hooksPath и %s).\n' "$own_dir"
  elif [ "$removed" -eq 1 ]; then
    printf 'Снят %s из %s; core.hooksPath не трогал (он не наш).\n' "${HOOKS[*]}" "$target"
  else
    printf 'Наших хуков в %s нет — ничего не меняю.\n' "$target"
  fi
  exit 0
fi

stale=0
for hook in "${HOOKS[@]}"; do
  cmp -s "$source_dir/$hook" "$target/$hook" || stale=1
done

if [ "$mode" = check ]; then
  if [ "$stale" -eq 0 ] && [ "$needs_config" -eq 0 ]; then
    printf 'Хуки стоят и совпадают с репозиторием: %s\n' "$target"
    exit 0
  fi
  if [ "$needs_config" -eq 1 ]; then
    if [ -n "$current" ]; then
      printf 'Хуки НЕ работают: core.hooksPath = %s, а этого каталога нет.\n' "$current" >&2
      printf 'Поставить: bash scripts/git-hooks/install.sh --force\n' >&2
    else
      printf 'Хуки НЕ стоят: каталога %s нет.\n' "$target" >&2
      printf 'Поставить: bash scripts/git-hooks/install.sh\n' >&2
    fi
  else
    printf 'Хуки стоят в %s, но копия устарела — обновить: bash scripts/git-hooks/install.sh\n' "$target" >&2
  fi
  exit 1
fi

# Свой каталог вместо настроенного заводим только осознанно: это правка
# core.hooksPath, пусть и указывающего в никуда.
if [ "$needs_config" -eq 1 ] && [ -n "$current" ] && [ "$resolved" != "$own_dir" ] && [ "$mode" != force ]; then
  printf 'core.hooksPath = %s, но этого каталога нет — значит, хуки в этом\n' "$current" >&2
  printf 'репозитории сейчас НЕ работают вовсе (ни один, включая чужие).\n' >&2
  printf 'Завести свой каталог и перенастроить: bash scripts/git-hooks/install.sh --force\n' >&2
  exit 1
fi

mkdir -p "$target" || exit 2
for hook in "${HOOKS[@]}"; do
  cp "$source_dir/$hook" "$target/$hook" || exit 2
  chmod +x "$target/$hook" || exit 2
done
if [ "$needs_config" -eq 1 ]; then
  git config core.hooksPath "$target" || exit 2
fi

printf 'Хуки: %s → %s\n' "${HOOKS[*]}" "$target"
if [ "$needs_config" -eq 1 ]; then
  printf 'core.hooksPath = %s' "$(git config --get core.hooksPath)"
  [ -n "$current" ] && printf ' (был %s, каталога нет)' "$current"
  printf '\n'
else
  printf 'core.hooksPath не трогал — git и так смотрит сюда, чужие хуки рядом целы.\n'
fi
printf 'Проверить: bash scripts/git-hooks/install.sh --check\n'
printf 'Снять: bash scripts/git-hooks/install.sh --uninstall\n'
