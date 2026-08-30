-- Effective-dated organization-default shift selection. `isDefault` remains
-- a read-only legacy fallback until an administrator schedules this timeline;
-- no historical default is guessed or backfilled by this migration.

SET lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "workforce_shift_default_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_shift_default_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_default_assignments_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "workforce_shift_default_assignments_organizationId_id_key"
  ON "workforce_shift_default_assignments"("organizationId", "id");
CREATE INDEX "workforce_shift_default_assignments_effective_idx"
  ON "workforce_shift_default_assignments"("organizationId", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_shift_default_assignments_template_effective_idx"
  ON "workforce_shift_default_assignments"("organizationId", "templateId", "effectiveFrom");
CREATE INDEX "workforce_shift_default_assignments_assigned_by_idx"
  ON "workforce_shift_default_assignments"("organizationId", "assignedByUserId", "createdAt");
ALTER TABLE "workforce_shift_default_assignments"
  ADD CONSTRAINT "workforce_shift_default_assignments_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  );

ALTER TABLE "workforce_shift_default_assignments"
  ADD CONSTRAINT "workforce_shift_default_assignments_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_default_assignments_template_fkey"
    FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_default_assignments_assigned_by_fkey"
    FOREIGN KEY ("organizationId", "assignedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_shift_snapshots"
  ADD COLUMN "defaultAssignmentId" TEXT;
CREATE INDEX "workforce_shift_snapshots_default_assignment_idx"
  ON "workforce_shift_snapshots"("organizationId", "defaultAssignmentId");
ALTER TABLE "workforce_shift_snapshots"
  ADD CONSTRAINT "workforce_shift_snapshots_default_assignment_fkey"
    FOREIGN KEY ("organizationId", "defaultAssignmentId")
    REFERENCES "workforce_shift_default_assignments"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_shift_default_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_row "workforce_shift_templates"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce default shift assignment cannot be deleted; schedule a future replacement instead'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId" THEN
      RAISE EXCEPTION 'Workforce default shift assignment identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
      IF NEW."effectiveTo" IS NULL
         OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
        RAISE EXCEPTION 'A Workforce default shift window can only be narrowed' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "workforce_shift_snapshots"
        WHERE "organizationId" = OLD."organizationId"
          AND "defaultAssignmentId" = OLD."id"
          AND "workDate" > NEW."effectiveTo"
      ) THEN
        RAISE EXCEPTION 'A Workforce default shift window cannot exclude an existing snapshot' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO template_row
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND OR template_row."status" <> 'ACTIVE'::"WorkforceDefinitionStatus" OR template_row."teamId" IS NOT NULL THEN
    RAISE EXCEPTION 'Workforce default shift must reference an active organization-scoped template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_default_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "workforce_shift_default_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_default_assignment();

CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_default_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  default_row "workforce_shift_default_assignments"%ROWTYPE;
BEGIN
  IF NEW."defaultAssignmentId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."assignmentId" IS NOT NULL THEN
    RAISE EXCEPTION 'Workforce shift snapshot cannot bind both an individual and default assignment' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO default_row
  FROM "workforce_shift_default_assignments"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."defaultAssignmentId";
  IF NOT FOUND
     OR default_row."templateId" <> NEW."templateId"
     OR default_row."effectiveFrom" > NEW."workDate"
     OR (default_row."effectiveTo" IS NOT NULL AND default_row."effectiveTo" < NEW."workDate") THEN
    RAISE EXCEPTION 'Workforce shift snapshot default assignment must cover its template and work date' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_snapshots_default_assignment_validate
  BEFORE INSERT ON "workforce_shift_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_snapshot_default_assignment();

ALTER TABLE "workforce_shift_default_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_shift_default_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workforce_shift_default_assignments_tenant_select"
  ON "workforce_shift_default_assignments" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "workforce_shift_default_assignments_tenant_insert"
  ON "workforce_shift_default_assignments" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "workforce_shift_default_assignments_tenant_update"
  ON "workforce_shift_default_assignments" FOR UPDATE
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
