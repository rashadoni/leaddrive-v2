-- D4: Subscription Management (Phase 6 Block A).
-- Salesforce Subscription Management analogue. Builds AT THE SIDE of
-- the existing RecurringInvoice (tenant-side invoice generator) — D4
-- introduces the customer-facing subscription lifecycle (trial →
-- active → past_due → cancelled, paused branch, dunning retries,
-- prorated plan changes).
--
-- Slice 1 ships schema + pure helpers (state machine, proration math,
-- dunning scheduler, billing-period calculator). Slice 2 wires API
-- routes + admin UI; slice 3 wires the dunning cron + payment-
-- provider webhook handlers.

-- ── SubscriptionPlan ─────────────────────────────────────────────
-- Catalog row: admin defines plans, customer Subscriptions reference
-- one. `unitAmount` is captured as Float at the row level — D3's
-- slice-3 deferral (Float → Decimal/cents) applies here too and is
-- the same TODO. `billingInterval` + `billingIntervalCount` allow
-- both "monthly" (interval=month, count=1) and "every 3 months"
-- (count=3) configurations.
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unitAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billingInterval" TEXT NOT NULL DEFAULT 'month',
    "billingIntervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_amount_check"
  CHECK ("unitAmount" >= 0);

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_interval_check"
  CHECK ("billingInterval" IN ('day', 'week', 'month', 'year'));

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_interval_count_check"
  CHECK ("billingIntervalCount" > 0);

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_trial_check"
  CHECK ("trialDays" >= 0);

CREATE INDEX "subscription_plans_org_active_idx" ON "subscription_plans"("organizationId", "isActive");

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Subscription ────────────────────────────────────────────────
-- Customer subscription instance. Stripe-style `cancelAtPeriodEnd`
-- separates "cancel immediately" (status flips now) from "cancel at
-- period end" (status stays active until currentPeriodEnd, then auto-
-- transitions). The dunning cron consumes `nextBillingAt` and
-- `currentPeriodEnd` to know when to retry / give up.
--
-- Subject is EITHER a Company OR a Contact (or both for a B2B
-- contract with a designated primary contact). The owner-check at the
-- route boundary enforces tenant scope; the DB FK is org-cascaded.
--
-- unitAmount + currency + billingInterval are SNAPSHOTTED at subscription
-- create time (or last plan_changed event). A future SubscriptionPlan
-- price update does NOT retroactively mutate active subscriptions —
-- price changes apply to NEW subscriptions or on explicit plan-change.
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT FALSE,
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "unitAmount" DOUBLE PRECISION NOT NULL,
    "billingInterval" TEXT NOT NULL,
    "billingIntervalCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_status_check"
  CHECK ("status" IN ('trial', 'active', 'past_due', 'paused', 'cancelled'));

