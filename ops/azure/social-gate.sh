#!/usr/bin/env bash
set -Eeuo pipefail
export ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/leaddrive_queue_e2e
export DATABASE_URL=postgresql://ld_queue_e2e:ld_queue_e2e@127.0.0.1:5432/leaddrive_queue_e2e
export APP_PORT=3000 NEXTAUTH_URL=http://127.0.0.1:3000 SOCIAL_QUEUE_E2E_BASE_URL=http://127.0.0.1:3000
export QUEUE_E2E_APP_LOG=/reports/social-queue-e2e-app.log
export QUEUE_E2E_BASE_SCHEMA=/tmp/social-queue-base-schema.prisma
export BASE_SHA="${LD_BASE_SHA:?}"
psql postgresql://postgres:postgres@127.0.0.1:5432/postgres -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE leaddrive_queue_e2e'


npm run i18n:check

npx vitest run \
  src/__tests__/ai-social-viral.test.ts \
  src/__tests__/lib-ai-classifiers-pii.test.ts \
  src/__tests__/api-social-analytics.test.ts \
  src/__tests__/api-social-coverage-alerts.test.ts \
  src/__tests__/api-social-mentions.test.ts \
  src/__tests__/api-social-monitoring-report-export.test.ts \
  src/__tests__/api-social-monitoring-cron.test.ts \
  src/__tests__/api-social-monitoring-run-jobs-cron.test.ts \
  src/__tests__/api-social-monitoring-run-jobs.test.ts \
  src/__tests__/api-social-monitoring-source-run.test.ts \
  src/__tests__/api-social-ingest-envelopes-review.test.ts \
  src/__tests__/lib-social-apify-async-adapter.test.ts \
  src/__tests__/lib-social-automatic-review-backfill.test.ts \
  src/__tests__/lib-social-automatic-review-triage.test.ts \
  src/__tests__/lib-social-ai-triage.test.ts \
  src/__tests__/lib-social-bright-data-adapter.test.ts \
  src/__tests__/lib-social-bright-data-client.test.ts \
  src/__tests__/lib-social-monitoring-collector.test.ts \
  src/__tests__/lib-social-monitoring-run-job-client.test.ts \
  src/__tests__/lib-social-monitoring-run-job.test.ts \
  src/__tests__/lib-social-monitoring-source-run.test.ts \
  src/__tests__/lib-social-ingest-envelope-replay.test.ts \
  src/__tests__/lib-social-ingest-mention.test.ts \
  src/__tests__/lib-social-incremental-monitoring-report.test.ts \
  src/__tests__/lib-social-media-dashboard-filters.test.ts \
  src/__tests__/lib-social-monitoring-profiles.test.ts \
  src/__tests__/lib-social-monitoring-rollups.test.ts \
  src/__tests__/lib-social-notification-inbox-adapter.test.ts \
  src/__tests__/lib-social-observation-retention.test.ts \
  src/__tests__/lib-social-official-collector.test.ts \
  src/__tests__/lib-social-paid-provider-run-scope.test.ts \
  src/__tests__/lib-social-paid-route-budget.test.ts \
  src/__tests__/lib-social-pollers-ingest.test.ts \
  src/__tests__/lib-social-provider-adapter.test.ts \
  src/__tests__/lib-social-provider-request-timeout.test.ts \
  src/__tests__/lib-social-review-queue-policy.test.ts \
  src/__tests__/lib-social-risk-mention-visibility.test.ts \
  src/__tests__/lib-social-search-index-adapter.test.ts \
  src/__tests__/lib-social-telegram-discussion-scanner.test.ts \
  src/__tests__/lib-social-tiktok-business-comments-adapter.test.ts \
  src/__tests__/lib-social-twitter-poller.test.ts \
  src/__tests__/lib-social-vk-comments-adapter.test.ts \
  src/__tests__/lib-social-visual-monitoring-report.test.ts \
  src/__tests__/lib-social-youtube-oauth-timeout.test.ts \
  src/__tests__/lib-social-youtube-provider-timeout.test.ts \
  src/__tests__/review-queue-sentiment.test.ts \
  src/__tests__/rls-bypass-classifier.test.ts \
  src/__tests__/social-monitoring-clean-slate-media-reset.test.ts \
  src/__tests__/social-monitoring-profile-card-grid-ui.test.ts \
  src/__tests__/social-monitoring-profile-provider-resume-ui.test.ts \
  src/__tests__/social-monitoring-run-job-cron-install.test.ts \
  src/__tests__/social-monitoring-server-queue-ui.test.ts


if [ -z "$BASE_SHA" ]; then
  BASE_SHA="origin/$DEFAULT_BRANCH"
fi
git show "$BASE_SHA:prisma/schema.prisma" > "$QUEUE_E2E_BASE_SCHEMA"
psql "$ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'
DATABASE_URL="$ADMIN_DATABASE_URL" \
  npx prisma db push --skip-generate --schema="$QUEUE_E2E_BASE_SCHEMA"

