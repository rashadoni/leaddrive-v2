ALTER TABLE "web_chat_messages" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
ALTER TABLE "web_chat_messages" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "web_chat_messages" ADD COLUMN IF NOT EXISTS "attachmentType" TEXT;
ALTER TABLE "web_chat_messages" ADD COLUMN IF NOT EXISTS "attachmentSize" INTEGER;
