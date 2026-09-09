-- Agent Mobile v2 work-calendar foundation. Calendar rows are additive
-- overrides; unchanged weekdays/weekends continue to use application defaults.

CREATE TYPE "MtmWorkCalendarDayKind" AS ENUM (
  'WORKING_DAY',
  'WEEKEND',
  'PUBLIC_HOLIDAY',
  'COMPANY_HOLIDAY',
  'EXCEPTION_WORKDAY',
  'MOVED_WORKDAY',
  'MOVED_DAY_OFF'
);

CREATE TABLE "mtm_work_calendar_days" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "kind" "MtmWorkCalendarDayKind" NOT NULL,
  "name" TEXT,
  "teamId" TEXT,
  "agentId" TEXT,
  "movedToDate" DATE,
  "routePlanningAllowed" BOOLEAN,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_work_calendar_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_work_calendar_days_single_scope_check"
    CHECK (num_nonnulls("teamId", "agentId") <= 1)
);

CREATE INDEX "mtm_work_calendar_days_organizationId_date_deletedAt_idx"
  ON "mtm_work_calendar_days"("organizationId", "date", "deletedAt");
CREATE INDEX "mtm_work_calendar_days_organizationId_teamId_date_idx"
  ON "mtm_work_calendar_days"("organizationId", "teamId", "date");
CREATE INDEX "mtm_work_calendar_days_organizationId_agentId_date_idx"
  ON "mtm_work_calendar_days"("organizationId", "agentId", "date");

-- PostgreSQL treats NULLs as distinct in a normal UNIQUE constraint. Partial
-- indexes enforce one active override per date at each scope.
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_org_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date")
  WHERE "teamId" IS NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_team_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date", "teamId")
  WHERE "teamId" IS NOT NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_agent_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date", "agentId")
  WHERE "agentId" IS NOT NULL AND "teamId" IS NULL AND "deletedAt" IS NULL;

ALTER TABLE "mtm_work_calendar_days"
  ADD CONSTRAINT "mtm_work_calendar_days_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_work_calendar_days"
  ADD CONSTRAINT "mtm_work_calendar_days_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "mtm_teams"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_work_calendar_days"
  ADD CONSTRAINT "mtm_work_calendar_days_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_work_calendar_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_work_calendar_days" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_work_calendar_days_tenant_isolation"
  ON "mtm_work_calendar_days"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
