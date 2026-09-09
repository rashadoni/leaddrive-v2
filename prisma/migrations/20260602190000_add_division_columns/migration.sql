-- Per-board configurable Kanban columns: which standard stages a board shows,
-- in order (backlog/todo/in_progress/testing/review/done). Empty array = the
-- app default (all stages). Additive + backfill-free: existing boards get '{}'
-- and keep the default 6-column behaviour.
ALTER TABLE "divisions" ADD COLUMN "columns" TEXT[] DEFAULT ARRAY[]::TEXT[];
