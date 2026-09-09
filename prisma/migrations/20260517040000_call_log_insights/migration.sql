-- A7 Conversation Intelligence (Phase 3 slice 1).
-- Adds JSONB `insights` + analysis timestamp to CallLog.

ALTER TABLE "call_logs" ADD COLUMN "insights" JSONB;
ALTER TABLE "call_logs" ADD COLUMN "insightsAt" TIMESTAMP(3);
