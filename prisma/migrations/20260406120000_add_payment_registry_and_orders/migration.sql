-- CreateTable
CREATE TABLE "payment_registry_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "counterpartyName" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "billId" TEXT,
    "invoiceId" TEXT,
    "fundId" TEXT,
    "category" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_registry_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "billId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "purpose" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'bank_transfer',
    "bankDetails" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_registry_entries_organizationId_idx" ON "payment_registry_entries"("organizationId");
CREATE INDEX "payment_registry_entries_organizationId_direction_idx" ON "payment_registry_entries"("organizationId", "direction");
CREATE INDEX "payment_registry_entries_organizationId_paymentDate_idx" ON "payment_registry_entries"("organizationId", "paymentDate");
CREATE INDEX "payment_registry_entries_organizationId_sourceType_sourceId_idx" ON "payment_registry_entries"("organizationId", "sourceType", "sourceId");

CREATE UNIQUE INDEX "payment_orders_organizationId_orderNumber_key" ON "payment_orders"("organizationId", "orderNumber");
CREATE INDEX "payment_orders_organizationId_idx" ON "payment_orders"("organizationId");
CREATE INDEX "payment_orders_organizationId_status_idx" ON "payment_orders"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "payment_registry_entries" ADD CONSTRAINT "payment_registry_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
