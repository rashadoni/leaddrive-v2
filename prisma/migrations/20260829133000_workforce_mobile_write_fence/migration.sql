-- H6 mobile release gate. This migration is strictly additive: no existing
-- tenant receives a row, so every current mobile Workforce client stays in the
-- legacy-allowed posture until a session administrator explicitly configures a
-- tenant-local fence through the audited control plane.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceMobileWriteFenceMode" AS ENUM (
  'LEGACY_ALLOWED',
  'COHORT_ONLY',
  'FROZEN'
);

CREATE TABLE "workforce_mobile_write_fences" (
  "organizationId" TEXT NOT NULL,
  "mode" "WorkforceMobileWriteFenceMode" NOT NULL DEFAULT 'LEGACY_ALLOWED',
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_mobile_write_fences_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "workforce_mobile_write_fences"
  ADD CONSTRAINT "workforce_mobile_write_fences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_mobile_write_fences_updatedByUser_fkey"
  FOREIGN KEY ("organizationId", "updatedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "workforce_mobile_write_fences_mode_updatedAt_idx"
  ON "workforce_mobile_write_fences"("organizationId", "mode", "updatedAt");

ALTER TABLE "workforce_mobile_write_fences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_mobile_write_fences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_mobile_write_fences"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
