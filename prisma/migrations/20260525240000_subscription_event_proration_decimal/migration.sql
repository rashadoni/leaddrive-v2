-- D4 Phase 6 Block A — SubscriptionEvent.prorationAmount Float? → Decimal(18,4)?
-- Architect-flagged: proration audit trail must match the same Decimal precision
-- as Subscription.unitAmount / SubscriptionPlan.unitAmount (both already Decimal(18,4)).
-- A Float prorationAmount drifts after a few round-trips and makes MRR/churn
-- reporting unreliable when slice-3 reconciles against invoice amounts.

ALTER TABLE "subscription_events"
  ALTER COLUMN "prorationAmount" TYPE NUMERIC(18, 4)
  USING "prorationAmount"::NUMERIC(18, 4);
