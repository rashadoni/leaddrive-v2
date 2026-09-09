-- MTM Phase 2 schema additions (F-18, F-22, F-29)
-- F-18: enable join from MtmAuditLog to MtmAgent (was: agentId stored without FK relation,
--       making `include: { agent }` impossible in reports/activity endpoints).
-- F-22: per-customer geofence radius override (null = use org-level MtmSetting).
-- F-29: discrete `metadataKind` column for indexed audit queries (was: JSON path scan).
--
-- NOTE: MTM tables were originally created via `prisma db push` (not via baseline
-- migration). This migration uses `IF EXISTS` / `IF NOT EXISTS` guards so it is a
-- no-op on fresh databases (where mtm tables don't yet exist — they'll be created
-- by next `db push` or follow-up baseline) AND on already-bootstrapped DBs (where
-- this is the actual delta). Idempotent on either path.

ALTER TABLE IF EXISTS "mtm_customers"
  ADD COLUMN IF NOT EXISTS "geofenceRadius" INTEGER;

ALTER TABLE IF EXISTS "mtm_audit_logs"
  ADD COLUMN IF NOT EXISTS "metadataKind" TEXT;

-- F-18: foreign key linking audit log agentId to mtm_agents.id.
-- ON DELETE SET NULL — preserve audit trail when agent is deleted.
-- Wrapped in DO block so we can guard on table existence + skip if constraint already exists.
--
-- DEPLOY SAFETY: before adding the FK we must NULL out any orphaned references
-- (agentId pointing at an MtmAgent that no longer exists). Without this step
-- the constraint creation would fail on production databases that have been
-- accumulating audit rows since before this FK existed. NULL is the correct
-- terminal state — ON DELETE SET NULL is the constraint's own behavior anyway.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mtm_audit_logs')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mtm_agents')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'mtm_audit_logs_agentId_fkey'
     ) THEN
    -- Step 1: null out orphaned agentId refs so the FK constraint can be created cleanly.
    UPDATE "mtm_audit_logs"
       SET "agentId" = NULL
     WHERE "agentId" IS NOT NULL
       AND "agentId" NOT IN (SELECT id FROM "mtm_agents");

    -- Step 2: add the FK with ON DELETE SET NULL (matches the orphan-handling we just did).
    ALTER TABLE "mtm_audit_logs"
      ADD CONSTRAINT "mtm_audit_logs_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "mtm_audit_logs_organizationId_metadataKind_idx"
  ON "mtm_audit_logs"("organizationId", "metadataKind");
