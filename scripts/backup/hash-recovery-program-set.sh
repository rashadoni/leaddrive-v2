#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_INPUT="${1:-}"
[ "$#" -eq 1 ] && [ -n "$ROOT_INPUT" ] || {
  printf 'usage: %s ROOT\n' "$0" >&2
  exit 2
}

ROOT="$(realpath -e -- "$ROOT_INPUT")" || {
  printf 'recovery program root is not resolvable\n' >&2
  exit 1
}
MANIFEST="$ROOT/ops/backup/recovery-program-set.files"
[ -f "$MANIFEST" ] && [ ! -L "$MANIFEST" ] || {
  printf 'recovery program manifest is missing or symlinked\n' >&2
  exit 1
}

awk '
  !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/ || /^\// || /(^|\/)\.\.?(\/|$)/ { bad=1 }
  seen[$0]++ { bad=1 }
  { if (previous != "" && previous >= $0) bad=1; previous=$0 }
  END { if (NR < 1 || bad) exit 1 }
' "$MANIFEST" || {
  printf 'recovery program manifest must be non-empty, safe, sorted and unique\n' >&2
  exit 1
}

(
  cd "$ROOT"
  {
    sha256sum -- ops/backup/recovery-program-set.files
    while IFS= read -r relative_path || [ -n "$relative_path" ]; do
      [ -f "$relative_path" ] && [ ! -L "$relative_path" ] || {
        printf 'recovery program member is missing or symlinked: %s\n' "$relative_path" >&2
        exit 1
      }
      sha256sum -- "$relative_path"
    done < ops/backup/recovery-program-set.files
  } | LC_ALL=C sort | sha256sum | awk '{print $1}'
)
