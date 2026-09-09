-- Raw provider dial evidence for a failed outbound AI call.  The PBX already
-- collapses DIALSTATUS/Q.850 into providerOutcome; these keep the raw reason
-- so an operator can read "CHANUNAVAIL / cause 1" from the call card instead
-- of capturing trunk traffic.
-- IF NOT EXISTS matches 20260817103048_call_end_evidence: a deploy that dies
-- between the ALTER and the migration bookkeeping must be re-runnable.
-- Nullable additions inherit the table's existing row-level security policies.
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "providerDialStatus" TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "providerHangupCause" TEXT;
