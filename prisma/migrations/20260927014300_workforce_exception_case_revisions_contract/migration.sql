-- C6 case-revision phase 4/4: validate without blocking ordinary writes, then
-- use the validated helper for one short metadata-only NOT NULL contract. This
-- separately tracked transaction is atomic and safe to mark rolled back after
-- a verified timeout.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

ALTER TABLE "workforce_exception_decisions"
  VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_check";
ALTER TABLE "workforce_exception_decisions"
  VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_not_null_check";
ALTER TABLE "workforce_exception_employee_responses"
  VALIDATE CONSTRAINT "workforce_exception_employee_responses_observed_revision_check";
ALTER TABLE "mtm_hrm_requests"
  VALIDATE CONSTRAINT "mtm_hrm_requests_exception_case_revision_check";
ALTER TABLE "mtm_hrm_requests"
  VALIDATE CONSTRAINT "mtm_hrm_requests_exception_case_revision_shape_check";

ALTER TABLE "workforce_exception_decisions"
  ALTER COLUMN "caseRevision" SET NOT NULL,
  DROP CONSTRAINT "workforce_exception_decisions_case_revision_not_null_check";

-- No tenant flag is enabled and no terminal action is exposed by this phase.
-- Existing RLS, grants and append-only triggers remain unchanged.
COMMIT;
