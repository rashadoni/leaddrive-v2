-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "swiftCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_organizationId_idx" ON "bank_accounts"("organizationId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
