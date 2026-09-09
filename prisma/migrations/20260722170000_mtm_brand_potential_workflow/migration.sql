CREATE TYPE "MtmFieldPotentialStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'ENDED');

ALTER TABLE "mtm_field_potentials"
  ADD COLUMN "agentId" TEXT,
  ADD COLUMN "enteredByAgentId" TEXT,
  ADD COLUMN "reviewedByAgentId" TEXT,
  ADD COLUMN "clientPotentialId" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "productName" TEXT,
  ADD COLUMN "categoryLabel" TEXT,
  ADD COLUMN "provenance" JSONB,
  ADD COLUMN "status" "MtmFieldPotentialStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewComment" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "supersedesPotentialId" TEXT;

-- Existing administrator-entered rows remain readable and are explicitly
-- marked as validated legacy facts. New API writes always include the
-- idempotency envelope and display-name snapshots.
UPDATE "mtm_field_potentials"
SET
  "clientPotentialId" = "id",
  "requestHash" = md5("id" || ':' || COALESCE("updatedAt"::text, '')),
  "brandName" = COALESCE("brandExternalId", "productExternalId", 'Legacy brand'),
  "status" = 'VERIFIED',
  "reviewedAt" = COALESCE("updatedAt", "createdAt")
WHERE "clientPotentialId" IS NULL;

CREATE UNIQUE INDEX "mtm_field_potentials_org_client_id_key"
  ON "mtm_field_potentials"("organizationId", "clientPotentialId");
CREATE INDEX "mtm_field_potentials_org_agent_period_idx"
  ON "mtm_field_potentials"("organizationId", "agentId", "periodStart", "periodEnd");
CREATE INDEX "mtm_field_potentials_org_status_created_idx"
  ON "mtm_field_potentials"("organizationId", "status", "createdAt");
CREATE INDEX "mtm_field_potentials_supersedes_idx"
  ON "mtm_field_potentials"("supersedesPotentialId");

ALTER TABLE "mtm_field_potentials"
  ADD CONSTRAINT "mtm_field_potentials_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_field_potentials_enteredByAgentId_fkey"
    FOREIGN KEY ("enteredByAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_field_potentials_reviewedByAgentId_fkey"
    FOREIGN KEY ("reviewedByAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_field_potentials_supersedesPotentialId_fkey"
    FOREIGN KEY ("supersedesPotentialId") REFERENCES "mtm_field_potentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "mtm_field_potential_evidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fieldPotentialId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_field_potential_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_field_potential_evidence_org_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_field_potential_evidence_potential_fkey"
    FOREIGN KEY ("fieldPotentialId") REFERENCES "mtm_field_potentials"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_field_potential_evidence_visit_fkey"
    FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_field_potential_evidence_pair_key"
  ON "mtm_field_potential_evidence"("fieldPotentialId", "visitId");
CREATE INDEX "mtm_field_potential_evidence_org_visit_idx"
  ON "mtm_field_potential_evidence"("organizationId", "visitId");

ALTER TABLE "mtm_field_potential_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_field_potential_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_field_potential_evidence_tenant_isolation" ON "mtm_field_potential_evidence"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
