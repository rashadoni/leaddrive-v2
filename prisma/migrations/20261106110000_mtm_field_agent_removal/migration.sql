BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
-- Module-specific removal. No history, credential of a linked person or Time state is deleted.
ALTER TABLE "mtm_agents" ADD COLUMN "fieldDeletedAt" TIMESTAMP(3);
CREATE INDEX "mtm_agents_organizationId_fieldDeletedAt_idx" ON "mtm_agents"("organizationId", "fieldDeletedAt");
-- Ordinary edits must not resurrect a removed Field identity or retarget it.
CREATE FUNCTION mtm_guard_field_removal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."fieldDeletedAt" IS NOT NULL AND
     (NEW."fieldDeletedAt" IS DISTINCT FROM OLD."fieldDeletedAt" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'MTM_FIELD_REMOVAL_RETAINED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_field_removal_guard BEFORE UPDATE ON "mtm_agents"
  FOR EACH ROW EXECUTE FUNCTION mtm_guard_field_removal();

COMMIT;
