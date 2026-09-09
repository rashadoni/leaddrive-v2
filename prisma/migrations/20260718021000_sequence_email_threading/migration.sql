-- E1 (Creatio 10X roadmap): sequence email threading.
-- Expand-only: nullable/defaulted columns, no backfill, no RLS interaction.
SET lock_timeout = '3s';
ALTER TABLE "sequence_steps" ADD COLUMN "threadMode" TEXT NOT NULL DEFAULT 'continue';
ALTER TABLE "sequence_enrollments" ADD COLUMN "threading" JSONB;
ALTER TABLE "email_logs" ADD COLUMN "inReplyTo" TEXT;
