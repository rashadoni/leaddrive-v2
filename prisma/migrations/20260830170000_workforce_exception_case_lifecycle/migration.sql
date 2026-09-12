-- C6: additive, immutable exception-case and decision ledgers. These tables
-- are intentionally inactive until tenant taxonomy/ownership/SLA and the
-- reviewed writer/employee experience exist. They do not alter legacy
-- calculated exceptions or manufacture attendance facts.

SET lock_timeout = '3s';

CREATE TABLE "workforce_exception_cases" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "detectorVersion" VARCHAR(64) NOT NULL,
  "deduplicationKey" VARCHAR(64) NOT NULL,
  "workdayId" TEXT,
  "workdayEventId" TEXT,
  "evidenceId" TEXT,
  "segmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_exception_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_exception_cases_kind_check"
    CHECK (NULLIF(btrim("kind"), '') IS NOT NULL),
  CONSTRAINT "workforce_exception_cases_detector_version_check"
    CHECK (NULLIF(btrim("detectorVersion"), '') IS NOT NULL),
  CONSTRAINT "workforce_exception_cases_deduplication_key_check"
    CHECK ("deduplicationKey" ~ '^[0-9a-f]{64}$'),
  -- Evidence can enrich a case, but it cannot be its sole subject because an
  -- evidence row alone does not expose the employee/workday safely.
  CONSTRAINT "workforce_exception_cases_subject_check"
    CHECK ("workdayId" IS NOT NULL OR "workdayEventId" IS NOT NULL OR "segmentId" IS NOT NULL)
);

CREATE TABLE "workforce_exception_decisions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "decisionCode" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_exception_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_exception_decisions_operation_id_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL),
  CONSTRAINT "workforce_exception_decisions_code_check"
    CHECK (NULLIF(btrim("decisionCode"), '') IS NOT NULL),
  CONSTRAINT "workforce_exception_decisions_reason_check"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_exception_cases_organizationId_id_key"
  ON "workforce_exception_cases"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_exception_cases_deduplication_key"
  ON "workforce_exception_cases"("organizationId", "deduplicationKey");
CREATE INDEX "workforce_exception_cases_org_agent_created_idx"
  ON "workforce_exception_cases"("organizationId", "agentId", "createdAt");
CREATE INDEX "workforce_exception_cases_org_workday_created_idx"
  ON "workforce_exception_cases"("organizationId", "workdayId", "createdAt");
CREATE INDEX "workforce_exception_cases_org_event_idx"
  ON "workforce_exception_cases"("organizationId", "workdayEventId");
CREATE INDEX "workforce_exception_cases_org_evidence_idx"
  ON "workforce_exception_cases"("organizationId", "evidenceId");
CREATE INDEX "workforce_exception_cases_org_segment_idx"
  ON "workforce_exception_cases"("organizationId", "segmentId");

CREATE UNIQUE INDEX "workforce_exception_decisions_organizationId_id_key"
  ON "workforce_exception_decisions"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_exception_decisions_operation_key"
  ON "workforce_exception_decisions"("organizationId", "operationId");
CREATE INDEX "workforce_exception_decisions_org_case_created_idx"
  ON "workforce_exception_decisions"("organizationId", "caseId", "createdAt");
CREATE INDEX "workforce_exception_decisions_org_actor_created_idx"
  ON "workforce_exception_decisions"("organizationId", "actorUserId", "createdAt");

ALTER TABLE "workforce_exception_cases"
  ADD CONSTRAINT "workforce_exception_cases_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_cases_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_cases_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_cases_event_fkey"
    FOREIGN KEY ("organizationId", "workdayEventId") REFERENCES "mtm_agent_workday_events"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_cases_evidence_fkey"
    FOREIGN KEY ("organizationId", "evidenceId") REFERENCES "workforce_attendance_evidence"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_cases_segment_fkey"
    FOREIGN KEY ("organizationId", "segmentId") REFERENCES "workforce_shift_segments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_exception_decisions"
  ADD CONSTRAINT "workforce_exception_decisions_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_decisions_case_fkey"
    FOREIGN KEY ("organizationId", "caseId") REFERENCES "workforce_exception_cases"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_exception_decisions_actor_fkey"
    FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A copied link must never silently point to another employee/workday. The
-- evidence link is deliberately reference-only: it is a restricted proof
-- source, not a permission to decrypt or expose its payload.
CREATE OR REPLACE FUNCTION workforce_validate_exception_case_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_agent_id TEXT;
  linked_workday_id TEXT;
BEGIN
  IF NEW."workdayId" IS NOT NULL THEN
    SELECT "agentId" INTO linked_agent_id
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce exception case workday must belong to its tenant employee' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."workdayEventId" IS NOT NULL THEN
    SELECT "agentId", "workdayId" INTO linked_agent_id, linked_workday_id
    FROM "mtm_agent_workday_events"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayEventId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId"
       OR (NEW."workdayId" IS NOT NULL AND linked_workday_id <> NEW."workdayId") THEN
      RAISE EXCEPTION 'Workforce exception case event must match its tenant employee/workday' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_exception_cases_validate_insert
  BEFORE INSERT ON "workforce_exception_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_exception_case_insert();

CREATE OR REPLACE FUNCTION workforce_reject_exception_case_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce exception case facts are immutable; append a decision instead' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce exception decisions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_exception_cases_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_case_mutation();
CREATE TRIGGER workforce_exception_decisions_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_decisions"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_decision_mutation();

ALTER TABLE "workforce_exception_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_exception_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_exception_cases_tenant_select
  ON "workforce_exception_cases" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_exception_cases_tenant_insert
  ON "workforce_exception_cases" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "workforce_exception_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_exception_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_exception_decisions_tenant_select
  ON "workforce_exception_decisions" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_exception_decisions_tenant_insert
  ON "workforce_exception_decisions" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- The migration adds storage only. There is no update/delete privilege for
-- application code, and an endpoint/worker must not use these ledgers until
-- the C6 taxonomy and reviewer authorization are enabled deliberately.
DO $$
DECLARE
  app_owner TEXT;
  table_name TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    FOREACH table_name IN ARRAY ARRAY['workforce_exception_cases', 'workforce_exception_decisions']
    LOOP
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;
  END IF;
END $$;
