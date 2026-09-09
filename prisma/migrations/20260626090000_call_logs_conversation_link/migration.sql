-- E4.1 — Link VoIP CallLog rows back to the originating inbox conversation.
-- This is additive and nullable: existing calls remain valid, and call routing behavior
-- does not change until a UI/API caller explicitly passes conversationId.
ALTER TABLE "call_logs" ADD COLUMN "conversationId" TEXT;

CREATE INDEX "call_logs_organizationId_conversationId_idx"
  ON "call_logs"("organizationId", "conversationId");

ALTER TABLE "call_logs"
  ADD CONSTRAINT "call_logs_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "social_conversations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
