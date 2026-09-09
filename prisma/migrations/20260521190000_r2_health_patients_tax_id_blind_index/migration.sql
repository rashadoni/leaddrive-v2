-- Slice-3 extension: blind-index column on R2 health_patients.taxId.
-- Online-safe ALTER + composite tenant-scoped index.

ALTER TABLE "health_patients" ADD COLUMN "taxIdBlindIndex" TEXT;

CREATE INDEX "health_patients_org_tax_id_blind_idx"
  ON "health_patients" ("organizationId", "taxIdBlindIndex");
