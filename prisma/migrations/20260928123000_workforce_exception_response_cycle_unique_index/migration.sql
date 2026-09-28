-- C6 employee-response cycle safety: enforce at most one non-legacy response
-- for an exact tenant/case/revision without blocking normal reads or writes.
-- Keep this file to exactly one executable statement: Prisma must submit
-- CREATE INDEX CONCURRENTLY outside a transaction block. PostgreSQL's default
-- NULLS DISTINCT semantics deliberately preserve multiple pre-cutover rows
-- whose observed revision is unknown.

CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_key"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "observedCaseRevision");
