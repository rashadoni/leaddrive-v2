CREATE TABLE IF NOT EXISTS "social_reply_channel_settings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "senderAccountId" TEXT,
  "sendMode" TEXT NOT NULL DEFAULT 'approval',
  "liveEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_reply_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_reply_channel_settings_org_platform_key"
  ON "social_reply_channel_settings" ("organizationId", "platform");

CREATE INDEX IF NOT EXISTS "social_reply_channel_settings_sender_account_idx"
  ON "social_reply_channel_settings" ("senderAccountId");

ALTER TABLE "social_reply_channel_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_reply_channel_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_reply_channel_settings";
CREATE POLICY tenant_isolation ON "social_reply_channel_settings"
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
    SELECT 1 FROM pg_constraint WHERE conname = 'social_reply_channel_settings_organizationId_fkey'
  ) THEN
    ALTER TABLE "social_reply_channel_settings"
      ADD CONSTRAINT "social_reply_channel_settings_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_reply_channel_settings_senderAccountId_fkey'
  ) THEN
    ALTER TABLE "social_reply_channel_settings"
      ADD CONSTRAINT "social_reply_channel_settings_senderAccountId_fkey"
      FOREIGN KEY ("senderAccountId") REFERENCES "social_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
