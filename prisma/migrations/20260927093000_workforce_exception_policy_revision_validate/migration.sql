-- C6 dormant policy-revision provenance phase 2/2: validate the tenant-bound
-- decision provenance key without adding a writer, consumer or activation.
-- PostgreSQL validates under SHARE UPDATE EXCLUSIVE, which keeps ordinary row
-- reads/writes available. Competing maintenance/DDL fails fast on lock timeout;
-- the full scan is bounded and rolls back atomically on statement timeout.
-- After a failed Prisma row, inspect pg_constraint, resolve this exact migration
-- as rolled back, then replay; VALIDATE is safe when the key is already valid.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

ALTER TABLE "workforce_exception_decisions"
  VALIDATE CONSTRAINT "workforce_exception_decisions_policy_revision_fk";

-- No data, grant, RLS policy, trigger, tenant flag or runtime surface changes.
COMMIT;
