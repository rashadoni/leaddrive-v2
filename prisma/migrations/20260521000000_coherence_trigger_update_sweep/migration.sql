-- Phase 7 slice-2 P0 #2 — cross-tenant FK coherence trigger sweep.
--
-- Background: 23 coherence-check triggers across R2/R6/R7/R8/R11 + C5
-- + G6 + C9 were defined as `BEFORE INSERT` only. An attacker (or
-- buggy service) issuing `UPDATE ... SET organizationId = <other-tenant>`
-- or `UPDATE ... SET <fkCol> = <other-tenant's-row>` would bypass the
-- check entirely — cross-tenant data leak vector.
--
-- This migration drops each `BEFORE INSERT` trigger and re-creates it
-- as `BEFORE INSERT OR UPDATE OF <fkCols, organizationId>`. Function
-- bodies are unchanged (they reference NEW.* which works on both
-- INSERT and UPDATE).
--
-- Scoping the UPDATE OF column list (rather than firing on every
-- UPDATE) keeps the perf cost negligible — these triggers only fire
-- when one of the actual re-parenting vectors is being modified. The
-- column list per trigger was extracted by grepping each function
-- body for `NEW."<col>"` references; see
-- `memory/project_phase7_slice2_inventory.md` item 2 for the design
-- rationale.
--
-- Defense-in-depth posture (architect-clarified):
-- Several tables in this sweep ALSO have peer `no_update` /
-- `append_only` triggers (`meter_readings`, `media_consumption_events`,
-- `event_stream_events`, `campaign_touchpoints`). Today an UPDATE
-- against any of those rows would be rejected before reaching the
-- coherence check, so the UPDATE-arm of this trigger is unreachable
-- in steady state. We INCLUDE most of them anyway (forward-compat: if
-- the peer immutability triggers are ever dropped or scoped looser,
-- this sweep keeps the cross-tenant guard intact).
--
-- The ONE intentional exclusion is `campaign_touchpoints`: its peer
-- append-only trigger is the canonical example of "fully append-only,
-- ever" in the codebase (slice-1 design memo explicitly marks it
-- non-updatable for telemetry-replay safety, NOT defense-in-depth).
-- Adding UPDATE OF on top would just be noise.
--
-- C5 inclusion (architect-flagged scope normalization):
-- `account_engagement` slice-1 ships 3 coherence triggers identical
-- in shape to the R-track. inventory memo line 199-200 explicitly
-- bundles C5 into "consistent posture with all R-slice-2 items". The
-- 3 are: account_intent_signals, abm_journey_enrollments,
-- account_score_snapshots.
--
-- Idempotency: DROP TRIGGER IF EXISTS pattern guarantees this migration
-- can replay safely if a partial apply happens.

