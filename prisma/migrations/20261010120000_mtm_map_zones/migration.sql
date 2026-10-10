-- Named zones a manager draws by hand on the live map — a district, a
-- delivery area, «центр»: a circle (centre and radius) or one closed outline.
-- A zone belongs to the organization and is shown to everybody who opens the
-- live map. It is a drawing only: nothing in GPS ingest reads this table.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).
--
-- A new table and nothing else: no existing row is touched, and the previous
-- build, which does not know the table, never reads it.

SET lock_timeout = '3s';

CREATE TABLE "mtm_map_zones" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  -- A key of the fixed palette in the code, not a hex: nothing to check here.
  "color" TEXT,
  "centerLatitude" DOUBLE PRECISION,
  "centerLongitude" DOUBLE PRECISION,
  "radiusMeters" INTEGER,
  "polygon" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_map_zones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_map_zones_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_map_zones_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "mtm_map_zones_kind_check" CHECK ("kind" IN ('CIRCLE', 'POLYGON')),
  -- One shape per row, whole. The IS NOT NULL terms are not decoration: a
  -- CHECK passes when its expression is NULL, and `NULL BETWEEN -90 AND 90`
  -- is NULL — without them a circle with no centre would be storable.
  CONSTRAINT "mtm_map_zones_shape_check" CHECK (
    ("kind" = 'CIRCLE' AND "polygon" IS NULL
      AND "centerLatitude" IS NOT NULL AND "centerLongitude" IS NOT NULL AND "radiusMeters" IS NOT NULL
      AND "centerLatitude" BETWEEN -90 AND 90 AND "centerLongitude" BETWEEN -180 AND 180
      AND "radiusMeters" BETWEEN 25 AND 100000)
    OR
    ("kind" = 'POLYGON' AND "polygon" IS NOT NULL AND jsonb_typeof("polygon") = 'object'
      AND "centerLatitude" IS NULL AND "centerLongitude" IS NULL AND "radiusMeters" IS NULL)
  )
);

CREATE UNIQUE INDEX "mtm_map_zones_organizationId_id_key" ON "mtm_map_zones"("organizationId", "id");
CREATE INDEX "mtm_map_zones_organizationId_deletedAt_idx" ON "mtm_map_zones"("organizationId", "deletedAt");

ALTER TABLE "mtm_map_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_map_zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_map_zones"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Rollback is forward-safe: roll back the application code and keep the
-- table. Dropping it would discard the zones managers have drawn.
