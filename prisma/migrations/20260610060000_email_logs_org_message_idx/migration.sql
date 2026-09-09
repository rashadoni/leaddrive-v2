-- Index backing the inbound-email idempotency probe added in email-inbound (dedup):
-- findFirst by (organizationId, messageId) runs on every inbound email (hot webhook path).
-- Name matches Prisma's @@index([organizationId, messageId]) convention so migrate sees no drift.
CREATE INDEX IF NOT EXISTS "email_logs_organizationId_messageId_idx"
  ON "email_logs" ("organizationId", "messageId");
