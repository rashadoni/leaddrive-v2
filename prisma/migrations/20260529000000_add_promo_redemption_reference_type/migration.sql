-- D8 Loyalty slice-2 soft #7 — PromoCodeRedemption.referenceType discriminator.
--
-- Without this column the existing `referenceId` is opaque — slice-3 reporting
-- can't join it to the right table (invoice / order / cart). Add a nullable
-- TEXT discriminator with a CHECK-constrained taxonomy plus a partial index
-- scoped to rows that actually carry a type.
--
-- Backfill strategy: leave existing rows NULL. The route layer (after this
-- migration) enforces `referenceType` whenever `referenceId` is supplied;
-- legacy / anonymous rows continue to round-trip without a value. Reports
-- treat NULL as "untyped" and exclude from group-by-type aggregations.
--
-- Memory: `memory/project_loyalty_slice2_design.md` soft #7.

ALTER TABLE "promo_code_redemptions"
  ADD COLUMN "referenceType" TEXT;

ALTER TABLE "promo_code_redemptions"
  ADD CONSTRAINT "promo_code_redemptions_referenceType_check"
  CHECK ("referenceType" IS NULL OR "referenceType" IN ('invoice', 'order', 'cart'));

-- Partial index — rows without a discriminator aren't included in
-- the slice-3 "redemptions by entity type" reports, so don't index them.
CREATE INDEX "promo_code_redemptions_org_refType_redeemedAt_idx"
  ON "promo_code_redemptions" ("organizationId", "referenceType", "redeemedAt")
  WHERE "referenceType" IS NOT NULL;
