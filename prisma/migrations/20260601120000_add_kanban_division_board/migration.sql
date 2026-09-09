-- Jira-style Kanban board: Division (board/team), per-user BoardPermission,
-- TaskActivity (task audit log), and additive columns on tasks.
--
-- 100% ADDITIVE + backward-compatible:
--   * All new tasks columns are nullable OR have a default → existing rows are
--     untouched and keep validating ("project OR division required" is enforced
--     at the API layer, not the DB).
--   * tasks."taskKey" unique is composite (organizationId, taskKey); Postgres
--     treats NULL as distinct, so the many pre-existing NULL-key rows never
--     collide. Only generated keys are constrained.
--   * Soft delete: tasks."deletedAt" is set by DELETE; board/list reads filter
--     deletedAt IS NULL via the prisma client extension. The taskKey generator
--     deliberately includes soft-deleted rows when computing MAX(n).

-- CreateTable
CREATE TABLE "divisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "headUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_permissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canMoveToTodo" BOOLEAN NOT NULL DEFAULT false,
    "canMoveToInProgress" BOOLEAN NOT NULL DEFAULT false,
    "canMoveToTesting" BOOLEAN NOT NULL DEFAULT false,
    "canMoveToReview" BOOLEAN NOT NULL DEFAULT false,
    "canMoveBack" BOOLEAN NOT NULL DEFAULT false,
    "canCreateTask" BOOLEAN NOT NULL DEFAULT false,
    "canComment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

-- AlterTable (additive, nullable / defaulted — existing rows untouched)
ALTER TABLE "tasks"
    ADD COLUMN "taskKey" TEXT,
    ADD COLUMN "type" TEXT NOT NULL DEFAULT 'task',
    ADD COLUMN "category" TEXT,
    ADD COLUMN "estimatedHours" DECIMAL(10,2),
    ADD COLUMN "estimatedPrice" DECIMAL(18,4),
    ADD COLUMN "divisionId" TEXT,
    ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "divisions_organizationId_key_key" ON "divisions"("organizationId", "key");

-- CreateIndex
CREATE INDEX "divisions_organizationId_idx" ON "divisions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "board_permissions_userId_divisionId_key" ON "board_permissions"("userId", "divisionId");

-- CreateIndex
CREATE INDEX "board_permissions_organizationId_idx" ON "board_permissions"("organizationId");

-- CreateIndex
CREATE INDEX "board_permissions_divisionId_idx" ON "board_permissions"("divisionId");

-- CreateIndex
CREATE INDEX "task_activities_taskId_idx" ON "task_activities"("taskId");

-- CreateIndex
CREATE INDEX "task_activities_organizationId_idx" ON "task_activities"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organizationId_taskKey_key" ON "tasks"("organizationId", "taskKey");

-- CreateIndex
CREATE INDEX "tasks_organizationId_divisionId_idx" ON "tasks"("organizationId", "divisionId");

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_idx" ON "tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "tasks_organizationId_deletedAt_idx" ON "tasks"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_permissions" ADD CONSTRAINT "board_permissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_permissions" ADD CONSTRAINT "board_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_permissions" ADD CONSTRAINT "board_permissions_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- Multi-tenant coherence trigger for board_permissions (Codex P0)
-- ═══════════════════════════════════════════════════════════════════
-- board_permissions is a PERMISSION table: a cross-tenant row (a user from
-- org A granted access to org B's division) is the highest-risk leak. The app
-- layer already validates this, but per the project's Phase 7 coherence-trigger
-- pattern we ALSO enforce it at the DB so a future app bug cannot write an
-- incoherent row. Rejects any INSERT / UPDATE OF the FK or org columns where
-- the referenced user's org OR the referenced division's org differs from
-- organizationId. (Prisma does not manage triggers → invisible to
-- `migrate diff`, so this adds no drift.)
CREATE OR REPLACE FUNCTION board_permissions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  user_org_id TEXT;
  division_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO user_org_id
    FROM "users" WHERE "id" = NEW."userId";
  IF user_org_id IS NULL THEN
    RAISE EXCEPTION 'board_permissions.userId "%" does not resolve', NEW."userId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF user_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'board_permissions: user "%" belongs to org "%" but permission references org "%"',
      NEW."userId", user_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO division_org_id
    FROM "divisions" WHERE "id" = NEW."divisionId";
  IF division_org_id IS NULL THEN
    RAISE EXCEPTION 'board_permissions.divisionId "%" does not resolve', NEW."divisionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF division_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'board_permissions: division "%" belongs to org "%" but permission references org "%"',
      NEW."divisionId", division_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS board_permissions_coherence_trigger ON "board_permissions";
CREATE TRIGGER board_permissions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "userId", "divisionId", "organizationId" ON "board_permissions"
  FOR EACH ROW
  EXECUTE FUNCTION board_permissions_coherence_fn();
