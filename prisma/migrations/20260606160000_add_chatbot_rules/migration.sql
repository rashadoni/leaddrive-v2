-- Phase 7 (inbox redesign) slice-1: inbound auto-reply rules.
-- Net-new table; no FK (orphan-on-delete, same choice as inbox_folders). Org
-- scoping is enforced in the API routes via organizationId.

-- CreateTable
CREATE TABLE "chatbot_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channelTypes" TEXT[] NOT NULL DEFAULT '{}',
    "triggerType" TEXT NOT NULL DEFAULT 'contains',
    "triggerValue" TEXT,
    "responseText" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatbot_rules_organizationId_idx" ON "chatbot_rules"("organizationId");
