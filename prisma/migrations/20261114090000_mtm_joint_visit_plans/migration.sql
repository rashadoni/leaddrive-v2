-- Planned joint visits (owner, 2026-10-30): the manager chooses which client of
-- the agent's day route he goes to together with the agent, or adds an extra
-- client to that route for it, and the agent is told where in advance.
--
-- * mtm_joint_visit_plans — one row per route stop the manager joins. The
--   visit still becomes joint only by the agent's «yes, together» at check-in
--   (20261024090000_mtm_joint_visits); `visitId` records which one it was.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).
--
-- One new table and one enum: no existing row is touched, and the previous
-- build, which knows neither, never reads them.

SET lock_timeout = '3s';

CREATE TYPE "MtmJointVisitPlanSource" AS ENUM ('ROUTE', 'EXTRA');

CREATE TABLE "mtm_joint_visit_plans" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "managerAgentId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "routePointId" TEXT,
  "customerId" TEXT NOT NULL,
  "contactId" TEXT,
  "source" "MtmJointVisitPlanSource" NOT NULL,
  "visitId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_joint_visit_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_joint_visit_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a plan joins two cards and a client of
  -- its own organization only.
  CONSTRAINT "mtm_joint_visit_plans_organizationId_managerAgentId_fkey" FOREIGN KEY ("organizationId", "managerAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_visit_plans_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_visit_plans_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_visit_plans_routePointId_fkey" FOREIGN KEY ("routePointId") REFERENCES "mtm_route_points"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_visit_plans_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_joint_visit_plans_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- Nobody accompanies himself.
  CONSTRAINT "mtm_joint_visit_plans_two_people_check" CHECK ("managerAgentId" <> "agentId")
);

CREATE INDEX "mtm_joint_visit_plans_organizationId_agentId_date_idx" ON "mtm_joint_visit_plans"("organizationId", "agentId", "date");
CREATE INDEX "mtm_joint_visit_plans_organizationId_managerAgentId_date_idx" ON "mtm_joint_visit_plans"("organizationId", "managerAgentId", "date");
CREATE INDEX "mtm_joint_visit_plans_routePointId_idx" ON "mtm_joint_visit_plans"("routePointId");
CREATE INDEX "mtm_joint_visit_plans_visitId_idx" ON "mtm_joint_visit_plans"("visitId");
-- One live plan per manager and stop: two presses at once plan it once. The
-- database holds this, not a read before the write.
CREATE UNIQUE INDEX "mtm_joint_visit_plans_one_live_per_stop" ON "mtm_joint_visit_plans"("managerAgentId", "routePointId") WHERE "cancelledAt" IS NULL AND "routePointId" IS NOT NULL;

ALTER TABLE "mtm_joint_visit_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_joint_visit_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_joint_visit_plans"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Rollback is forward-safe: roll back the application code and keep the
-- table. Without the code nothing reads or writes it.
