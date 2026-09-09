-- C9 Marketing Attribution — CampaignInfluence.attributedRevenue Float → Decimal(18,4)
-- D5 Payments closure unlocked this sweep (memory/project_payments_slice2_p0.md).
-- IEEE-754 drift on a _sum over many touchpoints (hundreds of campaign–deal pairs)
-- produces reporting inaccuracies visible in the attribution dashboard.
-- USING cast preserves existing values; nullability unchanged (column is NOT NULL DEFAULT 0).

ALTER TABLE "campaign_influences"
  ALTER COLUMN "attributedRevenue" TYPE NUMERIC(18, 4)
  USING "attributedRevenue"::NUMERIC(18, 4);
