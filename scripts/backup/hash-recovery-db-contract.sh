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

# Reviewed production ledger deviations (prisma/migration-ledger-exceptions.tsv).
# They become part of the contract, so its digest binds every receipt to them.
EXCEPTIONS="$ROOT/prisma/migration-ledger-exceptions.tsv"
[ ! -L "$EXCEPTIONS" ] || {
  printf 'migration ledger exceptions file is symlinked\n' >&2
  exit 1
}

emit_manifest() {
  local relative_path migration_name digest
  local -A migration_digest=()
  digest="$(sha256sum "$SCHEMA" | awk '{print $1}')"
  printf 'SCHEMA\tprisma/schema.prisma\t%s\n' "$digest"
  digest="$(sha256sum "$LOCK_FILE" | awk '{print $1}')"
  printf 'MIGRATION_LOCK\tprisma/migrations/migration_lock.toml\t%s\n' "$digest"
  for relative_path in "${MIGRATIONS[@]}"; do
    migration_name="${relative_path#prisma/migrations/}"
    migration_name="${migration_name%/migration.sql}"
    digest="$(sha256sum "$ROOT/$relative_path" | awk '{print $1}')"
    migration_digest["$migration_name"]="$digest"
    printf 'MIGRATION\t%s\t%s\n' "$migration_name" "$digest"
  done
  [ -e "$EXCEPTIONS" ] || return 0
  [ -f "$EXCEPTIONS" ] || {
    printf 'migration ledger exceptions path is not a regular file\n' >&2
    return 1
  }
  local line name checksum kind reason extra previous=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    IFS=$'\t' read -r name checksum kind reason extra <<<"$line"
    [[ "$name" =~ ^[0-9]{8,14}_[A-Za-z0-9_]+$ ]] \
      && [[ "$checksum" =~ ^([0-9a-f]{64}|manual-[0-9]{8,14})$ ]] \
      && [ -n "$reason" ] && [ -z "${extra:-}" ] \
      && { [ -z "$previous" ] || [[ "$previous" < "$name" ]]; } || {
      printf 'malformed, duplicate or unsorted migration ledger exception: %s\n' "$name" >&2
      return 1
    }
    case "$kind" in
      applied-not-in-code)
        [ -z "${migration_digest[$name]:-}" ] || {
          printf 'ledger exception %s claims a migration the repository has\n' "$name" >&2
          return 1
        }
        ;;
      checksum-differs)
        [ -n "${migration_digest[$name]:-}" ] && [ "${migration_digest[$name]}" != "$checksum" ] || {
          printf 'ledger exception %s does not differ from a repository migration\n' "$name" >&2
          return 1
        }
        ;;
      *)
        printf 'unknown migration ledger exception kind for %s\n' "$name" >&2
        return 1
        ;;
    esac
    printf 'LEDGER_EXCEPTION\t%s\t%s\t%s\n' "$name" "$checksum" "$kind"
    previous="$name"
  done <"$EXCEPTIONS"
}

MANIFEST="$(emit_manifest)" || exit 1
case "$MODE" in
  manifest) printf '%s\n' "$MANIFEST" ;;
  digest) printf '%s\n' "$MANIFEST" | sha256sum | awk '{print $1}' ;;
esac
