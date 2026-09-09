-- CreateTable
CREATE TABLE "stage_validation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineStageId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "ruleValue" TEXT,
    "errorMessage" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_validation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stage_validation_rules_organizationId_idx" ON "stage_validation_rules"("organizationId");

-- CreateIndex
CREATE INDEX "stage_validation_rules_pipelineStageId_idx" ON "stage_validation_rules"("pipelineStageId");

-- AddForeignKey
ALTER TABLE "stage_validation_rules" ADD CONSTRAINT "stage_validation_rules_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
