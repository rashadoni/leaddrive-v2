-- Temporary read-only access for an outside reviewer under NDA (owner,
-- 2026-10-23: «Давай, делай доступ проверяющего по этому плану»).
--
-- One row per reviewer login: the sections granted, the reason, who granted
-- it and the end date (at most 30 days out; the API enforces it). Sign-in and
-- every session refresh refuse a reviewer whose row is missing, revoked or
-- past its end date (src/lib/auth.ts). The reads themselves go to the
-- append-only compliance_audit_log, not here.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).

SET lock_timeout = '3s';

CREATE TABLE "reviewer_access_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "grantedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  CONSTRAINT "reviewer_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviewer_access_grants_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviewer_access_grants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviewer_access_grants_reason_present" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "reviewer_access_grants_userId_key" ON "reviewer_access_grants"("userId");
CREATE INDEX "reviewer_access_grants_organizationId_expiresAt_idx"
  ON "reviewer_access_grants"("organizationId", "expiresAt");

ALTER TABLE "reviewer_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviewer_access_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reviewer_access_grants"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
