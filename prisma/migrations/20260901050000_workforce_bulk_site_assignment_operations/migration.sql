-- C7: durable receipt for a reviewed, future-only bulk Workforce site
-- assignment publish. It is independent from Route and stores no employee
-- selection list or location evidence: immutable assignment rows remain the
-- sole per-employee history and this receipt proves only aggregate intent.

SET lock_timeout = '3s';

CREATE TABLE "workforce_site_assignment_bulk_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "siteId" TEXT NOT NULL,
  "kind" "WorkforceSiteAssignmentKind" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "requestedCount" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL,
  "unchangedCount" INTEGER NOT NULL,
  "publishedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_site_assignment_bulk_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_site_assignment_bulk_operations_window_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "workforce_site_assignment_bulk_operations_counts_check"
    CHECK (
      "requestedCount" > 0
      AND "createdCount" >= 0
      AND "unchangedCount" >= 0
      AND "createdCount" + "unchangedCount" = "requestedCount"
    ),
  CONSTRAINT "workforce_site_assignment_bulk_operations_hash_check"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "workforce_site_assignment_bulk_operations_operation_id_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_site_assignment_bulk_operations_organizationId_id_key"
  ON "workforce_site_assignment_bulk_operations"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_site_assignment_bulk_operations_organizationId_operationId_key"
  ON "workforce_site_assignment_bulk_operations"("organizationId", "operationId");
CREATE INDEX "workforce_site_assignment_bulk_operations_org_site_created_idx"
  ON "workforce_site_assignment_bulk_operations"("organizationId", "siteId", "createdAt");
CREATE INDEX "workforce_site_assignment_bulk_operations_org_publisher_created_idx"
  ON "workforce_site_assignment_bulk_operations"("organizationId", "publishedByUserId", "createdAt");

ALTER TABLE "workforce_site_assignment_bulk_operations"
  ADD CONSTRAINT "workforce_site_assignment_bulk_operations_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_assignment_bulk_operations_site_fkey"
    FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_assignment_bulk_operations_published_by_fkey"
    FOREIGN KEY ("organizationId", "publishedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_bulk_site_assignment_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce bulk site assignment operations are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_site_assignment_bulk_operations_append_only
  BEFORE UPDATE OR DELETE ON "workforce_site_assignment_bulk_operations"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_bulk_site_assignment_operation_mutation();

ALTER TABLE "workforce_site_assignment_bulk_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_site_assignment_bulk_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_site_assignment_bulk_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
