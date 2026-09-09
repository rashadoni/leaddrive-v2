ALTER TABLE "web_chat_sessions" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
CREATE INDEX IF NOT EXISTS "web_chat_sessions_contactId_idx" ON "web_chat_sessions"("contactId");
