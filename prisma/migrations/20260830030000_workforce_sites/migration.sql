-- C2: independent Workforce work sites. These rows intentionally do not
-- reference MTM Route customers, route assignments or customer geofences.
-- No tenant receives a site from this additive migration.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceSiteType" AS ENUM (
  'OFFICE',
  'WAREHOUSE',
  'TEMPORARY',
  'CUSTOMER',
  'HOME_REMOTE'
);

CREATE TYPE "WorkforceSiteStatus" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TABLE "workforce_sites" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "type" "WorkforceSiteType" NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "addressLabel" VARCHAR(500),
  "responsibleTeamId" TEXT,
  "status" "WorkforceSiteStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "archivedByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_sites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_sites_code_check" CHECK (NULLIF(btrim("code"), '') IS NOT NULL),
  CONSTRAINT "workforce_sites_name_check" CHECK (NULLIF(btrim("name"), '') IS NOT NULL),
  CONSTRAINT "workforce_sites_timezone_check" CHECK (NULLIF(btrim("timezone"), '') IS NOT NULL),
  CONSTRAINT "workforce_sites_archive_state_check" CHECK (
    ("status" = 'ACTIVE' AND "archivedByUserId" IS NULL AND "archivedAt" IS NULL)
    OR
    ("status" = 'ARCHIVED' AND "archivedByUserId" IS NOT NULL AND "archivedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "workforce_sites_organizationId_id_key"
  ON "workforce_sites"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_sites_organizationId_code_key"
  ON "workforce_sites"("organizationId", "code");
CREATE INDEX "workforce_sites_org_status_name_idx"
  ON "workforce_sites"("organizationId", "status", "name");
CREATE INDEX "workforce_sites_org_responsible_team_status_idx"
  ON "workforce_sites"("organizationId", "responsibleTeamId", "status");
CREATE INDEX "workforce_sites_org_created_by_idx"
  ON "workforce_sites"("organizationId", "createdByUserId");
CREATE INDEX "workforce_sites_org_archived_by_idx"
  ON "workforce_sites"("organizationId", "archivedByUserId");

ALTER TABLE "workforce_sites"
  ADD CONSTRAINT "workforce_sites_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_sites_responsible_team_fkey"
    FOREIGN KEY ("organizationId", "responsibleTeamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_sites_created_by_fkey"
    FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_sites_archived_by_fkey"
    FOREIGN KEY ("organizationId", "archivedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_sites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_sites"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
