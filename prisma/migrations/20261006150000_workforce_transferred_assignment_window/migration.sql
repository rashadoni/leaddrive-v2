-- C7: preserve historical team-bound assignments when a future bulk or
-- individual replacement closes their window after an employee transfer.
-- No rows, snapshots, grants or tenant activation are changed.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_team_id TEXT;
  template_team_id TEXT;
  template_status "WorkforceDefinitionStatus";
BEGIN
  SELECT "teamId" INTO agent_team_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment agent is missing' USING ERRCODE = '23514';
  END IF;

  SELECT "teamId", "status" INTO template_team_id, template_status
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment template is missing' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND template_status <> 'ACTIVE'::"WorkforceDefinitionStatus" THEN
    RAISE EXCEPTION 'Workforce shift assignment template must be active' USING ERRCODE = '23514';
  END IF;
  -- A future replacement may close a historical assignment after the employee
  -- has transferred teams. This exception permits only unchanged identity and
  -- a narrowing end date; the snapshot checks below still prevent exclusion
  -- or rewriting of any previously captured workday.
  IF template_team_id IS NOT NULL AND agent_team_id IS DISTINCT FROM template_team_id
     AND NOT (
       TG_OP = 'UPDATE'
       AND NEW."id" IS NOT DISTINCT FROM OLD."id"
       AND NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId"
       AND NEW."agentId" IS NOT DISTINCT FROM OLD."agentId"
       AND NEW."templateId" IS NOT DISTINCT FROM OLD."templateId"
       AND NEW."effectiveFrom" IS NOT DISTINCT FROM OLD."effectiveFrom"
       AND NEW."assignedByUserId" IS NOT DISTINCT FROM OLD."assignedByUserId"
       AND NEW."effectiveTo" IS NOT NULL
       AND (OLD."effectiveTo" IS NULL OR NEW."effectiveTo" <= OLD."effectiveTo")
     ) THEN
    RAISE EXCEPTION 'Workforce shift assignment template team must match its agent' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND EXISTS (
       SELECT 1
       FROM "workforce_shift_snapshots"
       WHERE "organizationId" = OLD."organizationId" AND "assignmentId" = OLD."id"
     ) THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId" THEN
      RAISE EXCEPTION 'Workforce shift assignment facts are immutable after a snapshot is created' USING ERRCODE = '55000';
    END IF;

    IF NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
      IF NEW."effectiveTo" IS NULL
         OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window can only be narrowed' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM "workforce_shift_snapshots"
        WHERE "organizationId" = OLD."organizationId"
          AND "assignmentId" = OLD."id"
          AND "workDate" > NEW."effectiveTo"
      ) THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window cannot exclude an existing snapshot' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
