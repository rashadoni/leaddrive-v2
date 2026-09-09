-- Slice-3 extension: blind-index column on R7 beneficiaries.taxId.
-- Online-safe ALTER + composite tenant-scoped index.

ALTER TABLE "beneficiaries" ADD COLUMN "taxIdBlindIndex" TEXT;

CREATE INDEX "beneficiaries_org_tax_id_blind_idx"
  ON "beneficiaries" ("organizationId", "taxIdBlindIndex");
