-- M10 slice-3 prereq — speed up content-perf-refresh cron's per-template
-- aggregation. The cron runs 4 groupBy queries per BATCH_SIZE templates,
-- each WHERE-clause includes `organizationId` + `templateId IN (...)`.
-- Without this composite, those queries become seq scans on email_logs.
--
-- CONCURRENTLY would be safer on a hot table; not used here because
-- Prisma migrations wrap in a transaction by default. For the first-
-- time tenants with <1M log rows the lock window is sub-second; for
-- larger tenants the migration runner can switch to `--create-only`
-- + manual `CREATE INDEX CONCURRENTLY` if needed.

CREATE INDEX "email_logs_organizationId_templateId_idx"
  ON "email_logs"("organizationId", "templateId");
