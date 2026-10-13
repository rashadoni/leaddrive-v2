-- Employee-proposed corrections stay in the existing immutable correction ledger.
-- A genuinely missing workday has an explicit genesis, never fabricated phone events.
SET lock_timeout = '3s';
ALTER TABLE "mtm_hrm_requests" DROP CONSTRAINT "mtm_attendance_request_details_check";
ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_attendance_request_details_check" CHECK (
  "attendanceDetails" IS NULL OR (
    jsonb_typeof("attendanceDetails") = 'object'
    AND "attendanceDetails"->>'version' = '1'
    AND "attendanceDetails"->>'unit' IN ('DAYS', 'HOURS')
    AND "attendanceDetails"->>'kind' IN ('ANNUAL_LEAVE', 'SICK_LEAVE', 'TIME_OFF', 'HOURLY_ABSENCE', 'BUSINESS_TRIP', 'REMOTE_WORK', 'OVERTIME', 'TIME_CORRECTION')
    AND "attendanceDetails"->>'submissionHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("attendanceDetails"->'attachmentIds') = 'array'
    AND jsonb_array_length("attendanceDetails"->'attachmentIds') <= 3
    AND (("type" = 'TIME_CORRECTION') = ("attendanceDetails"->>'kind' = 'TIME_CORRECTION'))
    AND ("type" <> 'TIME_CORRECTION' OR (
      "startDate" = "endDate" AND "requestedStartAt" IS NOT NULL AND "requestedEndAt" > "requestedStartAt"
      AND "attendanceDetails"->>'unit' = 'HOURS'
      AND "attendanceDetails"->'correctionBasis'->>'kind' IN ('MISSING', 'WORKDAY')
    ))
  ) IS TRUE
);
ALTER TABLE "mtm_hrm_requests" DROP CONSTRAINT IF EXISTS "mtm_hrm_requests_correction_check";
ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_hrm_requests_correction_check" CHECK (
  "type" <> 'TIME_CORRECTION' OR (
    ("requestedStartAt" IS NOT NULL OR "requestedEndAt" IS NOT NULL)
    AND ("correctionWorkdayId" IS NOT NULL OR (
      "attendanceDetails"->>'kind' = 'TIME_CORRECTION'
      AND "attendanceDetails"->'correctionBasis'->>'kind' = 'MISSING'
      AND "attendanceDetails"->'correctionBasis'->>'workDate' = "startDate"::text
      AND "requestedStartAt" IS NOT NULL AND "requestedEndAt" IS NOT NULL
      AND "status" IN ('PENDING', 'REJECTED', 'CANCELLED')
    ) IS TRUE)
  )
);

CREATE OR REPLACE FUNCTION "mtm_attendance_request_submission_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."attendanceDetails" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MTM attendance requests must be cancelled, not deleted'; END IF;
    IF (NEW."organizationId", NEW."agentId", NEW."clientRequestId", NEW."type", NEW."startDate", NEW."endDate", NEW."reason", NEW."attendanceDetails", NEW."submittedAt", NEW."requestedStartAt", NEW."requestedEndAt")
       IS DISTINCT FROM
       (OLD."organizationId", OLD."agentId", OLD."clientRequestId", OLD."type", OLD."startDate", OLD."endDate", OLD."reason", OLD."attendanceDetails", OLD."submittedAt", OLD."requestedStartAt", OLD."requestedEndAt") THEN
      RAISE EXCEPTION 'MTM attendance request submission is immutable';
    END IF;
    IF NEW."correctionWorkdayId" IS DISTINCT FROM OLD."correctionWorkdayId" AND (
      OLD."type" = 'TIME_CORRECTION' AND OLD."status" = 'PENDING' AND NEW."status" = 'APPROVED'
      AND OLD."correctionWorkdayId" IS NULL AND NEW."correctionWorkdayId" IS NOT NULL
      AND OLD."attendanceDetails"->'correctionBasis'->>'kind' = 'MISSING'
    ) IS NOT TRUE THEN RAISE EXCEPTION 'MTM attendance correction target is immutable'; END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW."attendanceDetails" IS NOT NULL THEN
    RAISE EXCEPTION 'Retained Workforce requests cannot be relabelled as MTM attendance';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "mtm_attendance_genesis_ledger_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_row "mtm_hrm_requests"%ROWTYPE;
  workday_row "mtm_agent_workdays"%ROWTYPE;
