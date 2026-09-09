-- N14 Platform Events (Phase 5 slice 1).
-- Tenant-defined event types + append-only event log.

CREATE TABLE "platform_event_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_event_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_event_definitions_org_name_uniq"
  ON "platform_event_definitions"("organizationId", "name");

CREATE INDEX "platform_event_definitions_org_idx"
  ON "platform_event_definitions"("organizationId");

ALTER TABLE "platform_event_definitions"
  ADD CONSTRAINT "platform_event_definitions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_event_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_event_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform_event_logs"
  ADD CONSTRAINT "platform_event_logs_origin_check"
  CHECK ("origin" IN ('manual', 'cdc', 'apex', 'workflow'));

CREATE INDEX "platform_event_logs_org_publishedAt_idx"
  ON "platform_event_logs"("organizationId", "publishedAt");

CREATE INDEX "platform_event_logs_org_eventName_publishedAt_idx"
  ON "platform_event_logs"("organizationId", "eventName", "publishedAt");

CREATE INDEX "platform_event_logs_definition_publishedAt_idx"
  ON "platform_event_logs"("definitionId", "publishedAt");

ALTER TABLE "platform_event_logs"
  ADD CONSTRAINT "platform_event_logs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_event_logs"
  ADD CONSTRAINT "platform_event_logs_definitionId_fkey"
  FOREIGN KEY ("definitionId") REFERENCES "platform_event_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
