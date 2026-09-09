-- Immutable mobile promise and promise-vs-fact events. LeadDrive stores only
-- external product/brand references; LeadShelf remains the catalog/order owner.

CREATE TYPE "MtmCommitmentOutcome" AS ENUM (
  'FULFILLED',
  'PARTIAL',
  'NOT_FULFILLED'
);

CREATE TABLE "mtm_commitments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "visitId" TEXT,
  "customerId" TEXT NOT NULL,
  "contactId" TEXT,
  "clientCommitmentId" TEXT NOT NULL,
  "productExternalId" TEXT,
  "productName" TEXT NOT NULL,
  "brandExternalId" TEXT,
  "brandName" TEXT,
  "promisedQuantity" DECIMAL(14,2) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'unit',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "evidencePhotoId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_commitments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_commitments_quantity_check" CHECK ("promisedQuantity" > 0),
  CONSTRAINT "mtm_commitments_product_name_check" CHECK (char_length(btrim("productName")) BETWEEN 1 AND 200),
  CONSTRAINT "mtm_commitments_unit_check" CHECK (char_length(btrim("unit")) BETWEEN 1 AND 40),
  CONSTRAINT "mtm_commitments_due_check" CHECK ("dueAt" >= "submittedAt"),
  CONSTRAINT "mtm_commitments_client_id_check" CHECK (char_length("clientCommitmentId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_commitments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitments_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitments_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitments_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitments_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitments_evidencePhotoId_fkey"
    FOREIGN KEY ("evidencePhotoId") REFERENCES "mtm_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "mtm_commitment_fulfillments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "clientFulfillmentId" TEXT NOT NULL,
  "outcome" "MtmCommitmentOutcome" NOT NULL,
  "actualQuantity" DECIMAL(14,2) NOT NULL,
  "varianceQuantity" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "evidencePhotoId" TEXT,
  "fulfilledAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_commitment_fulfillments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_commitment_fulfillments_actual_check" CHECK ("actualQuantity" >= 0),
  CONSTRAINT "mtm_commitment_fulfillments_client_id_check" CHECK (char_length("clientFulfillmentId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_commitment_fulfillments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitment_fulfillments_commitmentId_fkey"
    FOREIGN KEY ("commitmentId") REFERENCES "mtm_commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitment_fulfillments_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_commitment_fulfillments_evidencePhotoId_fkey"
    FOREIGN KEY ("evidencePhotoId") REFERENCES "mtm_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_commitments_organizationId_agentId_clientCommitmentId_key"
  ON "mtm_commitments"("organizationId", "agentId", "clientCommitmentId");
CREATE INDEX "mtm_commitments_organizationId_agentId_dueAt_idx"
  ON "mtm_commitments"("organizationId", "agentId", "dueAt");
CREATE INDEX "mtm_commitments_organizationId_customerId_dueAt_idx"
  ON "mtm_commitments"("organizationId", "customerId", "dueAt");
CREATE INDEX "mtm_commitments_organizationId_contactId_dueAt_idx"
  ON "mtm_commitments"("organizationId", "contactId", "dueAt");
CREATE INDEX "mtm_commitments_evidencePhotoId_idx" ON "mtm_commitments"("evidencePhotoId");

CREATE UNIQUE INDEX "mtm_commitment_fulfillments_commitmentId_key"
  ON "mtm_commitment_fulfillments"("commitmentId");
CREATE UNIQUE INDEX "mtm_commitment_fulfillments_organizationId_agentId_clientFulfillmentId_key"
  ON "mtm_commitment_fulfillments"("organizationId", "agentId", "clientFulfillmentId");
CREATE INDEX "mtm_commitment_fulfillments_organizationId_agentId_fulfilledAt_idx"
  ON "mtm_commitment_fulfillments"("organizationId", "agentId", "fulfilledAt");
CREATE INDEX "mtm_commitment_fulfillments_organizationId_commitmentId_idx"
  ON "mtm_commitment_fulfillments"("organizationId", "commitmentId");
CREATE INDEX "mtm_commitment_fulfillments_evidencePhotoId_idx"
  ON "mtm_commitment_fulfillments"("evidencePhotoId");

ALTER TABLE "mtm_commitments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_commitments_tenant_isolation"
  ON "mtm_commitments"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_commitment_fulfillments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitment_fulfillments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_commitment_fulfillments_tenant_isolation"
  ON "mtm_commitment_fulfillments"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
