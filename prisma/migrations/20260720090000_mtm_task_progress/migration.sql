-- SWM-14: per-task completion progress (0..100), reported by the assignee as
-- they execute. Nullable and additive — no backfill, no default; a null value
-- simply means "no progress reported yet".
ALTER TABLE "mtm_tasks" ADD COLUMN "progress" INTEGER;
