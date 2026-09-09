-- M4-5: Region → Team → Agent territory hierarchy
-- Creates mtm_regions and mtm_teams tables, wires mtm_agents.teamId FK

-- 1) Create mtm_regions
CREATE TABLE "mtm_regions" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "code"           TEXT,
    "description"    TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_regions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mtm_regions" ADD CONSTRAINT "mtm_regions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX "mtm_regions_organizationId_idx" ON "mtm_regions"("organizationId");
CREATE INDEX "mtm_regions_organizationId_isActive_idx" ON "mtm_regions"("organizationId", "isActive");

-- 2) Create mtm_teams
CREATE TABLE "mtm_teams" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regionId"       TEXT,
    "name"           TEXT NOT NULL,
    "code"           TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_teams_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mtm_teams" ADD CONSTRAINT "mtm_teams_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "mtm_teams" ADD CONSTRAINT "mtm_teams_regionId_fkey"
    FOREIGN KEY ("regionId") REFERENCES "mtm_regions"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "mtm_teams_organizationId_idx" ON "mtm_teams"("organizationId");
CREATE INDEX "mtm_teams_organizationId_regionId_idx" ON "mtm_teams"("organizationId", "regionId");
CREATE INDEX "mtm_teams_regionId_idx" ON "mtm_teams"("regionId");

-- 3) Wire mtm_agents.teamId FK now that mtm_teams exists
ALTER TABLE "mtm_agents" ADD CONSTRAINT "mtm_agents_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "mtm_teams"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "mtm_agents_teamId_idx" ON "mtm_agents"("teamId");
