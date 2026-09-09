CREATE TABLE "mtm_contact_transfer_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "sourceAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "request" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "mtm_contact_transfer_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_contact_transfer_operations_organizationId_idempotencyKey_key"
    ON "mtm_contact_transfer_operations"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_contact_transfer_operations_organizationId_sourceAgentId_createdAt_idx"
    ON "mtm_contact_transfer_operations"("organizationId", "sourceAgentId", "createdAt");
CREATE INDEX "mtm_contact_transfer_operations_organizationId_targetAgentId_createdAt_idx"
    ON "mtm_contact_transfer_operations"("organizationId", "targetAgentId", "createdAt");

ALTER TABLE "mtm_contact_transfer_operations"
    ADD CONSTRAINT "mtm_contact_transfer_operations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
