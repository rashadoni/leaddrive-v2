-- Epic A step 6: org-wide configurable Event types (Bordio "Event types") — the
-- channel/source axis on tasks (914 LINE / MOBIL OPERATORS LINE / SOCIAL MEDIA /
-- VIP GROUP WHATSAPP), used for filtering "what a task relates to". Mirrors the
-- task_types table. Also adds the nullable tasks."eventType" column. Idempotent.

CREATE TABLE IF NOT EXISTS "event_types" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "displayName"    TEXT NOT NULL,
  "color"          TEXT NOT NULL DEFAULT '#6B7280',
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- FK → organizations (idempotent), cascade on org delete.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_types_organizationId_fkey'
  ) THEN
    ALTER TABLE "event_types"
      ADD CONSTRAINT "event_types_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_types_organizationId_idx" ON "event_types"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "event_types_organizationId_name_key" ON "event_types"("organizationId", "name");

-- Tasks gain a nullable eventType (the channel/source value).
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "eventType" TEXT;

-- Seed the client's 4 channels for every existing org. ON CONFLICT keeps re-runs safe.
INSERT INTO "event_types" ("id", "organizationId", "name", "displayName", "color", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", t."name", t."displayName", t."color", t."sortOrder", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('914_line',             '914 LINE',             '#EAB308', 0),
  ('mobil_operators_line', 'MOBIL OPERATORS LINE', '#A855F7', 1),
  ('social_media',         'SOCIAL MEDIA',         '#EC4899', 2),
  ('vip_group_whatsapp',   'VIP GROUP WHATSAPP',   '#06B6D4', 3)
) AS t("name", "displayName", "color", "sortOrder")
ON CONFLICT ("organizationId", "name") DO NOTHING;
