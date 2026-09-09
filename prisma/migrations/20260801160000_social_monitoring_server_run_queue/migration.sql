CREATE TABLE "social_monitoring_run_jobs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceScope" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "fullArchiveConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "paidConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "sharedConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "totalItems" INTEGER NOT NULL,
  "paidItems" INTEGER NOT NULL DEFAULT 0,
  "sharedItems" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "cancelRequestedAt" TIMESTAMP(3),
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_monitoring_run_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_monitoring_run_jobs_kind_check"
    CHECK ("kind" IN ('PROFILE_FULL', 'SOURCE_FULL', 'WEB_NEWS')),
  CONSTRAINT "social_monitoring_run_jobs_scope_check"
    CHECK (
      ("kind" = 'PROFILE_FULL' AND "sourceScope" IS NULL)
      OR (
        "kind" IN ('SOURCE_FULL', 'WEB_NEWS')
        AND "sourceScope" IN ('OWNED', 'EXTERNAL')
      )
    ),
  CONSTRAINT "social_monitoring_run_jobs_status_check"
    CHECK ("status" IN (
      'QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'CANCEL_REQUESTED',
      'CANCELED', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED'
    )),
  CONSTRAINT "social_monitoring_run_jobs_counts_check"
    CHECK (
      "totalItems" > 0 AND "paidItems" >= 0 AND "sharedItems" >= 0
      AND "failureCount" >= 0
    )
);

CREATE TABLE "social_monitoring_run_job_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "subjectId" TEXT,
  "scenarioId" TEXT,
  "profileName" TEXT,
  "sourceId" TEXT NOT NULL,
  "sourceLabel" TEXT NOT NULL,
  "sourcePlatform" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "paid" BOOLEAN NOT NULL DEFAULT false,
  "providerAccountFundedOnly" BOOLEAN NOT NULL DEFAULT false,
  "sharedAcrossMonitorings" BOOLEAN NOT NULL DEFAULT false,
  "maxTotalChargeUsd" DECIMAL(12,6),
  "onlyCapability" TEXT,
  "includeComments" BOOLEAN NOT NULL DEFAULT false,
  "fullArchiveRun" BOOLEAN NOT NULL DEFAULT false,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "providerDeadlineAt" TIMESTAMP(3),
  "terminalObservedAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "collectorRunId" TEXT,
  "providerRunIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "collectorResult" JSONB,
  "foundCount" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "ignoredCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_monitoring_run_job_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_monitoring_run_job_items_status_check"
    CHECK ("status" IN (
      'QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'SUCCEEDED', 'PARTIAL',
      'SKIPPED', 'FAILED', 'TIMED_OUT'
    )),
  CONSTRAINT "social_monitoring_run_job_items_position_check" CHECK ("position" > 0),
  CONSTRAINT "social_monitoring_run_job_items_attempt_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "social_monitoring_run_job_items_counts_check" CHECK (
    "foundCount" >= 0 AND "newCount" >= 0 AND "duplicateCount" >= 0
    AND "acceptedCount" >= 0 AND "reviewCount" >= 0
    AND "rejectedCount" >= 0 AND "ignoredCount" >= 0
  )
);

CREATE UNIQUE INDEX "social_monitoring_run_jobs_org_id_key"
  ON "social_monitoring_run_jobs"("organizationId", "id");
CREATE UNIQUE INDEX "social_monitoring_run_jobs_org_idempotency_key"
  ON "social_monitoring_run_jobs"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "social_monitoring_run_jobs_one_active_org_key"
  ON "social_monitoring_run_jobs"("organizationId")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'CANCEL_REQUESTED');
CREATE INDEX "social_monitoring_run_jobs_queue_idx"
  ON "social_monitoring_run_jobs"(
    "status", "nextAttemptAt", "leaseExpiresAt", "updatedAt", "createdAt"
  );
CREATE INDEX "social_monitoring_run_jobs_org_created_idx"
  ON "social_monitoring_run_jobs"("organizationId", "createdAt");

CREATE UNIQUE INDEX "social_monitoring_run_job_items_org_id_key"
  ON "social_monitoring_run_job_items"("organizationId", "id");
CREATE UNIQUE INDEX "social_monitoring_run_job_items_org_job_position_key"
  ON "social_monitoring_run_job_items"("organizationId", "jobId", "position");
CREATE INDEX "social_monitoring_run_job_items_job_status_idx"
  ON "social_monitoring_run_job_items"("organizationId", "jobId", "status", "position");
CREATE INDEX "social_monitoring_run_job_items_queue_idx"
  ON "social_monitoring_run_job_items"("status", "nextAttemptAt", "leaseExpiresAt");

ALTER TABLE "social_monitoring_run_jobs"
  ADD CONSTRAINT "social_monitoring_run_jobs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_monitoring_run_job_items"
  ADD CONSTRAINT "social_monitoring_run_job_items_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_monitoring_run_job_items"
  ADD CONSTRAINT "social_monitoring_run_job_items_organizationId_jobId_fkey"
  FOREIGN KEY ("organizationId", "jobId")
  REFERENCES "social_monitoring_run_jobs"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_monitoring_run_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_job_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_job_items" FORCE ROW LEVEL SECURITY;

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
