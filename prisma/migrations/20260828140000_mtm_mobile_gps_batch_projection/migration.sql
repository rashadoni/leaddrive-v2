-- Server-first GPS scale foundation. Existing v1 point uploads continue to
-- write mtm_agent_locations. The new latest projection is additive and has
-- its own FORCE RLS policy from day one; no raw GPS history is rewritten.
--
-- Raw GPS retention is the owner-approved 30 days for standard and enterprise
-- tenants. The bounded cleanup job enforces the same period for this
-- projection, so it cannot become an accidental long-term location archive.

SET lock_timeout = '3s';

ALTER TABLE "mtm_agent_locations"
  ADD COLUMN IF NOT EXISTS "payloadSha256" TEXT;

CREATE TABLE IF NOT EXISTS "mtm_agent_latest_locations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "sourceLocationId" TEXT,
  "payloadSha256" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "altitude" DOUBLE PRECISION,
  "battery" DOUBLE PRECISION,
  "isMoving" BOOLEAN NOT NULL DEFAULT false,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_agent_latest_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_agent_latest_locations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_agent_latest_locations_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "mtm_agent_latest_locations_organizationId_agentId_key"
  ON "mtm_agent_latest_locations"("organizationId", "agentId");
CREATE UNIQUE INDEX IF NOT EXISTS "mtm_agent_latest_locations_agentId_key"
  ON "mtm_agent_latest_locations"("agentId");
CREATE INDEX IF NOT EXISTS "mtm_agent_latest_locations_organizationId_recordedAt_idx"
  ON "mtm_agent_latest_locations"("organizationId", "recordedAt");

ALTER TABLE "mtm_agent_latest_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_latest_locations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_latest_locations";
CREATE POLICY tenant_isolation ON "mtm_agent_latest_locations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
