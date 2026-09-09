CREATE TABLE "advisor_playbooks" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "patternKey" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'disabled',
  "maxAutonomyLevel" TEXT NOT NULL DEFAULT 'L4',
  "dailyLimit" INTEGER NOT NULL DEFAULT 10,
  "approvalCount" INTEGER NOT NULL DEFAULT 0,
  "rejectionCount" INTEGER NOT NULL DEFAULT 0,
  "executionSuccessCount" INTEGER NOT NULL DEFAULT 0,
  "sourceActionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payloadTemplate" JSONB NOT NULL DEFAULT '{}',
  "promotedBy" TEXT,
  "promotedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "advisor_playbooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advisor_playbooks_organizationId_patternKey_key"
  ON "advisor_playbooks"("organizationId", "patternKey");

CREATE INDEX "advisor_playbooks_organizationId_status_idx"
  ON "advisor_playbooks"("organizationId", "status");

CREATE INDEX "advisor_playbooks_organizationId_domain_idx"
  ON "advisor_playbooks"("organizationId", "domain");
