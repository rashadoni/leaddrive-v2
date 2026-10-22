-- Recipient-level ledger. No existing campaign is enqueued or replayed by migration.
CREATE UNIQUE INDEX "campaigns_id_organizationId_key" ON "campaigns"("id", "organizationId");
CREATE TABLE "whatsapp_campaign_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "contactId" TEXT,
  "leadId" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "externalId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_campaign_delivery_campaign_fkey"
    FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_campaign_delivery_status_check"
    CHECK ("status" IN ('pending', 'sending', 'accepted', 'delivered', 'read', 'failed', 'unknown', 'skipped')),
  CONSTRAINT "whatsapp_campaign_delivery_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "wa_delivery_campaign_recipient_key" ON "whatsapp_campaign_deliveries"("campaignId", "recipientPhone");
CREATE INDEX "whatsapp_campaign_deliveries_status_nextAttemptAt_idx" ON "whatsapp_campaign_deliveries"("status", "nextAttemptAt");
CREATE INDEX "wa_delivery_org_campaign_status_idx" ON "whatsapp_campaign_deliveries"("organizationId", "campaignId", "status");
CREATE INDEX "whatsapp_campaign_deliveries_organizationId_externalId_idx" ON "whatsapp_campaign_deliveries"("organizationId", "externalId");
ALTER TABLE "whatsapp_campaign_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_campaign_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_campaign_deliveries"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
