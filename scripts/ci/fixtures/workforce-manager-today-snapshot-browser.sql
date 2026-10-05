-- Disposable hosted manager-only snapshot fixture; never production seeding.
-- Apply after shared Today SQL and before fenced admin snapshot seeding.
-- Does not change production migrations, app role grants or shared report SQL.
-- Restores the latest production triplet snapshot validators and immutability.
-- Live policy lifecycle/full migration replay and unrelated writer guards are
-- outside this bounded fixture; only named snapshot guards receive acceptance.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() <> 'workforce_manager_today_browser' THEN
    RAISE EXCEPTION 'Snapshot sidecar requires its isolated disposable database';
  END IF;
END $$;
ALTER TABLE public.workforce_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY wf_manager_today_tenant ON public.workforce_policies
  USING ("organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "workforce_workday_schedule_snapshots"
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_shape_check" CHECK (
    ("schemaVersion" = 1 OR (
      "schemaVersion" = 2
      AND jsonb_typeof("calendarSnapshot" -> 'teamMembership') = 'object'
    ))
    AND NULLIF(btrim("calendarState"), '') IS NOT NULL
    AND jsonb_typeof("calendarSnapshot") = 'object'
    AND jsonb_typeof("segments") = 'array'
    AND jsonb_typeof("sites") = 'array'
    AND "snapshotHash" ~ '^[A-Fa-f0-9]{64}$'
  );

