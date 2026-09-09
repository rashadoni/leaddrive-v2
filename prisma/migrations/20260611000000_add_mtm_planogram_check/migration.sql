-- Slice B: persisted planogram compliance checks (was audit-log-only).
-- One row per agent-submitted verdict; analysisId links the optional
-- Slice-A inline shelf scan so supervisors see the AI score + photo next
-- to the human verdict.

-- CreateEnum
CREATE TYPE "MtmPlanogramCheckStatus" AS ENUM ('COMPLIANT', 'NON_COMPLIANT');

-- CreateTable
CREATE TABLE "mtm_planogram_checks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "visitId" TEXT,
    "planogramId" TEXT NOT NULL,
    "status" "MtmPlanogramCheckStatus" NOT NULL,
    "analysisId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtm_planogram_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mtm_planogram_checks_organizationId_createdAt_idx" ON "mtm_planogram_checks"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "mtm_planogram_checks_organizationId_customerId_idx" ON "mtm_planogram_checks"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "mtm_planogram_checks_organizationId_agentId_idx" ON "mtm_planogram_checks"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "mtm_planogram_checks_planogramId_idx" ON "mtm_planogram_checks"("planogramId");

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "mtm_planograms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_checks" ADD CONSTRAINT "mtm_planogram_checks_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "mtm_shelf_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
