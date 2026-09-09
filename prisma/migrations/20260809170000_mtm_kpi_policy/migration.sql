-- SWM-13: tenant-signed plan/GPS KPI formula policy. No seed is created: KPI
-- results remain explicitly non-authoritative until SwissMed approves a
-- version and an administrator activates its exact reviewed hash.

SET lock_timeout = '3s';

CREATE TYPE "MtmKpiPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "mtm_kpi_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "approvalReference" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "status" "MtmKpiPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_kpi_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_kpi_policy_org_code_version_key"
  ON "mtm_kpi_policies"("organizationId", "code", "version");
CREATE UNIQUE INDEX "mtm_kpi_policy_org_id_key"
  ON "mtm_kpi_policies"("organizationId", "id");
CREATE INDEX "mtm_kpi_policy_org_status_effective_idx"
  ON "mtm_kpi_policies"("organizationId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "mtm_kpi_policy_one_active_org_key"
  ON "mtm_kpi_policies"("organizationId") WHERE "status" = 'ACTIVE';

ALTER TABLE "mtm_kpi_policies"
  ADD CONSTRAINT "mtm_kpi_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_kpi_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_kpi_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_kpi_policies"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_kpi_policies"
  ADD CONSTRAINT "mtm_kpi_policy_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "mtm_kpi_policies"
  ADD CONSTRAINT "mtm_kpi_policy_signature_check" CHECK (
    ("status" = 'DRAFT' AND "approvalReference" IS NULL AND "signedByUserId" IS NULL AND "signedAt" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'ACTIVE' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'RETIRED' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
  );
