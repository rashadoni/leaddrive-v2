-- C6 case-revision phase 3/5: build the uniqueness index online. This file
-- deliberately contains exactly one SQL statement: Prisma submits a
-- multi-statement PostgreSQL migration in an implicit transaction block, where
-- CONCURRENTLY is prohibited. A failed build can leave this exact index
-- invalid; verify/drop only that artifact outside a transaction, mark this
-- exact ledger row rolled back, then replay it.

CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"
  ON "workforce_exception_decisions"("organizationId", "caseId", "caseRevision");
