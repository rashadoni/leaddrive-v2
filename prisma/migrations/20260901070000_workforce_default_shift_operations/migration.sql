-- C7: immutable receipt for an explicitly confirmed, future-only Workforce
-- organization-default shift publication. It records a retry-safe link to the
-- effective timeline row, never an employee roster or attendance evidence.

SET lock_timeout = '3s';

CREATE TABLE "workforce_shift_default_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "templateId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "defaultAssignmentId" TEXT NOT NULL,
  "publishedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_shift_default_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_default_operations_hash_check"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "workforce_shift_default_operations_operation_id_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_shift_default_operations_organizationId_id_key"
  ON "workforce_shift_default_operations"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_shift_default_operations_organizationId_operationId_key"
  ON "workforce_shift_default_operations"("organizationId", "operationId");
CREATE INDEX "workforce_shift_default_operations_org_template_created_idx"
  ON "workforce_shift_default_operations"("organizationId", "templateId", "createdAt");
CREATE INDEX "workforce_shift_default_operations_org_publisher_created_idx"
  ON "workforce_shift_default_operations"("organizationId", "publishedByUserId", "createdAt");

ALTER TABLE "workforce_shift_default_operations"
  ADD CONSTRAINT "workforce_shift_default_operations_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_default_operations_template_fkey"
    FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_default_operations_assignment_fkey"
    FOREIGN KEY ("organizationId", "defaultAssignmentId") REFERENCES "workforce_shift_default_assignments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_default_operations_published_by_fkey"
    FOREIGN KEY ("organizationId", "publishedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_shift_default_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce default shift operations are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_shift_default_operations_append_only
  BEFORE UPDATE OR DELETE ON "workforce_shift_default_operations"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_default_operation_mutation();

ALTER TABLE "workforce_shift_default_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_shift_default_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_shift_default_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
