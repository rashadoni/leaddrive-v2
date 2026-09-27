-- C6: replace cross-table timestamp ordering with one case-local logical
-- revision allocated under the canonical exception advisory lock. Decision
-- revisions are backfilled in the exact deterministic order used before this
-- cutover. Existing linked signals remain NULL rather than guessing whether
-- they happened before or after a request/reopen cycle.
--
-- This is an expand/backfill/index/validate/contract migration. Long scans and
-- index builds never run while an ACCESS EXCLUSIVE table lock is held. Every
-- phase has a bounded timeout, and the old application binary remains writable
-- between phases because the insert compatibility trigger accepts an omitted
-- revision.
--
-- Rollback: once a decision or linked signal carries a revision, a code revert
-- must retain these columns, triggers and indexes. Dropping them would make a
-- later terminal lifecycle trust client or transaction-start timestamps.

-- Phase 1: metadata-only expansion and rolling-deploy compatibility. The DDL
-- locks are bounded and released before any data scan begins.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "workforce_exception_decisions"
  ADD COLUMN "caseRevision" INTEGER,
  ADD CONSTRAINT "workforce_exception_decisions_case_revision_check"
    CHECK ("caseRevision" > 0) NOT VALID,
  ADD CONSTRAINT "workforce_exception_decisions_case_revision_not_null_check"
    CHECK ("caseRevision" IS NOT NULL) NOT VALID;

ALTER TABLE "workforce_exception_employee_responses"
  ADD COLUMN "observedCaseRevision" INTEGER,
  ADD CONSTRAINT "workforce_exception_employee_responses_observed_revision_check"
    CHECK ("observedCaseRevision" IS NULL OR "observedCaseRevision" >= 0) NOT VALID;

ALTER TABLE "mtm_hrm_requests"
  ADD COLUMN "exceptionCaseRevision" INTEGER,
  ADD CONSTRAINT "mtm_hrm_requests_exception_case_revision_check"
    CHECK ("exceptionCaseRevision" IS NULL OR "exceptionCaseRevision" >= 0) NOT VALID,
  ADD CONSTRAINT "mtm_hrm_requests_exception_case_revision_shape_check"
    CHECK ("exceptionCaseRevision" IS NULL OR "exceptionCaseId" IS NOT NULL) NOT VALID;

-- A draining pre-cutover binary does not send caseRevision. COUNT includes the
-- still-NULL legacy rows, so it allocates after them before and during the
-- backfill. New code sends that exact expected value. The advisory lock makes
-- the count a serial per-case allocation point for both binaries.
CREATE OR REPLACE FUNCTION workforce_assign_exception_decision_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_revision INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(
    'workforce-exception-decision:' || NEW."organizationId" || ':' || NEW."caseId"
  ));

  SELECT (COUNT(*) + 1)::INTEGER
    INTO expected_revision
    FROM "workforce_exception_decisions"
   WHERE "organizationId" = NEW."organizationId"
     AND "caseId" = NEW."caseId";

  IF NEW."caseRevision" IS NULL THEN
    NEW."caseRevision" := expected_revision;
  ELSIF NEW."caseRevision" <> expected_revision THEN
    RAISE EXCEPTION 'Workforce exception decision case revision is stale'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_exception_decisions_assign_case_revision
  BEFORE INSERT ON "workforce_exception_decisions"
  FOR EACH ROW EXECUTE FUNCTION workforce_assign_exception_decision_revision();

-- Preserve all earlier case/employee/workday constraints and additionally
-- prove that a non-legacy response observed the current locked case revision.
CREATE OR REPLACE FUNCTION workforce_validate_exception_employee_response_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_agent_id TEXT;
  case_workday_id TEXT;
  case_segment_id TEXT;
  linked_user_id TEXT;
  request_agent_id TEXT;
  request_type TEXT;
  request_workday_id TEXT;
  request_exception_case_id TEXT;
  current_case_revision INTEGER;
