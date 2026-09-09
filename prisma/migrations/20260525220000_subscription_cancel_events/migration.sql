-- D4 slice-2 REPORTING BLOCKER fix: add cancel_scheduled + cancel_revoked
-- to the subscription_events eventType CHECK constraint.
--
-- Background (from TODO in schedule-cancel/route.ts):
--   Without these event types, slice-3 MRR/churn reporting CANNOT
--   distinguish "active customer who never thought about leaving" from
--   "customer who scheduled cancel and revoked" — a primary
--   churn-recovery KPI.
--
-- Implementation:
--   1. DROP the existing subscription_events_type_check constraint.
--   2. Re-create it with 'cancel_scheduled' and 'cancel_revoked' added.
--   The two new values are emitted exclusively by the schedule-cancel
--   route (POST /api/v1/subscriptions/[id]/schedule-cancel):
--     * cancelAtPeriodEnd=true  → emit 'cancel_scheduled'
--     * cancelAtPeriodEnd=false → emit 'cancel_revoked'
--
-- Idempotency: DROP CONSTRAINT IF EXISTS prevents double-apply failures.

ALTER TABLE "subscription_events"
  DROP CONSTRAINT IF EXISTS "subscription_events_type_check";

ALTER TABLE "subscription_events"
  ADD CONSTRAINT "subscription_events_type_check"
  CHECK ("eventType" IN (
    'created', 'trial_ended', 'activated', 'paused', 'resumed',
    'plan_changed', 'dunning_started', 'dunning_succeeded',
    'dunning_failed', 'cancelled',
    'cancel_scheduled', 'cancel_revoked'
  ));
