-- Workforce H3 future-only lifecycle.
--
-- ACTIVE means a published definition; effectiveFrom/effectiveTo determines
-- when it applies. This migration permits consecutive published policy
-- versions only when their dates do not overlap. It changes no tenant data,
-- workdays, snapshots, calculations, approvals, or legacy MTM rows.

SET lock_timeout = '3s';

-- organizationId/teamId are text keys in the GiST exclusion constraints.
-- The foundation migration also installed btree_gist, but this migration stays
-- self-sufficient for an empty or schema-pushed CI baseline and for a restored
-- database whose extension catalog was rebuilt independently of migration
-- history. The operation is idempotent and changes no tenant row.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Inclusive dates become a half-open daterange so adjacent versions
-- (oldTo + 1 = newFrom) are valid while every overlap is rejected by
-- PostgreSQL itself.
ALTER TABLE "workforce_policies"
  ADD CONSTRAINT "workforce_policies_active_org_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE' AND "teamId" IS NULL);

ALTER TABLE "workforce_policies"
  ADD CONSTRAINT "workforce_policies_active_team_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "teamId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE' AND "teamId" IS NOT NULL);

-- Add the stronger date-range protections before removing the old
-- one-published-row indexes. A failed migration therefore preserves the
-- prior fail-closed uniqueness invariant.
DROP INDEX IF EXISTS "workforce_policies_one_active_org_key";
DROP INDEX IF EXISTS "workforce_policies_one_active_team_key";

-- Policy definitions remain immutable after publication. The only permitted
-- change to an ACTIVE policy is to narrow its end date, and the database
-- refuses that change if it would exclude an already-frozen policy snapshot.
CREATE OR REPLACE FUNCTION workforce_guard_published_policy_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD."status"::text;
  new_status TEXT := NEW."status"::text;
  allowed_keys TEXT[];
BEGIN
  allowed_keys := CASE old_status
    WHEN 'ACTIVE' THEN ARRAY['status', 'retiredAt', 'effectiveTo', 'updatedAt']
    WHEN 'RETIRED' THEN ARRAY['updatedAt']
    ELSE ARRAY[]::TEXT[]
  END;

  IF old_status <> 'DRAFT'
     AND (to_jsonb(NEW) - allowed_keys) IS DISTINCT FROM (to_jsonb(OLD) - allowed_keys) THEN
    RAISE EXCEPTION 'workforce_policies published definition content is immutable; create a new draft version'
      USING ERRCODE = '55000';
  END IF;

  IF old_status = 'ACTIVE' AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    IF NEW."effectiveTo" IS NULL
       OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
      RAISE EXCEPTION 'An active Workforce policy effective window can only be narrowed' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "workforce_policy_snapshots"
      WHERE "organizationId" = OLD."organizationId"
        AND "policyId" = OLD."id"
        AND "workDate" > NEW."effectiveTo"
    ) THEN
      RAISE EXCEPTION 'A Workforce policy effective window cannot exclude an existing snapshot' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'invalid Workforce policy transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'ACTIVE' AND new_status NOT IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'invalid Workforce policy transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'RETIRED' AND new_status <> 'RETIRED' THEN
    RAISE EXCEPTION 'retired Workforce policy cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER workforce_policies_published_definition_guard
  BEFORE UPDATE ON "workforce_policies"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_policy_definition();

-- A used assignment keeps its identity and existing covered facts forever.
-- A future replacement may only narrow the old assignment's end date, and
-- PostgreSQL rejects an update that would exclude any immutable shift fact.
CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_team_id TEXT;
  template_team_id TEXT;
  template_status "WorkforceDefinitionStatus";
BEGIN
  SELECT "teamId" INTO agent_team_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment agent is missing' USING ERRCODE = '23514';
  END IF;

  SELECT "teamId", "status" INTO template_team_id, template_status
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment template is missing' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND template_status <> 'ACTIVE'::"WorkforceDefinitionStatus" THEN
    RAISE EXCEPTION 'Workforce shift assignment template must be active' USING ERRCODE = '23514';
  END IF;
  IF template_team_id IS NOT NULL AND agent_team_id IS DISTINCT FROM template_team_id THEN
    RAISE EXCEPTION 'Workforce shift assignment template team must match its agent' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND EXISTS (
       SELECT 1
       FROM "workforce_shift_snapshots"
       WHERE "organizationId" = OLD."organizationId" AND "assignmentId" = OLD."id"
     ) THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId" THEN
      RAISE EXCEPTION 'Workforce shift assignment facts are immutable after a snapshot is created' USING ERRCODE = '55000';
    END IF;

    IF NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
      IF NEW."effectiveTo" IS NULL
         OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window can only be narrowed' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM "workforce_shift_snapshots"
        WHERE "organizationId" = OLD."organizationId"
          AND "assignmentId" = OLD."id"
          AND "workDate" > NEW."effectiveTo"
      ) THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window cannot exclude an existing snapshot' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