CREATE OR REPLACE FUNCTION workforce_validate_policy_snapshot_team_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row RECORD;
  policy_row RECORD;
  membership_row RECORD;
  historical_team_id TEXT;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND OR workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce policy snapshot must match its workday employee and date' USING ERRCODE = '23514';
  END IF;

  -- Locks the mutable directory row so a transfer cannot race this snapshot.
  PERFORM 1 FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce policy snapshot employee is missing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO membership_row
  FROM "workforce_employee_team_memberships"
  WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW."agentId"
    AND "effectiveAt" <= workday_row."startedAt"
  ORDER BY "effectiveAt" DESC, "id" DESC
  LIMIT 1;
  IF FOUND THEN historical_team_id := membership_row."teamId"; END IF;

  SELECT * INTO policy_row
  FROM "workforce_policies"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policyId";
  IF NOT FOUND
    OR policy_row."version" <> NEW."policyVersion"
    OR policy_row."definitionHash" <> NEW."definitionHash"
    OR policy_row."definition" IS DISTINCT FROM NEW."definition"
    OR policy_row."effectiveFrom" > NEW."workDate"
    OR (policy_row."effectiveTo" IS NOT NULL AND policy_row."effectiveTo" < NEW."workDate") THEN
    RAISE EXCEPTION 'Workforce policy snapshot must preserve its applicable policy version and definition' USING ERRCODE = '23514';
  END IF;

  IF policy_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
    OR policy_row."activatedAt" IS NULL
    OR workday_row."startedAt" < policy_row."activatedAt"
    OR (policy_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
      AND (policy_row."retiredAt" IS NULL OR workday_row."startedAt" > policy_row."retiredAt")) THEN
    RAISE EXCEPTION 'Workforce policy snapshot must preserve its historical lifecycle' USING ERRCODE = '23514';
  END IF;

  IF policy_row."teamId" IS NULL THEN
    IF historical_team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM "workforce_policies" AS team_policy
      WHERE team_policy."organizationId" = NEW."organizationId"
        AND team_policy."teamId" = historical_team_id
        AND team_policy."effectiveFrom" <= NEW."workDate"
        AND (team_policy."effectiveTo" IS NULL OR team_policy."effectiveTo" >= NEW."workDate")
        AND team_policy."status" IN ('ACTIVE'::"WorkforceDefinitionStatus", 'RETIRED'::"WorkforceDefinitionStatus")
        AND team_policy."activatedAt" IS NOT NULL
        AND team_policy."activatedAt" <= workday_row."startedAt"
        AND (team_policy."status" <> 'RETIRED'::"WorkforceDefinitionStatus"
          OR (team_policy."retiredAt" IS NOT NULL AND workday_row."startedAt" <= team_policy."retiredAt"))
    ) THEN
      RAISE EXCEPTION 'Organization Workforce policy cannot bypass an applicable historical-team policy' USING ERRCODE = '23514';
    END IF;
  ELSIF policy_row."teamId" IS DISTINCT FROM historical_team_id THEN
    RAISE EXCEPTION 'Team-scoped Workforce policy must match the employee team at workday start' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_team_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row RECORD;
  template_row RECORD;
  assignment_row RECORD;
  membership_row RECORD;
  historical_team_id TEXT;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND OR workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce shift snapshot must match its workday employee and date' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift snapshot employee is missing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO membership_row
  FROM "workforce_employee_team_memberships"
  WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW."agentId"
    AND "effectiveAt" <= workday_row."startedAt"
  ORDER BY "effectiveAt" DESC, "id" DESC
  LIMIT 1;
  IF FOUND THEN historical_team_id := membership_row."teamId"; END IF;

  SELECT * INTO template_row
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND
    OR template_row."version" <> NEW."templateVersion"
    OR template_row."timezone" <> NEW."timezone"
    OR template_row."definitionHash" <> NEW."definitionHash"
    OR template_row."definition" IS DISTINCT FROM NEW."definition"
    OR template_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
    OR template_row."activatedAt" IS NULL
    OR workday_row."startedAt" < template_row."activatedAt"
    OR (template_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
      AND (template_row."retiredAt" IS NULL OR workday_row."startedAt" > template_row."retiredAt")) THEN
    RAISE EXCEPTION 'Workforce shift snapshot must preserve its historical template version and lifecycle' USING ERRCODE = '23514';
  END IF;
  IF template_row."teamId" IS NOT NULL AND template_row."teamId" IS DISTINCT FROM historical_team_id THEN
    RAISE EXCEPTION 'Team-scoped Workforce shift must match the employee team at workday start' USING ERRCODE = '23514';
  END IF;

  IF NEW."assignmentId" IS NOT NULL THEN
    SELECT * INTO assignment_row
    FROM "workforce_shift_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."assignmentId";
    IF NOT FOUND
      OR assignment_row."agentId" <> NEW."agentId"
      OR assignment_row."templateId" <> NEW."templateId"
      OR assignment_row."effectiveFrom" > NEW."workDate"
      OR (assignment_row."effectiveTo" IS NOT NULL AND assignment_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot assignment must cover its agent, template and work date' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_validate_workday_schedule_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row "mtm_agent_workdays"%ROWTYPE;
  policy_row "workforce_policy_snapshots"%ROWTYPE;
  shift_row "workforce_shift_snapshots"%ROWTYPE;
  membership_row RECORD;
  snapshot_membership_id TEXT;
  snapshot_team_id TEXT;
BEGIN
  SELECT * INTO workday_row FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND OR workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce schedule snapshot must match its workday employee and date' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO policy_row FROM "workforce_policy_snapshots"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policySnapshotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce schedule snapshot policy snapshot is missing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO shift_row FROM "workforce_shift_snapshots"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."shiftSnapshotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce schedule snapshot shift snapshot is missing' USING ERRCODE = '23514';
  END IF;
  IF policy_row."workdayId" <> NEW."workdayId" OR policy_row."agentId" <> NEW."agentId" OR policy_row."workDate" <> NEW."workDate"
    OR shift_row."workdayId" <> NEW."workdayId" OR shift_row."agentId" <> NEW."agentId" OR shift_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce schedule snapshot must bind the matching policy and shift snapshots' USING ERRCODE = '23514';
  END IF;
  IF NEW."schemaVersion" = 2 THEN
    SELECT * INTO membership_row FROM "workforce_employee_team_memberships"
    WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW."agentId"
      AND "effectiveAt" <= workday_row."startedAt"
    ORDER BY "effectiveAt" DESC, "id" DESC LIMIT 1;
    snapshot_membership_id := NEW."calendarSnapshot" #>> '{teamMembership,id}';
    snapshot_team_id := NEW."calendarSnapshot" #>> '{teamMembership,teamId}';
    IF FOUND THEN
      IF snapshot_membership_id IS DISTINCT FROM membership_row."id"
        OR snapshot_team_id IS DISTINCT FROM membership_row."teamId" THEN
        RAISE EXCEPTION 'Workforce schedule snapshot must preserve its historical team membership' USING ERRCODE = '23514';
      END IF;
    ELSIF snapshot_membership_id IS NOT NULL OR snapshot_team_id IS NOT NULL THEN
      RAISE EXCEPTION 'Workforce schedule snapshot cannot invent missing historical team membership' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce immutable records cannot be %', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_workday_schedule_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce workday schedule snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_default_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  default_row "workforce_shift_default_assignments"%ROWTYPE;
  team_default_row "workforce_shift_team_default_assignments"%ROWTYPE;
  membership_team_id TEXT;
BEGIN
  IF ((CASE WHEN NEW."assignmentId" IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN NEW."defaultAssignmentId" IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN NEW."teamDefaultAssignmentId" IS NULL THEN 0 ELSE 1 END)) > 1 THEN
    RAISE EXCEPTION 'Workforce shift snapshot cannot bind more than one assignment source' USING ERRCODE = '23514';
  END IF;

  IF NEW."defaultAssignmentId" IS NOT NULL THEN
    SELECT * INTO default_row
    FROM "workforce_shift_default_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."defaultAssignmentId";
    IF NOT FOUND
       OR default_row."templateId" <> NEW."templateId"
       OR default_row."effectiveFrom" > NEW."workDate"
       OR (default_row."effectiveTo" IS NOT NULL AND default_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot default assignment must cover its template and work date' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."teamDefaultAssignmentId" IS NOT NULL THEN
    SELECT * INTO team_default_row
    FROM "workforce_shift_team_default_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."teamDefaultAssignmentId";
    IF NOT FOUND
       OR team_default_row."templateId" <> NEW."templateId"
       OR team_default_row."effectiveFrom" > NEW."workDate"
       OR (team_default_row."effectiveTo" IS NOT NULL AND team_default_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot team default must cover its template and work date' USING ERRCODE = '23514';
    END IF;
    SELECT membership."teamId" INTO membership_team_id
    FROM "mtm_agent_workdays" AS workday
    JOIN LATERAL (
      SELECT "teamId"
      FROM "workforce_employee_team_memberships"
      WHERE "organizationId" = NEW."organizationId"
        AND "agentId" = NEW."agentId"
        AND "effectiveAt" <= workday."startedAt"
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
    ) AS membership ON TRUE
    WHERE workday."organizationId" = NEW."organizationId"
      AND workday."id" = NEW."workdayId";
    IF membership_team_id IS DISTINCT FROM team_default_row."teamId" THEN
      RAISE EXCEPTION 'Workforce shift snapshot team default must match immutable workday-start membership' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_policy_snapshots_validate_insert
  BEFORE INSERT ON workforce_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_policy_snapshot_team_history();
CREATE TRIGGER workforce_shift_snapshots_validate_insert
  BEFORE INSERT ON workforce_shift_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_snapshot_team_history();
CREATE TRIGGER workforce_workday_schedule_snapshots_validate_insert
  BEFORE INSERT ON workforce_workday_schedule_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_workday_schedule_snapshot();
CREATE TRIGGER workforce_policy_snapshots_append_only
  BEFORE UPDATE OR DELETE ON workforce_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();
CREATE TRIGGER workforce_shift_snapshots_append_only
  BEFORE UPDATE OR DELETE ON workforce_shift_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();
CREATE TRIGGER workforce_workday_schedule_snapshots_immutable
  BEFORE UPDATE OR DELETE ON workforce_workday_schedule_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_workday_schedule_snapshot_mutation();
CREATE TRIGGER workforce_shift_snapshots_default_assignment_validate
  BEFORE INSERT ON workforce_shift_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_snapshot_default_assignment();
COMMIT;
