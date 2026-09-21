-- Audit 2026-09-21: the MTM activity journal could not say which office user
-- acted. Nullable, no backfill and no foreign key: rows written before this
-- stay honest about not knowing, and deleting a user must not erase history.
ALTER TABLE "mtm_audit_logs" ADD COLUMN "actorUserId" TEXT;
