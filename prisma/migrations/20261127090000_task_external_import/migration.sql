-- Imported tasks remember where they came from (Zeytun's marketing board moved
-- over from Bordio, 2026-11-06). Both columns stay NULL for every task made in
-- the CRM; Postgres treats NULLs as distinct, so the unique index constrains
-- only imported rows and a re-run of the same import updates instead of
-- duplicating.
ALTER TABLE "tasks" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "tasks" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "tasks_organizationId_externalSource_externalId_key"
  ON "tasks"("organizationId", "externalSource", "externalId");
