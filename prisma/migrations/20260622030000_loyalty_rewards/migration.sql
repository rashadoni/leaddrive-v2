-- D8 Loyalty — redeem rewards catalog (LoyaltyReward) + member claims (LoyaltyRedemption).

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "stockLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_redemptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "loyaltyRewardId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'fulfilled',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_rewards_org_active_idx" ON "loyalty_rewards"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_org_contact_idx" ON "loyalty_redemptions"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_org_reward_idx" ON "loyalty_redemptions"("organizationId", "loyaltyRewardId");

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_loyaltyRewardId_fkey" FOREIGN KEY ("loyaltyRewardId") REFERENCES "loyalty_rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (referenced by the schema doc comments)
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_points_cost_check" CHECK ("pointsCost" > 0);
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_status_check" CHECK ("status" IN ('fulfilled', 'pending', 'cancelled'));
