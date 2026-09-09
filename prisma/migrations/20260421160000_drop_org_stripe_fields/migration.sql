-- Revert the Stripe columns added by 20260421150000_org_stripe_subscription.
-- That migration is being reverted because LeadDrive is B2B enterprise — no
-- self-serve Stripe Checkout flow is needed. All columns were nullable and
-- never populated, so dropping them is safe.

DROP INDEX IF EXISTS "organizations_stripeCustomerId_key";
DROP INDEX IF EXISTS "organizations_stripeSubscriptionId_key";

ALTER TABLE "organizations"
  DROP COLUMN IF EXISTS "stripeCustomerId",
  DROP COLUMN IF EXISTS "stripeSubscriptionId",
  DROP COLUMN IF EXISTS "subscriptionStatus",
  DROP COLUMN IF EXISTS "currentPeriodEnd",
  DROP COLUMN IF EXISTS "trialEndsAt";
