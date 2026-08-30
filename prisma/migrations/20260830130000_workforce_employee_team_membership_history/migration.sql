-- Immutable employee-team history for delayed Workforce attendance. The
-- migration records the directory team only from this rollout instant forward;
-- it deliberately does not manufacture a team for older workdays.

SET lock_timeout = '3s';

CREATE TABLE "workforce_employee_team_memberships" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "teamId" TEXT,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "source" VARCHAR(48) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_employee_team_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workforce_employee_team_memberships_organizationId_id_key"
  ON "workforce_employee_team_memberships"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_employee_team_memberships_agent_effective_key"
  ON "workforce_employee_team_memberships"("organizationId", "agentId", "effectiveAt");
CREATE INDEX "workforce_employee_team_memberships_agent_effective_idx"
  ON "workforce_employee_team_memberships"("organizationId", "agentId", "effectiveAt");
CREATE INDEX "workforce_employee_team_memberships_team_effective_idx"
  ON "workforce_employee_team_memberships"("organizationId", "teamId", "effectiveAt");

ALTER TABLE "workforce_employee_team_memberships"
  ADD CONSTRAINT "workforce_employee_team_memberships_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_employee_team_memberships_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_employee_team_memberships_team_fkey"
    FOREIGN KEY ("organizationId", "teamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- This one baseline is true only from the migration instant onward. A workday
-- before it has no membership fact and must not be resolved from current team.
WITH migration_clock AS (
  SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS effective_at
)
INSERT INTO "workforce_employee_team_memberships" (
  "id", "organizationId", "agentId", "teamId", "effectiveAt", "source"
)
SELECT
  'wf-team-baseline-' || md5(agent."organizationId" || ':' || agent."id"),
  agent."organizationId",
  agent."id",
  agent."teamId",
  migration_clock.effective_at,
  'MIGRATION_BASELINE'
FROM "mtm_agents" AS agent
CROSS JOIN migration_clock;

CREATE OR REPLACE FUNCTION workforce_capture_employee_team_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_at TIMESTAMP(3);
  change_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."teamId" IS NOT DISTINCT FROM OLD."teamId" THEN
    RETURN NEW;
  END IF;

  -- Updates to the same employee row serialize naturally. Preserve strict
  -- ordering even if two transfers land in the same millisecond.
  SELECT MAX("effectiveAt") INTO latest_at
  FROM "workforce_employee_team_memberships"
  WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW."id";
  change_at := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
  IF latest_at IS NOT NULL AND change_at <= latest_at THEN
    change_at := latest_at + INTERVAL '1 millisecond';
  END IF;

  INSERT INTO "workforce_employee_team_memberships" (
    "id", "organizationId", "agentId", "teamId", "effectiveAt", "source"
  ) VALUES (
    'wf-team-change-' || md5(NEW."organizationId" || ':' || NEW."id" || ':' || change_at::TEXT || ':' || txid_current()::TEXT),
    NEW."organizationId",
    NEW."id",
    NEW."teamId",
    change_at,
    CASE WHEN TG_OP = 'INSERT' THEN 'DIRECTORY_CREATE' ELSE 'DIRECTORY_TRANSFER' END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_capture_employee_team_membership_after_change
  AFTER INSERT OR UPDATE OF "teamId" ON "mtm_agents"
  FOR EACH ROW EXECUTE FUNCTION workforce_capture_employee_team_membership();

CREATE OR REPLACE FUNCTION workforce_reject_employee_team_membership_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce employee team membership history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_employee_team_memberships_immutable
  BEFORE UPDATE OR DELETE ON "workforce_employee_team_memberships"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_employee_team_membership_mutation();

ALTER TABLE "workforce_employee_team_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_employee_team_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workforce_employee_team_memberships_tenant_select"
  ON "workforce_employee_team_memberships" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "workforce_employee_team_memberships_tenant_insert"
  ON "workforce_employee_team_memberships" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- Replace the earlier current-team policy validator. Team policy selection now
-- uses only the latest immutable membership at workday start. An absent
-- pre-history membership may use an organization policy but never current team.
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

CREATE OR REPLACE TRIGGER workforce_policy_snapshots_validate_insert
  BEFORE INSERT ON "workforce_policy_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_policy_snapshot_team_history();

-- Apply the same historical membership rule to all team-scoped shifts,
-- including explicit assignments. Individual assignment dates remain guarded.
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

CREATE OR REPLACE TRIGGER workforce_shift_snapshots_validate_insert
  BEFORE INSERT ON "workforce_shift_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_snapshot_team_history();

-- Schedule snapshot v2 makes the membership used by policy/shift selection
-- inspectable. v1 rows are immutable legacy history and remain untouched.
ALTER TABLE "workforce_workday_schedule_snapshots"
  DROP CONSTRAINT "workforce_workday_schedule_snapshots_shape_check";
ALTER TABLE "workforce_workday_schedule_snapshots"
  ALTER COLUMN "schemaVersion" SET DEFAULT 2;
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
