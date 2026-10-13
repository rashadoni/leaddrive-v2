-- Additive opt-in outbox. Rollback keeps history and disables the new worker.
SET lock_timeout = '3s';
CREATE TABLE "mtm_attendance_schedules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "input" JSONB NOT NULL,
  "timezone" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_attendance_schedule_enabled_check" CHECK (("input"->>'enabled')::boolean = "enabled"),
  CONSTRAINT "mtm_attendance_schedule_archived_check" CHECK ("archivedAt" IS NULL OR NOT "enabled")
);
CREATE UNIQUE INDEX "mtm_attendance_schedules_organizationId_id_key" ON "mtm_attendance_schedules"("organizationId", "id");
CREATE INDEX "mtm_attendance_schedules_organizationId_userId_archivedAt_idx" ON "mtm_attendance_schedules"("organizationId", "userId", "archivedAt");
CREATE INDEX "mtm_attendance_schedules_enabled_nextRunAt_idx" ON "mtm_attendance_schedules"("enabled", "nextRunAt");
CREATE TABLE "mtm_attendance_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "scheduleId" TEXT NOT NULL,
  "scheduleVersion" TIMESTAMP(3) NOT NULL,
  "recipient" TEXT NOT NULL,
  "from" DATE NOT NULL,
  "to" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  CONSTRAINT "mtm_attendance_deliveries_schedule_fkey" FOREIGN KEY ("organizationId", "scheduleId") REFERENCES "mtm_attendance_schedules"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_attendance_delivery_period_check" CHECK ("to" >= "from" AND "to" - "from" <= 365),
  CONSTRAINT "mtm_attendance_delivery_status_check" CHECK ("status" IN ('PENDING','SENDING','SENT','UNKNOWN','CANCELLED','FAILED'))
);
CREATE UNIQUE INDEX "mtm_attendance_deliveries_scheduleId_from_to_recipient_key" ON "mtm_attendance_deliveries"("scheduleId", "from", "to", "recipient");
CREATE INDEX "mtm_attendance_deliveries_organizationId_scheduleId_createdAt_idx" ON "mtm_attendance_deliveries"("organizationId", "scheduleId", "createdAt");
CREATE INDEX "mtm_attendance_deliveries_status_createdAt_idx" ON "mtm_attendance_deliveries"("status", "createdAt");
ALTER TABLE "mtm_attendance_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_attendance_schedules"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "mtm_attendance_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_attendance_deliveries"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
