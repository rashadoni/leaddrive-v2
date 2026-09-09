-- Per-user voice-control grant.
--
-- Default false, so the migration turns nothing on: existing users keep the
-- access they had via the env allowlist until an admin ticks the box. A default
-- of true would have silently granted every member of every tenant a surface
-- that reads the whole organisation aloud.
--
-- No RLS work needed: "users" already carries the tenant policy, and this is a
-- new column on an existing row, not a new table.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voiceEnabled" BOOLEAN NOT NULL DEFAULT false;
