-- Future attendance clocks are UTC regardless of the caller's session zone.
-- Function-local settings are restored by PostgreSQL when each trigger returns.
-- Keep the existing function bodies, immutable checks and monotonic predecessor
-- rule unchanged. No retained timestamp is rewritten. An old future predecessor
-- can therefore keep its chain ahead until real UTC time catches up.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER FUNCTION public.mtm_attendance_location_history_guard() SET timezone = 'UTC';
ALTER FUNCTION public.mtm_attendance_branch_history_guard() SET timezone = 'UTC';
ALTER FUNCTION public.mtm_attendance_risk_guard() SET timezone = 'UTC';
ALTER FUNCTION public.mtm_attendance_qr_guard() SET timezone = 'UTC';
COMMIT;
