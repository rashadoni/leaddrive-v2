#!/usr/bin/env bash
# Защита от повторной публикации данных клиентов — по СОДЕРЖИМОМУ дерева, а не
# по происхождению истории.
#
# Прежняя защита (~/.claude/CLAUDE.md, раздел про перезапись 2026-09-11)
# сравнивала ветку со старым корнем: `git merge-base --is-ancestor 87ba5ae0
# HEAD` должна была падать, иначе не пушить. Она отвечала на вопрос «откуда
# ветка растёт», а опубликует данные то, «что в ветке лежит», — и эти вопросы
# разошлись. 2026-11-01 в главном чекауте нашлась локальная ветка
# `feat/chat-voice-parity` со СВОИМ корнем `7f9a57e8`: ни старым, ни новым,
# поэтому проверку по предку она проходила — имея в дереве 74 отслеживаемых
# файла из `migration_data/`, `scripts/v1-data/` и `cost_model_migration_data/`.
# Один `git push` с неё опубликовал бы их в публичном репозитории.
#
# Поэтому здесь про корни не спрашивают вовсе. Смотрят деревья:
#   - дерево каждого названного коммита (`git ls-tree -r`) — это то, что
#     доедет до `main`;
#   - дерево КАЖДОГО коммита диапазона — файл, добавленный одним коммитом и
#     убранный следующим, в дифе к базе не виден и в дереве вершины его нет, но
#     в истории он остаётся и уезжает на GitHub вместе с пушем.
#
# Список путей один на всех — scripts/ci/forbidden-data-paths.txt; его же
# читает scripts/git-hooks/pre-push.
#
# Usage:
#   check-forbidden-data-paths.sh [<коммит> ...] [--history <аргументы rev-list> ...]
#   check-forbidden-data-paths.sh --list
#
# Примеры:
#   check-forbidden-data-paths.sh HEAD --history "$BASE_SHA..$HEAD_SHA"
#   check-forbidden-data-paths.sh "$local_sha" --history "$local_sha" --not --remotes=origin
#
# Без аргументов проверяется дерево HEAD. Код выхода 1 — найдены запрещённые
# пути; 2 — проверку выполнить не удалось (нет списка, не репозиторий, плохой
# коммит). Fail closed: «не смог проверить» никогда не выдаётся за «чисто».
set -uo pipefail

self_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
list_file="${FORBIDDEN_DATA_PATHS_FILE:-$self_dir/forbidden-data-paths.txt}"

die() { printf '%s\n' "check-forbidden-data-paths: $*" >&2; exit 2; }

[ -f "$list_file" ] || die "нет списка путей $list_file"

toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || die "это не git-репозиторий"
cd "$toplevel" || die "не удалось перейти в $toplevel"

# Пути читаем как есть, чтобы pathspec не зависел от того, откуда запущен
# скрипт: cd выше уже поставил нас в корень репозитория.
paths=()
while IFS= read -r line; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  paths+=("$line")
done < <(sed -e 's/[[:space:]]*$//' "$list_file")

[ "${#paths[@]}" -gt 0 ] || die "список путей $list_file пуст"

revs=()
history_args=()
mode=revs
for arg in "$@"; do
  case "$mode:$arg" in
    revs:--list)
      printf '%s\n' "${paths[@]}"
      exit 0
      ;;
    revs:--history)
      mode=history
      ;;
    revs:-h|revs:--help)
      sed -n '/^# Usage:/,/^# коммит/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    revs:*)
      revs+=("$arg")
      ;;
    history:*)
      history_args+=("$arg")
      ;;
  esac
done

[ "${#revs[@]}" -gt 0 ] || [ "${#history_args[@]}" -gt 0 ] || revs=(HEAD)

# Одно место, где решается «есть или нет»: дерево коммита, отфильтрованное
# запрещёнными pathspec'ами. Пустой вывод — чисто.
tree_hits() {
  git ls-tree -r --name-only "$1" -- "${paths[@]}"
}

report() {
  local what="$1" hits="$2" shown
  printf '\n❌ %s — файлы по запрещённым путям:\n' "$what" >&2
  shown=$(printf '%s\n' "$hits" | head -20)
  printf '%s\n' "$shown" | sed 's/^/   /' >&2
  local total
  total=$(printf '%s\n' "$hits" | grep -c '')
  if [ "$total" -gt 20 ]; then
    printf '   … и ещё %s файл(ов)\n' "$((total - 20))" >&2
  fi
}

status=0

for rev in "${revs[@]}"; do
  hits=$(tree_hits "$rev") || die "не удалось прочитать дерево $rev"
  if [ -n "$hits" ]; then
    report "В дереве $rev" "$hits"
    status=1
  fi
done

if [ "${#history_args[@]}" -gt 0 ]; then
  commits=$(git rev-list "${history_args[@]}") || die "не удалось перечислить коммиты: ${history_args[*]}"
  # Останавливаемся на первом найденном коммите: сообщение от второго такое же,
  # а длинная ветка иначе проверялась бы целиком ради того же ответа.
  while IFS= read -r commit; do
    [ -n "$commit" ] || continue
    hits=$(tree_hits "$commit") || die "не удалось прочитать дерево $commit"
    if [ -n "$hits" ]; then
      report "В дереве коммита $commit (он уедет на GitHub вместе с пушем, даже если в вершине ветки файлов уже нет)" "$hits"
      status=1
      break
    fi
  done <<< "$commits"
fi

if [ "$status" -ne 0 ]; then
  cat >&2 <<'MSG'

Это персональные данные клиентов. Их вычистили из истории 2026-09-11, а
репозиторий публичный: такой пуш или мерж вернёт их на GitHub навсегда.

Что делать: не пушить эту ветку. Свою работу перенести на ветку от свежего
origin/main — `git cherry-pick` своих коммитов или
`git rebase --onto origin/main <старая база> <ветка>`. Мерж старой ветки в
новую не годится: он тянет за собой всю старую историю.

Список путей: scripts/ci/forbidden-data-paths.txt
MSG
  exit 1
fi

printf 'check-forbidden-data-paths: чисто (%s путей, %s коммит(ов) вершин%s)\n' \
  "${#paths[@]}" "${#revs[@]}" \
  "$([ "${#history_args[@]}" -gt 0 ] && printf ' + история %s' "${history_args[*]}")"
