-- Phase 3b: internal agent notes on inbox conversations (private, keyed to the
-- persisted SocialConversation).

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialConversationId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_notes_organizationId_socialConversationId_creat_idx" ON "conversation_notes"("organizationId", "socialConversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_socialConversationId_fkey" FOREIGN KEY ("socialConversationId") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
