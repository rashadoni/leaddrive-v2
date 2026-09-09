-- Roadmap #22 follow-up — concurrent-completion race protection.
--
-- Architect P1 finding on commit 78d81a5f: two simultaneous PATCHes
-- against the same recurring task's `complete` action both observed
-- `existing.status = "pending"` and both fired `spawnNextRecurringTask`,
-- producing duplicate children with the same parent + same dueDate.
--
-- The unique constraint at DB level guarantees only one survives. The
-- spawn helper catches the resulting Prisma P2002 and treats it as a
-- silent no-op (the OTHER concurrent PATCH already produced the next
-- instance — we just lost the race, no error to surface).
--
-- Postgres semantics: NULL values are distinct in unique constraints,
-- so the original parent task (recurrenceParentId=null) is never
-- constrained against itself or other null-parent tasks.

CREATE UNIQUE INDEX "tasks_recurrenceParentId_dueDate_key"
  ON "tasks"("recurrenceParentId", "dueDate");
