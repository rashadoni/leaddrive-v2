-- WhatsApp multi-tenant redesign — Phase 1
--
-- 1. Add proper per-tenant WhatsApp credential columns to channel_configs.
--    The legacy trio (apiKey, phoneNumber, webhookUrl) is kept for other
--    channel types and backward compat. The whatsapp library reads the
--    new columns first and falls back to the legacy ones one release cycle.
--
-- 2. New whatsapp_templates table — single source of truth for approved
--    message templates synced from Meta Business Manager. Removes the
--    "invoice_payment_reminder" hardcode in src/lib/whatsapp.ts.
--
-- 3. Non-destructive backfill for existing whatsapp ChannelConfig rows:
--    copy legacy apiKey/phoneNumber/webhookUrl into the new columns so
--    nothing breaks on cold start.

-- ── 1. ChannelConfig: new columns ───────────────────────────────────
ALTER TABLE "channel_configs"
  ADD COLUMN "accessToken"         TEXT,
  ADD COLUMN "phoneNumberId"       TEXT,
  ADD COLUMN "businessAccountId"   TEXT,
  ADD COLUMN "verifyToken"         TEXT,
  ADD COLUMN "displayName"         TEXT,
  ADD COLUMN "lastValidatedAt"     TIMESTAMP(3),
  ADD COLUMN "lastTemplateSyncAt"  TIMESTAMP(3);

-- ── 2. Backfill whatsapp rows from legacy columns ───────────────────
UPDATE "channel_configs"
SET
  "accessToken"       = COALESCE("accessToken", "apiKey"),
  "phoneNumberId"     = COALESCE("phoneNumberId", "phoneNumber"),
  "businessAccountId" = COALESCE("businessAccountId", "webhookUrl")
WHERE "channelType" = 'whatsapp';

-- ── 3. New whatsapp_templates table ─────────────────────────────────
CREATE TABLE "whatsapp_templates" (
  "id"               TEXT        NOT NULL,
  "organizationId"   TEXT        NOT NULL,
  "channelConfigId"  TEXT        NOT NULL,
  "metaTemplateId"   TEXT,
  "name"             TEXT        NOT NULL,
  "category"         TEXT        NOT NULL,
  "language"         TEXT        NOT NULL,
  "status"           TEXT        NOT NULL,
  "bodyText"         TEXT,
  "headerType"       TEXT,
  "headerText"       TEXT,
  "footerText"       TEXT,
  "buttons"          JSONB,
  "variables"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rawMeta"          JSONB,
  "lastSyncAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_templates_organizationId_name_language_key"
  ON "whatsapp_templates"("organizationId", "name", "language");

CREATE INDEX "whatsapp_templates_organizationId_status_idx"
  ON "whatsapp_templates"("organizationId", "status");

CREATE INDEX "whatsapp_templates_channelConfigId_idx"
  ON "whatsapp_templates"("channelConfigId");

ALTER TABLE "whatsapp_templates"
  ADD CONSTRAINT "whatsapp_templates_channelConfigId_fkey"
  FOREIGN KEY ("channelConfigId")
  REFERENCES "channel_configs"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
