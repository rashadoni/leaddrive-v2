ALTER TABLE "social_mentions"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "sourceMetadata" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "social_mentions_org_platform_source_type_idx"
  ON "social_mentions" ("organizationId", "platform", "sourceType");
