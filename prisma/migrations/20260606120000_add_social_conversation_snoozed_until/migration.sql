-- Phase 2 (via Option-D): snooze support for inbox conversations.
-- Additive nullable column — null = active, a future timestamp = snoozed until then.
-- AlterTable
ALTER TABLE "social_conversations" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "social_conversations_organizationId_snoozedUntil_idx" ON "social_conversations"("organizationId", "snoozedUntil");
