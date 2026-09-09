-- Roadmap: Task→Project relations + rollup (Phase 2 of Notion-tasks plan).
--
-- Adds an optional `projectId` column to `tasks` so CRM-side tasks can link
-- to a Project. The link is distinct from `project_tasks` (a separate table
-- for tasks inside a project's own task list); both contribute to the
-- project's `completionPercentage` rollup via `src/lib/project-rollup.ts`.
--
-- Migration is purely additive and safe to run on a live table:
--   • Column is NULL-able with no default → existing rows unaffected.
--   • FK uses ON DELETE SET NULL so deleting a project doesn't cascade
--     into the tasks table (CRM tasks survive project removal).
--   • Index supports `where: { projectId }` filtering and the rollup
--     count queries.

ALTER TABLE "tasks"
  ADD COLUMN "projectId" TEXT;

CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
