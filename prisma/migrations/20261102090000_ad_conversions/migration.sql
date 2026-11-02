-- Ad conversions: new leads and won deals sent to an ad platform (Meta
-- Conversions API). The lead keeps where it came from; the destination keeps
-- its token as tenant-bound ciphertext; the event table is the outbox and its
-- history. Both new tables are tenant data under FORCE row-level security.
ALTER TABLE "leads" ADD COLUMN "adAttribution" JSONB;

CREATE TABLE "ad_conversion_destinations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "testEventCode" TEXT,
  "sendLeads" BOOLEAN NOT NULL DEFAULT true,
  "sendWins" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "consentConfirmedAt" TIMESTAMP(3),
  "consentConfirmedBy" TEXT,
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ad_conversion_destinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_conversion_destinations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ad_conversion_destinations_platform_check" CHECK ("platform" IN ('meta')),
  -- Sending without the consent statement is impossible, not just unlikely.
  CONSTRAINT "ad_conversion_destinations_consent_check" CHECK (NOT "isActive" OR ("consentConfirmedAt" IS NOT NULL AND "activatedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ad_conversion_destinations_organizationId_platform_key" ON "ad_conversion_destinations"("organizationId", "platform");

CREATE TABLE "ad_conversion_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "eventTime" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "recordLabel" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ad_conversion_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_conversion_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ad_conversion_events_destinationId_fkey"
    FOREIGN KEY ("destinationId") REFERENCES "ad_conversion_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ad_conversion_events_event_check" CHECK ("eventName" IN ('lead', 'purchase')),
  CONSTRAINT "ad_conversion_events_entity_check" CHECK ("entityType" IN ('lead', 'deal')),
  CONSTRAINT "ad_conversion_events_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT "ad_conversion_events_sent_check" CHECK (("status" = 'sent') = ("sentAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ad_conversion_events_destinationId_eventName_entityId_key" ON "ad_conversion_events"("destinationId", "eventName", "entityId");
CREATE INDEX "ad_conversion_events_organizationId_status_idx" ON "ad_conversion_events"("organizationId", "status");
CREATE INDEX "ad_conversion_events_destinationId_createdAt_idx" ON "ad_conversion_events"("destinationId", "createdAt");

ALTER TABLE "ad_conversion_destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_conversion_destinations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ad_conversion_destinations"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "ad_conversion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_conversion_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ad_conversion_events"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
