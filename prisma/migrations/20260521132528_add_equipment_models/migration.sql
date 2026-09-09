-- CreateEnum
CREATE TYPE "MtmEquipmentStatus" AS ENUM ('ACTIVE', 'IN_TRANSIT', 'IN_REPAIR', 'WAREHOUSE', 'WRITTEN_OFF', 'LOST');

-- CreateEnum
CREATE TYPE "MtmEquipmentCondition" AS ENUM ('WORKING', 'NEEDS_REPAIR', 'BROKEN');

-- CreateEnum
CREATE TYPE "MtmEquipmentEvent" AS ENUM ('INSTALLED', 'RELOCATED', 'INSPECTED', 'REPAIR_REQUESTED', 'REPAIRED', 'REPLACED', 'WRITTEN_OFF', 'STATUS_CHANGED', 'CONDITION_CHANGED');

-- CreateEnum
CREATE TYPE "MtmRepairPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MtmRepairStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "mtm_equipment_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "iconUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mtm_equipment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtm_equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "internalCode" TEXT,
    "model" TEXT,
    "manufacturer" TEXT,
    "manufacturingYear" INTEGER,
    "currentCustomerId" TEXT,
    "installedAt" TIMESTAMP(3),
    "status" "MtmEquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "condition" "MtmEquipmentCondition" NOT NULL DEFAULT 'WORKING',
    "purchasePrice" DECIMAL(12,2),
    "purchaseDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtm_equipment_history" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "eventType" "MtmEquipmentEvent" NOT NULL,
    "fromCustomerId" TEXT,
    "toCustomerId" TEXT,
    "notes" TEXT,
    "performedBy" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtm_equipment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtm_equipment_inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visitId" TEXT,
    "conditionBefore" "MtmEquipmentCondition" NOT NULL,
    "conditionAfter" "MtmEquipmentCondition" NOT NULL,
    "checklist" JSONB NOT NULL,
    "notes" TEXT,
    "photoUrls" JSONB NOT NULL DEFAULT '[]',
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtm_equipment_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtm_repair_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "priority" "MtmRepairPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MtmRepairStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expectedDays" INTEGER NOT NULL DEFAULT 3,
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNotes" TEXT,
    "partsUsed" JSONB,
    "totalCost" DECIMAL(10,2),
    "photoUrlsBefore" JSONB NOT NULL DEFAULT '[]',
    "photoUrlsAfter" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "mtm_repair_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mtm_equipment_types_organizationId_code_key" ON "mtm_equipment_types"("organizationId", "code");

-- CreateIndex
CREATE INDEX "mtm_equipment_types_organizationId_idx" ON "mtm_equipment_types"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mtm_equipment_organizationId_serialNumber_key" ON "mtm_equipment"("organizationId", "serialNumber");

-- CreateIndex
CREATE INDEX "mtm_equipment_organizationId_idx" ON "mtm_equipment"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_equipment_currentCustomerId_idx" ON "mtm_equipment"("currentCustomerId");

-- CreateIndex
CREATE INDEX "mtm_equipment_status_idx" ON "mtm_equipment"("status");

-- CreateIndex
CREATE INDEX "mtm_equipment_history_organizationId_idx" ON "mtm_equipment_history"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_equipment_history_equipmentId_idx" ON "mtm_equipment_history"("equipmentId");

-- CreateIndex
CREATE INDEX "mtm_equipment_history_performedAt_idx" ON "mtm_equipment_history"("performedAt");

-- CreateIndex
CREATE INDEX "mtm_equipment_inspections_organizationId_idx" ON "mtm_equipment_inspections"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_equipment_inspections_equipmentId_idx" ON "mtm_equipment_inspections"("equipmentId");

-- CreateIndex
CREATE INDEX "mtm_repair_requests_organizationId_idx" ON "mtm_repair_requests"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_repair_requests_equipmentId_idx" ON "mtm_repair_requests"("equipmentId");

-- CreateIndex
CREATE INDEX "mtm_repair_requests_status_idx" ON "mtm_repair_requests"("status");

-- CreateIndex
CREATE INDEX "mtm_repair_requests_assignedTo_idx" ON "mtm_repair_requests"("assignedTo");

-- AddForeignKey
ALTER TABLE "mtm_equipment_types" ADD CONSTRAINT "mtm_equipment_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment" ADD CONSTRAINT "mtm_equipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment" ADD CONSTRAINT "mtm_equipment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "mtm_equipment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment" ADD CONSTRAINT "mtm_equipment_currentCustomerId_fkey" FOREIGN KEY ("currentCustomerId") REFERENCES "mtm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment_history" ADD CONSTRAINT "mtm_equipment_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment_history" ADD CONSTRAINT "mtm_equipment_history_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "mtm_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment_inspections" ADD CONSTRAINT "mtm_equipment_inspections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_equipment_inspections" ADD CONSTRAINT "mtm_equipment_inspections_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "mtm_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_repair_requests" ADD CONSTRAINT "mtm_repair_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_repair_requests" ADD CONSTRAINT "mtm_repair_requests_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "mtm_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
