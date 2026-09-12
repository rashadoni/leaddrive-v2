-- C1: distinguish client attendance claim/capture/queue time from the
-- server's receipt/application time. Existing immutable legacy events retain
-- NULL provenance fields and schemaVersion=1; do not rewrite them as if they
-- carried evidence they never supplied.

ALTER TABLE "mtm_agent_workday_events"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "serverReceivedAt" TIMESTAMP(3),
  ADD COLUMN "appliedAt" TIMESTAMP(3),
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requestHash" VARCHAR(64);

ALTER TABLE "mtm_sync_operations"
  ADD COLUMN "requestHash" VARCHAR(64);

ALTER TABLE "mtm_agent_workday_events"
  ADD CONSTRAINT "mtm_agent_workday_events_schema_version_check"
  CHECK ("schemaVersion" IN (1, 2));

-- Receipt-time queries support the C0/C12 tenant-safe baseline and make it
-- possible to distinguish current server traffic from an older valid client
-- claim without indexing raw coordinates or free-text notes.
CREATE INDEX "mtm_agent_workday_events_organizationId_agentId_serverReceivedAt_idx"
  ON "mtm_agent_workday_events"("organizationId", "agentId", "serverReceivedAt");
