-- CreateEnum
CREATE TYPE "MtmTrainingRunStatus" AS ENUM ('DRAFT', 'UPLOADING', 'UPLOADED', 'TRAINING', 'READY', 'DEPLOYED', 'FAILED');

-- CreateTable
CREATE TABLE "mtm_model_training_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "MtmTrainingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "boxCount" INTEGER NOT NULL DEFAULT 0,
    "skuCount" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL DEFAULT 'coco',
    "roboflowProject" TEXT,
    "roboflowVersion" INTEGER,
    "metrics" JSONB,
    "notes" TEXT,
    "errorMessage" TEXT,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "mtm_model_training_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mtm_model_training_runs_organizationId_idx" ON "mtm_model_training_runs"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_model_training_runs_organizationId_status_idx" ON "mtm_model_training_runs"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "mtm_model_training_runs" ADD CONSTRAINT "mtm_model_training_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
