-- CreateTable
CREATE TABLE "deal_competitors" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "price" TEXT,
    "threat" TEXT NOT NULL DEFAULT 'Medium',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_competitors_dealId_idx" ON "deal_competitors"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_competitors_dealId_name_key" ON "deal_competitors"("dealId", "name");

-- AddForeignKey
ALTER TABLE "deal_competitors" ADD CONSTRAINT "deal_competitors_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
