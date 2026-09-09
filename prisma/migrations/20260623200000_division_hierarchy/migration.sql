-- Division → Section hierarchy (nested boards).
--
-- Additive only: both new columns are nullable / defaulted, so this is a no-op
-- for every existing board (they all become top-level standalone boards:
-- isDepartment=false, parentDivisionId=NULL). No backfill required.
--
--   * isDepartment      — TRUE marks a container "department" board that groups
--                         child section boards and holds NO tasks of its own
--                         (container-only is enforced at the route layer).
--   * parentDivisionId  — a section's parent department. NULL = top-level.
--                         FK is self-referential; ON DELETE SET NULL so deleting
--                         a department detaches (never deletes) its sections.

-- AlterTable
ALTER TABLE "divisions" ADD COLUMN "isDepartment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "divisions" ADD COLUMN "parentDivisionId" TEXT;

-- CreateIndex
CREATE INDEX "divisions_organizationId_parentDivisionId_idx" ON "divisions"("organizationId", "parentDivisionId");

-- AddForeignKey (self-relation "DivisionTree")
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_parentDivisionId_fkey" FOREIGN KEY ("parentDivisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- divisions_parent_coherence_trigger
-- ═══════════════════════════════════════════════════════════════════
-- A division and its parent department MUST belong to the same org. The
-- self-FK guarantees the parent ROW exists, but not that it is same-tenant;
-- a cross-tenant parent would let org A's section hang under org B's
-- department and leak the whole subtree through the inheritance cascade.
-- The route layer already validates this, but per the project's coherence-
-- trigger pattern (board_permissions / board_columns) we ALSO enforce it at
-- the DB so a future app bug cannot persist an incoherent row. (Prisma does
-- not manage triggers → invisible to `migrate diff`, so this adds no drift.)
CREATE OR REPLACE FUNCTION divisions_parent_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  parent_org_id TEXT;
BEGIN
  IF NEW."parentDivisionId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- A division may not be its own parent (cheap self-cycle guard; depth>2 is
  -- prevented at the route layer since only departments may be parents).
  IF NEW."parentDivisionId" = NEW."id" THEN
    RAISE EXCEPTION 'divisions: division "%" cannot be its own parent', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO parent_org_id
    FROM "divisions" WHERE "id" = NEW."parentDivisionId";
  IF parent_org_id IS NULL THEN
    RAISE EXCEPTION 'divisions.parentDivisionId "%" does not resolve', NEW."parentDivisionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'divisions: parent "%" belongs to org "%" but division references org "%"',
      NEW."parentDivisionId", parent_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS divisions_parent_coherence_trigger ON "divisions";
CREATE TRIGGER divisions_parent_coherence_trigger
  BEFORE INSERT OR UPDATE OF "parentDivisionId", "organizationId" ON "divisions"
  FOR EACH ROW
  EXECUTE FUNCTION divisions_parent_coherence_fn();
