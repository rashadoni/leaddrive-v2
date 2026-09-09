-- SWM-14 review/return: when a manager sends a completed task back for rework
-- the task reopens (IN_PROGRESS) and this column records why. Nullable and
-- additive — a null value means the task was never returned. Prior completion
-- evidence (result) is preserved on return.
ALTER TABLE "mtm_tasks" ADD COLUMN "returnReason" TEXT;
