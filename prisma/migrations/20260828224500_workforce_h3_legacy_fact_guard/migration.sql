-- Seal canonical Workforce facts without replacing the supported MTM workday
-- state machine. This is additive: active shifts still transition through the
-- existing state machine, while completed shifts and every event become
-- append-only facts.

SET lock_timeout = '3s';

-- Match the JSON contract written by src/lib/workforce/request-decision.ts.
-- ISO-UTC values are compared as typed instants, not formatted strings, so
-- this remains independent of the database session timezone.
CREATE OR REPLACE FUNCTION workforce_workday_fact_matches(
  facts JSONB,
  workday_row "mtm_agent_workdays"
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT facts ?& ARRAY[
    'id', 'workDate', 'status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds'
  ]
    AND facts->>'id' = workday_row."id"
    AND facts->>'workDate' = to_char(workday_row."workDate", 'YYYY-MM-DD')
    AND facts->>'status' = workday_row."status"::text
    AND ((facts->>'startedAt')::timestamptz AT TIME ZONE 'UTC') = workday_row."startedAt"
    AND (
      (facts->>'pausedAt' IS NULL AND workday_row."pausedAt" IS NULL)
      OR (
        facts->>'pausedAt' IS NOT NULL
        AND workday_row."pausedAt" IS NOT NULL
        AND ((facts->>'pausedAt')::timestamptz AT TIME ZONE 'UTC') = workday_row."pausedAt"
      )
    )
    AND (
      (facts->>'completedAt' IS NULL AND workday_row."completedAt" IS NULL)
      OR (
        facts->>'completedAt' IS NOT NULL
        AND workday_row."completedAt" IS NOT NULL
        AND ((facts->>'completedAt')::timestamptz AT TIME ZONE 'UTC') = workday_row."completedAt"
      )
    )
    AND (facts->>'totalPausedSeconds')::integer = workday_row."totalPausedSeconds";
$$;

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

  -- An open shift is a projection of the state machine and can keep changing,
  -- but its tenant, employee and calendar identity never can.
  IF OLD."status" <> 'COMPLETED' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."workDate" IS DISTINCT FROM OLD."workDate" THEN
      RAISE EXCEPTION 'Workforce workday identity is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  -- A completed shift can never reopen. The narrowly allowed fields are the
  -- ordinary start/end correction surface, and they must exactly match a
  -- ledger row selected by the current transaction-local context.
  IF NEW."status" <> 'COMPLETED'
     OR NEW."pausedAt" IS NOT NULL
     OR NEW."completedAt" IS NULL
     OR NEW."completedAt" <= NEW."startedAt" THEN
    RAISE EXCEPTION 'Completed Workforce workday cannot reopen or become invalid' USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'updatedAt'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'updatedAt']) THEN
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

CREATE TRIGGER workforce_completed_workday_guard
  BEFORE UPDATE OR DELETE ON "mtm_agent_workdays"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_completed_workday();

-- Workday events are the canonical event journal. Existing application code
-- only appends them, so reject any rewrite or deletion at the database edge.
CREATE TRIGGER workforce_workday_events_append_only
  BEFORE UPDATE OR DELETE ON "mtm_agent_workday_events"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();

-- Replace the old generic tenant CRUD policies with the narrow operations the
-- canonical state machine needs. The dedicated triggers above still protect
-- migration/bypass callers and FK cascades that are outside normal RLS paths.
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workdays";
DROP POLICY IF EXISTS "mtm_agent_workdays_tenant_isolation" ON "mtm_agent_workdays";
CREATE POLICY workforce_workdays_tenant_select ON "mtm_agent_workdays"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY workforce_workdays_tenant_insert ON "mtm_agent_workdays"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY workforce_workdays_tenant_update ON "mtm_agent_workdays"
  FOR UPDATE USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workday_events";
DROP POLICY IF EXISTS "mtm_agent_workday_events_tenant_isolation" ON "mtm_agent_workday_events";
CREATE POLICY workforce_workday_events_tenant_select ON "mtm_agent_workday_events"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY workforce_workday_events_tenant_insert ON "mtm_agent_workday_events"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
