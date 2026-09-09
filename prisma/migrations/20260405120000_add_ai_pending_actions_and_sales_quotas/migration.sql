-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolInput" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_pending_actions_organizationId_status_idx" ON "ai_pending_actions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "sales_quotas_organizationId_idx" ON "sales_quotas"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotas_organizationId_userId_year_quarter_key" ON "sales_quotas"("organizationId", "userId", "year", "quarter");

-- AddForeignKey
ALTER TABLE "sales_quotas" ADD CONSTRAINT "sales_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
