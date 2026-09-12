-- C1: delayed but in-window attendance claims must be explicitly reviewable,
-- never silently presented as ordinary evidence. This is additive: legacy
-- events remain LEGACY_UNKNOWN and no historical fact is rewritten.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceAttendanceClaimReviewState" AS ENUM (
  'LEGACY_UNKNOWN',
  'NOT_REQUIRED',
  'PENDING_REVIEW'
);

CREATE TYPE "WorkforceAttendanceReviewCaseStatus" AS ENUM (
  'PENDING_REVIEW'
);

ALTER TABLE "mtm_agent_workday_events"
  ADD COLUMN "attendanceReviewState" "WorkforceAttendanceClaimReviewState" NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN "attendanceReviewReasonCode" VARCHAR(64);

ALTER TABLE "mtm_agent_workday_events"
  ADD CONSTRAINT "mtm_agent_workday_events_review_state_check"
  CHECK (
    ("attendanceReviewState" = 'PENDING_REVIEW' AND NULLIF(btrim("attendanceReviewReasonCode"), '') IS NOT NULL)
    OR
    ("attendanceReviewState" IN ('LEGACY_UNKNOWN', 'NOT_REQUIRED') AND "attendanceReviewReasonCode" IS NULL)
  );

CREATE INDEX "mtm_agent_workday_events_org_agent_review_receipt_idx"
  ON "mtm_agent_workday_events"("organizationId", "agentId", "attendanceReviewState", "serverReceivedAt");

CREATE TABLE "workforce_attendance_review_cases" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "workdayEventId" TEXT NOT NULL,
  "status" "WorkforceAttendanceReviewCaseStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reasonCode" VARCHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "claimAgeSeconds" INTEGER NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "serverReceivedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_attendance_review_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_review_cases_reason_check" CHECK (NULLIF(btrim("reasonCode"), '') IS NOT NULL),
  CONSTRAINT "workforce_attendance_review_cases_policy_check" CHECK (NULLIF(btrim("policyVersion"), '') IS NOT NULL),
  CONSTRAINT "workforce_attendance_review_cases_age_check" CHECK ("claimAgeSeconds" BETWEEN 0 AND 604800),
  CONSTRAINT "workforce_attendance_review_cases_time_check" CHECK ("serverReceivedAt" >= "claimedAt"),
  CONSTRAINT "workforce_attendance_review_cases_initial_state_check" CHECK ("status" = 'PENDING_REVIEW')
);

CREATE UNIQUE INDEX "workforce_attendance_review_cases_organizationId_id_key"
  ON "workforce_attendance_review_cases"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_review_cases_event_key"
  ON "workforce_attendance_review_cases"("organizationId", "workdayEventId");
CREATE INDEX "workforce_attendance_review_cases_org_agent_status_created_idx"
  ON "workforce_attendance_review_cases"("organizationId", "agentId", "status", "createdAt");
CREATE INDEX "workforce_attendance_review_cases_org_workday_idx"
  ON "workforce_attendance_review_cases"("organizationId", "workdayId");

ALTER TABLE "workforce_attendance_review_cases"
  ADD CONSTRAINT "workforce_attendance_review_cases_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_review_cases_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_review_cases_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_review_cases_event_fkey"
    FOREIGN KEY ("organizationId", "workdayEventId") REFERENCES "mtm_agent_workday_events"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A review case may be inserted only for the server-marked immutable event it
-- describes. The client cannot invent another agent/workday, lower the claim
-- age or mark its own delayed claim resolved.
CREATE OR REPLACE FUNCTION workforce_validate_attendance_review_case_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_row RECORD;
BEGIN
  SELECT * INTO event_row
  FROM "mtm_agent_workday_events"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayEventId";

  IF NOT FOUND
     OR event_row."agentId" <> NEW."agentId"
     OR event_row."workdayId" <> NEW."workdayId"
     OR event_row."attendanceReviewState" <> 'PENDING_REVIEW'::"WorkforceAttendanceClaimReviewState"
     OR event_row."attendanceReviewReasonCode" <> NEW."reasonCode"
     OR event_row."claimedAt" IS DISTINCT FROM NEW."claimedAt"
     OR event_row."serverReceivedAt" IS DISTINCT FROM NEW."serverReceivedAt"
     OR FLOOR(EXTRACT(EPOCH FROM (NEW."serverReceivedAt" - NEW."claimedAt"))) <> NEW."claimAgeSeconds" THEN
    RAISE EXCEPTION 'Workforce attendance review case must match its pending immutable event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_review_cases_validate_insert
  BEFORE INSERT ON "workforce_attendance_review_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_attendance_review_case_insert();

CREATE OR REPLACE FUNCTION workforce_reject_attendance_review_case_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce attendance review cases cannot be % before the C6 resolution lifecycle is introduced', TG_OP USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_attendance_review_cases_append_only
  BEFORE UPDATE OR DELETE ON "workforce_attendance_review_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_attendance_review_case_mutation();

ALTER TABLE "workforce_attendance_review_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_attendance_review_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_attendance_review_cases_tenant_select
  ON "workforce_attendance_review_cases" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_attendance_review_cases_tenant_insert
  ON "workforce_attendance_review_cases" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- The established application role receives only the operations the C1 model
-- needs. DELETE and UPDATE wait for a separately implemented C6 resolution
-- lifecycle and retention policy.
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', 'workforce_attendance_review_cases', app_owner);
  END IF;
END $$;
