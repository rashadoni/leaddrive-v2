CREATE TABLE IF NOT EXISTS "whatsapp_call_permissions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "recipientKey" TEXT NOT NULL,
  "userWaId" TEXT,
  "recipient" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "canRequest" BOOLEAN NOT NULL DEFAULT false,
  "canStartCall" BOOLEAN NOT NULL DEFAULT false,
  "requestMessageId" TEXT,
  "contextId" TEXT,
  "responseSource" TEXT,
  "isPermanent" BOOLEAN NOT NULL DEFAULT false,
  "requestedByUserId" TEXT,
  "requestedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "lastProviderStatus" TEXT,
  "lastError" TEXT,
  "actions" JSONB NOT NULL DEFAULT '[]',
  "providerPayload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_call_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_call_permissions_org_channel_recipient_key"
  ON "whatsapp_call_permissions" ("organizationId", "channelConfigId", "recipientKey");

CREATE INDEX IF NOT EXISTS "whatsapp_call_permissions_org_conversation_idx"
  ON "whatsapp_call_permissions" ("organizationId", "conversationId");

CREATE INDEX IF NOT EXISTS "whatsapp_call_permissions_org_contact_idx"
  ON "whatsapp_call_permissions" ("organizationId", "contactId");

CREATE INDEX IF NOT EXISTS "whatsapp_call_permissions_org_channel_status_idx"
  ON "whatsapp_call_permissions" ("organizationId", "channelConfigId", "status");

CREATE INDEX IF NOT EXISTS "whatsapp_call_permissions_org_user_wa_idx"
  ON "whatsapp_call_permissions" ("organizationId", "userWaId");

ALTER TABLE "whatsapp_call_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_call_permissions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_call_permissions";
CREATE POLICY tenant_isolation ON "whatsapp_call_permissions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_call_permissions_organizationId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_call_permissions"
      ADD CONSTRAINT "whatsapp_call_permissions_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_call_permissions_channelConfigId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_call_permissions"
      ADD CONSTRAINT "whatsapp_call_permissions_channelConfigId_fkey"
      FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
