-- Bordio-style task card (owner, 2026-11-07): start date, the person who set
-- the task, tags, subtask assignee and deadline, @-mentions in messages,
-- followers and logged time. See schema.prisma Task / TaskChecklist /
-- TaskComment / TaskFollower / TaskTimeEntry.

ALTER TABLE "tasks" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "reporterId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_checklists" ADD COLUMN "assignedTo" TEXT;
ALTER TABLE "task_checklists" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "task_checklists" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_assignedTo_fkey"
  FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_comments" ADD COLUMN "mentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "task_followers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_followers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_followers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_followers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_followers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "task_followers_taskId_userId_key" ON "task_followers"("taskId", "userId");
CREATE INDEX "task_followers_organizationId_userId_idx" ON "task_followers"("organizationId", "userId");

CREATE TABLE "task_time_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "minutes" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_time_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "task_time_entries_source_check" CHECK ("source" IN ('timer', 'manual')),
  CONSTRAINT "task_time_entries_minutes_check" CHECK ("minutes" IS NULL OR "minutes" BETWEEN 0 AND 100000),
  CONSTRAINT "task_time_entries_closed_check" CHECK (("endedAt" IS NULL) = ("minutes" IS NULL))
);
CREATE INDEX "task_time_entries_organizationId_taskId_idx" ON "task_time_entries"("organizationId", "taskId");
CREATE INDEX "task_time_entries_userId_endedAt_idx" ON "task_time_entries"("userId", "endedAt");
-- One running timer per person, across all tasks.
CREATE UNIQUE INDEX "task_time_entries_one_running_timer" ON "task_time_entries"("userId") WHERE "endedAt" IS NULL;

ALTER TABLE "task_followers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_followers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_followers"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "task_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_time_entries"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
