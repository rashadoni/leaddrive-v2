-- Agent workday lifecycle and replay-safe mobile GPS uploads.

CREATE TYPE "MtmWorkdayStatus" AS ENUM ('STARTED', 'PAUSED', 'COMPLETED');
CREATE TYPE "MtmWorkdayEventType" AS ENUM ('START', 'PAUSE', 'RESUME', 'FINISH');

ALTER TABLE "mtm_agent_locations"
  ADD COLUMN "clientLocationId" TEXT;

CREATE UNIQUE INDEX "mtm_agent_locations_organizationId_agentId_clientLocationId_key"
  ON "mtm_agent_locations"("organizationId", "agentId", "clientLocationId");

CREATE TABLE "mtm_agent_workdays" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "status" "MtmWorkdayStatus" NOT NULL DEFAULT 'STARTED',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "pausedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
  "startLatitude" DOUBLE PRECISION,
  "startLongitude" DOUBLE PRECISION,
  "endLatitude" DOUBLE PRECISION,
  "endLongitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_agent_workdays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_agent_workdays_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_agent_workdays_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_agent_workdays_organizationId_agentId_workDate_key"
  ON "mtm_agent_workdays"("organizationId", "agentId", "workDate");
CREATE INDEX "mtm_agent_workdays_organizationId_workDate_idx"
  ON "mtm_agent_workdays"("organizationId", "workDate");
CREATE INDEX "mtm_agent_workdays_organizationId_agentId_status_idx"
  ON "mtm_agent_workdays"("organizationId", "agentId", "status");

CREATE TABLE "mtm_agent_workday_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "clientEventId" TEXT,
  "type" "MtmWorkdayEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_agent_workday_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_agent_workday_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_agent_workday_events_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_agent_workday_events_workdayId_fkey"
    FOREIGN KEY ("workdayId") REFERENCES "mtm_agent_workdays"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_agent_workday_events_organizationId_agentId_clientEventId_key"
  ON "mtm_agent_workday_events"("organizationId", "agentId", "clientEventId");
CREATE INDEX "mtm_agent_workday_events_organizationId_agentId_occurredAt_idx"
  ON "mtm_agent_workday_events"("organizationId", "agentId", "occurredAt");
CREATE INDEX "mtm_agent_workday_events_workdayId_occurredAt_idx"
  ON "mtm_agent_workday_events"("workdayId", "occurredAt");

ALTER TABLE "mtm_agent_workdays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workdays" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_agent_workdays_tenant_isolation"
  ON "mtm_agent_workdays"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_agent_workday_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workday_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_agent_workday_events_tenant_isolation"
  ON "mtm_agent_workday_events"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
