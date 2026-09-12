-- C7: versioned team-default selection. The source of team eligibility is the
-- existing immutable membership timeline at workday start, not a mutable
-- directory team. No historical default or membership is inferred here.

SET lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "workforce_shift_team_default_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_shift_team_default_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_team_default_assignments_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "workforce_shift_team_default_assignments_organizationId_id_key"
  ON "workforce_shift_team_default_assignments"("organizationId", "id");
CREATE INDEX "workforce_shift_team_default_assignments_team_effective_idx"
  ON "workforce_shift_team_default_assignments"("organizationId", "teamId", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_shift_team_default_assignments_template_effective_idx"
  ON "workforce_shift_team_default_assignments"("organizationId", "templateId", "effectiveFrom");
CREATE INDEX "workforce_shift_team_default_assignments_assigned_by_idx"
  ON "workforce_shift_team_default_assignments"("organizationId", "assignedByUserId", "createdAt");
ALTER TABLE "workforce_shift_team_default_assignments"
  ADD CONSTRAINT "workforce_shift_team_default_assignments_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "teamId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  );
ALTER TABLE "workforce_shift_team_default_assignments"
  ADD CONSTRAINT "workforce_shift_team_default_assignments_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_assignments_team_fkey"
    FOREIGN KEY ("organizationId", "teamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_assignments_template_fkey"
    FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_assignments_assigned_by_fkey"
    FOREIGN KEY ("organizationId", "assignedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_shift_team_default_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_row "workforce_shift_templates"%ROWTYPE;
  team_active BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce team default shift assignment cannot be deleted; schedule a future replacement instead'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."teamId" IS DISTINCT FROM OLD."teamId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId" THEN
      RAISE EXCEPTION 'Workforce team default shift assignment identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
      IF NEW."effectiveTo" IS NULL
         OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
        RAISE EXCEPTION 'A Workforce team default shift window can only be narrowed' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "workforce_shift_snapshots"
        WHERE "organizationId" = OLD."organizationId"
          AND "teamDefaultAssignmentId" = OLD."id"
          AND "workDate" > NEW."effectiveTo"
      ) THEN
        RAISE EXCEPTION 'A Workforce team default shift window cannot exclude an existing snapshot' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT "isActive" INTO team_active
  FROM "mtm_teams"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."teamId";
  IF NOT FOUND OR team_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Workforce team default shift must reference an active tenant team' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO template_row
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND
     OR template_row."status" <> 'ACTIVE'::"WorkforceDefinitionStatus"
     OR template_row."teamId" IS DISTINCT FROM NEW."teamId" THEN
    RAISE EXCEPTION 'Workforce team default shift must reference an active matching-team template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_team_default_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "workforce_shift_team_default_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_team_default_assignment();

CREATE TABLE "workforce_shift_team_default_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "teamId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "teamDefaultAssignmentId" TEXT NOT NULL,
  "publishedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_shift_team_default_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_team_default_operations_hash_check"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "workforce_shift_team_default_operations_operation_id_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_shift_team_default_operations_organizationId_id_key"
  ON "workforce_shift_team_default_operations"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_shift_team_default_operations_organizationId_operationId_key"
  ON "workforce_shift_team_default_operations"("organizationId", "operationId");
CREATE INDEX "workforce_shift_team_default_operations_team_template_created_idx"
  ON "workforce_shift_team_default_operations"("organizationId", "teamId", "templateId", "createdAt");
CREATE INDEX "workforce_shift_team_default_operations_publisher_created_idx"
  ON "workforce_shift_team_default_operations"("organizationId", "publishedByUserId", "createdAt");
ALTER TABLE "workforce_shift_team_default_operations"
  ADD CONSTRAINT "workforce_shift_team_default_operations_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_operations_team_fkey"
    FOREIGN KEY ("organizationId", "teamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_operations_template_fkey"
    FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_operations_assignment_fkey"
    FOREIGN KEY ("organizationId", "teamDefaultAssignmentId") REFERENCES "workforce_shift_team_default_assignments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_team_default_operations_published_by_fkey"
    FOREIGN KEY ("organizationId", "publishedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_shift_team_default_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce team default shift operations are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_shift_team_default_operations_append_only
  BEFORE UPDATE OR DELETE ON "workforce_shift_team_default_operations"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_team_default_operation_mutation();

ALTER TABLE "workforce_shift_snapshots"
  ADD COLUMN "teamDefaultAssignmentId" TEXT;
CREATE INDEX "workforce_shift_snapshots_team_default_assignment_idx"
  ON "workforce_shift_snapshots"("organizationId", "teamDefaultAssignmentId");
ALTER TABLE "workforce_shift_snapshots"
  ADD CONSTRAINT "workforce_shift_snapshots_team_default_assignment_fkey"
    FOREIGN KEY ("organizationId", "teamDefaultAssignmentId")
    REFERENCES "workforce_shift_team_default_assignments"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_default_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  default_row "workforce_shift_default_assignments"%ROWTYPE;
  team_default_row "workforce_shift_team_default_assignments"%ROWTYPE;
  membership_team_id TEXT;
BEGIN
  IF ((CASE WHEN NEW."assignmentId" IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN NEW."defaultAssignmentId" IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN NEW."teamDefaultAssignmentId" IS NULL THEN 0 ELSE 1 END)) > 1 THEN
    RAISE EXCEPTION 'Workforce shift snapshot cannot bind more than one assignment source' USING ERRCODE = '23514';
  END IF;

  IF NEW."defaultAssignmentId" IS NOT NULL THEN
    SELECT * INTO default_row
    FROM "workforce_shift_default_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."defaultAssignmentId";
    IF NOT FOUND
       OR default_row."templateId" <> NEW."templateId"
       OR default_row."effectiveFrom" > NEW."workDate"
       OR (default_row."effectiveTo" IS NOT NULL AND default_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot default assignment must cover its template and work date' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."teamDefaultAssignmentId" IS NOT NULL THEN
    SELECT * INTO team_default_row
    FROM "workforce_shift_team_default_assignments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."teamDefaultAssignmentId";
    IF NOT FOUND
       OR team_default_row."templateId" <> NEW."templateId"
       OR team_default_row."effectiveFrom" > NEW."workDate"
       OR (team_default_row."effectiveTo" IS NOT NULL AND team_default_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce shift snapshot team default must cover its template and work date' USING ERRCODE = '23514';
    END IF;
    SELECT membership."teamId" INTO membership_team_id
    FROM "mtm_agent_workdays" AS workday
    JOIN LATERAL (
      SELECT "teamId"
      FROM "workforce_employee_team_memberships"
      WHERE "organizationId" = NEW."organizationId"
        AND "agentId" = NEW."agentId"
        AND "effectiveAt" <= workday."startedAt"
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
    ) AS membership ON TRUE
    WHERE workday."organizationId" = NEW."organizationId"
      AND workday."id" = NEW."workdayId";
    IF membership_team_id IS DISTINCT FROM team_default_row."teamId" THEN
      RAISE EXCEPTION 'Workforce shift snapshot team default must match immutable workday-start membership' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "workforce_shift_team_default_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_shift_team_default_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_shift_team_default_assignments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "workforce_shift_team_default_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_shift_team_default_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_shift_team_default_operations"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
