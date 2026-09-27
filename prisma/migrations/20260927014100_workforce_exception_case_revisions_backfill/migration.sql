-- C6 case-revision phase 2/5: atomically backfill only the new decision
-- column. This phase is separately tracked by Prisma; a timeout rolls back the
-- data and both function definitions, so `migrate resolve --rolled-back` can
-- safely retry it after catalog verification.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';
SELECT set_config('app.rls_bypass', 'on', true);
SELECT set_config('app.workforce_exception_revision_backfill', 'on', true);

-- The append-only trigger is never disabled. This replacement exists only
-- inside the backfill transaction and admits exactly NULL -> positive revision
-- for a relation-owner member without changing any other column. Other
-- sessions continue to see the previously committed unconditional guard.
CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relation_owner OID;
BEGIN
  SELECT relowner INTO relation_owner FROM pg_class WHERE oid = TG_RELID;
  IF TG_OP = 'UPDATE'
     AND current_setting('app.workforce_exception_revision_backfill', true) = 'on'
     AND pg_has_role(session_user, relation_owner, 'MEMBER')
     AND OLD."caseRevision" IS NULL
     AND NEW."caseRevision" > 0
     AND (to_jsonb(NEW) - 'caseRevision') = (to_jsonb(OLD) - 'caseRevision') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Workforce exception decisions are append-only' USING ERRCODE = '55000';
END;
$$;

WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "organizationId", "caseId"
           ORDER BY "createdAt" ASC, "id" ASC
         )::INTEGER AS revision
    FROM "workforce_exception_decisions"
   WHERE "caseRevision" IS NULL
)
UPDATE "workforce_exception_decisions" decisions
   SET "caseRevision" = ranked.revision
  FROM ranked
 WHERE decisions."id" = ranked."id"
   AND decisions."caseRevision" IS NULL;

CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce exception decisions are append-only' USING ERRCODE = '55000';
END;
$$;

COMMIT;
