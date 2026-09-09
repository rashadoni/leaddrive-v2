CREATE TABLE "team_queues" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "skillTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "strategy" TEXT NOT NULL DEFAULT 'least_loaded',
  "lastAssignedTo" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_queues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_queues_organizationId_name_key" ON "team_queues"("organizationId", "name");
CREATE INDEX "team_queues_organizationId_isActive_idx" ON "team_queues"("organizationId", "isActive");

ALTER TABLE "team_queues"
  ADD CONSTRAINT "team_queues_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
