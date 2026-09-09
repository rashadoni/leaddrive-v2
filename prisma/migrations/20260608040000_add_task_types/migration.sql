-- Slice 1: org-wide configurable Task types (Bordio-style "Task types").
-- Task.type stays a String; it is validated dynamically against task_types.name
-- (same canonical-string + config-table shape as Task.status + board_columns).
-- Seeds the 5 legacy types (task/bug/feature/story/epic) for every existing org
-- so current tasks keep a valid, labelled type. Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS "task_types" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "displayName"    TEXT NOT NULL,
  "color"          TEXT NOT NULL DEFAULT '#6B7280',
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- FK → organizations (idempotent), cascade on org delete.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_types_organizationId_fkey'
  ) THEN
    ALTER TABLE "task_types"
      ADD CONSTRAINT "task_types_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "task_types_organizationId_idx" ON "task_types"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "task_types_organizationId_name_key" ON "task_types"("organizationId", "name");

-- Seed the 5 legacy types for every existing org (colors mirror board-reports.tsx
-- TYPE_COLOR). ON CONFLICT keeps re-runs and re-seeds harmless.
INSERT INTO "task_types" ("id", "organizationId", "name", "displayName", "color", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", t."name", t."displayName", t."color", t."sortOrder", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('task',    'Task',    '#EA580C', 0),
  ('bug',     'Bug',     '#DE350B', 1),
  ('feature', 'Feature', '#00B8D9', 2),
  ('story',   'Story',   '#00875A', 3),
  ('epic',    'Epic',    '#6554C0', 4)
) AS t("name", "displayName", "color", "sortOrder")
ON CONFLICT ("organizationId", "name") DO NOTHING;
