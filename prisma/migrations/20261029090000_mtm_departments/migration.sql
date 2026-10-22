-- Personnel: departments above sections (owner, 2026-10-22: «тут есть отдел,
-- но нет департамента»). A section (şöbə) is an MTM team; a department
-- (departament) groups sections, and a person may sit in a department without
-- a section (its head, for one).
--
-- Additive only: every existing team and person keeps no department, exactly
-- as before. The policy reads `app.org_id`, the setting every tenant path in
-- this codebase sets (src/__tests__/migration-rls-setting-name.test.ts).

SET lock_timeout = '3s';

CREATE TABLE "mtm_departments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_departments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_departments_organizationId_id_key" ON "mtm_departments"("organizationId", "id");
CREATE INDEX "mtm_departments_organizationId_idx" ON "mtm_departments"("organizationId");

ALTER TABLE "mtm_departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_departments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_teams" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "mtm_teams" ADD CONSTRAINT "mtm_teams_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "mtm_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "mtm_teams_departmentId_idx" ON "mtm_teams"("departmentId");

ALTER TABLE "mtm_agents" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "mtm_agents" ADD CONSTRAINT "mtm_agents_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "mtm_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "mtm_agents_departmentId_idx" ON "mtm_agents"("departmentId");
