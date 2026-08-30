-- C4 QR proof v2. Existing stations remain readable/auditable but intentionally
-- cannot issue or verify a new QR until an administrator recreates them with a
-- tenant Workforce site, immutable geofence revision and effective window.
-- This avoids guessing a historical physical location for an old station.

SET lock_timeout = '3s';

ALTER TABLE "workforce_attendance_qr_stations"
  ADD COLUMN "siteId" TEXT,
  ADD COLUMN "areaLabel" VARCHAR(120),
  ADD COLUMN "geofenceRevisionId" TEXT,
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveTo" TIMESTAMP(3);

ALTER TABLE "workforce_attendance_qr_stations"
  ADD CONSTRAINT "workforce_attendance_qr_stations_binding_check" CHECK (
    (
      "siteId" IS NULL
      AND "areaLabel" IS NULL
      AND "geofenceRevisionId" IS NULL
      AND "effectiveFrom" IS NULL
      AND "effectiveTo" IS NULL
    )
    OR
    (
      "siteId" IS NOT NULL
      AND "geofenceRevisionId" IS NOT NULL
      AND "effectiveFrom" IS NOT NULL
      AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
    )
  ),
  ADD CONSTRAINT "workforce_attendance_qr_stations_area_label_check" CHECK (
    "areaLabel" IS NULL OR NULLIF(btrim("areaLabel"), '') IS NOT NULL
  ),
  ADD CONSTRAINT "workforce_attendance_qr_stations_site_fkey"
    FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_qr_stations_geofence_revision_fkey"
    FOREIGN KEY ("organizationId", "geofenceRevisionId") REFERENCES "workforce_site_geofence_revisions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "workforce_attendance_qr_stations_org_site_status_effective_idx"
  ON "workforce_attendance_qr_stations"("organizationId", "siteId", "status", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_attendance_qr_stations_org_geofence_revision_idx"
  ON "workforce_attendance_qr_stations"("organizationId", "geofenceRevisionId");

-- A composite FK proves only tenant membership. Enforce that the selected
-- immutable revision belongs to the same Workforce site and covers the whole
-- station window. The check also deliberately permits the all-null legacy
-- shape; application issuance and verification reject that shape fail-closed.
CREATE OR REPLACE FUNCTION workforce_validate_attendance_qr_station_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_row RECORD;
BEGIN
  IF NEW."siteId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO revision_row
  FROM "workforce_site_geofence_revisions"
  WHERE "organizationId" = NEW."organizationId"
    AND "id" = NEW."geofenceRevisionId";

  IF NOT FOUND
     OR revision_row."siteId" <> NEW."siteId"
     OR revision_row."effectiveFrom" > NEW."effectiveFrom"::date
     OR (
       revision_row."effectiveTo" IS NOT NULL
       AND (
         NEW."effectiveTo" IS NULL
         OR revision_row."effectiveTo" < NEW."effectiveTo"::date
       )
     ) THEN
    RAISE EXCEPTION 'Workforce attendance QR station must bind to a same-site effective geofence revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_qr_stations_binding_guard
  BEFORE INSERT OR UPDATE ON "workforce_attendance_qr_stations"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_attendance_qr_station_binding();

-- Preserve the original no-delete/one-way-disable lifecycle while adding the
-- binding columns to immutable station identity. Changing a site or revision
-- means disabling this station and creating a separately auditable successor.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_qr_station()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance QR stations cannot be deleted; disable them instead' USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."rotationSeconds" IS DISTINCT FROM OLD."rotationSeconds"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."areaLabel" IS DISTINCT FROM OLD."areaLabel"
     OR NEW."geofenceRevisionId" IS DISTINCT FROM OLD."geofenceRevisionId"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Workforce attendance QR station identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' THEN
    IF NEW."status" = 'ACTIVE' THEN
      IF NEW."disabledByUserId" IS NOT NULL OR NEW."disabledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Active Workforce attendance QR station cannot have disable metadata' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'DISABLED' AND NEW."disabledByUserId" IS NOT NULL AND NEW."disabledAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Workforce attendance QR station lifecycle is immutable after disable' USING ERRCODE = '55000';
END;
$$;
