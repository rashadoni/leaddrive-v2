-- Installation request, decision and revocation clocks are UTC regardless of
-- the caller's session zone. Production app sessions run in Europe/Berlin, so
-- clock_timestamp()::timestamp(3) and the timestamptz -> TIMESTAMP(3)
-- assignment wrote Berlin wall clock into columns that hold UTC everywhere
-- else. 20261014010000_mtm_attendance_utc_guard_clocks fixed four sibling
-- guards; this is the fifth, in the same shape.
-- Function-local settings are restored by PostgreSQL when each trigger returns.
-- Keep the existing function body, immutable checks and monotonic predecessor
-- rule unchanged. No retained timestamp is rewritten. An old future predecessor
-- can therefore keep its request chain ahead until real UTC time catches up.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER FUNCTION public.mtm_attendance_installation_guard() SET timezone = 'UTC';
COMMIT;
