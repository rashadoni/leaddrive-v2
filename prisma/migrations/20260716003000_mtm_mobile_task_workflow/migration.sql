-- Offline-safe task workflow: versioned cards, recurrence metadata and an
-- immutable agent event timeline.

CREATE TYPE "MtmTaskRecurrenceRule" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "MtmTaskEventType" AS ENUM (
  'CREATED',
  'ACCEPTED',
  'STARTED',
  'COMPLETED',
  'RESCHEDULED',
  'COMMENTED',
  'EVIDENCE_ADDED',
  'COPIED',
  'CANCELLED',
  'EDITED'
);

ALTER TABLE "mtm_tasks"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceRule" "MtmTaskRecurrenceRule",
  ADD COLUMN "recurrenceInterval" INTEGER,
  ADD COLUMN "recurrenceUntil" TIMESTAMP(3),
  ADD COLUMN "recurrenceParentId" TEXT,
  ADD COLUMN "copiedFromId" TEXT;

ALTER TABLE "mtm_tasks"
  ADD CONSTRAINT "mtm_tasks_recurrenceParentId_fkey"
    FOREIGN KEY ("recurrenceParentId") REFERENCES "mtm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_tasks_copiedFromId_fkey"
    FOREIGN KEY ("copiedFromId") REFERENCES "mtm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "mtm_tasks_organizationId_agentId_status_dueDate_idx"
  ON "mtm_tasks"("organizationId", "agentId", "status", "dueDate");
CREATE INDEX "mtm_tasks_recurrenceParentId_idx" ON "mtm_tasks"("recurrenceParentId");
CREATE INDEX "mtm_tasks_copiedFromId_idx" ON "mtm_tasks"("copiedFromId");

CREATE TABLE "mtm_task_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "clientEventId" TEXT,
  "type" "MtmTaskEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "comment" TEXT,
  "evidence" JSONB,
  "fromStatus" "MtmTaskStatus",
  "toStatus" "MtmTaskStatus",
  "oldDueDate" TIMESTAMP(3),
  "newDueDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_task_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_task_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_task_events_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "mtm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_task_events_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_task_events_organizationId_agentId_clientEventId_key"
  ON "mtm_task_events"("organizationId", "agentId", "clientEventId");
CREATE INDEX "mtm_task_events_organizationId_agentId_occurredAt_idx"
  ON "mtm_task_events"("organizationId", "agentId", "occurredAt");
CREATE INDEX "mtm_task_events_taskId_occurredAt_idx"
  ON "mtm_task_events"("taskId", "occurredAt");

ALTER TABLE "mtm_task_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_task_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_task_events_tenant_isolation"
  ON "mtm_task_events"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
