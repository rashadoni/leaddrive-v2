-- Fresh-install compatibility: email_logs existed through the historical
-- bootstrap before insight/lead-link delta migrations were added.
CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "errorMessage" TEXT,
    "campaignId" TEXT,
    "templateId" TEXT,
    "contactId" TEXT,
    "variantId" TEXT,
    "sentBy" TEXT,
    "messageId" TEXT,
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_logs_organizationId_idx" ON "email_logs"("organizationId");
CREATE INDEX IF NOT EXISTS "email_logs_organizationId_status_idx" ON "email_logs"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "email_logs_organizationId_contactId_idx" ON "email_logs"("organizationId", "contactId");
CREATE INDEX IF NOT EXISTS "email_logs_variantId_idx" ON "email_logs"("variantId");
