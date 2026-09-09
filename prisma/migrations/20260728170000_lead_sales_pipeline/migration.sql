ALTER TABLE "leads" ADD COLUMN "pipelineId" TEXT;

CREATE INDEX "leads_organizationId_pipelineId_idx"
ON "leads"("organizationId", "pipelineId");

ALTER TABLE "leads"
ADD CONSTRAINT "leads_pipelineId_fkey"
FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
