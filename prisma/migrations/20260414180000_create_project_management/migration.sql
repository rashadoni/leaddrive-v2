-- Fresh-install compatibility for Project Management tables that existed in
-- deployed schemas before their FK-only migration was added.
CREATE TABLE IF NOT EXISTS "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "completionPercentage" INTEGER NOT NULL DEFAULT 0,
    "managerId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "projects_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "projects_organizationId_idx" ON "projects"("organizationId");
CREATE INDEX IF NOT EXISTS "projects_organizationId_status_idx" ON "projects"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "projects_companyId_idx" ON "projects"("companyId");

CREATE TABLE IF NOT EXISTS "project_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "hourlyRate" DOUBLE PRECISION DEFAULT 0,
    "hoursLogged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_members_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_members_projectId_userId_key"
    ON "project_members"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "project_members_organizationId_idx" ON "project_members"("organizationId");
CREATE INDEX IF NOT EXISTS "project_members_projectId_idx" ON "project_members"("projectId");

CREATE TABLE IF NOT EXISTS "project_milestones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_milestones_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_milestones_projectId_idx" ON "project_milestones"("projectId");
CREATE INDEX IF NOT EXISTS "project_milestones_organizationId_idx" ON "project_milestones"("organizationId");

CREATE TABLE IF NOT EXISTS "project_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assignedTo" TEXT,
    "dueDate" TIMESTAMP(3),
    "estimatedHours" DOUBLE PRECISION DEFAULT 0,
    "actualHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_tasks_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_tasks_milestoneId_fkey"
        FOREIGN KEY ("milestoneId") REFERENCES "project_milestones"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "project_tasks_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "project_tasks"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_tasks_projectId_idx" ON "project_tasks"("projectId");
CREATE INDEX IF NOT EXISTS "project_tasks_organizationId_idx" ON "project_tasks"("organizationId");
CREATE INDEX IF NOT EXISTS "project_tasks_milestoneId_idx" ON "project_tasks"("milestoneId");
CREATE INDEX IF NOT EXISTS "project_tasks_parentId_idx" ON "project_tasks"("parentId");
CREATE INDEX IF NOT EXISTS "project_tasks_assignedTo_idx" ON "project_tasks"("assignedTo");
