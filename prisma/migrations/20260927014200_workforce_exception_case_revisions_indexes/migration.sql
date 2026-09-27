-- C6 case-revision phase 3/4: build the lookup/uniqueness indexes as one
-- bounded, replayable transaction. Prisma submits a multi-statement PostgreSQL
-- migration as one simple-query message, so CONCURRENTLY is not legal here.
-- The production deploy controller already requires a migration quiet window;
-- the heap-size fence prevents this non-concurrent fallback from becoming an
-- unbounded write pause if the still-fenced Workforce tables grew unexpectedly.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

DO $$
BEGIN
  IF pg_relation_size('workforce_exception_decisions'::regclass) > 67108864
     OR pg_relation_size('workforce_exception_employee_responses'::regclass) > 67108864 THEN
    RAISE EXCEPTION 'Workforce exception revision index build exceeds the reviewed 64 MiB heap limit'
      USING ERRCODE = '54000';
  END IF;
END;
$$;

-- DROP makes a retry safe if PostgreSQL committed the DDL but the Prisma
-- process died before it finalized the migration-ledger row. A later failure
-- rolls these drops and both creates back atomically.
DROP INDEX IF EXISTS "workforce_exception_decisions_org_case_revision_key";
CREATE UNIQUE INDEX "workforce_exception_decisions_org_case_revision_key"
  ON "workforce_exception_decisions"("organizationId", "caseId", "caseRevision");

DROP INDEX IF EXISTS "workforce_exception_employee_responses_org_case_revision_idx";
CREATE INDEX "workforce_exception_employee_responses_org_case_revision_idx"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "observedCaseRevision");

COMMIT;
