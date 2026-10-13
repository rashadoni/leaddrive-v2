SET lock_timeout='3s';
-- These sources are created after the month-close migration. A single shared
-- fence covers both halves of a future roster publication until its commit.
CREATE TRIGGER mtm_month_source_fence BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_shift_plans FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_source_lock();
CREATE TRIGGER mtm_month_source_fence BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_shift_members FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_source_lock();