BEGIN
  SELECT "agentId", "workdayId", "segmentId"
  INTO case_agent_id, case_workday_id, case_segment_id
  FROM "workforce_exception_cases"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."caseId";
  IF NOT FOUND OR case_agent_id <> NEW."agentId" OR case_workday_id IS NULL
     OR case_workday_id <> NEW."workdayId" OR case_segment_id IS DISTINCT FROM NEW."segmentId" THEN
    RAISE EXCEPTION 'Workforce employee response must match its employee case, exact workday and segment' USING ERRCODE = '23514';
  END IF;

  SELECT "userId" INTO linked_user_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NOT FOUND OR linked_user_id IS NULL OR linked_user_id <> NEW."actorUserId" THEN
    RAISE EXCEPTION 'Workforce employee response actor must be the linked employee user' USING ERRCODE = '23514';
  END IF;

  IF NEW."correctionRequestId" IS NOT NULL THEN
    SELECT "agentId", "type"::TEXT, "correctionWorkdayId", "exceptionCaseId"
    INTO request_agent_id, request_type, request_workday_id, request_exception_case_id
    FROM "mtm_hrm_requests"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."correctionRequestId";
    IF NOT FOUND OR request_agent_id <> NEW."agentId"
       OR request_type <> 'TIME_CORRECTION' OR request_workday_id <> NEW."workdayId"
       OR request_exception_case_id IS DISTINCT FROM NEW."caseId" THEN
      RAISE EXCEPTION 'Workforce correction request must belong to the exact employee case and response workday' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."observedCaseRevision" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(
      'workforce-exception-decision:' || NEW."organizationId" || ':' || NEW."caseId"
    ));
    SELECT COALESCE(MAX("caseRevision"), 0)
      INTO current_case_revision
      FROM "workforce_exception_decisions"
     WHERE "organizationId" = NEW."organizationId"
       AND "caseId" = NEW."caseId";
    IF NEW."observedCaseRevision" <> current_case_revision THEN
      RAISE EXCEPTION 'Workforce employee response observed a stale case revision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the immutable correction source link and bind only new, explicitly
-- revisioned rows to the case stream. NULL remains valid for old application
-- writes during the deploy and for legacy rows; terminal logic must treat it
-- as unknown rather than inferring order from submittedAt/createdAt.
CREATE OR REPLACE FUNCTION workforce_validate_hrm_request_exception_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_agent_id TEXT;
  case_workday_id TEXT;
  current_case_revision INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."exceptionCaseId" IS DISTINCT FROM NEW."exceptionCaseId" THEN
    RAISE EXCEPTION 'Workforce correction exception link is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."exceptionCaseRevision" IS DISTINCT FROM NEW."exceptionCaseRevision" THEN
    RAISE EXCEPTION 'Workforce correction exception case revision is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW."exceptionCaseId" IS NULL THEN
    IF NEW."exceptionCaseRevision" IS NOT NULL THEN
      RAISE EXCEPTION 'Workforce exception case revision requires a linked case' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."type"::TEXT <> 'TIME_CORRECTION' OR NEW."correctionWorkdayId" IS NULL THEN
    RAISE EXCEPTION 'Workforce exception link requires a time correction and exact workday' USING ERRCODE = '23514';
  END IF;

  SELECT "agentId", "workdayId"
  INTO case_agent_id, case_workday_id
  FROM "workforce_exception_cases"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."exceptionCaseId";

  IF NOT FOUND OR case_agent_id <> NEW."agentId"
     OR case_workday_id IS NULL OR case_workday_id <> NEW."correctionWorkdayId" THEN
    RAISE EXCEPTION 'Workforce exception link must match the employee and exact correction workday' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."exceptionCaseRevision" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(
      'workforce-exception-decision:' || NEW."organizationId" || ':' || NEW."exceptionCaseId"
    ));
    SELECT COALESCE(MAX("caseRevision"), 0)
      INTO current_case_revision
      FROM "workforce_exception_decisions"
     WHERE "organizationId" = NEW."organizationId"
       AND "caseId" = NEW."exceptionCaseId";
    IF NEW."exceptionCaseRevision" <> current_case_revision THEN
      RAISE EXCEPTION 'Workforce correction request observed a stale case revision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- Phase 2: update only the new column while ordinary reads/inserts continue.
-- The append-only trigger is never disabled. Its temporary implementation
-- admits exactly NULL -> positive revision, only for an owning-role member
-- that opted into this transaction-local backfill; every other UPDATE/DELETE
-- remains rejected. A failure rolls this function replacement back as well.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';
SELECT set_config('app.rls_bypass', 'on', true);
SELECT set_config('app.workforce_exception_revision_backfill', 'on', true);

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

-- Phase 3: online indexes. Prisma's PostgreSQL migration runner does not wrap
-- a migration in an implicit transaction, so these statements are deliberately
-- outside every explicit transaction.
SET lock_timeout = '3s';
SET statement_timeout = '2min';

CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"
  ON "workforce_exception_decisions"("organizationId", "caseId", "caseRevision");

CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "observedCaseRevision");

RESET statement_timeout;
RESET lock_timeout;

-- Phase 4: scans use VALIDATE CONSTRAINT without blocking ordinary writes.
-- The validated helper lets SET NOT NULL become a short metadata operation;
-- only that final bounded transaction needs ACCESS EXCLUSIVE briefly.
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

-- No tenant flag is enabled and no terminal action is exposed by this
-- migration. Existing RLS, grants and append-only triggers remain unchanged.
COMMIT;
