-- Direct manager corrections use a client operation id. Keep an immutable
-- request hash beside it so a retry can be distinguished from an operation-id
-- reuse with changed time boundaries, reason, actor, or expected version.
-- It is additive and does not touch historical Workforce facts.

SET lock_timeout = '3s';

ALTER TABLE "workforce_time_corrections"
  ADD COLUMN "requestHash" VARCHAR(64);

ALTER TABLE "workforce_time_corrections"
  ADD CONSTRAINT "workforce_time_corrections_request_hash_format"
  CHECK (
    "requestHash" IS NULL
    OR "requestHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "workforce_time_corrections"
  ADD CONSTRAINT "workforce_time_corrections_source_request_contract"
  CHECK (
    (
      "source" = 'DIRECT_MANAGER'::"WorkforceTimeCorrectionSource"
      AND "requestId" IS NULL
      AND "requestHash" IS NOT NULL
    )
    OR (
      "source" = 'REQUEST_APPROVAL'::"WorkforceTimeCorrectionSource"
      AND "requestHash" IS NULL
    )
  );

-- A correction which finishes an actively-paused workday must also pin the
-- derived closed-pause total. Replace only the guard function in this later
-- migration; the trigger remains in place and every other workday field stays
-- immutable outside the transaction-local correction ledger fact.
CREATE OR REPLACE FUNCTION workforce_guard_completed_workday()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  correction_id TEXT := current_setting('app.workforce_correction_id', true);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce workday facts cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'COMPLETED' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."workDate" IS DISTINCT FROM OLD."workDate" THEN
      RAISE EXCEPTION 'Workforce workday identity is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" <> 'COMPLETED'
     OR NEW."pausedAt" IS NOT NULL
     OR NEW."completedAt" IS NULL
     OR NEW."completedAt" <= NEW."startedAt" THEN
    RAISE EXCEPTION 'Completed Workforce workday cannot reopen or become invalid' USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds', 'updatedAt'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds', 'updatedAt']) THEN
    RAISE EXCEPTION 'Completed Workforce workday facts are immutable outside an audited time correction' USING ERRCODE = '55000';
  END IF;

  IF correction_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM "workforce_time_corrections" correction_row
    WHERE correction_row."id" = correction_id
      AND correction_row."organizationId" = OLD."organizationId"
      AND correction_row."workdayId" = OLD."id"
      AND correction_row."agentId" = OLD."agentId"
      AND workforce_workday_fact_matches(correction_row."beforeFacts", OLD)
      AND workforce_workday_fact_matches(correction_row."afterFacts", NEW)
  ) THEN
    RAISE EXCEPTION 'Completed Workforce workday update requires its current transaction correction ledger fact' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
