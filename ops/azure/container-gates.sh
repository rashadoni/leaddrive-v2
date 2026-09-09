#!/usr/bin/env bash
set -Eeuo pipefail
mode="${1:?}"
mkdir -p /workspace/source
cp -a /source-ro/. /workspace/source/
cd /workspace/source
export LEADDRIVE_CI_REPORT_DIR=/reports
export RUNNER_TEMP=/tmp AGENT_TEMPDIRECTORY=/tmp
export VITEST_MAX_WORKERS=4
export NEXTAUTH_SECRET=leaddrive-ci-build-only-not-a-runtime-secret-8b7d4e7fb4da99da31d73e3c3e0c02a8
export NEXTAUTH_URL=https://build.invalid
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/event_platform_test
export EVENT_PLATFORM_TEST_DATABASE_URL="$DATABASE_URL"
export BUILD_SOURCEVERSION="${DEPLOY_TARGET_SHA:?}"
test "$(git rev-parse HEAD)" = "$DEPLOY_TARGET_SHA"
timeout --kill-after=15s 900s npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=60000
npx prisma generate
export LEADDRIVE_DEPS_READY=1 LEADDRIVE_TYPECHECK_HEAP_MIB=12288
bash /controller/static-checks.sh
bash /controller/typecheck.sh
if [ "${LD_SOCIAL:-false}" = true ]; then
  timeout --kill-after=30s 2400s bash /controller/social-gate.sh
fi
if [ "$mode" = build ]; then
  bash /controller/release-security-gates.sh
  : "${NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY:?Production map public key must be configured}"
  printf 'export const DEPLOY_SHA = "%s"\nexport const BUILT_AT = "%s"\n' "$DEPLOY_TARGET_SHA" "$(date -u +%FT%TZ)" > src/generated/build-sha.ts
  NODE_OPTIONS=--max-old-space-size=12288 NEXT_BUILD_CPUS=1 NEXT_WEBPACK_PARALLELISM=1 LEADDRIVE_COLD_PRODUCTION_BUILD=1 timeout --kill-after=30s 1800s npx next build --webpack
  test -f .next/standalone/server.js
  test -f public/sw.js
  bash /controller/assemble-release.sh
  mv "/tmp/leaddrive-prod-${DEPLOY_TARGET_SHA}.tar.gz" /reports/
  cp scripts/server-deploy.sh /reports/server-deploy.sh
  cd /reports
  sha256sum "leaddrive-prod-${DEPLOY_TARGET_SHA}.tar.gz" server-deploy.sh > SHA256SUMS
fi
