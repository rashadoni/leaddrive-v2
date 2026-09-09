ALTER TABLE "monitoring_subjects"
  DROP CONSTRAINT IF EXISTS "monitoring_subjects_status_check";

ALTER TABLE "monitoring_subjects"
  ADD CONSTRAINT "monitoring_subjects_status_check"
  CHECK ("status" IN ('active', 'paused', 'archived', 'deleted'));
