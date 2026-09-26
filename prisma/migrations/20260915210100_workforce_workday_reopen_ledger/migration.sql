-- Owner-approved manager reopen of today's finished workday (2026-09-15).
--
-- A manager in the employee's scope (never the employee) may reopen a
-- COMPLETED workday dated today in the tenant timezone, with a mandatory
-- reason. Both the closure and the reopen stay in history: the journal keeps
-- its FINISH and gains a REOPEN event, and this append-only ledger records who,
-- when, why and the exact before/after projection. The shift reopens PAUSED
-- from its previous finish, so the time until the employee resumes counts as
-- pause and never as work. One shift per day is unchanged: no row is created.
--
-- Additive only: one new table and a replacement of the completed-workday guard
-- function that keeps every existing branch and adds the single reopen path.
-- No historical workday, event or correction is rewritten.
--
-- Rollback: once any REOPEN row exists, a revert must keep this table, the
-- REOPEN enum value and the REOPEN case of the journal replay. Code from before
-- this change cannot read those rows (an unknown enum value throws in the
-- Prisma client, and the old replay rejects the event type), so reverting them
-- would break every reader of a reopened day, not only the reopen feature.

SET lock_timeout = '3s';

CREATE TABLE "workforce_workday_reopens" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeFacts" JSONB NOT NULL,
  "afterFacts" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_workday_reopens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_workday_reopens_reason_check"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL AND char_length("reason") <= 1000),
  CONSTRAINT "workforce_workday_reopens_operation_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL),
  CONSTRAINT "workforce_workday_reopens_request_hash_format"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "workforce_workday_reopens_organizationId_id_key"
  ON "workforce_workday_reopens"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_workday_reopens_operation_key"
  ON "workforce_workday_reopens"("organizationId", "operationId");
CREATE UNIQUE INDEX "workforce_workday_reopens_event_key"
  ON "workforce_workday_reopens"("organizationId", "eventId");
CREATE INDEX "workforce_workday_reopens_workday_occurred_idx"
  ON "workforce_workday_reopens"("organizationId", "workdayId", "occurredAt");
CREATE INDEX "workforce_workday_reopens_agent_occurred_idx"
  ON "workforce_workday_reopens"("organizationId", "agentId", "occurredAt");
CREATE INDEX "workforce_workday_reopens_actor_occurred_idx"
  ON "workforce_workday_reopens"("organizationId", "actorUserId", "occurredAt");

ALTER TABLE "workforce_workday_reopens"
  ADD CONSTRAINT "workforce_workday_reopens_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_reopens_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_reopens_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_reopens_event_fkey"
    FOREIGN KEY ("organizationId", "eventId") REFERENCES "mtm_agent_workday_events"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_reopens_actor_fkey"
    FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant-scoped FK cannot prove the referenced rows describe one reopen.
-- The ledger is written after its REOPEN event and before the projection
-- moves, so at insert time the workday must still be exactly the completed
-- state it leaves, the event must be this workday's REOPEN recorded at the
-- instant of the finish it reopens (the pause starts there; the ledger row's
-- own occurredAt is the server time the manager acted), the after facts must
-- be that state paused at its finish, and the actor is never the employee's
-- own linked user.
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
  IF linked_user_id IS NOT NULL AND linked_user_id = NEW."actorUserId" THEN
    RAISE EXCEPTION 'Workforce workday reopen actor cannot be the employee' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_workday_reopens_validate_insert
  BEFORE INSERT ON "workforce_workday_reopens"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_workday_reopen_insert();

-- Reopen facts are history like correction facts: ordinary application code
-- cannot revise or delete them. Like every Workforce table after H3 it owns its
-- rejection function, so the migration does not depend on an older migration's
-- helper (a database built by `prisma db push` has no functions at all).
CREATE OR REPLACE FUNCTION workforce_reject_workday_reopen_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce workday reopen facts are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_workday_reopens_append_only
  BEFORE UPDATE OR DELETE ON "workforce_workday_reopens"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_workday_reopen_mutation();

ALTER TABLE "workforce_workday_reopens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_workday_reopens" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_workday_reopens_tenant_select
  ON "workforce_workday_reopens" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_workday_reopens_tenant_insert
  ON "workforce_workday_reopens" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- Replaces the body from 20260828230000_workforce_direct_correction_contract.
-- Every existing branch, message and error code is kept as it was; the only
-- addition is the reopen branch, entered solely when this transaction selected
-- a reopen ledger row. Without that context a COMPLETED -> PAUSED update still
-- fails with 'Completed Workforce workday cannot reopen or become invalid'.
CREATE OR REPLACE FUNCTION workforce_guard_completed_workday()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  correction_id TEXT := current_setting('app.workforce_correction_id', true);
  reopen_id TEXT := current_setting('app.workforce_reopen_id', true);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce workday facts cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'COMPLETED' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."workDate" IS DISTINCT FROM OLD."workDate" THEN
      RAISE EXCEPTION 'Workforce workday identity is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  -- The single audited way out of COMPLETED: a manager reopen. The shift
  -- pauses at its previous finish and every other fact (start, closed pause
  -- total, coordinates, identity) stays exactly as it was, so the reopened
  -- gap can only ever be counted as pause. It must match the ledger row this
  -- transaction selected, before and after.
  IF NEW."status" = 'PAUSED' AND NULLIF(reopen_id, '') IS NOT NULL THEN
    IF OLD."completedAt" IS NULL
       OR NEW."completedAt" IS NOT NULL
       OR NEW."pausedAt" IS DISTINCT FROM OLD."completedAt"
       OR (to_jsonb(NEW) - ARRAY['status', 'pausedAt', 'completedAt', 'updatedAt'])
            IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'pausedAt', 'completedAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'Completed Workforce workday reopen must pause at its previous finish without changing other facts' USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "workforce_workday_reopens" reopen_row
      WHERE reopen_row."id" = reopen_id
        AND reopen_row."organizationId" = OLD."organizationId"
        AND reopen_row."workdayId" = OLD."id"
        AND reopen_row."agentId" = OLD."agentId"
        AND workforce_workday_fact_matches(reopen_row."beforeFacts", OLD)
        AND workforce_workday_fact_matches(reopen_row."afterFacts", NEW)
    ) THEN
      RAISE EXCEPTION 'Completed Workforce workday reopen requires its current transaction reopen ledger fact' USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."status" <> 'COMPLETED'
     OR NEW."pausedAt" IS NOT NULL
     OR NEW."completedAt" IS NULL
     OR NEW."completedAt" <= NEW."startedAt" THEN
    RAISE EXCEPTION 'Completed Workforce workday cannot reopen or become invalid' USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds', 'updatedAt'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds', 'updatedAt']) THEN
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

-- A migration runner can own the new table while the established application
-- role owns mtm_agents. Grant only what the RLS policies and the append-only
-- trigger permit: SELECT and INSERT.
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', 'workforce_workday_reopens', app_owner);
  END IF;
END $$;
