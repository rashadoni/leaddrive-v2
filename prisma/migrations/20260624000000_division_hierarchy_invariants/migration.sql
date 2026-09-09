-- Division hierarchy invariants — DB-level enforcement (close the route-layer TOCTOU).
--
-- The route layer (validateDivisionHierarchy) already checks these, but two
-- concurrent admin requests can race between validate and write (e.g. "convert D
-- to a department" + "create a task on D" each pass their own pre-check, then both
-- commit → a department holding a task). These triggers make the invariants
-- unviolatable regardless of interleaving, matching the project's coherence-trigger
-- philosophy. Additive: every existing row is a flat board (isDepartment=false,
-- parentDivisionId=NULL, no children) and already satisfies all of them.
--
-- Invariants (mirror src/lib/tasks/board-hierarchy.ts):
--   (A) a department has no parent            → CHECK constraint (column-local)
--   (B) only a department may have children   → divisions trigger (caps depth at 2)
--   (C) a parent must be a department         → divisions trigger (+ FOR SHARE lock)
--   (D) a department holds no tasks           → divisions trigger + tasks trigger
--
-- Concurrency: the cross-row checks take FOR SHARE on the referenced division row
-- so they conflict with a concurrent UPDATE of that row's isDepartment (which takes
-- FOR NO KEY UPDATE) — serialising "convert" against "attach child" / "add task".

-- (A) a department may never carry a parent.
ALTER TABLE "divisions"
  ADD CONSTRAINT "divisions_department_no_parent_chk"
  CHECK (NOT ("isDepartment" = true AND "parentDivisionId" IS NOT NULL));

-- (B) + (C) + (D, convert side) — fires on the division being inserted/changed.
CREATE OR REPLACE FUNCTION divisions_hierarchy_invariants_fn()
RETURNS TRIGGER AS $$
DECLARE
  parent_is_dept BOOLEAN;
  child_count INT;
  task_count INT;
BEGIN
  -- (C) parent must be a department. FOR SHARE locks the parent row so a
  -- concurrent "demote parent to non-department" serialises against this attach.
  IF NEW."parentDivisionId" IS NOT NULL THEN
    SELECT "isDepartment" INTO parent_is_dept
      FROM "divisions" WHERE "id" = NEW."parentDivisionId" FOR SHARE;
    IF parent_is_dept IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'divisions: parent "%" must be a department', NEW."parentDivisionId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (D) a department holds no tasks (container-only). The row's own UPDATE lock
  -- plus the tasks-trigger FOR SHARE (below) serialise this against a task insert.
  IF NEW."isDepartment" = TRUE THEN
    SELECT COUNT(*) INTO task_count
      FROM "tasks" WHERE "divisionId" = NEW."id" AND "deletedAt" IS NULL;
    IF task_count > 0 THEN
      RAISE EXCEPTION 'divisions: a department cannot hold tasks (division "%")', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (B) only a department may have children (this is what caps depth at 2).
  IF NEW."isDepartment" = FALSE THEN
    SELECT COUNT(*) INTO child_count
      FROM "divisions" WHERE "parentDivisionId" = NEW."id";
    IF child_count > 0 THEN
      RAISE EXCEPTION 'divisions: only a department may have child sections (division "%")', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS divisions_hierarchy_invariants_trigger ON "divisions";
CREATE TRIGGER divisions_hierarchy_invariants_trigger
  BEFORE INSERT OR UPDATE OF "isDepartment", "parentDivisionId" ON "divisions"
  FOR EACH ROW
  EXECUTE FUNCTION divisions_hierarchy_invariants_fn();

-- (D, task side) — a task may not live on a department. FOR SHARE on the division
-- row conflicts with a concurrent "convert to department" (FOR NO KEY UPDATE), so
-- one of the two always loses: no department ever ends up holding a task.
CREATE OR REPLACE FUNCTION tasks_no_task_on_department_fn()
RETURNS TRIGGER AS $$
DECLARE
  div_is_dept BOOLEAN;
BEGIN
  IF NEW."divisionId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "isDepartment" INTO div_is_dept
    FROM "divisions" WHERE "id" = NEW."divisionId" FOR SHARE;
  IF div_is_dept = TRUE THEN
    RAISE EXCEPTION 'tasks: cannot place a task on a department (division "%")', NEW."divisionId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_no_task_on_department_trigger ON "tasks";
CREATE TRIGGER tasks_no_task_on_department_trigger
  BEFORE INSERT OR UPDATE OF "divisionId" ON "tasks"
  FOR EACH ROW
  WHEN (NEW."divisionId" IS NOT NULL)
  EXECUTE FUNCTION tasks_no_task_on_department_fn();
