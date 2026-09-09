-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialConversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_socialConversationId_userId_key" ON "conversation_participants"("socialConversationId", "userId");

-- CreateIndex
CREATE INDEX "conversation_participants_organizationId_userId_idx" ON "conversation_participants"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_socialConversationId_fkey" FOREIGN KEY ("socialConversationId") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
