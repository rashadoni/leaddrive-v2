#!/usr/bin/env bash
# Provider-neutral static/test gate ported from .github/workflows/pr-checks.yml.
set -Eeuo pipefail

REPORT_DIR="${LEADDRIVE_CI_REPORT_DIR:-${RUNNER_TEMP:-${AGENT_TEMPDIRECTORY:-/tmp}}}"
mkdir -p "$REPORT_DIR"
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-4}"

install_deps() {
  if [ "${LEADDRIVE_DEPS_READY:-0}" = "1" ]; then
    test -d node_modules/.prisma/client
  elif [ "${LEADDRIVE_USE_WARM_INSTALL:-1}" = "1" ] && [ -f scripts/ci/self-hosted-warm-install.sh ]; then
    RUNNER_ENVIRONMENT=self-hosted bash scripts/ci/self-hosted-warm-install.sh deps
    RUNNER_ENVIRONMENT=self-hosted bash scripts/ci/self-hosted-warm-install.sh prisma prisma/schema.prisma node_modules/.prisma/client
  else
    npm ci --include=dev
    npx prisma generate
  fi
}

container_id=""
if [ -n "${EVENT_PLATFORM_TEST_DATABASE_URL:-}" ]; then
  admin_url="$EVENT_PLATFORM_TEST_DATABASE_URL"
else
  command -v docker >/dev/null 2>&1 || { echo "static checks: docker is required when EVENT_PLATFORM_TEST_DATABASE_URL is not supplied" >&2; exit 1; }
  name="leaddrive-static-${BUILD_BUILDID:-manual}-$$"
  container_id="$(docker run -d --name "$name" \
    -e POSTGRES_DB=event_platform_test \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -p 127.0.0.1::5432 \
    postgres:16)"
  cleanup() {
    if [ -n "$container_id" ]; then docker rm -f "$container_id" >/dev/null 2>&1 || true; fi
  }
  trap cleanup EXIT
  for _ in $(seq 1 60); do
    if docker exec "$container_id" pg_isready -U postgres -d event_platform_test >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$container_id" pg_isready -U postgres -d event_platform_test >/dev/null
  port="$(docker port "$container_id" 5432/tcp | sed -E 's/^.*:([0-9]+)$/\1/' | tail -1)"
  [ -n "$port" ] || { echo "static checks: could not resolve random Postgres host port" >&2; exit 1; }
  admin_url="postgresql://postgres:postgres@127.0.0.1:${port}/event_platform_test"
fi
printf '%s\n' "${admin_url/postgres:postgres@/postgres:***@}" > "$REPORT_DIR/event-platform-db-url.redacted.txt"

install_deps
if [ "${LEADDRIVE_USE_WARM_INSTALL:-1}" = "1" ] && [ -f scripts/ci/self-hosted-warm-install.sh ]; then
  RUNNER_ENVIRONMENT=self-hosted bash scripts/ci/self-hosted-warm-install.sh prisma scripts/ci/fixtures/event-platform-legacy-client/schema.prisma node_modules/.event-platform-legacy-client
else
  npx prisma generate --schema scripts/ci/fixtures/event-platform-legacy-client/schema.prisma
fi

node scripts/ci/test-event-platform-assets.mjs
EVENT_PLATFORM_TEST_DATABASE_URL="$admin_url" node scripts/ci/test-event-platform-migrations.mjs
EVENT_PLATFORM_TEST_DATABASE_URL="$admin_url" npx vitest run src/__tests__/lib-event-platform-postgres.test.ts
LEGACY_PRISMA_CLIENT_MODULE="$PWD/node_modules/.event-platform-legacy-client" \
LEGACY_RUNTIME_DATABASE_URL="postgresql://event_app:event-app-password@${admin_url#*@}" \
LEGACY_VERIFY_DATABASE_URL="$admin_url" \
node scripts/event-platform-legacy-client-probe.mjs
npm run lint:pii-columns
node scripts/check-test-baseline.mjs
