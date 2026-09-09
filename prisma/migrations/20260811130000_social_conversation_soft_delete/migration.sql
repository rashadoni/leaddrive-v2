-- Deleting a conversation moves it to the trash rather than destroying it.
-- Messages, the lead it produced and the audit trail all keep pointing at a row
-- that still exists, so a mistaken delete is a reversible one.
--
-- Additive and nullable: every existing row reads as not deleted, and the
-- migration needs no tenant context because there is nothing to backfill.
ALTER TABLE "social_conversations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "social_conversations" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;

-- Every inbox listing filters on it, and the trash view filters the other way.
CREATE INDEX IF NOT EXISTS "social_conversations_org_deleted_idx"
  ON "social_conversations" ("organizationId", "deletedAt");
