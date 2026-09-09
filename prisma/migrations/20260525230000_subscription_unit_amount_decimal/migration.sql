-- D4 Subscriptions — Float → Decimal(18,4) for unitAmount columns.
--
-- Background: SubscriptionPlan.unitAmount and Subscription.unitAmount were
-- Float (DOUBLE PRECISION). IEEE-754 binary representation causes rounding
-- drift in MRR aggregation and proration calculations:
--   - toMonthly(99.99 * 12 / count) can yield 1199.8799999999998 instead of 1199.88
--   - calculateProration(99.99 * fraction) produces fractional cents
-- Both are fixed by switching to NUMERIC(18,4) (4 decimal places = sub-cent
-- precision, enough for all subscription pricing scenarios).
--
-- Two tables affected:
--   - subscription_plans.unitAmount: the canonical plan price
--   - subscriptions.unitAmount: the snapshot price (frozen at create / plan-change)
--
-- The USING cast is lossless for monetary values that originated as
-- double-precision floats — NUMERIC representation is exact for values
-- that fit in 18 digits with 4 decimal places.
--
-- Idempotency: Postgres silently ignores a USING cast if the column type
-- is already NUMERIC(18,4). Safe to re-apply.

ALTER TABLE "subscription_plans"
  ALTER COLUMN "unitAmount" TYPE NUMERIC(18, 4)
  USING "unitAmount"::NUMERIC(18, 4);

ALTER TABLE "subscriptions"
  ALTER COLUMN "unitAmount" TYPE NUMERIC(18, 4)
  USING "unitAmount"::NUMERIC(18, 4);
