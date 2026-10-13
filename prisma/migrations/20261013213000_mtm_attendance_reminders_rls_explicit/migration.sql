-- The original reminder migration already enables and forces RLS. Reassert
-- that invariant with the quoted identifier used by the migration coverage
-- contract, without rewriting applied SQL or replacing the existing policies.
SET lock_timeout = '3s';
ALTER TABLE "mtm_attendance_reminder_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_reminder_notices" FORCE ROW LEVEL SECURITY;
