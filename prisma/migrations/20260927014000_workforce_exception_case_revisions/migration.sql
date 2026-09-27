-- C6: replace cross-table timestamp ordering with one case-local logical
-- revision allocated under the canonical exception advisory lock. Decision
-- revisions are backfilled in the exact deterministic order used before this
-- cutover. Existing linked signals remain NULL rather than guessing whether
-- they happened before or after a request/reopen cycle.
--
-- This separately tracked expansion is atomic and metadata-only. Later
-- migrations backfill, build online indexes and contract the column. The old
-- application binary remains writable because compatibility triggers allocate
-- omitted revisions and preserve its timestamp-based lifecycle order.
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

-- The deployed pre-cutover reader still compares these three timestamp
-- columns. During the non-overlap handoff it remains live while migrations run,
-- and a rollback may restart it afterward. Give every post-expansion lifecycle
-- event a strictly increasing millisecond floor while the canonical case lock
-- is held, so old timestamp readers and new revision readers observe the same
-- causal order. Client time is retained only when it is later than that floor;
-- the next event advances past it.
CREATE OR REPLACE FUNCTION workforce_next_exception_compatibility_timestamp(
  input_organization_id TEXT,
  input_case_id TEXT
)
RETURNS TIMESTAMP(3)
LANGUAGE sql
VOLATILE
AS $$
  SELECT GREATEST(
    clock_timestamp()::TIMESTAMP(3),
    COALESCE(
      MAX(lifecycle_event."eventAt") + INTERVAL '1 millisecond',
      clock_timestamp()::TIMESTAMP(3)
    )
  )
  FROM (
    SELECT "createdAt" AS "eventAt"
      FROM "workforce_exception_decisions"
     WHERE "organizationId" = input_organization_id AND "caseId" = input_case_id
    UNION ALL
    SELECT "createdAt" AS "eventAt"
      FROM "workforce_exception_employee_responses"
     WHERE "organizationId" = input_organization_id AND "caseId" = input_case_id
    UNION ALL
    SELECT "submittedAt" AS "eventAt"
      FROM "mtm_hrm_requests"
     WHERE "organizationId" = input_organization_id AND "exceptionCaseId" = input_case_id
  ) lifecycle_event;
$$;

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
  NEW."createdAt" := GREATEST(
    NEW."createdAt",
    workforce_next_exception_compatibility_timestamp(NEW."organizationId", NEW."caseId")
  );
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

  PERFORM pg_advisory_xact_lock(hashtext(
    'workforce-exception-decision:' || NEW."organizationId" || ':' || NEW."caseId"
  ));
  -- COUNT is the logical current revision both before and after backfill. During
  -- the expand/backfill overlap, legacy decisions are still NULL while an old
  -- binary can emit a new signal; MAX would incorrectly bind that signal to 0.
  SELECT COUNT(*)::INTEGER
    INTO current_case_revision
    FROM "workforce_exception_decisions"
   WHERE "organizationId" = NEW."organizationId"
     AND "caseId" = NEW."caseId";
  IF NEW."observedCaseRevision" IS NULL THEN
    NEW."observedCaseRevision" := current_case_revision;
  ELSIF NEW."observedCaseRevision" <> current_case_revision THEN
    RAISE EXCEPTION 'Workforce employee response observed a stale case revision' USING ERRCODE = '23514';
  END IF;
  NEW."createdAt" := GREATEST(
    NEW."createdAt",
    workforce_next_exception_compatibility_timestamp(NEW."organizationId", NEW."caseId")
  );
  RETURN NEW;
END;
$$;

-- Preserve the immutable correction source link. A draining old binary omits
-- the new revision, so the trigger fills it for every newly inserted linked
-- request. NULL remains only for unlinked or pre-expansion legacy rows.
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

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext(
      'workforce-exception-decision:' || NEW."organizationId" || ':' || NEW."exceptionCaseId"
    ));
    -- COUNT also covers the short rolling window before legacy decisions have
    -- received their positive revisions in the separately tracked backfill.
    SELECT COUNT(*)::INTEGER
      INTO current_case_revision
      FROM "workforce_exception_decisions"
     WHERE "organizationId" = NEW."organizationId"
       AND "caseId" = NEW."exceptionCaseId";
    IF NEW."exceptionCaseRevision" IS NULL THEN
      NEW."exceptionCaseRevision" := current_case_revision;
    ELSIF NEW."exceptionCaseRevision" <> current_case_revision THEN
      RAISE EXCEPTION 'Workforce correction request observed a stale case revision' USING ERRCODE = '23514';
    END IF;
    NEW."submittedAt" := GREATEST(
      NEW."submittedAt",
      workforce_next_exception_compatibility_timestamp(
        NEW."organizationId",
        NEW."exceptionCaseId"
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