# The database above is the BASE schema on purpose — this job checks
# the candidate against the pre-merge shape. But the candidate's own
# migrations have to land too, or any new column breaks it: Prisma
# selects every scalar on a create(), so a column the client knows and
# the database does not is an immediate P2022. On production these
# migrations run before the app serves traffic (server-deploy.sh,
# migrate deploy, fail-fast), so base-schema-plus-new-migrations is
# the state the app actually starts in.
for dir in prisma/migrations/*/; do
  name="$(basename "$dir")"
  if ! git cat-file -e "$BASE_SHA:prisma/migrations/$name/migration.sql" 2>/dev/null; then
    echo "applying migration missing from base: $name"
    psql "$ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$dir/migration.sql"
  fi
done


if [ "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT to_regclass('public.social_monitoring_run_jobs') IS NULL")" = "t" ]; then
  psql "$ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -f prisma/migrations/20260801160000_social_monitoring_server_run_queue/migration.sql
else
  # On this PR the base has no queue tables, so the exact migration
  # above is exercised. Future queue PRs start from a base that
  # already has the models; db push cannot express RLS, so recreate
  # only the two policies in the fresh ephemeral database.
psql "$ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE "social_monitoring_run_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_job_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_job_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_jobs"
  ADD CONSTRAINT "social_monitoring_run_jobs_kind_check"
  CHECK ("kind" IN ('PROFILE_FULL', 'SOURCE_FULL', 'WEB_NEWS')),
  ADD CONSTRAINT "social_monitoring_run_jobs_scope_check"
  CHECK (
    ("kind" = 'PROFILE_FULL' AND "sourceScope" IS NULL)
    OR ("kind" IN ('SOURCE_FULL', 'WEB_NEWS') AND "sourceScope" IN ('OWNED', 'EXTERNAL'))
  ),
  ADD CONSTRAINT "social_monitoring_run_jobs_status_check"
  CHECK ("status" IN (
    'QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'CANCEL_REQUESTED',
    'CANCELED', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED'
  )),
  ADD CONSTRAINT "social_monitoring_run_jobs_counts_check"
  CHECK ("totalItems" > 0 AND "paidItems" >= 0 AND "sharedItems" >= 0 AND "failureCount" >= 0);
ALTER TABLE "social_monitoring_run_job_items"
  ADD CONSTRAINT "social_monitoring_run_job_items_status_check"
  CHECK ("status" IN (
    'QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'SUCCEEDED', 'PARTIAL',
    'SKIPPED', 'FAILED', 'TIMED_OUT'
  )),
  ADD CONSTRAINT "social_monitoring_run_job_items_position_check" CHECK ("position" > 0),
  ADD CONSTRAINT "social_monitoring_run_job_items_attempt_check" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "social_monitoring_run_job_items_counts_check" CHECK (
    "foundCount" >= 0 AND "newCount" >= 0 AND "duplicateCount" >= 0
    AND "acceptedCount" >= 0 AND "reviewCount" >= 0
    AND "rejectedCount" >= 0 AND "ignoredCount" >= 0
  );
CREATE UNIQUE INDEX "social_monitoring_run_jobs_one_active_org_key"
  ON "social_monitoring_run_jobs"("organizationId")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'CANCEL_REQUESTED');
CREATE POLICY "social_monitoring_run_jobs_tenant_isolation"
  ON "social_monitoring_run_jobs"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "social_monitoring_run_job_items_tenant_isolation"
  ON "social_monitoring_run_job_items"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
SQL
fi
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT COUNT(*) FROM pg_class WHERE relname IN ('social_monitoring_run_jobs', 'social_monitoring_run_job_items')")" = "2"
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT COUNT(*) FROM pg_policies WHERE policyname IN ('social_monitoring_run_jobs_tenant_isolation', 'social_monitoring_run_job_items_tenant_isolation')")" = "2"
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT COUNT(*) FROM pg_class WHERE relname IN ('social_monitoring_run_jobs', 'social_monitoring_run_job_items') AND relrowsecurity AND relforcerowsecurity")" = "2"
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT COUNT(*) FROM pg_constraint WHERE conname IN ('social_monitoring_run_jobs_kind_check', 'social_monitoring_run_jobs_scope_check', 'social_monitoring_run_jobs_status_check', 'social_monitoring_run_jobs_counts_check', 'social_monitoring_run_job_items_status_check', 'social_monitoring_run_job_items_position_check', 'social_monitoring_run_job_items_attempt_check', 'social_monitoring_run_job_items_counts_check')")" = "8"
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT to_regclass('public.social_monitoring_run_jobs_one_active_org_key') IS NOT NULL")" = "t"


psql "$ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE ld_queue_e2e
  LOGIN PASSWORD 'ld_queue_e2e'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE leaddrive_queue_e2e TO ld_queue_e2e;
GRANT USAGE ON SCHEMA public TO ld_queue_e2e;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ld_queue_e2e;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ld_queue_e2e;
SQL
test "$(psql "$ADMIN_DATABASE_URL" -X -Atc \
  "SELECT rolsuper::int || ':' || rolbypassrls::int FROM pg_roles WHERE rolname = 'ld_queue_e2e'")" = "0:0"


npx prisma generate

export NEXTAUTH_SECRET="$(openssl rand -hex 32)"
export CRON_SECRET="$(openssl rand -hex 32)"
export TENANT_PII_MASTER_KEY="$(openssl rand -hex 32)"
npx next dev --hostname 127.0.0.1 --port "$APP_PORT" > "$QUEUE_E2E_APP_LOG" 2>&1 &
APP_PID=$!
cleanup() {
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/v1/ping" >/dev/null; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    cat "$QUEUE_E2E_APP_LOG"
    exit 1
  fi
  if [ "$attempt" -eq 90 ]; then
    cat "$QUEUE_E2E_APP_LOG"
    exit 1
  fi
  sleep 2
done
node scripts/social-monitoring-server-queue-e2e.mjs
