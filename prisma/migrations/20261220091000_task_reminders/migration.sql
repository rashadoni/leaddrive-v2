-- «Напомнить» from the inbox panel (owner, 2026-11-15): a task carries the moment its assignee is
-- reminded. Until now a task had a due date and nobody was told when it came. The cron
-- `task-reminders` sends the bell + push once and stamps "remindedAt". See src/lib/tasks/task-reminders.ts.
ALTER TABLE "tasks" ADD COLUMN "remindAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "remindedAt" TIMESTAMP(3);

-- The cron reads only reminders still waiting, across every organization.
CREATE INDEX "tasks_reminder_due_idx" ON "tasks" ("remindAt")
  WHERE "remindAt" IS NOT NULL AND "remindedAt" IS NULL AND "deletedAt" IS NULL;
