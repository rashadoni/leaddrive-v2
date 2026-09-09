-- H6 Einstein Email Insights (Phase 3 slice 1).
-- Adds JSONB insights + analysis timestamp to EmailLog.

ALTER TABLE "email_logs" ADD COLUMN "insights" JSONB;
ALTER TABLE "email_logs" ADD COLUMN "insightsAt" TIMESTAMP(3);
