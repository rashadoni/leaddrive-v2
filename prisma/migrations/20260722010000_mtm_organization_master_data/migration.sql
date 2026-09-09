-- GAP-002: SwissMed-parity geography, classification and accountable manager
-- fields for field organizations. Existing city/district columns stay intact
-- for backwards-compatible imports and mobile sync payloads.
ALTER TABLE "mtm_customers"
  ADD COLUMN "region" TEXT,
  ADD COLUMN "administrativeDistrict" TEXT,
  ADD COLUMN "locality" TEXT,
  ADD COLUMN "cityDistrict" TEXT,
  ADD COLUMN "specialization" TEXT,
  ADD COLUMN "organizationKind" TEXT,
  ADD COLUMN "polygon" JSONB,
  ADD COLUMN "managingManagerId" TEXT;

ALTER TABLE "mtm_customers"
  ADD CONSTRAINT "mtm_customers_managingManagerId_fkey"
  FOREIGN KEY ("managingManagerId") REFERENCES "mtm_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "mtm_customers_organizationId_region_administrativeDistrict_locality_idx"
  ON "mtm_customers"("organizationId", "region", "administrativeDistrict", "locality");
CREATE INDEX "mtm_customers_organizationId_managingManagerId_idx"
  ON "mtm_customers"("organizationId", "managingManagerId");
CREATE INDEX "mtm_customers_organizationId_status_objectType_idx"
  ON "mtm_customers"("organizationId", "status", "objectType");

CREATE TABLE "mtm_organization_assignment_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorAgentId" TEXT,
  "targetAgentId" TEXT,
  "effectiveFrom" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "request" JSONB NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_organization_assignment_operations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mtm_organization_assignment_operations"
  ADD CONSTRAINT "mtm_organization_assignment_operations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "mtm_organization_assignment_operations_organizationId_idempotencyKey_key"
  ON "mtm_organization_assignment_operations"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_organization_assignment_operations_organizationId_targetAgentId_createdAt_idx"
  ON "mtm_organization_assignment_operations"("organizationId", "targetAgentId", "createdAt");
