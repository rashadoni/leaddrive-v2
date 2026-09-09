#!/usr/bin/env bash
set -Eeuo pipefail

MODE="digest"
if [ "${1:-}" = "--manifest" ]; then
  MODE="manifest"
  shift
fi
ROOT_INPUT="${1:-}"
[ "$#" -eq 1 ] && [ -n "$ROOT_INPUT" ] || {
  printf 'usage: %s [--manifest] ROOT\n' "$0" >&2
  exit 2
}

ROOT="$(realpath -e -- "$ROOT_INPUT")" || {
  printf 'recovery DB contract root is not resolvable\n' >&2
  exit 1
}
SCHEMA="$ROOT/prisma/schema.prisma"
LOCK_FILE="$ROOT/prisma/migrations/migration_lock.toml"
[ -f "$SCHEMA" ] && [ ! -L "$SCHEMA" ] \
  && [ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] || {
  printf 'Prisma schema or migration lock is missing or symlinked\n' >&2
  exit 1
}
[ -d "$ROOT/prisma/migrations" ] && [ ! -L "$ROOT/prisma/migrations" ] || {
  printf 'Prisma migrations root is missing or symlinked\n' >&2
  exit 1
}

mapfile -t MIGRATIONS < <(
  cd "$ROOT"
  find prisma/migrations -mindepth 2 -maxdepth 2 -type f -name migration.sql \
    -printf '%p\n' | LC_ALL=C sort
)
[ "${#MIGRATIONS[@]}" -gt 0 ] || {
  printf 'recovery DB contract has no migrations\n' >&2
  exit 1
}
for relative_path in "${MIGRATIONS[@]}"; do
  [[ "$relative_path" =~ ^prisma/migrations/[0-9]{8,14}_[A-Za-z0-9_]+/migration\.sql$ ]] \
    && [ -f "$ROOT/$relative_path" ] && [ ! -L "$ROOT/$relative_path" ] || {
    printf 'unsafe or symlinked Prisma migration path: %s\n' "$relative_path" >&2
    exit 1
  }
done

unexpected="$(
  find "$ROOT/prisma/migrations" -mindepth 1 \
    \( -type l -o -type f ! -name migration.sql ! -name migration_lock.toml \
       -o -mindepth 2 -maxdepth 2 -type f ! -name migration.sql \
       -o -mindepth 3 \) -print -quit
)"
[ -z "$unexpected" ] || {
  printf 'recovery DB contract contains an unexpected path\n' >&2
  exit 1
}

emit_manifest() {
  local relative_path migration_name digest
  digest="$(sha256sum "$SCHEMA" | awk '{print $1}')"
  printf 'SCHEMA\tprisma/schema.prisma\t%s\n' "$digest"
  digest="$(sha256sum "$LOCK_FILE" | awk '{print $1}')"
  printf 'MIGRATION_LOCK\tprisma/migrations/migration_lock.toml\t%s\n' "$digest"
  for relative_path in "${MIGRATIONS[@]}"; do
    migration_name="${relative_path#prisma/migrations/}"
    migration_name="${migration_name%/migration.sql}"
    digest="$(sha256sum "$ROOT/$relative_path" | awk '{print $1}')"
    printf 'MIGRATION\t%s\t%s\n' "$migration_name" "$digest"
  done
}

case "$MODE" in
  manifest) emit_manifest ;;
  digest) emit_manifest | sha256sum | awk '{print $1}' ;;
esac
