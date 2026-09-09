#!/usr/bin/env bash
# Warm install for the self-hosted runners.
#
# A self-hosted runner keeps its workspace between jobs, so node_modules and
# the generated Prisma clients only have to be rebuilt when their inputs
# change. actions/cache did the same job through the GitHub cache service and
# paid for it every run: measured 2026-09-08 on leaddrive-ci-1, restoring
# node_modules took 106 s and `prisma generate` (545 models) 198 s of a
# 12.6-minute typecheck, for an identical lockfile and schema. The workspace
# survives because actions/checkout runs with `clean: false` and the job
# removes everything else itself (see pr-checks.yml).
#
# Usage:
#   self-hosted-warm-install.sh deps
#   self-hosted-warm-install.sh prisma <schema> <generated-client-dir>
#
# Each target keeps a marker holding the SHA-256 of its inputs inside the
# directory it describes, so a fresh checkout, a wiped node_modules or an
# `npm ci` for a new lockfile always regenerates. Nothing here runs on a
# GitHub-hosted runner: those start empty, and the production build must keep
# installing from the lockfile (deploy.yml restores its own bounded caches).
set -euo pipefail

[ "${RUNNER_ENVIRONMENT:-}" = "self-hosted" ] || {
  echo "::error::self-hosted-warm-install.sh is only for the self-hosted runners (RUNNER_ENVIRONMENT=${RUNNER_ENVIRONMENT:-unset})"
  exit 1
}
[ -f package-lock.json ] || { echo "::error::run from the repository root"; exit 1; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | cut -c1-64
  else
    shasum -a 256 -- "$1" | cut -c1-64
  fi
}
LOCK_SHA="$(sha package-lock.json)"
[ -f package.json ] || { echo "::error::package.json is required"; exit 1; }
PACKAGE_SHA="$(sha package.json)"
NPMRC_SHA=absent
[ ! -f .npmrc ] || NPMRC_SHA="$(sha .npmrc)"
NODE_ID="$(node -p 'process.version + "/" + process.platform + "/" + process.arch')"
NPM_VERSION="$(npm --version)"
# Include effective npm environment overrides without logging their values.
# Registry credentials, when present, are hashed locally and never printed.
NPM_ENV_SHA="$(node -e 'const c=require("node:crypto"); const e=Object.entries(process.env).filter(([k])=>/^npm_config_/i.test(k)||k==="NODE_ENV").sort(([a],[b])=>a.localeCompare(b)); process.stdout.write(c.createHash("sha256").update(JSON.stringify(e)).digest("hex"))')"
DEPS_KEY="v2 lock=$LOCK_SHA package=$PACKAGE_SHA npmrc=$NPMRC_SHA runtime=$NODE_ID npm=$NPM_VERSION config=$NPM_ENV_SHA"

case "${1:-}" in
  deps)
    MARK=node_modules/.leaddrive-warm-install
    WANT="$DEPS_KEY"
    if [ -d node_modules ] && [ "$(cat "$MARK" 2>/dev/null || true)" = "$WANT" ]; then
      echo "node_modules inputs unchanged — npm ci skipped"
    else
      echo "node_modules is missing or stale — running npm ci"
      rm -f "$MARK"
      npm ci --include=dev
      printf '%s\n' "$WANT" > "$MARK"
    fi
    ;;
  prisma)
    SCHEMA="${2:?schema path}"
    OUT="${3:?generated client directory}"
    [ -f "$SCHEMA" ] || { echo "::error::schema $SCHEMA not found"; exit 1; }
    PRISMA_VERSION="$(node -p "require('prisma/package.json').version")"
    MARK="$OUT/.leaddrive-warm-generate"
    WANT="schema=$SCHEMA:$(sha "$SCHEMA") prisma=$PRISMA_VERSION deps=$DEPS_KEY"
    if [ -d "$OUT" ] && [ "$(cat "$MARK" 2>/dev/null || true)" = "$WANT" ]; then
      echo "$OUT already generated from $SCHEMA with prisma $PRISMA_VERSION — prisma generate skipped"
    else
      echo "$OUT is missing or stale — running prisma generate --schema $SCHEMA"
      rm -f "$MARK"
      npx prisma generate --schema "$SCHEMA"
      [ -d "$OUT" ] || { echo "::error::prisma generate did not produce $OUT"; exit 1; }
      printf '%s\n' "$WANT" > "$MARK"
    fi
    ;;
  *)
    echo "usage: $0 deps | prisma <schema> <generated-client-dir>" >&2
    exit 64
    ;;
esac
