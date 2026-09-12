-- C6: additive source link from a new employee TIME_CORRECTION request to
-- the exact employee-owned exception case that opened it. Existing requests
-- remain valid with a NULL link; this migration neither backfills nor changes
-- an attendance fact, decision, pay result or exception lifecycle.

SET lock_timeout = '3s';

ALTER TABLE "mtm_hrm_requests"
  ADD COLUMN "exceptionCaseId" TEXT;

CREATE INDEX "mtm_hrm_requests_organizationId_exceptionCaseId_idx"
  ON "mtm_hrm_requests"("organizationId", "exceptionCaseId");

ALTER TABLE "mtm_hrm_requests"
  ADD CONSTRAINT "mtm_hrm_requests_exception_case_fkey"
    FOREIGN KEY ("organizationId", "exceptionCaseId")
    REFERENCES "workforce_exception_cases"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A case link is optional, but if present it is a write-once attribution for
-- one exact employee correction and one exact workday. The check is at the
-- database boundary so a future mobile or admin adapter cannot bypass the
-- self-service server check by writing the request table directly.
CREATE OR REPLACE FUNCTION workforce_validate_hrm_request_exception_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_agent_id TEXT;
  case_workday_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."exceptionCaseId" IS DISTINCT FROM NEW."exceptionCaseId" THEN
    RAISE EXCEPTION 'Workforce correction exception link is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW."exceptionCaseId" IS NULL THEN
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_hrm_requests_validate_exception_link
  BEFORE INSERT OR UPDATE ON "mtm_hrm_requests"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_hrm_request_exception_link();

-- This modifies only the existing table's nullable metadata and trigger; it
-- does not create a new table or privilege path. Existing RLS and grants on
-- mtm_hrm_requests remain the authority for this dormant additive field.
