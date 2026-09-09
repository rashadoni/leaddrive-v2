-- The owner selected the same non-historical transfer rule for a selected
-- team-scoped default shift as for a team policy: a delayed offline workday
-- uses the employee's current team when its snapshot is processed. Rebind only
-- the shift-snapshot validator. The generic H3 validator and policy trigger
-- remain unchanged; this migration changes no rows, tables, constraints or RLS.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_current_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row RECORD;
  template_row RECORD;
  assignment_row RECORD;
  current_team_id TEXT;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift snapshot workday is missing' USING ERRCODE = '23514';
  END IF;
  IF workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce shift snapshot must match its workday agent and date' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO template_row
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift snapshot template is missing' USING ERRCODE = '23514';
  END IF;
  IF template_row."version" <> NEW."templateVersion"
    OR template_row."timezone" <> NEW."timezone"
    OR template_row."definitionHash" <> NEW."definitionHash"
    OR template_row."definition" IS DISTINCT FROM NEW."definition" THEN
    RAISE EXCEPTION 'Workforce shift snapshot must preserve its template version and definition' USING ERRCODE = '23514';
  END IF;

  IF NEW."assignmentId" IS NULL AND template_row."teamId" IS NOT NULL THEN
    -- Serialize default-team template selection with a transfer. This selected
    -- template belongs to the team visible while this INSERT is processed; no
    -- historical team is inferred from the workday date or client timestamp.
    SELECT "teamId" INTO current_team_id
    FROM "mtm_agents"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId"
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce shift snapshot employee is missing' USING ERRCODE = '23514';
    END IF;

    IF template_row."teamId" IS DISTINCT FROM current_team_id THEN
      RAISE EXCEPTION 'Team-scoped default Workforce shift must match the employee current team at server processing' USING ERRCODE = '23514';
    END IF;
    IF template_row."status" <> 'ACTIVE'::"WorkforceDefinitionStatus"
      OR template_row."activatedAt" IS NULL
      OR template_row."activatedAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'Team-scoped default Workforce shift must be active at server processing' USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Organization defaults and explicit individual assignments retain the
    -- established historical-workday lifecycle contract. The owner decision
    -- applies only to an unassigned team-scoped default template.
    IF template_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
      OR (
        template_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
        AND (template_row."retiredAt" IS NULL OR workday_row."startedAt" > template_row."retiredAt")
      )
      OR workday_row."startedAt" < template_row."activatedAt" THEN
      RAISE EXCEPTION 'Workforce shift snapshot must preserve its template version and definition' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."assignmentId" IS NOT NULL THEN
    SELECT * INTO assignment_row
    FROM "workforce_shift_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."assignmentId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce shift snapshot assignment is missing' USING ERRCODE = '23514';
    END IF;
    IF assignment_row."agentId" <> NEW."agentId"
      OR assignment_row."templateId" <> NEW."templateId"
      OR assignment_row."effectiveFrom" > NEW."workDate"
      OR (assignment_row."effectiveTo" IS NOT NULL AND assignment_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot assignment must cover its agent, template and work date' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- PostgreSQL 16 supports replacing the trigger binding atomically. Keeping
-- the generic H3 function and the policy binding untouched confines this
-- owner decision to shift snapshots.
CREATE OR REPLACE TRIGGER workforce_shift_snapshots_validate_insert
  BEFORE INSERT ON "workforce_shift_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_snapshot_current_team();
