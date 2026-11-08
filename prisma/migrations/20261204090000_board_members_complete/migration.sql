-- A board member may finish a task, as in Bordio (owner, 2026-11-08: «Давай,
-- обе» — Zeytun's marketers moving from Bordio could not mark their own task
-- Completed: only an admin, a manager or the board's head could).
--
-- A new per-person flag beside the other move flags. Every grant the board's
-- member picker wrote is a full member (all nine flags on): those get it too.
-- board_permissions is under FORCE ROW LEVEL SECURITY and a migration runs with
-- no tenant set, so the backfill lifts RLS for the UPDATE and restores it.
ALTER TABLE "board_permissions" ADD COLUMN "canMoveToDone" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'board_permissions'::regclass;

  ALTER TABLE "board_permissions" DISABLE ROW LEVEL SECURITY;

  UPDATE "board_permissions"
  SET "canMoveToDone" = true
  WHERE "canView" AND "canEdit" AND "canCreateTask" AND "canComment"
    AND "canMoveToTodo" AND "canMoveToInProgress" AND "canMoveToTesting"
    AND "canMoveToReview" AND "canMoveBack";

  IF had_rls THEN
    ALTER TABLE "board_permissions" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "board_permissions" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "board_permissions" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "board_permissions" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
