-- An employee who is deleted takes their own team history with them.
--
-- Since 20260830130000 every new employee gets a team-membership row from a
-- trigger at INSERT, that row can be neither changed nor deleted, and its
-- foreign key refuses the employee's deletion. So no employee could be
-- deleted at all — not one created by mistake a minute ago, with no visit, no
-- route and no hour worked. The «Delete agent» button answered with the raw
-- constraint name (prod, 2026-10-06, owner's screenshot).
--
-- Owner's decision the same day: an employee WITHOUT work history can be
-- deleted for good; one with history cannot, and is deactivated instead.
-- Whether there is history is decided by the application before it deletes
-- (src/lib/mtm/agent-deletion.ts); every table of real facts keeps its own
-- RESTRICT key, so the database still refuses if the application is wrong.
--
-- What changes here, and only here:
--   1. the membership's key to its employee cascades instead of restricting;
--   2. the immutability trigger lets a row go when — and only when — its
--      employee is already gone, i.e. the delete arrives from that cascade.
-- A membership of an employee who still exists stays immutable exactly as
-- before: UPDATE and a direct DELETE are refused with the same error.
SET LOCAL lock_timeout = '10s';

ALTER TABLE "workforce_employee_team_memberships"
  DROP CONSTRAINT "workforce_employee_team_memberships_agent_fkey",
  ADD CONSTRAINT "workforce_employee_team_memberships_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_reject_employee_team_membership_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- pg_trigger_depth() > 1: this DELETE was issued from inside another
  -- trigger — the foreign-key cascade — not by a statement of its own. And the
  -- employee no longer exists: the cascade runs after their row is deleted.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT EXISTS (
    SELECT 1 FROM "mtm_agents" AS employee
    WHERE employee."organizationId" = OLD."organizationId" AND employee."id" = OLD."agentId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Workforce employee team membership history is immutable' USING ERRCODE = '55000';
END;
$$;
