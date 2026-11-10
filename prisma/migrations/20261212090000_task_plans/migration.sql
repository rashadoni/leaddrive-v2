-- The day each person plans to work on a task (owner, 2026-11-10: «Да, свой у
-- каждого» — as in Bordio, where every assignee places a task on their own
-- day). Read by «Mənim işlərim → Təqvim». See schema.prisma TaskPlan.

CREATE TABLE "task_plans" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_plans_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "task_plans_taskId_userId_key" ON "task_plans"("taskId", "userId");
CREATE INDEX "task_plans_organizationId_userId_day_idx" ON "task_plans"("organizationId", "userId", "day");

ALTER TABLE "task_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_plans"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
