-- N2 Business hours foundation for inbox automation.
-- Additive only: no live webhook behavior changes until flows explicitly use this table.
CREATE TABLE "business_hours" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelType" TEXT NOT NULL DEFAULT 'all',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "schedule" JSONB NOT NULL DEFAULT '{}',
  "holidays" JSONB NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "welcomeMessage" TEXT,
  "awayMessage" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_hours_organizationId_channelType_key"
  ON "business_hours"("organizationId", "channelType");

CREATE INDEX "business_hours_organizationId_isActive_idx"
  ON "business_hours"("organizationId", "isActive");

ALTER TABLE "business_hours"
  ADD CONSTRAINT "business_hours_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
