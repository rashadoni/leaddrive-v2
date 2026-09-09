-- N6 Rollup Summary fields (Phase 4 slice 1).
-- Definition table + per-parent computed values.

CREATE TABLE "rollup_fields" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentEntity" TEXT NOT NULL,
    "childEntity" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregateField" TEXT,
    "parentKey" TEXT NOT NULL,
    "filterJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rollup_fields_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rollup_fields"
  ADD CONSTRAINT "rollup_fields_aggregate_check"
  CHECK ("aggregate" IN ('count', 'sum', 'avg', 'min', 'max'));

ALTER TABLE "rollup_fields"
  ADD CONSTRAINT "rollup_fields_count_no_field_check"
  CHECK (("aggregate" = 'count' AND "aggregateField" IS NULL)
      OR ("aggregate" <> 'count' AND "aggregateField" IS NOT NULL));

CREATE UNIQUE INDEX "rollup_fields_org_parent_name_uniq"
  ON "rollup_fields"("organizationId", "parentEntity", "name");

CREATE INDEX "rollup_fields_org_parent_idx"
  ON "rollup_fields"("organizationId", "parentEntity");

ALTER TABLE "rollup_fields"
  ADD CONSTRAINT "rollup_fields_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rollup_values" (
    "id" TEXT NOT NULL,
    "rollupFieldId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rollup_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rollup_values_field_parent_uniq"
  ON "rollup_values"("rollupFieldId", "parentId");

CREATE INDEX "rollup_values_org_field_idx"
  ON "rollup_values"("organizationId", "rollupFieldId");

ALTER TABLE "rollup_values"
  ADD CONSTRAINT "rollup_values_rollupFieldId_fkey"
  FOREIGN KEY ("rollupFieldId") REFERENCES "rollup_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rollup_values"
  ADD CONSTRAINT "rollup_values_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
