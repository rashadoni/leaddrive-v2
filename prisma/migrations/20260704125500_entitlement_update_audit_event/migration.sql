-- Allow support-entitlement edit operations to be audited explicitly.
-- Existing lifecycle event types remain unchanged.
ALTER TABLE "entitlement_audit_events"
  DROP CONSTRAINT IF EXISTS "entitlement_audit_events_event_type_check";

ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_event_type_check"
  CHECK ("eventType" IN (
    'entitlement_created', 'entitlement_updated', 'entitlement_activated',
    'entitlement_suspended', 'entitlement_resumed', 'entitlement_expired',
    'entitlement_cancelled', 'milestone_started', 'milestone_met',
    'milestone_missed', 'milestone_waived', 'milestone_escalated',
    'milestone_re_anchored'
  ));
