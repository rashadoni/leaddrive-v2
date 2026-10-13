-- An employee returns to their own workday, the same calendar day.
--
-- Owner, 2026-10-13, having closed a workday at 10:56 and asked how to turn it
-- back on: «думаю, ограничение не имеет смысла, это ничего не предотвращает».
-- It did not: an employee who wants to be out of sight has «Перерыв», the
-- journal is append-only so the closure and the return both stay in it, and
-- the only people the rule stopped were those who closed the day by mistake.
-- This supersedes the rule of 2026-09-15 «employees cannot reopen their own
-- day». Everything else of that rule stands: the closure and the reopen both
-- stay in history, and the time between them is never worked time.
--
-- The ledger of reopens learns who acted: a supervisor on someone else's day
-- (as before), or the employee on their own. The second kind has no CRM user
-- to name when the employee's card has none — most field agents sign in to the
-- app alone — so the actor becomes optional for that kind only.
--
-- The guard of completed workdays is untouched: a completed day still leaves
-- COMPLETED only against a ledger row written in the same transaction.
--
-- Rollback: once a row with "source" = 'EMPLOYEE' exists, a revert must keep
-- the column and this version of the function; code from before this migration
-- never writes such a row and reads the ledger without the column.

ALTER TABLE "workforce_workday_reopens"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANAGER';

ALTER TABLE "workforce_workday_reopens"
  ALTER COLUMN "actorUserId" DROP NOT NULL;

ALTER TABLE "workforce_workday_reopens"
  ADD CONSTRAINT "workforce_workday_reopens_source_check"
    CHECK ("source" IN ('MANAGER', 'EMPLOYEE') AND ("source" = 'EMPLOYEE' OR "actorUserId" IS NOT NULL));

-- Same checks as before, in the same order; only the last one — who the actor
-- may be — now depends on the kind of reopen.
CREATE OR REPLACE FUNCTION workforce_validate_workday_reopen_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row "mtm_agent_workdays"%ROWTYPE;
  event_agent_id TEXT;
  event_workday_id TEXT;
  event_type TEXT;
  event_occurred_at TIMESTAMP(3);
  linked_user_id TEXT;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND OR workday_row."agentId" <> NEW."agentId" THEN
    RAISE EXCEPTION 'Workforce workday reopen must match its workday agent' USING ERRCODE = '23514';
  END IF;

  IF workday_row."status" <> 'COMPLETED'
     OR NOT workforce_workday_fact_matches(NEW."beforeFacts", workday_row) THEN
    RAISE EXCEPTION 'Workforce workday reopen must start from the current completed workday facts' USING ERRCODE = '23514';
  END IF;

  IF NEW."afterFacts"->>'status' IS DISTINCT FROM 'PAUSED'
     OR NEW."afterFacts"->>'completedAt' IS NOT NULL
     OR NEW."afterFacts"->>'pausedAt' IS DISTINCT FROM NEW."beforeFacts"->>'completedAt'
     OR (NEW."afterFacts" - ARRAY['status', 'pausedAt', 'completedAt'])
          IS DISTINCT FROM
        (NEW."beforeFacts" - ARRAY['status', 'pausedAt', 'completedAt']) THEN
    RAISE EXCEPTION 'Workforce workday reopen must pause at the previous finish without changing other facts' USING ERRCODE = '23514';
  END IF;

  SELECT "agentId", "workdayId", "type"::TEXT, "occurredAt"
  INTO event_agent_id, event_workday_id, event_type, event_occurred_at
  FROM "mtm_agent_workday_events"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."eventId";
  IF NOT FOUND
     OR event_agent_id <> NEW."agentId"
     OR event_workday_id <> NEW."workdayId"
     OR event_type <> 'REOPEN'
     OR event_occurred_at IS DISTINCT FROM workday_row."completedAt" THEN
    RAISE EXCEPTION 'Workforce workday reopen must reference its own REOPEN journal event' USING ERRCODE = '23514';
  END IF;

  SELECT "userId" INTO linked_user_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NEW."source" = 'EMPLOYEE' THEN
    -- The employee's own return: the actor is that employee — their linked CRM
    -- user, or nobody when the card has none. Never a third person.
    IF NEW."actorUserId" IS DISTINCT FROM linked_user_id THEN
      RAISE EXCEPTION 'Workforce workday return actor must be the employee' USING ERRCODE = '23514';
    END IF;
  ELSIF linked_user_id IS NOT NULL AND linked_user_id = NEW."actorUserId" THEN
    RAISE EXCEPTION 'Workforce workday reopen actor cannot be the employee' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
