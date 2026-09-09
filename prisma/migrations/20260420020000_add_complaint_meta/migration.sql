-- CreateTable: complaint_meta stores industry-specific fields for complaint-type tickets
CREATE TABLE "complaint_meta" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalRegistryNumber" INTEGER,
    "complaintType" TEXT NOT NULL DEFAULT 'complaint',
    "brand" TEXT,
    "productionArea" TEXT,
    "productCategory" TEXT,
    "complaintObject" TEXT,
    "complaintObjectDetail" TEXT,
    "responsibleDepartment" TEXT,
    "riskLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_meta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "complaint_meta_ticketId_key" ON "complaint_meta"("ticketId");
CREATE INDEX "complaint_meta_organizationId_brand_idx" ON "complaint_meta"("organizationId", "brand");
CREATE INDEX "complaint_meta_organizationId_riskLevel_idx" ON "complaint_meta"("organizationId", "riskLevel");
CREATE INDEX "complaint_meta_organizationId_productCategory_idx" ON "complaint_meta"("organizationId", "productCategory");

ALTER TABLE "complaint_meta" ADD CONSTRAINT "complaint_meta_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
