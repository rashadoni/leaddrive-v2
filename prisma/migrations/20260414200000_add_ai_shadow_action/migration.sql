-- CreateTable
CREATE TABLE "ai_shadow_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "approved" BOOLEAN,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_shadow_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_shadow_actions_organizationId_featureName_idx" ON "ai_shadow_actions"("organizationId", "featureName");

-- CreateIndex
CREATE INDEX "ai_shadow_actions_organizationId_approved_idx" ON "ai_shadow_actions"("organizationId", "approved");
