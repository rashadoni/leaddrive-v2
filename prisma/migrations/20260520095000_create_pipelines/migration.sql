-- Fresh-install compatibility for customizable pipelines. pipeline_stages was
-- in the initial migration, while its parent table/column came from db push.
CREATE TABLE IF NOT EXISTS "pipelines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pipelines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pipelines_organizationId_idx" ON "pipelines"("organizationId");

ALTER TABLE "pipeline_stages" ADD COLUMN IF NOT EXISTS "pipelineId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pipeline_stages_pipelineId_fkey'
  ) THEN
    ALTER TABLE "pipeline_stages"
      ADD CONSTRAINT "pipeline_stages_pipelineId_fkey"
      FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "pipeline_stages_pipelineId_idx" ON "pipeline_stages"("pipelineId");