BEGIN
  IF NEW."beforeFacts"->>'kind' IS DISTINCT FROM 'MISSING' THEN RETURN NEW; END IF;
  SELECT * INTO request_row FROM "mtm_hrm_requests" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."requestId";
  SELECT * INTO workday_row FROM "mtm_agent_workdays" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF request_row."id" IS NULL OR workday_row."id" IS NULL
    OR NEW."source" <> 'REQUEST_APPROVAL'
    OR request_row."type" <> 'TIME_CORRECTION' OR request_row."status" <> 'APPROVED'
    OR request_row."attendanceDetails"->>'kind' IS DISTINCT FROM 'TIME_CORRECTION'
    OR request_row."attendanceDetails"->'correctionBasis' IS DISTINCT FROM NEW."beforeFacts"
    OR NEW."beforeFacts" IS DISTINCT FROM jsonb_build_object('kind', 'MISSING', 'workDate', request_row."startDate"::text)
    OR request_row."correctionWorkdayId" IS DISTINCT FROM NEW."workdayId"
    OR request_row."agentId" <> NEW."agentId" OR workday_row."agentId" <> NEW."agentId"
    OR request_row."decidedByUserId" IS DISTINCT FROM NEW."actorUserId"
    OR request_row."decidedAt" IS DISTINCT FROM NEW."occurredAt"
    OR workday_row."workDate" <> request_row."startDate" OR request_row."endDate" <> request_row."startDate"
    OR workday_row."status" <> 'COMPLETED' OR workday_row."pausedAt" IS NOT NULL OR workday_row."totalPausedSeconds" <> 0
    OR workday_row."startedAt" IS DISTINCT FROM request_row."requestedStartAt"
    OR workday_row."completedAt" IS DISTINCT FROM request_row."requestedEndAt"
    OR workforce_workday_fact_matches(NEW."afterFacts", workday_row) IS DISTINCT FROM TRUE
    -- This proves the matching version was written in this transaction. The
    -- engine proves prior absence under the shared employee workday lock.
    OR NOT EXISTS (SELECT 1 FROM "mtm_agent_workdays" w WHERE w."id" = NEW."workdayId" AND w.xmin = pg_current_xact_id()::text::xid)
    OR EXISTS (SELECT 1 FROM "mtm_agent_workday_events" e WHERE e."organizationId" = NEW."organizationId" AND e."workdayId" = NEW."workdayId")
    OR EXISTS (SELECT 1 FROM "mtm_agents" a WHERE a."organizationId" = NEW."organizationId" AND a."id" = NEW."agentId" AND a."userId" = NEW."actorUserId")
  THEN RAISE EXCEPTION 'MTM missing-day genesis requires its approved employee proposal and new eventless workday' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "mtm_attendance_genesis_ledger_guard" BEFORE INSERT ON "workforce_time_corrections"
  FOR EACH ROW EXECUTE FUNCTION "mtm_attendance_genesis_ledger_guard"();

-- The request may bind its newly created day only if the matching immutable
-- ledger fact commits in the SAME transaction. A partial write rolls back.
CREATE FUNCTION "mtm_attendance_genesis_commit_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."attendanceDetails"->>'kind' = 'TIME_CORRECTION'
    AND NEW."attendanceDetails"->'correctionBasis'->>'kind' = 'MISSING' AND NEW."status" = 'APPROVED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "workforce_time_corrections" c
      JOIN "mtm_agent_workdays" w ON w."organizationId" = c."organizationId" AND w."id" = c."workdayId"
      WHERE c."organizationId" = NEW."organizationId" AND c."requestId" = NEW."id"
        AND c."workdayId" = NEW."correctionWorkdayId" AND c."agentId" = NEW."agentId"
        AND c."source" = 'REQUEST_APPROVAL' AND c."actorUserId" = NEW."decidedByUserId"
        AND c."beforeFacts" = NEW."attendanceDetails"->'correctionBasis'
        AND c.xmin = pg_current_xact_id()::text::xid AND workforce_workday_fact_matches(c."afterFacts", w)
    ) THEN RAISE EXCEPTION 'MTM missing-day approval requires its current transaction genesis ledger' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "mtm_attendance_genesis_commit_guard" AFTER INSERT OR UPDATE ON "mtm_hrm_requests"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mtm_attendance_genesis_commit_guard"();
