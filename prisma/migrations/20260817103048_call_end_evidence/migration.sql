-- Media-level end evidence reported by the PBX for AI calls.
-- The Prisma model is `CallLog`; the table it maps to is `call_logs`.
-- Both columns are nullable and carry no default: a NULL means "this call
-- predates the reporting build", which must stay distinguishable from a call
-- that genuinely ended with the agent silent and no recoveries.
-- Nullable additions inherit the table's existing row-level security policies,
-- so no policy change is required.
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "agentMidUtterance" BOOLEAN;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "recoveryAttempts" INTEGER;
