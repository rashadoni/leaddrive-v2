-- Explicit overnight MTM corrections retain the original workDate and immutable ledger.
SET lock_timeout = '3s';
ALTER TABLE "mtm_hrm_requests" DROP CONSTRAINT "mtm_attendance_request_details_check";
ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_attendance_request_details_check" CHECK (
  "attendanceDetails" IS NULL OR (
    jsonb_typeof("attendanceDetails") = 'object'
    AND "attendanceDetails"->>'version' = '1'
    AND "attendanceDetails"->>'unit' IN ('DAYS', 'HOURS')
    AND "attendanceDetails"->>'kind' IN ('ANNUAL_LEAVE', 'SICK_LEAVE', 'TIME_OFF', 'HOURLY_ABSENCE', 'BUSINESS_TRIP', 'REMOTE_WORK', 'OVERTIME', 'TIME_CORRECTION', 'HR_RECORD')
    AND "attendanceDetails"->>'submissionHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("attendanceDetails"->'attachmentIds') = 'array'
    AND jsonb_array_length("attendanceDetails"->'attachmentIds') <= 3
    AND (("attendanceDetails"->>'kind' = 'HR_RECORD') = ("attendanceDetails" ? 'recording'))
    AND ("attendanceDetails"->>'kind' <> 'HR_RECORD' OR (
      jsonb_typeof("attendanceDetails"->'recording') = 'object'
      AND length("attendanceDetails"->'recording'->>'userId') > 0
      AND "attendanceDetails"->'recording'->>'operationId' = "clientRequestId"
      AND "decidedByUserId" = "attendanceDetails"->'recording'->>'userId'
      AND "decidedAt" IS NOT NULL AND "status" IN ('APPROVED', 'CANCELLED')
      AND jsonb_array_length("attendanceDetails"->'attachmentIds') = 0
    ))
    AND (("type" = 'TIME_CORRECTION') = ("attendanceDetails"->>'kind' = 'TIME_CORRECTION'))
    AND ("type" <> 'TIME_CORRECTION' OR (
      ("startDate" = "endDate" OR (
        "endDate" = "startDate" + 1
        AND "attendanceDetails"->>'endTime' <= "attendanceDetails"->>'startTime'
        AND "requestedEndAt" - "requestedStartAt" <= INTERVAL '24 hours'
      ))
      AND "requestedStartAt" IS NOT NULL AND "requestedEndAt" > "requestedStartAt"
      AND "attendanceDetails"->>'unit' = 'HOURS'
      AND "attendanceDetails"->'correctionBasis'->>'kind' IN ('MISSING', 'WORKDAY')
    ))
  ) IS TRUE
);

CREATE OR REPLACE FUNCTION "mtm_attendance_genesis_ledger_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR workday_row."workDate" <> request_row."startDate" OR request_row."endDate" NOT IN (request_row."startDate", request_row."startDate" + 1)
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
