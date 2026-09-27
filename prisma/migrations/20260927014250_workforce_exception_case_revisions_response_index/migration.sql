-- C6 case-revision phase 4/5: build the response lookup index online. Keep
-- this as exactly one SQL statement for the same Prisma/PostgreSQL execution
-- boundary as the preceding unique index migration.

CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "observedCaseRevision");