-- ═══════════════════════════════════════════════════════════════════
-- R2 Health (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS health_medical_records_coherence_trigger ON "health_medical_records";
CREATE TRIGGER health_medical_records_coherence_trigger
  BEFORE INSERT OR UPDATE OF "patientId", "organizationId" ON "health_medical_records"
  FOR EACH ROW
  EXECUTE FUNCTION health_medical_records_coherence_fn();

DROP TRIGGER IF EXISTS health_encounters_coherence_trigger ON "health_encounters";
CREATE TRIGGER health_encounters_coherence_trigger
  BEFORE INSERT OR UPDATE OF "patientId", "organizationId" ON "health_encounters"
  FOR EACH ROW
  EXECUTE FUNCTION health_encounters_coherence_fn();

DROP TRIGGER IF EXISTS health_care_plans_coherence_trigger ON "health_care_plans";
CREATE TRIGGER health_care_plans_coherence_trigger
  BEFORE INSERT OR UPDATE OF "patientId", "organizationId" ON "health_care_plans"
  FOR EACH ROW
  EXECUTE FUNCTION health_care_plans_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- R6 Energy & Utilities (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS metering_points_coherence_trigger ON "metering_points";
CREATE TRIGGER metering_points_coherence_trigger
  BEFORE INSERT OR UPDATE OF "utilityCustomerId", "organizationId" ON "metering_points"
  FOR EACH ROW
  EXECUTE FUNCTION metering_points_coherence_fn();

DROP TRIGGER IF EXISTS meter_readings_coherence_trigger ON "meter_readings";
CREATE TRIGGER meter_readings_coherence_trigger
  BEFORE INSERT OR UPDATE OF "meteringPointId", "supersedesReadingId", "organizationId" ON "meter_readings"
  FOR EACH ROW
  EXECUTE FUNCTION meter_readings_coherence_fn();

DROP TRIGGER IF EXISTS service_calls_coherence_trigger ON "service_calls";
CREATE TRIGGER service_calls_coherence_trigger
  BEFORE INSERT OR UPDATE OF "utilityCustomerId", "meteringPointId", "outageId", "organizationId" ON "service_calls"
  FOR EACH ROW
  EXECUTE FUNCTION service_calls_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- R7 Insurance (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS policies_coherence_trigger ON "policies";
CREATE TRIGGER policies_coherence_trigger
  BEFORE INSERT OR UPDATE OF "policyHolderId", "underwriterId", "organizationId" ON "policies"
  FOR EACH ROW
  EXECUTE FUNCTION policies_coherence_fn();

DROP TRIGGER IF EXISTS claims_coherence_trigger ON "claims";
CREATE TRIGGER claims_coherence_trigger
  BEFORE INSERT OR UPDATE OF "policyId", "adjusterId", "organizationId" ON "claims"
  FOR EACH ROW
  EXECUTE FUNCTION claims_coherence_fn();

DROP TRIGGER IF EXISTS beneficiaries_coherence_trigger ON "beneficiaries";
CREATE TRIGGER beneficiaries_coherence_trigger
  BEFORE INSERT OR UPDATE OF "policyId", "organizationId" ON "beneficiaries"
  FOR EACH ROW
  EXECUTE FUNCTION beneficiaries_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- R8 Public Sector (3 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS public_sector_cases_coherence_trigger ON "public_sector_cases";
CREATE TRIGGER public_sector_cases_coherence_trigger
  BEFORE INSERT OR UPDATE OF "citizenId", "assignedOfficialId", "organizationId" ON "public_sector_cases"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_cases_coherence_fn();

DROP TRIGGER IF EXISTS public_sector_licenses_coherence_trigger ON "public_sector_licenses";
CREATE TRIGGER public_sector_licenses_coherence_trigger
  BEFORE INSERT OR UPDATE OF "citizenId", "issuingOfficialId", "caseId", "organizationId" ON "public_sector_licenses"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_licenses_coherence_fn();

DROP TRIGGER IF EXISTS public_sector_grants_coherence_trigger ON "public_sector_grants";
CREATE TRIGGER public_sector_grants_coherence_trigger
  BEFORE INSERT OR UPDATE OF "citizenId", "assignedOfficialId", "caseId", "organizationId" ON "public_sector_grants"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_grants_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- R11 Media (2 triggers)
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS media_ad_placements_coherence_trigger ON "media_ad_placements";
CREATE TRIGGER media_ad_placements_coherence_trigger
  BEFORE INSERT OR UPDATE OF "campaignId", "contentId", "organizationId" ON "media_ad_placements"
  FOR EACH ROW
  EXECUTE FUNCTION media_ad_placements_coherence_fn();

DROP TRIGGER IF EXISTS media_consumption_events_coherence_trigger ON "media_consumption_events";
CREATE TRIGGER media_consumption_events_coherence_trigger
  BEFORE INSERT OR UPDATE OF "subscriberId", "contentId", "placementId", "organizationId" ON "media_consumption_events"
  FOR EACH ROW
  EXECUTE FUNCTION media_consumption_events_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- G6 Event Stream (4 triggers)
-- ═══════════════════════════════════════════════════════════════════
-- NOTE: slice-1 identifier columns on these tables are already
-- protected by separate immutability triggers (event_stream_events
-- has streamId immutable, etc.). This sweep adds defense-in-depth in
-- case those immutability triggers are ever dropped or bypassed.

DROP TRIGGER IF EXISTS event_stream_events_coherence_trigger ON "event_stream_events";
CREATE TRIGGER event_stream_events_coherence_trigger
  BEFORE INSERT OR UPDATE OF "streamId", "organizationId" ON "event_stream_events"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_events_coherence_fn();

DROP TRIGGER IF EXISTS event_stream_subscriptions_coherence_trigger ON "event_stream_subscriptions";
CREATE TRIGGER event_stream_subscriptions_coherence_trigger
  BEFORE INSERT OR UPDATE OF "streamId", "organizationId" ON "event_stream_subscriptions"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_subscriptions_coherence_fn();

DROP TRIGGER IF EXISTS event_stream_delivery_attempts_coherence_trigger ON "event_stream_delivery_attempts";
CREATE TRIGGER event_stream_delivery_attempts_coherence_trigger
  BEFORE INSERT OR UPDATE OF "subscriptionId", "eventId", "organizationId" ON "event_stream_delivery_attempts"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_delivery_attempts_coherence_fn();

DROP TRIGGER IF EXISTS event_stream_dead_letters_coherence_trigger ON "event_stream_dead_letters";
CREATE TRIGGER event_stream_dead_letters_coherence_trigger
  BEFORE INSERT OR UPDATE OF "subscriptionId", "eventId", "organizationId" ON "event_stream_dead_letters"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_dead_letters_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- C9 Marketing Attribution (2 triggers)
-- ═══════════════════════════════════════════════════════════════════
-- campaign_touchpoints is INTENTIONALLY excluded: it has a fully
-- append-only immutability trigger blocking ALL UPDATEs, so a
-- coherence-on-UPDATE rule is unreachable.

DROP TRIGGER IF EXISTS campaign_influences_coherence_trigger ON "campaign_influences";
CREATE TRIGGER campaign_influences_coherence_trigger
  BEFORE INSERT OR UPDATE OF "campaignId", "dealId", "modelId", "organizationId" ON "campaign_influences"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_influences_coherence_fn();

DROP TRIGGER IF EXISTS attribution_calculation_runs_coherence_trigger ON "attribution_calculation_runs";
CREATE TRIGGER attribution_calculation_runs_coherence_trigger
  BEFORE INSERT OR UPDATE OF "modelId", "organizationId" ON "attribution_calculation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION attribution_calculation_runs_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- C5 Account Engagement (3 triggers) — Phase 6+ track, swept here
-- per inventory memo line 199-200 ("consistent posture with all
-- R-slice-2 items"). MarketingAccount is the per-tenant parent;
-- intent signals, ABM journey enrollments, and score snapshots all
-- reference it via FK.
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS account_intent_signals_coherence_trigger ON "account_intent_signals";
CREATE TRIGGER account_intent_signals_coherence_trigger
  BEFORE INSERT OR UPDATE OF "marketingAccountId", "organizationId" ON "account_intent_signals"
  FOR EACH ROW
  EXECUTE FUNCTION account_intent_signals_coherence_fn();

DROP TRIGGER IF EXISTS abm_journey_enrollments_coherence_trigger ON "abm_journey_enrollments";
CREATE TRIGGER abm_journey_enrollments_coherence_trigger
  BEFORE INSERT OR UPDATE OF "marketingAccountId", "journeyId", "organizationId" ON "abm_journey_enrollments"
  FOR EACH ROW
  EXECUTE FUNCTION abm_journey_enrollments_coherence_fn();

DROP TRIGGER IF EXISTS account_score_snapshots_coherence_trigger ON "account_score_snapshots";
CREATE TRIGGER account_score_snapshots_coherence_trigger
  BEFORE INSERT OR UPDATE OF "marketingAccountId", "organizationId" ON "account_score_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION account_score_snapshots_coherence_fn();
