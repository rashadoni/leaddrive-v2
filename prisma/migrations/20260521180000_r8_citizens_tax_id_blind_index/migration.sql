-- Slice-3 extension: blind-index column on R8 citizens.taxId.
-- Same shape as the fullName blind-index migration (20260521140000).
-- Online-safe: nullable column + non-CONCURRENTLY composite index.

ALTER TABLE "citizens" ADD COLUMN "taxIdBlindIndex" TEXT;

CREATE INDEX "citizens_org_tax_id_blind_idx"
  ON "citizens" ("organizationId", "taxIdBlindIndex");
