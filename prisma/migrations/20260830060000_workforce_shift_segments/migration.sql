-- C2: ordered planned portions of a single Workforce workday. These are
-- intentionally independent of Route customers, Route geofences and pay.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceShiftSegmentMode" AS ENUM (
  'SITE',
  'REMOTE',
  'FIELD',
  'TRAVEL',
  'ON_CALL',
  'EXCEPTION'
);

CREATE TABLE "workforce_shift_segments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "mode" "WorkforceShiftSegmentMode" NOT NULL,
  "siteId" TEXT,
  "startTime" VARCHAR(5) NOT NULL,
  "endTime" VARCHAR(5) NOT NULL,
  "lateGraceSeconds" INTEGER NOT NULL DEFAULT 0,
  "proofPolicyReference" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_shift_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_segments_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "workforce_shift_segments_time_format_check" CHECK (
    "startTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" > "startTime"
  ),
  CONSTRAINT "workforce_shift_segments_grace_check" CHECK ("lateGraceSeconds" >= 0 AND "lateGraceSeconds" <= 7200),
  CONSTRAINT "workforce_shift_segments_site_mode_check" CHECK (
    ("mode" = 'SITE'::"WorkforceShiftSegmentMode" AND "siteId" IS NOT NULL)
    OR ("mode" <> 'SITE'::"WorkforceShiftSegmentMode" AND "siteId" IS NULL)
  )
);

CREATE UNIQUE INDEX "workforce_shift_segments_organizationId_id_key"
  ON "workforce_shift_segments"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_shift_segments_org_template_sequence_key"
  ON "workforce_shift_segments"("organizationId", "templateId", "sequence");
CREATE INDEX "workforce_shift_segments_org_template_window_idx"
  ON "workforce_shift_segments"("organizationId", "templateId", "startTime", "endTime");
CREATE INDEX "workforce_shift_segments_org_site_created_idx"
  ON "workforce_shift_segments"("organizationId", "siteId", "createdAt");

ALTER TABLE "workforce_shift_segments"
  ADD CONSTRAINT "workforce_shift_segments_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_segments_template_fkey"
    FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_segments_site_fkey"
    FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A segment can be edited only while its parent template is a DRAFT. This
-- preserves the published schedule configuration even before C3 adds a
-- workday-level segment snapshot.
CREATE OR REPLACE FUNCTION workforce_guard_shift_segment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "WorkforceDefinitionStatus";
  parent_organization_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "status", "organizationId" INTO parent_status, parent_organization_id
    FROM "workforce_shift_templates"
    WHERE "id" = OLD."templateId" AND "organizationId" = OLD."organizationId";
  ELSE
    SELECT "status", "organizationId" INTO parent_status, parent_organization_id
    FROM "workforce_shift_templates"
    WHERE "id" = NEW."templateId" AND "organizationId" = NEW."organizationId";
  END IF;

  IF parent_organization_id IS NULL THEN
    RAISE EXCEPTION 'Workforce shift segment requires an existing template' USING ERRCODE = '23503';
  END IF;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"WorkforceDefinitionStatus" THEN
    RAISE EXCEPTION 'Published Workforce shift segments are immutable; create a new draft version' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_segments_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON "workforce_shift_segments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_segment_mutation();

-- Ordering is explicit and chronological. Intervals are half-open, so two
-- consecutive segments may meet at the same minute; overlapping segments are
-- rejected rather than producing two simultaneous attendance expectations.
CREATE OR REPLACE FUNCTION workforce_validate_shift_segment_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workforce_shift_segments" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."templateId" = NEW."templateId"
      AND other."id" <> NEW."id"
      AND other."startTime" < NEW."endTime"
      AND NEW."startTime" < other."endTime"
  ) THEN
    RAISE EXCEPTION 'Workforce shift segments must not overlap' USING ERRCODE = '23P01';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workforce_shift_segments" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."templateId" = NEW."templateId"
      AND other."id" <> NEW."id"
      AND (
        (other."sequence" < NEW."sequence" AND other."startTime" >= NEW."startTime")
        OR (other."sequence" > NEW."sequence" AND other."startTime" <= NEW."startTime")
      )
  ) THEN
    RAISE EXCEPTION 'Workforce shift segment sequence must match chronological order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_segments_validate_order
  BEFORE INSERT OR UPDATE ON "workforce_shift_segments"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_segment_order();

ALTER TABLE "workforce_shift_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_shift_segments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_shift_segments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
