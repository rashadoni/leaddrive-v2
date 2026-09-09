-- E4/E5 (Creatio 10X roadmap): tag cadence emails so the daily-send limit can
-- count them and step stats can aggregate delivery/replies.
-- Expand-only. ADD COLUMN is instant (nullable, no table rewrite on PG11+).
-- The index build briefly locks email_logs against writes for its duration —
-- CONCURRENTLY is unavailable inside Prisma's migration transaction, matching
-- the repo's plain-CREATE-INDEX convention; lock_timeout fails fast rather
-- than stalling a deploy if the table is busy. Deploys run in a low-traffic
-- window, so the brief write-block on outbound email is acceptable.
SET lock_timeout = '3s';
ALTER TABLE "email_logs" ADD COLUMN "sequenceId" TEXT;
CREATE INDEX "email_logs_organizationId_sequenceId_createdAt_idx" ON "email_logs" ("organizationId", "sequenceId", "createdAt");
