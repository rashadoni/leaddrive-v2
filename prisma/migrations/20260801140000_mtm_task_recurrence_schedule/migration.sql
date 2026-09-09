-- Keep planned task time separate from factual execution, pin the IANA
-- timezone, and persist an optional edit-future pivot for recurrence expansion.
-- Every column is nullable so existing one-time and legacy recurring tasks
-- remain valid and can be normalized lazily when next edited or completed.
ALTER TABLE "mtm_tasks"
  ADD COLUMN "scheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceTimezone" TEXT,
  ADD COLUMN "recurrenceAnchorScheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceAnchorDueDate" TIMESTAMP(3),
  ADD COLUMN "recurrenceCursorScheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceCursorDueDate" TIMESTAMP(3);

-- Existing recurring rows have never supported isolated THIS exceptions, so
-- their current planned timestamps are the only valid cursor bootstrap.
UPDATE "mtm_tasks"
SET
  "recurrenceCursorScheduledStartAt" = "scheduledStartAt",
  "recurrenceCursorDueDate" = "dueDate"
WHERE "recurrenceRule" IS NOT NULL;

ALTER TABLE "mtm_tasks"
  ADD CONSTRAINT "mtm_tasks_recurrenceTimezone_length_check"
  CHECK (
    "recurrenceTimezone" IS NULL
    OR char_length("recurrenceTimezone") BETWEEN 1 AND 64
  );
