ALTER TABLE "social_mentions"
  ADD COLUMN IF NOT EXISTS "whatsappGroupStatus" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "whatsappGroupDestination" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "whatsappGroupLastError" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappGroupDeliveredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "social_mentions_org_whatsapp_group_status_idx"
  ON "social_mentions" ("organizationId", "whatsappGroupStatus");
