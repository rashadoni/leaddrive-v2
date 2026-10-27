-- The AI voice agent hands an inbound call to a salesperson's browser
-- (owner, 2026-10-27): requested -> ringing -> connected | returned.
ALTER TABLE "call_logs" ADD COLUMN "handoffState" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "handoffRequestedAt" TIMESTAMP(3);
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_handoff_state_check" CHECK (
  ("handoffState" IS NULL AND "handoffRequestedAt" IS NULL)
  OR ("handoffState" IN ('requested', 'ringing', 'connected', 'returned') AND "handoffRequestedAt" IS NOT NULL)
);
