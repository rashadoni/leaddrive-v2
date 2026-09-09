-- Slice-3 extension: blind-index column on R7 policy_holders.taxId.
-- Online-safe ALTER + composite tenant-scoped index.

ALTER TABLE "policy_holders" ADD COLUMN "taxIdBlindIndex" TEXT;

CREATE INDEX "policy_holders_org_tax_id_blind_idx"
  ON "policy_holders" ("organizationId", "taxIdBlindIndex");
