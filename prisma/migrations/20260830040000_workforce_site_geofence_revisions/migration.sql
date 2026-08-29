-- C2: versioned Workforce-only circle geofences. A geometry cannot be edited
-- or deleted; a future replacement may close the prior effective window once.
-- Route customer geometry is intentionally not read or written here.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceSiteGeofenceKind" AS ENUM ('CIRCLE');

CREATE TABLE "workforce_site_geofence_revisions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" "WorkforceSiteGeofenceKind" NOT NULL DEFAULT 'CIRCLE',
  "centerLatitude" DOUBLE PRECISION NOT NULL,
  "centerLongitude" DOUBLE PRECISION NOT NULL,
  "radiusMeters" INTEGER NOT NULL,
  "calibrationReference" VARCHAR(500) NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_site_geofence_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_site_geofence_revisions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "workforce_site_geofence_revisions_latitude_check" CHECK ("centerLatitude" BETWEEN -90 AND 90),
  CONSTRAINT "workforce_site_geofence_revisions_longitude_check" CHECK ("centerLongitude" BETWEEN -180 AND 180),
  CONSTRAINT "workforce_site_geofence_revisions_radius_check" CHECK ("radiusMeters" BETWEEN 25 AND 5000),
  CONSTRAINT "workforce_site_geofence_revisions_calibration_check" CHECK (NULLIF(btrim("calibrationReference"), '') IS NOT NULL),
  CONSTRAINT "workforce_site_geofence_revisions_hash_check" CHECK ("definitionHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "workforce_site_geofence_revisions_date_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "workforce_site_geofence_revisions_organizationId_id_key"
  ON "workforce_site_geofence_revisions"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_site_geofence_revisions_org_site_revision_key"
  ON "workforce_site_geofence_revisions"("organizationId", "siteId", "revision");
CREATE INDEX "workforce_site_geofence_revisions_org_site_window_idx"
  ON "workforce_site_geofence_revisions"("organizationId", "siteId", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_site_geofence_revisions_org_created_by_idx"
  ON "workforce_site_geofence_revisions"("organizationId", "createdByUserId", "createdAt");

ALTER TABLE "workforce_site_geofence_revisions"
  ADD CONSTRAINT "workforce_site_geofence_revisions_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_geofence_revisions_site_fkey"
    FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_geofence_revisions_created_by_fkey"
    FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The only permitted UPDATE closes an otherwise-open effective window. It may
-- not alter center/radius/hash/creator/revision or reopen a closed revision.
CREATE OR REPLACE FUNCTION workforce_guard_site_geofence_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce geofence revisions are append-only' USING ERRCODE = '55000';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."centerLatitude" IS DISTINCT FROM OLD."centerLatitude"
     OR NEW."centerLongitude" IS DISTINCT FROM OLD."centerLongitude"
     OR NEW."radiusMeters" IS DISTINCT FROM OLD."radiusMeters"
     OR NEW."calibrationReference" IS DISTINCT FROM OLD."calibrationReference"
     OR NEW."definitionHash" IS DISTINCT FROM OLD."definitionHash"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR OLD."effectiveTo" IS NOT NULL
     OR NEW."effectiveTo" IS NULL THEN
    RAISE EXCEPTION 'Workforce geofence revision geometry is immutable; only an open window may be closed once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_site_geofence_revisions_append_only
  BEFORE UPDATE OR DELETE ON "workforce_site_geofence_revisions"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_site_geofence_revision_mutation();

-- Reject overlapping effective windows even if a non-application database role
-- attempts a write. Gaps remain explicit and resolver-visible rather than
-- silently filled by a nearby revision.
CREATE OR REPLACE FUNCTION workforce_validate_site_geofence_revision_window()
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
    RAISE EXCEPTION 'Workforce geofence revision requires an active site' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "workforce_site_geofence_revisions" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."siteId" = NEW."siteId"
      AND other."id" <> NEW."id"
      AND daterange(other."effectiveFrom", COALESCE(other."effectiveTo", 'infinity'::date), '[]')
          && daterange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Workforce geofence revision window overlaps another revision' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_site_geofence_revisions_validate_window
  BEFORE INSERT OR UPDATE ON "workforce_site_geofence_revisions"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_site_geofence_revision_window();

ALTER TABLE "workforce_site_geofence_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_site_geofence_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_site_geofence_revisions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
