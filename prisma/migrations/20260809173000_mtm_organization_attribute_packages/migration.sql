-- SWM-07 / SWM-08: signed tenant packages for organization attributes that
-- cannot be inferred from CRM data (medical category, license, polygon).
-- The migration is additive and creates no tenant facts.

SET lock_timeout = '3s';

CREATE TYPE "MtmOrganizationAttributePackageStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "mtm_organization_attribute_packages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "rowsHash" VARCHAR(64) NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "status" "MtmOrganizationAttributePackageStatus" NOT NULL DEFAULT 'DRAFT',
  "approvalReference" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_organization_attribute_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_organization_attribute_facts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "organizationCode" TEXT NOT NULL,
  "medicalCategoryCode" TEXT,
  "medicalCategoryLabels" JSONB,
  "licenseStatus" TEXT,
  "licenseLabels" JSONB,
  "polygonCode" TEXT,
  "polygonLabels" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_organization_attribute_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_org_attribute_packages_org_id_key"
  ON "mtm_organization_attribute_packages"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_org_attribute_packages_org_version_key"
  ON "mtm_organization_attribute_packages"("organizationId", "version");
CREATE UNIQUE INDEX "mtm_org_attribute_packages_one_active_key"
  ON "mtm_organization_attribute_packages"("organizationId") WHERE "status" = 'ACTIVE';
CREATE INDEX "mtm_org_attribute_packages_status_idx"
  ON "mtm_organization_attribute_packages"("organizationId", "status", "effectiveFrom");

CREATE UNIQUE INDEX "mtm_org_attribute_facts_package_customer_key"
  ON "mtm_organization_attribute_facts"("packageId", "customerId");
CREATE INDEX "mtm_org_attribute_facts_customer_idx"
  ON "mtm_organization_attribute_facts"("organizationId", "customerId", "packageId");
CREATE INDEX "mtm_org_attribute_facts_category_idx"
  ON "mtm_organization_attribute_facts"("organizationId", "medicalCategoryCode", "packageId");
CREATE INDEX "mtm_org_attribute_facts_license_idx"
  ON "mtm_organization_attribute_facts"("organizationId", "licenseStatus", "packageId");
CREATE INDEX "mtm_org_attribute_facts_polygon_idx"
  ON "mtm_organization_attribute_facts"("organizationId", "polygonCode", "packageId");

ALTER TABLE "mtm_organization_attribute_packages"
  ADD CONSTRAINT "mtm_org_attribute_packages_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_organization_attribute_facts"
  ADD CONSTRAINT "mtm_org_attribute_facts_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_org_attribute_facts_package_fkey"
  FOREIGN KEY ("organizationId", "packageId") REFERENCES "mtm_organization_attribute_packages"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_org_attribute_facts_customer_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_organization_attribute_packages"
  ADD CONSTRAINT "mtm_org_attribute_packages_signature_check" CHECK (
    ("status" = 'DRAFT' AND "approvalReference" IS NULL AND "signedByUserId" IS NULL AND "signedAt" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'ACTIVE' AND NULLIF(btrim("approvalReference"), '') IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'RETIRED' AND NULLIF(btrim("approvalReference"), '') IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "mtm_org_attribute_packages_hash_check" CHECK ("rowsHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "mtm_org_attribute_packages_count_check" CHECK ("rowCount" > 0 AND "rowCount" <= 50000);

ALTER TABLE "mtm_organization_attribute_facts"
  ADD CONSTRAINT "mtm_org_attribute_facts_license_check" CHECK (
    "licenseStatus" IS NULL OR "licenseStatus" IN ('LICENSED', 'UNLICENSED', 'NOT_REQUIRED')
  );

ALTER TABLE "mtm_organization_attribute_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_organization_attribute_packages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_organization_attribute_packages"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_organization_attribute_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_organization_attribute_facts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_organization_attribute_facts"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
