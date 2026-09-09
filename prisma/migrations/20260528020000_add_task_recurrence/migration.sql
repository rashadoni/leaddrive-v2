-- Roadmap #22 — recurring tasks.
--
-- Adds four nullable columns to `tasks` so a task can carry a recurrence
-- rule. When the task completes, the PATCH handler spawns the next
-- instance with the same payload but a new dueDate computed by
-- `src/lib/recurrence/parse.ts`. `recurrenceParentId` chains every
-- instance back to the first task in the series for UI traceability.
--
-- Purely additive — safe on a live DB. Indices support the parent-id
-- lookup (showing all instances of a series).

ALTER TABLE "tasks"
  ADD COLUMN "recurrenceRule"     TEXT,
  ADD COLUMN "recurrenceEndAt"    TIMESTAMP(3),
  ADD COLUMN "recurrenceCount"    INTEGER,
  ADD COLUMN "recurrenceParentId" TEXT;

CREATE INDEX "tasks_recurrenceParentId_idx"
  ON "tasks"("recurrenceParentId");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_recurrenceParentId_fkey"
  FOREIGN KEY ("recurrenceParentId") REFERENCES "tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
