-- AddForeignKey: Project.managerId -> users.id
ALTER TABLE "projects" ADD CONSTRAINT "projects_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Project.dealId -> deals.id
ALTER TABLE "projects" ADD CONSTRAINT "projects_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProjectTask.assignedTo -> users.id
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "projects_managerId_idx" ON "projects"("managerId");
CREATE INDEX IF NOT EXISTS "projects_dealId_idx" ON "projects"("dealId");
