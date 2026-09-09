-- The owner selected a deliberately non-historical transfer rule: a delayed
-- offline workday uses the employee's current team when the server processes
-- its policy snapshot. Rebind only the policy-snapshot validator. The generic
-- H3 validator remains unchanged for shift snapshots, exceptions, corrections
-- and approvals; this migration changes no rows, tables, constraints or RLS.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION workforce_validate_policy_snapshot_current_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row RECORD;
  policy_row RECORD;
  current_team_id TEXT;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce policy snapshot workday is missing' USING ERRCODE = '23514';
  END IF;
  IF workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce policy snapshot must match its workday agent and date' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO policy_row
  FROM "workforce_policies"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policyId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce policy snapshot policy is missing' USING ERRCODE = '23514';
  END IF;
  IF policy_row."version" <> NEW."policyVersion"
    OR policy_row."definitionHash" <> NEW."definitionHash"
    OR policy_row."definition" IS DISTINCT FROM NEW."definition"
    OR policy_row."effectiveFrom" > NEW."workDate"
    OR (policy_row."effectiveTo" IS NOT NULL AND policy_row."effectiveTo" < NEW."workDate") THEN
    RAISE EXCEPTION 'Workforce policy snapshot must preserve its applicable policy version and definition' USING ERRCODE = '23514';
  END IF;

  -- Serialize policy selection with a transfer. The workday deliberately uses
  -- the team visible while this INSERT is processed; it never infers a past
  -- team from the workday date or client timestamp.
  SELECT "teamId" INTO current_team_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce policy snapshot employee is missing' USING ERRCODE = '23514';
  END IF;

  IF policy_row."teamId" IS NULL THEN
    -- Organization policies retain the established historical-workday rule:
    -- a delayed sync may use a policy active at START and later retired, but
    -- never a draft or future policy.
    IF policy_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
      OR (
        policy_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
        AND (policy_row."retiredAt" IS NULL OR workday_row."startedAt" > policy_row."retiredAt")
      )
      OR workday_row."startedAt" < policy_row."activatedAt" THEN
      RAISE EXCEPTION 'Workforce policy snapshot must preserve its applicable policy version and definition' USING ERRCODE = '23514';
    END IF;

    -- The organization fallback cannot bypass a matching current-team policy
    -- merely because a stale caller omitted it from the snapshot request.
    IF current_team_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM "workforce_policies" AS team_policy
      WHERE team_policy."organizationId" = NEW."organizationId"
        AND team_policy."teamId" = current_team_id
        AND team_policy."status" = 'ACTIVE'::"WorkforceDefinitionStatus"
        AND team_policy."activatedAt" IS NOT NULL
        AND team_policy."activatedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        AND team_policy."effectiveFrom" <= NEW."workDate"
        AND (team_policy."effectiveTo" IS NULL OR team_policy."effectiveTo" >= NEW."workDate")
    ) THEN
      RAISE EXCEPTION 'Organization Workforce policy cannot bypass an applicable current-team policy' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF policy_row."teamId" IS DISTINCT FROM current_team_id THEN
      RAISE EXCEPTION 'Team-scoped Workforce policy must match the employee current team at server processing' USING ERRCODE = '23514';
    END IF;
    IF policy_row."status" <> 'ACTIVE'::"WorkforceDefinitionStatus"
      OR policy_row."activatedAt" IS NULL
      OR policy_row."activatedAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'Team-scoped Workforce policy must be active at server processing' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- PostgreSQL 16 supports replacing the trigger binding atomically. Keeping
-- the original generic function untouched confines this decision to policy
-- snapshots and leaves every other H3 insert validator byte-for-byte intact.
CREATE OR REPLACE TRIGGER workforce_policy_snapshots_validate_insert
  BEFORE INSERT ON "workforce_policy_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_policy_snapshot_current_team();
