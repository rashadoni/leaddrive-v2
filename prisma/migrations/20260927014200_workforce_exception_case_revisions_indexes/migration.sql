-- C6 case-revision phase 3/4: build lookup/uniqueness indexes online. Prisma
-- does not wrap PostgreSQL migration files in an implicit transaction. DROP
-- CONCURRENTLY makes this phase restartable after PostgreSQL leaves a
-- same-named invalid index on timeout/cancellation; the exact failure/recovery
-- path is exercised by the real-PostgreSQL migration-ledger test.

SET lock_timeout = '3s';
SET statement_timeout = '2min';

DROP INDEX CONCURRENTLY IF EXISTS "workforce_exception_decisions_org_case_revision_key";
CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"
  ON "workforce_exception_decisions"("organizationId", "caseId", "caseRevision");

DROP INDEX CONCURRENTLY IF EXISTS "workforce_exception_employee_responses_org_case_revision_idx";
CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "observedCaseRevision");

RESET statement_timeout;
RESET lock_timeout;
