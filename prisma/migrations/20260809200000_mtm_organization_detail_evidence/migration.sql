-- SWM-06: source-attributed organization departments, immutable coordinate
-- verification receipts, and private organization file provenance.
-- The migration is additive and does not infer or seed SwissMed facts.

SET lock_timeout = '3s';

CREATE TABLE "mtm_customer_departments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "contactPerson" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_customer_departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_customer_coordinate_verifications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "accuracyMeters" DOUBLE PRECISION,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "decisionReason" TEXT,
  "verifiedByUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_customer_coordinate_verifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mtm_documents"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "sourceObservedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "mtm_customer_departments_org_customer_code_key"
  ON "mtm_customer_departments"("organizationId", "customerId", "code");
CREATE INDEX "mtm_customer_departments_org_customer_archive_name_idx"
  ON "mtm_customer_departments"("organizationId", "customerId", "archivedAt", "name");
CREATE INDEX "mtm_customer_coordinate_verifications_org_customer_verified_idx"
  ON "mtm_customer_coordinate_verifications"("organizationId", "customerId", "verifiedAt");
CREATE INDEX "mtm_documents_org_customer_deleted_idx"
  ON "mtm_documents"("organizationId", "customerId", "deletedAt");

ALTER TABLE "mtm_customer_departments"
  ADD CONSTRAINT "mtm_customer_departments_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_customer_departments_customer_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_customer_coordinate_verifications"
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_customer_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_documents"
  ADD CONSTRAINT "mtm_documents_customer_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_customer_departments"
  ADD CONSTRAINT "mtm_customer_departments_name_check" CHECK (NULLIF(btrim("name"), '') IS NOT NULL),
  ADD CONSTRAINT "mtm_customer_departments_code_check" CHECK ("code" IS NULL OR NULLIF(btrim("code"), '') IS NOT NULL),
  ADD CONSTRAINT "mtm_customer_departments_source_check" CHECK (NULLIF(btrim("sourceSystem"), '') IS NOT NULL);

ALTER TABLE "mtm_customer_coordinate_verifications"
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_accuracy_check" CHECK ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0),
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_status_check" CHECK ("status" IN ('VERIFIED', 'REJECTED')),
  ADD CONSTRAINT "mtm_customer_coordinate_verifications_source_check" CHECK (NULLIF(btrim("sourceSystem"), '') IS NOT NULL);

ALTER TABLE "mtm_customer_departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_customer_departments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_customer_coordinate_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_coordinate_verifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_customer_coordinate_verifications"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
