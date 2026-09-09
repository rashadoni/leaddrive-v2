-- SWM-15A: signed tenant coverage policies and immutable employee/period
-- population snapshots. This migration is additive and deliberately creates
-- no policy or snapshot data: coverage stays unavailable until an approved
-- tenant definition is signed and a complete population is frozen.

SET lock_timeout = '3s';

CREATE TYPE "MtmCoveragePolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "MtmCoverageSnapshotStatus" AS ENUM ('BUILDING', 'FROZEN', 'FAILED');
CREATE TYPE "MtmCoverageSubjectType" AS ENUM ('DOCTOR', 'PHARMACY');

CREATE TABLE "mtm_coverage_policies" (
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
  "status" "MtmCoveragePolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_coverage_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_coverage_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "MtmCoverageSnapshotStatus" NOT NULL DEFAULT 'BUILDING',
  "sourceCutoffAt" TIMESTAMP(3) NOT NULL,
  "sourceFreshnessAt" TIMESTAMP(3),
  "populationHash" VARCHAR(64) NOT NULL,
  "totals" JSONB,
  "completeness" JSONB,
  "failureReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "frozenByUserId" TEXT,
  "frozenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_coverage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_coverage_snapshot_rows" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "rowHash" VARCHAR(64) NOT NULL,
  "subjectType" "MtmCoverageSubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "subjectName" TEXT NOT NULL,
  "customerId" TEXT,
  "customerName" TEXT,
  "ownerAgentId" TEXT NOT NULL,
  "ownerAgentName" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "groupLabel" TEXT NOT NULL,
  "groupOrder" INTEGER NOT NULL DEFAULT 0,
  "categoryCode" TEXT,
  "categoryLabel" TEXT,
  "specialtyCode" TEXT,
  "specialtyName" TEXT,
  "requiredCoverage" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "actualMoi" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "target" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "actualCoverage" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uncoveredMoi" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "explanation" JSONB NOT NULL,
  "planningContext" JSONB NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_coverage_snapshot_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_cov_policy_org_code_version_key"
  ON "mtm_coverage_policies"("organizationId", "code", "version");
CREATE UNIQUE INDEX "mtm_cov_policy_org_id_key"
  ON "mtm_coverage_policies"("organizationId", "id");
CREATE INDEX "mtm_cov_policy_org_status_effective_idx"
  ON "mtm_coverage_policies"("organizationId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "mtm_cov_policy_one_active_org_key"
  ON "mtm_coverage_policies"("organizationId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "mtm_cov_snapshot_org_agent_period_policy_key"
  ON "mtm_coverage_snapshots"("organizationId", "agentId", "periodStart", "periodEnd", "policyId");
CREATE UNIQUE INDEX "mtm_cov_snapshot_org_id_key"
  ON "mtm_coverage_snapshots"("organizationId", "id");
CREATE INDEX "mtm_cov_snapshot_org_agent_status_period_idx"
  ON "mtm_coverage_snapshots"("organizationId", "agentId", "status", "periodStart", "periodEnd");
CREATE INDEX "mtm_cov_snapshot_org_policy_created_idx"
  ON "mtm_coverage_snapshots"("organizationId", "policyId", "createdAt");

CREATE UNIQUE INDEX "mtm_cov_row_snapshot_hash_key"
  ON "mtm_coverage_snapshot_rows"("snapshotId", "rowHash");
CREATE INDEX "mtm_cov_row_org_snapshot_group_idx"
  ON "mtm_coverage_snapshot_rows"("organizationId", "snapshotId", "groupOrder", "groupKey");
CREATE INDEX "mtm_cov_row_org_snapshot_subject_idx"
  ON "mtm_coverage_snapshot_rows"("organizationId", "snapshotId", "subjectType", "subjectId");
CREATE INDEX "mtm_cov_row_org_owner_subject_idx"
  ON "mtm_coverage_snapshot_rows"("organizationId", "ownerAgentId", "subjectType");

ALTER TABLE "mtm_coverage_policies"
  ADD CONSTRAINT "mtm_coverage_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_coverage_snapshots"
  ADD CONSTRAINT "mtm_coverage_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_coverage_snapshots"
  ADD CONSTRAINT "mtm_cov_snapshot_org_policy_fk"
  FOREIGN KEY ("organizationId", "policyId") REFERENCES "mtm_coverage_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_coverage_snapshot_rows"
  ADD CONSTRAINT "mtm_coverage_snapshot_rows_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_coverage_snapshot_rows"
  ADD CONSTRAINT "mtm_cov_row_org_snapshot_fk"
  FOREIGN KEY ("organizationId", "snapshotId") REFERENCES "mtm_coverage_snapshots"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_coverage_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_coverage_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_coverage_policies"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_coverage_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_coverage_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_coverage_snapshots"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_coverage_snapshot_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_coverage_snapshot_rows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_coverage_snapshot_rows"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_coverage_snapshots"
  ADD CONSTRAINT "mtm_cov_snapshot_period_check" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "mtm_coverage_policies"
  ADD CONSTRAINT "mtm_cov_policy_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "mtm_coverage_policies"
  ADD CONSTRAINT "mtm_cov_policy_signature_check" CHECK (
    ("status" = 'DRAFT' AND "approvalReference" IS NULL AND "signedByUserId" IS NULL AND "signedAt" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'ACTIVE' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'RETIRED' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
  );
ALTER TABLE "mtm_coverage_snapshots"
  ADD CONSTRAINT "mtm_cov_snapshot_freeze_check" CHECK (
    ("status" = 'BUILDING' AND "frozenByUserId" IS NULL AND "frozenAt" IS NULL AND "failureReason" IS NULL)
    OR
    ("status" = 'FROZEN' AND "frozenByUserId" IS NOT NULL AND "frozenAt" IS NOT NULL AND "totals" IS NOT NULL AND "completeness" IS NOT NULL AND "failureReason" IS NULL)
    OR
    ("status" = 'FAILED' AND "failureReason" IS NOT NULL AND "frozenByUserId" IS NULL AND "frozenAt" IS NULL)
  );