-- The subscription must point at SOMETHING (company OR contact) — a
-- subscription with neither has no subject and is dead-data. Mirror
-- of the carts_owner_check pattern from D2.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_subject_check"
  CHECK ("companyId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_period_order_check"
  CHECK ("currentPeriodStart" <= "currentPeriodEnd");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_amount_check"
  CHECK ("unitAmount" >= 0);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_interval_check"
  CHECK ("billingInterval" IN ('day', 'week', 'month', 'year'));

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_interval_count_check"
  CHECK ("billingIntervalCount" > 0);

-- Cancelled-coherence: status='cancelled' implies cancelledAt set.
-- Status≠'cancelled' implies cancelledAt is NULL. A status=cancelled
-- with NULL cancelledAt would lose the cancellation timestamp in
-- reporting; a non-cancelled status with cancelledAt set would
-- misrepresent the lifecycle.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_cancelled_coherence_check"
  CHECK (
    ("status" = 'cancelled' AND "cancelledAt" IS NOT NULL)
    OR ("status" <> 'cancelled' AND "cancelledAt" IS NULL)
  );

-- Paused-coherence: status='paused' implies pausedAt set + resumedAt NULL.
-- For status≠'paused' the constraint is permissive on purpose:
--   • Never-been-paused: both timestamps NULL
--   • Was paused, then resumed: both timestamps set (resumedAt ≥ pausedAt)
--   • Was paused, then cancelled WITHOUT resuming: pausedAt set, resumedAt NULL,
--     status='cancelled' — semantically correct (the customer was paused at
--     the moment of cancellation; resumedAt=NULL accurately records "never resumed")
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_paused_coherence_check"
  CHECK (
    ("status" = 'paused' AND "pausedAt" IS NOT NULL AND "resumedAt" IS NULL)
    OR ("status" <> 'paused')
  );

-- Temporal-ordering defense-in-depth: if both pausedAt and resumedAt are set,
-- resumedAt MUST be ≥ pausedAt. The SM is the single write path and never
-- produces resumedAt < pausedAt; this CHECK is a guard against backup-restore
-- or hand-rolled SQL fixes landing a backwards pair (which would silently
-- corrupt the paused-duration math in slice-3 reporting).
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_paused_temporal_order_check"
  CHECK (
    "pausedAt" IS NULL
    OR "resumedAt" IS NULL
    OR "resumedAt" >= "pausedAt"
  );

-- cancelAtPeriodEnd is a Stripe-style "scheduled cancel" flag. It must be
-- FALSE for already-terminal subscriptions — `cancelAtPeriodEnd=true AND
-- status='cancelled'` is meaningless (the cancel already happened, so the
-- "schedule" is in the past). Slice 2 will add an explicit `scheduleCancel`
-- SM action that flips the flag without changing status; this CHECK ensures
-- that action can't be invoked on a row that's already cancelled.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_scheduled_cancel_coherence_check"
  CHECK (NOT ("cancelAtPeriodEnd" = TRUE AND "status" = 'cancelled'));

CREATE INDEX "subscriptions_org_status_idx" ON "subscriptions"("organizationId", "status");
CREATE INDEX "subscriptions_org_next_billing_idx" ON "subscriptions"("organizationId", "nextBillingAt");
-- Slice-3 cron will scan by (org, currentPeriodEnd) for the cancelAtPeriodEnd
-- reaper job + trial-end auto-conversion. Index ships now to avoid a follow-up
-- migration in slice 2/3.
CREATE INDEX "subscriptions_org_period_end_idx" ON "subscriptions"("organizationId", "currentPeriodEnd");
CREATE INDEX "subscriptions_company_idx" ON "subscriptions"("companyId");
CREATE INDEX "subscriptions_contact_idx" ON "subscriptions"("contactId");
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions"("planId");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── SubscriptionEvent ───────────────────────────────────────────
-- Append-only audit log. Captures every status change + plan change
-- with structured before/after snapshots. Slice 2 admin UI consumes
-- this for the "Activity" tab on the subscription detail view; slice
-- 3 reporting (MRR / churn / cohort) reads it heavily.
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "previousPlanId" TEXT,
    "newPlanId" TEXT,
    "prorationAmount" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- eventType enum mirrors src/lib/subscriptions/types.ts:SUBSCRIPTION_EVENT_TYPES.
-- `cancelled` is a TERMINAL transition — once a subscription is cancelled,
-- the row is read-only for lifecycle purposes. A returning customer creates
-- a NEW Subscription (with linkage in metadata if needed). There is
-- intentionally no `reactivated` event because the SM has no `cancelled →
-- *` edge; an enum value with no producer would be dead data.
ALTER TABLE "subscription_events"
  ADD CONSTRAINT "subscription_events_type_check"
  CHECK ("eventType" IN (
    'created', 'trial_ended', 'activated', 'paused', 'resumed',
    'plan_changed', 'dunning_started', 'dunning_succeeded',
    'dunning_failed', 'cancelled'
  ));

CREATE INDEX "subscription_events_sub_occurred_idx" ON "subscription_events"("subscriptionId", "occurredAt");
CREATE INDEX "subscription_events_org_type_idx" ON "subscription_events"("organizationId", "eventType");

ALTER TABLE "subscription_events"
  ADD CONSTRAINT "subscription_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_events"
  ADD CONSTRAINT "subscription_events_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DunningAttempt ──────────────────────────────────────────────
-- One row per retry attempt against a past_due subscription. The
-- dunning-scheduler helper produces the timestamps; slice-3 cron
-- consumes scheduledAt + writes attemptedAt + succeededAt / failureReason.
-- attemptNumber is monotonically increasing within (subscriptionId).
CREATE TABLE "dunning_attempts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attemptedAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "paymentRef" TEXT,
    "isFinalAttempt" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dunning_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dunning_attempts"
  ADD CONSTRAINT "dunning_attempts_number_check"
  CHECK ("attemptNumber" > 0);

-- Outcome coherence: an attempt is in one of three terminal states
-- modeled by (attemptedAt, succeededAt, failureReason):
--   pending   — attemptedAt NULL, succeededAt NULL, failureReason NULL
--   succeeded — attemptedAt set, succeededAt set, failureReason NULL
--   failed    — attemptedAt set, succeededAt NULL, failureReason set
-- This CHECK forbids mixed half-states (e.g. succeededAt without
-- attemptedAt, or failureReason on a succeeded attempt).
ALTER TABLE "dunning_attempts"
  ADD CONSTRAINT "dunning_attempts_outcome_check"
  CHECK (
    ("attemptedAt" IS NULL AND "succeededAt" IS NULL AND "failureReason" IS NULL)
    OR ("attemptedAt" IS NOT NULL AND "succeededAt" IS NOT NULL AND "failureReason" IS NULL)
    OR ("attemptedAt" IS NOT NULL AND "succeededAt" IS NULL AND "failureReason" IS NOT NULL)
  );

-- Two pending attempts on the same subscription with the same number
-- would be a scheduler bug — UNIQUE (subscriptionId, attemptNumber)
-- catches it at insert time.
CREATE UNIQUE INDEX "dunning_attempts_sub_attempt_uniq" ON "dunning_attempts"("subscriptionId", "attemptNumber");
CREATE INDEX "dunning_attempts_org_scheduled_idx" ON "dunning_attempts"("organizationId", "scheduledAt");
CREATE INDEX "dunning_attempts_sub_scheduled_idx" ON "dunning_attempts"("subscriptionId", "scheduledAt");

ALTER TABLE "dunning_attempts"
  ADD CONSTRAINT "dunning_attempts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dunning_attempts"
  ADD CONSTRAINT "dunning_attempts_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
