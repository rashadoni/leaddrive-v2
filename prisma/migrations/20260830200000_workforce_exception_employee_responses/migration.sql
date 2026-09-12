-- C6: additive, immutable employee response references. The ledger stores no
-- explanation, raw attendance proof, location, QR or device data: a linked
-- time-correction request retains its established protected reason path.
-- This migration has no detector, endpoint, notification or tenant activation.

SET lock_timeout = '3s';

CREATE TABLE "workforce_exception_employee_responses" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "segmentId" TEXT,
  "correctionRequestId" TEXT,
  "responseCode" VARCHAR(64) NOT NULL,
  "clientResponseId" VARCHAR(100) NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_exception_employee_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_exception_employee_responses_client_id_check"
    CHECK (NULLIF(btrim("clientResponseId"), '') IS NOT NULL),
  CONSTRAINT "workforce_exception_employee_responses_code_check"
    CHECK ("responseCode" IN ('ACKNOWLEDGED', 'CORRECTION_REQUESTED')),
  CONSTRAINT "workforce_exception_employee_responses_request_shape_check"
    CHECK (
      ("responseCode" = 'ACKNOWLEDGED' AND "correctionRequestId" IS NULL)
      OR ("responseCode" = 'CORRECTION_REQUESTED' AND "correctionRequestId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "workforce_exception_employee_responses_organizationId_id_key"
  ON "workforce_exception_employee_responses"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_exception_employee_responses_agent_client_key"
  ON "workforce_exception_employee_responses"("organizationId", "agentId", "clientResponseId");
CREATE INDEX "workforce_exception_employee_responses_org_case_created_idx"
  ON "workforce_exception_employee_responses"("organizationId", "caseId", "createdAt");
CREATE INDEX "workforce_exception_employee_responses_org_agent_workday_created_idx"
  ON "workforce_exception_employee_responses"("organizationId", "agentId", "workdayId", "createdAt");
CREATE INDEX "workforce_exception_employee_responses_org_request_idx"
  ON "workforce_exception_employee_responses"("organizationId", "correctionRequestId");

ALTER TABLE "workforce_exception_employee_responses"
  ADD CONSTRAINT "workforce_exception_employee_responses_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_case_fkey"
    FOREIGN KEY ("organizationId", "caseId") REFERENCES "workforce_exception_cases"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_segment_fkey"
    FOREIGN KEY ("organizationId", "segmentId") REFERENCES "workforce_shift_segments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_request_fkey"
    FOREIGN KEY ("organizationId", "correctionRequestId") REFERENCES "mtm_hrm_requests"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_employee_responses_actor_fkey"
    FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A response is valid only when the signed-in employee owns the exact case
-- and its exact workday/segment. No response can turn an arbitrary employee
-- request into an appeal, or link a correction from a different day.
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
    SELECT "agentId", "type"::TEXT, "correctionWorkdayId"
    INTO request_agent_id, request_type, request_workday_id
    FROM "mtm_hrm_requests"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."correctionRequestId";
    IF NOT FOUND OR request_agent_id <> NEW."agentId"
       OR request_type <> 'TIME_CORRECTION' OR request_workday_id <> NEW."workdayId" THEN
      RAISE EXCEPTION 'Workforce correction request must belong to the employee and exact response workday' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_exception_employee_responses_validate_insert
  BEFORE INSERT ON "workforce_exception_employee_responses"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_exception_employee_response_insert();

CREATE OR REPLACE FUNCTION workforce_reject_exception_employee_response_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce employee responses are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_exception_employee_responses_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_employee_responses"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_employee_response_mutation();

ALTER TABLE "workforce_exception_employee_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_exception_employee_responses" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_exception_employee_responses_tenant_select
  ON "workforce_exception_employee_responses" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_exception_employee_responses_tenant_insert
  ON "workforce_exception_employee_responses" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- The migration adds dormant storage only. The normal application role gets
-- no UPDATE or DELETE route, and a future self-service endpoint must still
-- prove its own employee scope before inserting a response.
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', 'workforce_exception_employee_responses', app_owner);
  END IF;
END $$;
