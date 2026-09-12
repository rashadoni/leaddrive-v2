-- C2: effective-dated workforce site eligibility. This is independent from
-- Route assignments and does not infer attendance or travel compensation.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceSiteAssignmentKind" AS ENUM (
  'PRIMARY',
  'SECONDARY',
  'TEMPORARY'
);

CREATE TABLE "workforce_site_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "kind" "WorkforceSiteAssignmentKind" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_site_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_site_assignments_date_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "workforce_site_assignments_organizationId_id_key"
  ON "workforce_site_assignments"("organizationId", "id");
CREATE INDEX "workforce_site_assignments_org_agent_kind_window_idx"
  ON "workforce_site_assignments"("organizationId", "agentId", "kind", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_site_assignments_org_site_kind_window_idx"
  ON "workforce_site_assignments"("organizationId", "siteId", "kind", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_site_assignments_org_assigned_by_idx"
  ON "workforce_site_assignments"("organizationId", "assignedByUserId", "createdAt");

ALTER TABLE "workforce_site_assignments"
  ADD CONSTRAINT "workforce_site_assignments_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_assignments_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_assignments_site_fkey"
    FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_assignments_assigned_by_fkey"
    FOREIGN KEY ("organizationId", "assignedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assignment attributes are append-only. A replacement may close an open
-- earlier window once, preserving which site was expected at each date.
CREATE OR REPLACE FUNCTION workforce_guard_site_assignment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce site assignments are append-only' USING ERRCODE = '55000';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId"
     OR OLD."effectiveTo" IS NOT NULL
     OR NEW."effectiveTo" IS NULL THEN
    RAISE EXCEPTION 'Workforce site assignment is immutable; only an open window may be closed once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_site_assignments_append_only
  BEFORE UPDATE OR DELETE ON "workforce_site_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_site_assignment_mutation();

-- An employee has one primary site at a time. Secondary/temporary duplicate
-- windows for the same site/kind are also rejected; different secondary sites
-- may coexist intentionally. A site must still be active when assigned.
CREATE OR REPLACE FUNCTION workforce_validate_site_assignment_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  site_status "WorkforceSiteStatus";
BEGIN
  SELECT "status" INTO site_status
  FROM "workforce_sites"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."siteId";
  IF site_status IS DISTINCT FROM 'ACTIVE'::"WorkforceSiteStatus" THEN
    RAISE EXCEPTION 'Workforce site assignment requires an active site' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "workforce_site_assignments" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."agentId" = NEW."agentId"
      AND other."id" <> NEW."id"
      AND (NEW."kind" = 'PRIMARY'::"WorkforceSiteAssignmentKind"
        AND other."kind" = 'PRIMARY'::"WorkforceSiteAssignmentKind"
        OR NEW."kind" <> 'PRIMARY'::"WorkforceSiteAssignmentKind"
          AND other."kind" = NEW."kind" AND other."siteId" = NEW."siteId")
      AND daterange(other."effectiveFrom", COALESCE(other."effectiveTo", 'infinity'::date), '[]')
          && daterange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Workforce site assignment window overlaps another assignment' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_site_assignments_validate_window
  BEFORE INSERT OR UPDATE ON "workforce_site_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_site_assignment_window();

ALTER TABLE "workforce_site_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_site_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_site_assignments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
