-- N3 Apex-equivalent JS sandbox (Phase 5 slice 1).
-- Per-tenant code modules + append-only execution log.

CREATE TABLE "code_modules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "timeoutMs" INTEGER NOT NULL DEFAULT 3000,
    "maxLogLines" INTEGER NOT NULL DEFAULT 500,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_modules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "code_modules"
  ADD CONSTRAINT "code_modules_triggerType_check"
  CHECK ("triggerType" IN ('manual', 'record_created', 'record_updated', 'cron'));

ALTER TABLE "code_modules"
  ADD CONSTRAINT "code_modules_timeoutMs_check"
  CHECK ("timeoutMs" > 0 AND "timeoutMs" <= 30000);

ALTER TABLE "code_modules"
  ADD CONSTRAINT "code_modules_maxLogLines_check"
  CHECK ("maxLogLines" > 0 AND "maxLogLines" <= 10000);

CREATE UNIQUE INDEX "code_modules_org_name_uniq"
  ON "code_modules"("organizationId", "name");

CREATE INDEX "code_modules_org_trigger_idx"
  ON "code_modules"("organizationId", "triggerType");

ALTER TABLE "code_modules"
  ADD CONSTRAINT "code_modules_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "code_executions" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "errorMessage" TEXT,
    "result" TEXT,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_executions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "code_executions"
  ADD CONSTRAINT "code_executions_outcome_check"
  CHECK ("outcome" IN ('ok', 'error', 'timeout', 'rejected'));

CREATE INDEX "code_executions_module_started_idx"
  ON "code_executions"("moduleId", "startedAt");

CREATE INDEX "code_executions_org_started_idx"
  ON "code_executions"("organizationId", "startedAt");

ALTER TABLE "code_executions"
  ADD CONSTRAINT "code_executions_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "code_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "code_executions"
  ADD CONSTRAINT "code_executions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
