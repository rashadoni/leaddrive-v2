-- Non-Phase-7 coherence trigger sweep — follow-up to Phase 7 P0 #2.
--
-- Same UPDATE-bypass vulnerability class as the Phase 7 sweep
-- (migration `20260521000000_coherence_trigger_update_sweep`): 16
-- coherence triggers across B10 / A12 / C12 / C7 / C4 / G5 were
-- defined as BEFORE INSERT only. An UPDATE that re-parents a row
-- across tenants bypasses the check entirely — cross-tenant data
-- leak vector.
--
-- This migration drops each BEFORE INSERT trigger and re-creates it
-- as BEFORE INSERT OR UPDATE OF <fkCols, organizationId>. Function
-- bodies unchanged (NEW.* works on both INSERT and UPDATE).
--
-- Scope (16 triggers):
--   B10 Entitlement Process (4): entitlements, entitlement_milestone_definitions,
--     entitlement_ticket_milestones, entitlement_audit_events
--   A12 Revenue Intelligence (4): forecast_snapshots, pipeline_stage_transitions,
--     deal_velocity_metrics, forecast_accuracy_reports
--   C12 Multi-channel Orchestrator (3): channel_preferences,
--     campaign_orchestration_runs, orchestrated_deliveries
--   C7 Distributed Marketing (3): template_distributions,
--     template_personalizations, template_send_records
--   C4 Personalization (1): personalization_decisions
--   G5 Segment Activation (1): segment_activation_runs
--
-- FK column lists extracted from each function body via
-- awk + grep -oE 'NEW."[a-zA-Z]+"' (same methodology as the
-- Phase 7 P0 #2 PR).
--
-- Idempotency: DROP TRIGGER IF EXISTS pattern allows safe replay.

-- ═══════════════════════════════════════════════════════════════════
-- B10 Entitlement Process (4 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS entitlements_coherence_trigger ON "entitlements";
CREATE TRIGGER entitlements_coherence_trigger
  BEFORE INSERT OR UPDATE OF "companyId", "slaPolicyId", "organizationId" ON "entitlements"
  FOR EACH ROW
  EXECUTE FUNCTION entitlements_coherence_fn();

DROP TRIGGER IF EXISTS entitlement_milestone_definitions_coherence_trigger ON "entitlement_milestone_definitions";
CREATE TRIGGER entitlement_milestone_definitions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "entitlementId", "organizationId" ON "entitlement_milestone_definitions"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_milestone_definitions_coherence_fn();

DROP TRIGGER IF EXISTS entitlement_ticket_milestones_coherence_trigger ON "entitlement_ticket_milestones";
CREATE TRIGGER entitlement_ticket_milestones_coherence_trigger
  BEFORE INSERT OR UPDATE OF "definitionId", "ticketId", "organizationId" ON "entitlement_ticket_milestones"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_ticket_milestones_coherence_fn();

DROP TRIGGER IF EXISTS entitlement_audit_events_coherence_trigger ON "entitlement_audit_events";
CREATE TRIGGER entitlement_audit_events_coherence_trigger
  BEFORE INSERT OR UPDATE OF "entitlementId", "milestoneId", "actorUserId", "organizationId" ON "entitlement_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_audit_events_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- A12 Revenue Intelligence (4 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS forecast_snapshots_coherence_trigger ON "forecast_snapshots";
CREATE TRIGGER forecast_snapshots_coherence_trigger
  BEFORE INSERT OR UPDATE OF "capturedBy", "organizationId" ON "forecast_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_snapshots_coherence_fn();

DROP TRIGGER IF EXISTS pipeline_stage_transitions_coherence_trigger ON "pipeline_stage_transitions";
CREATE TRIGGER pipeline_stage_transitions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "dealId", "pipelineId", "actorUserId", "organizationId" ON "pipeline_stage_transitions"
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_stage_transitions_coherence_fn();

DROP TRIGGER IF EXISTS deal_velocity_metrics_coherence_trigger ON "deal_velocity_metrics";
CREATE TRIGGER deal_velocity_metrics_coherence_trigger
  BEFORE INSERT OR UPDATE OF "pipelineId", "organizationId" ON "deal_velocity_metrics"
  FOR EACH ROW
  EXECUTE FUNCTION deal_velocity_metrics_coherence_fn();

DROP TRIGGER IF EXISTS forecast_accuracy_reports_coherence_trigger ON "forecast_accuracy_reports";
CREATE TRIGGER forecast_accuracy_reports_coherence_trigger
  BEFORE INSERT OR UPDATE OF "snapshotId", "organizationId" ON "forecast_accuracy_reports"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_accuracy_reports_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- C12 Multi-channel Campaign Orchestrator (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS channel_preferences_coherence_trigger ON "channel_preferences";
CREATE TRIGGER channel_preferences_coherence_trigger
  BEFORE INSERT OR UPDATE OF "contactId", "organizationId" ON "channel_preferences"
  FOR EACH ROW
  EXECUTE FUNCTION channel_preferences_coherence_fn();

DROP TRIGGER IF EXISTS campaign_orchestration_runs_coherence_trigger ON "campaign_orchestration_runs";
CREATE TRIGGER campaign_orchestration_runs_coherence_trigger
  BEFORE INSERT OR UPDATE OF "campaignId", "policyId", "organizationId" ON "campaign_orchestration_runs"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_orchestration_runs_coherence_fn();

DROP TRIGGER IF EXISTS orchestrated_deliveries_coherence_trigger ON "orchestrated_deliveries";
CREATE TRIGGER orchestrated_deliveries_coherence_trigger
  BEFORE INSERT OR UPDATE OF "runId", "campaignId", "contactId", "organizationId" ON "orchestrated_deliveries"
  FOR EACH ROW
  EXECUTE FUNCTION orchestrated_deliveries_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- C7 Distributed Marketing (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS template_distributions_coherence_trigger ON "template_distributions";
CREATE TRIGGER template_distributions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "templateId", "targetUserId", "organizationId" ON "template_distributions"
  FOR EACH ROW
  EXECUTE FUNCTION template_distributions_coherence_fn();

DROP TRIGGER IF EXISTS template_personalizations_coherence_trigger ON "template_personalizations";
CREATE TRIGGER template_personalizations_coherence_trigger
  BEFORE INSERT OR UPDATE OF "templateId", "userId", "organizationId" ON "template_personalizations"
  FOR EACH ROW
  EXECUTE FUNCTION template_personalizations_coherence_fn();

DROP TRIGGER IF EXISTS template_send_records_coherence_trigger ON "template_send_records";
CREATE TRIGGER template_send_records_coherence_trigger
  BEFORE INSERT OR UPDATE OF "templateId", "personalizationId", "userId", "contactId", "organizationId" ON "template_send_records"
  FOR EACH ROW
  EXECUTE FUNCTION template_send_records_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- C4 Personalization (1 trigger)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS personalization_decisions_coherence_trigger ON "personalization_decisions";
CREATE TRIGGER personalization_decisions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "experienceId", "variantId", "organizationId" ON "personalization_decisions"
  FOR EACH ROW
  EXECUTE FUNCTION personalization_decisions_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- G5 Segment Activation (1 trigger)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS segment_activation_runs_coherence_trigger ON "segment_activation_runs";
CREATE TRIGGER segment_activation_runs_coherence_trigger
  BEFORE INSERT OR UPDATE OF "activationId", "organizationId" ON "segment_activation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION segment_activation_runs_coherence_fn();
