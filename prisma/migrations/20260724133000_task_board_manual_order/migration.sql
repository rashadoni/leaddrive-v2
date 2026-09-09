ALTER TABLE "tasks"
ADD COLUMN "boardPosition" DOUBLE PRECISION NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "divisionId", COALESCE("boardColumnKey", "status")
      ORDER BY "dueDate" ASC NULLS LAST, "createdAt" ASC, "id" ASC
    ) * 1024 AS position
  FROM "tasks"
  WHERE "divisionId" IS NOT NULL
)
UPDATE "tasks"
SET "boardPosition" = ranked.position
FROM ranked
WHERE "tasks"."id" = ranked."id";

CREATE INDEX "tasks_organizationId_divisionId_boardColumnKey_boardPosition_idx"
ON "tasks"("organizationId", "divisionId", "boardColumnKey", "boardPosition");
