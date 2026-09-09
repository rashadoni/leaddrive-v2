-- R6: Energy & Utilities Cloud (Phase 7 backlog item).
--
-- Salesforce E&U Cloud analogue. Customer service for utilities
-- (electricity / gas / water / district heating), with smart-metering
-- ingestion + outage management + service-call dispatch.
--
-- Slice 1 ships SCHEMA + 5 PURE HELPERS only. Out of scope (slice-2+):
--   • Smart-meter ingestion adapter (AMI/AMR push pipeline).
--   • SCADA / DERMS integration for grid-level outage detection.
--   • Mobile field-service app for technician dispatch (depends on O1).
--   • Customer portal: bill view, outage map, usage charts.
--   • Tariff engine + rate calculation against MeterReading (depends on M3
--     Billing depth).
--   • Energy-disaggregation AI (reuse H1 agent framework) for
--     "where's your energy going" breakdown.
--
-- 5 tables:
--   utility_customers   — utility-side account (distinct from CRM Contact:
--                          residential/commercial/industrial classification +
--                          service-address anchor + billing-account number)
--   metering_points     — physical meter at a service address (electricity/
--                          gas/water/heat type, status lifecycle, install date)
--   meter_readings      — time-series usage data (APPEND-ONLY by trigger),
--                          source: manual / amr / ami / estimated;
--                          tariffCode + cumulativeValue + intervalValue
--   outages             — service disruption (planned/unplanned),
--                          affectedMeterCount snapshot, severity tier,
--                          status lifecycle (active → resolved | cancelled)
--   service_calls       — customer-initiated service request, lifecycle
--                          (received → dispatched → in_progress → resolved
--                           | cancelled), priority + queue routing

-- ── UtilityCustomer ────────────────────────────────────────────
-- Utility-side account record. Distinct from CRM Contact / Company
-- because: utility account has its own account number (billing system),
-- a service-address anchor (the meter location, possibly different
-- from contact's mailing address), and a customer class (residential/
-- commercial/industrial) that drives tariff selection + outreach.
CREATE TABLE "utility_customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to CRM Contact for billing-side correspondence. */
    "contactId" TEXT,
    /** Billing-system account number — UNIQUE per tenant. */
    "accountNumber" TEXT NOT NULL,
    /** Legal-name of the account holder (PII). */
    "accountHolderName" TEXT NOT NULL,
    /** Service-address — where meters are physically located. */
    "serviceAddressLine1" TEXT NOT NULL,
    "serviceAddressLine2" TEXT,
    "serviceCity" TEXT NOT NULL,
    "servicePostalCode" TEXT,
    "serviceCountry" TEXT,
    /** Customer class (DB CHECK):
     *  residential | small_commercial | large_commercial | industrial | agricultural | municipal
     */
    "customerClass" TEXT NOT NULL DEFAULT 'residential',
    /** Lifecycle (DB CHECK):
     *  prospect | active | suspended | terminated
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "utility_customers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_class_check"
  CHECK ("customerClass" IN (
    'residential', 'small_commercial', 'large_commercial',
    'industrial', 'agricultural', 'municipal'
  ));

ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_status_check"
  CHECK ("status" IN ('prospect', 'active', 'suspended', 'terminated'));

-- Status-timestamp coherence.
ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'suspended', 'terminated') OR "activatedAt" IS NOT NULL);
ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_suspended_coherence_check"
  CHECK ("status" <> 'suspended' OR "suspendedAt" IS NOT NULL);
ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_terminated_coherence_check"
  CHECK ("status" <> 'terminated' OR "terminatedAt" IS NOT NULL);

CREATE UNIQUE INDEX "utility_customers_org_account_uniq"
  ON "utility_customers"("organizationId", "accountNumber");
CREATE INDEX "utility_customers_org_status_idx"
  ON "utility_customers"("organizationId", "status");
CREATE INDEX "utility_customers_org_class_idx"
  ON "utility_customers"("organizationId", "customerClass");
CREATE INDEX "utility_customers_contact_idx"
  ON "utility_customers"("contactId");

ALTER TABLE "utility_customers"
  ADD CONSTRAINT "utility_customers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activation timestamps immutable once set (IS DISTINCT FROM — N2 lesson).
CREATE OR REPLACE FUNCTION utility_customers_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'utility_customers.activatedAt is immutable once set (customer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."suspendedAt" IS NOT NULL AND NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt" THEN
    RAISE EXCEPTION 'utility_customers.suspendedAt is immutable once set (customer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."terminatedAt" IS NOT NULL AND NEW."terminatedAt" IS DISTINCT FROM OLD."terminatedAt" THEN
    RAISE EXCEPTION 'utility_customers.terminatedAt is immutable once set (customer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER utility_customers_timestamps_immutable_trigger
  BEFORE UPDATE ON "utility_customers"
  FOR EACH ROW
  EXECUTE FUNCTION utility_customers_timestamps_immutable_fn();

-- ── MeteringPoint ──────────────────────────────────────────────
-- Physical meter device at a service address. Multiple meters can
-- be associated with a single UtilityCustomer (e.g. industrial site
-- with separate electricity + gas + water meters).
CREATE TABLE "metering_points" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "utilityCustomerId" TEXT NOT NULL,
    /** Meter serial / device number — UNIQUE per tenant (a tenant
     *  cannot have two meters with the same physical serial). */
    "meterNumber" TEXT NOT NULL,
    /** Commodity type (DB CHECK):
     *  electricity | gas | water | district_heating | sewer
     */
    "commodityType" TEXT NOT NULL,
    /** Service-address coordinates — optional (slice-2 fills via
     *  geocoding when service-address is normalized). */
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    /** Manufacturer / model (free-form). */
    "manufacturer" TEXT,
    "modelNumber" TEXT,
    /** Installation date — wall-clock when meter went into service. */
    "installedAt" TIMESTAMP(3),
    /** Lifecycle (DB CHECK):
     *  pending_install — created in system but not yet on wall
     *  active          — in service, accumulating readings
     *  disconnected    — temporarily off (customer suspension)
     *  retired         — physically removed (UNIQUE-relaxed: a new
     *                    meter at the same address with same serial
     *                    not possible — we keep retired ones for
     *                    historical reading FK preservation, but no
     *                    new readings allowed)
     */
    "status" TEXT NOT NULL DEFAULT 'pending_install',
    "disconnectedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    /** Tariff plan slug for billing (slice-2 wires to tariff engine). */
    "tariffPlanSlug" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "metering_points_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_commodity_check"
  CHECK ("commodityType" IN (
    'electricity', 'gas', 'water', 'district_heating', 'sewer'
  ));

ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_status_check"
  CHECK ("status" IN (
    'pending_install', 'active', 'disconnected', 'retired'
  ));

-- Coords sanity: lat ∈ [-90, 90], lon ∈ [-180, 180].
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_lat_check"
  CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90));
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_lon_check"
  CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));

-- Status-timestamp coherence:
--   active / disconnected / retired requires installedAt set
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_installed_coherence_check"
  CHECK ("status" NOT IN ('active', 'disconnected', 'retired')
         OR "installedAt" IS NOT NULL);
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_disconnected_coherence_check"
  CHECK ("status" <> 'disconnected' OR "disconnectedAt" IS NOT NULL);
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_retired_coherence_check"
  CHECK ("status" <> 'retired' OR "retiredAt" IS NOT NULL);

CREATE UNIQUE INDEX "metering_points_org_meter_uniq"
  ON "metering_points"("organizationId", "meterNumber");
CREATE INDEX "metering_points_customer_idx"
  ON "metering_points"("utilityCustomerId");
CREATE INDEX "metering_points_org_status_idx"
  ON "metering_points"("organizationId", "status");
CREATE INDEX "metering_points_org_commodity_idx"
  ON "metering_points"("organizationId", "commodityType");

ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metering_points"
  ADD CONSTRAINT "metering_points_utilityCustomerId_fkey"
  FOREIGN KEY ("utilityCustomerId") REFERENCES "utility_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Install/disconnect/retire timestamps immutable once set.
CREATE OR REPLACE FUNCTION metering_points_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."installedAt" IS NOT NULL AND NEW."installedAt" IS DISTINCT FROM OLD."installedAt" THEN
    RAISE EXCEPTION 'metering_points.installedAt is immutable once set (meter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."disconnectedAt" IS NOT NULL AND NEW."disconnectedAt" IS DISTINCT FROM OLD."disconnectedAt" THEN
    RAISE EXCEPTION 'metering_points.disconnectedAt is immutable once set (meter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'metering_points.retiredAt is immutable once set (meter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metering_points_timestamps_immutable_trigger
  BEFORE UPDATE ON "metering_points"
  FOR EACH ROW
  EXECUTE FUNCTION metering_points_timestamps_immutable_fn();

-- ── MeterReading ───────────────────────────────────────────────
-- Time-series usage observation. Append-only (UPDATE blocked by
-- trigger); corrections require a new estimation row with linkage.
-- This is the time-series facts table for the entire utility — high-
-- volume, indexed for (meterId, readingAt) range scans.
CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meteringPointId" TEXT NOT NULL,
    /** Reading source (DB CHECK):
     *  manual    — walk-up / customer-reported
     *  amr       — automated meter reading (drive-by)
     *  ami       — advanced metering infrastructure (smart meter push)
     *  estimated — generated by billing system when read missing
     *  corrected — supersedes a prior reading (slice-2 wires linkage)
     */
    "source" TEXT NOT NULL,
    /** Wall-clock when meter was physically read (NOT row-create time). */
    "readingAt" TIMESTAMP(3) NOT NULL,
    /** Cumulative register reading at readingAt. */
    "cumulativeValue" DECIMAL(18, 4) NOT NULL,
    /** Interval value = (this.cumulative − prior.cumulative); NULL if
     *  this is the first reading or supplier hasn't joined yet. */
    "intervalValue" DECIMAL(18, 4),
    /** Unit (kWh / m³ / GJ / etc) — free-form per commodityType convention. */
    "unit" TEXT NOT NULL,
    /** Tariff applied at this reading window (slice-2 fills from rate engine). */
    "tariffCode" TEXT,
    /** Quality flag (DB CHECK):
     *  raw       — uninspected
     *  validated — passed range / continuity checks
     *  flagged   — fails one or more checks; held for review
     */
    "quality" TEXT NOT NULL DEFAULT 'raw',
    /** Optional link to a prior reading this one corrects. */
    "supersedesReadingId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_source_check"
  CHECK ("source" IN ('manual', 'amr', 'ami', 'estimated', 'corrected'));

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_quality_check"
  CHECK ("quality" IN ('raw', 'validated', 'flagged'));

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_cumulative_check"
  CHECK ("cumulativeValue" >= 0);

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_unit_check"
  CHECK (length("unit") >= 1 AND length("unit") <= 16);

-- corrected source ⇒ supersedesReadingId must be set
ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_correction_coherence_check"
  CHECK ("source" <> 'corrected' OR "supersedesReadingId" IS NOT NULL);

CREATE INDEX "meter_readings_meter_time_idx"
  ON "meter_readings"("meteringPointId", "readingAt");
CREATE INDEX "meter_readings_org_quality_idx"
  ON "meter_readings"("organizationId", "quality");
CREATE INDEX "meter_readings_org_source_idx"
  ON "meter_readings"("organizationId", "source");
CREATE INDEX "meter_readings_supersedes_idx"
  ON "meter_readings"("supersedesReadingId");

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_meteringPointId_fkey"
  FOREIGN KEY ("meteringPointId") REFERENCES "metering_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ON DELETE RESTRICT — preserves audit-trail integrity: a correction
-- row's pointer to its superseded reading must remain intact even if
-- a downstream operator tries to delete the original. To delete a
-- meter and all readings, CASCADE from metering_points still works
-- (it removes both rows in the same transaction).
ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_supersedesReadingId_fkey"
  FOREIGN KEY ("supersedesReadingId") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: NO UPDATE allowed (corrections via new row pointing at
-- supersedesReadingId — preserves an immutable audit trail).
CREATE OR REPLACE FUNCTION meter_readings_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'meter_readings is append-only; UPDATE not allowed (reading %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meter_readings_no_update_trigger
  BEFORE UPDATE ON "meter_readings"
  FOR EACH ROW
  EXECUTE FUNCTION meter_readings_no_update_fn();

-- ── Outage ─────────────────────────────────────────────────────
-- Service disruption — planned (maintenance) or unplanned (storm/
-- equipment failure). Slice-2 cron joins outages × meter-set to
-- snapshot which customers are affected for outreach.
CREATE TABLE "outages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Reference label (e.g. "OUT-2026-05-1234") — UNIQUE per tenant. */
    "outageNumber" TEXT NOT NULL,
    /** Outage cause (DB CHECK):
     *  planned_maintenance | equipment_failure | weather | third_party_damage
     *  | overload | unknown
     */
    "cause" TEXT NOT NULL DEFAULT 'unknown',
    /** Severity (DB CHECK):
     *  minor     — single-property
     *  moderate  — neighborhood
     *  major     — feeder / multiple-neighborhoods
     *  critical  — substation / city-grade
     */
    "severity" TEXT NOT NULL DEFAULT 'minor',
    /** Lifecycle (DB CHECK):
     *  pending   — scheduled future outage (planned)
     *  active    — currently in progress
     *  resolved  — power restored
     *  cancelled — planned outage cancelled before start
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Scheduled / actual timestamps. */
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    /** Snapshot at outage start — count of affected meters
     *  (slice-2 fills via meter-set query at status=active transition). */
    "affectedMeterCount" INTEGER NOT NULL DEFAULT 0,
    /** Public-facing summary (caller decides language; slice-2 i18n). */
    "publicSummary" TEXT,
    /** Internal notes (technician-side). */
    "internalNotes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "outages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "outages"
  ADD CONSTRAINT "outages_cause_check"
  CHECK ("cause" IN (
    'planned_maintenance', 'equipment_failure', 'weather',
    'third_party_damage', 'overload', 'unknown'
  ));

ALTER TABLE "outages"
  ADD CONSTRAINT "outages_severity_check"
  CHECK ("severity" IN ('minor', 'moderate', 'major', 'critical'));

ALTER TABLE "outages"
  ADD CONSTRAINT "outages_status_check"
  CHECK ("status" IN ('pending', 'active', 'resolved', 'cancelled'));

ALTER TABLE "outages"
  ADD CONSTRAINT "outages_affected_count_check"
  CHECK ("affectedMeterCount" >= 0);

-- scheduledEnd > scheduledStart (when both set)
ALTER TABLE "outages"
  ADD CONSTRAINT "outages_scheduled_window_check"
  CHECK ("scheduledEndAt" IS NULL OR "scheduledStartAt" IS NULL
         OR "scheduledEndAt" > "scheduledStartAt");
-- actualEnd > actualStart (when both set)
ALTER TABLE "outages"
  ADD CONSTRAINT "outages_actual_window_check"
  CHECK ("actualEndAt" IS NULL OR "actualStartAt" IS NULL
         OR "actualEndAt" > "actualStartAt");

-- Status-timestamp coherence.
ALTER TABLE "outages"
  ADD CONSTRAINT "outages_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'resolved') OR "actualStartAt" IS NOT NULL);
ALTER TABLE "outages"
  ADD CONSTRAINT "outages_resolved_coherence_check"
  CHECK ("status" <> 'resolved' OR "actualEndAt" IS NOT NULL);
-- Symmetry with service_calls.cancelled_coherence: cancelled status
-- requires witness columns. Reuses scheduledStartAt as "intended start"
-- so the cancelled row still records when the planned outage was
-- supposed to happen (slice-2 reporting reads this for planned-outage
-- cancellation rate).
ALTER TABLE "outages"
  ADD CONSTRAINT "outages_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR "scheduledStartAt" IS NOT NULL);

CREATE UNIQUE INDEX "outages_org_number_uniq"
  ON "outages"("organizationId", "outageNumber");
CREATE INDEX "outages_org_status_idx"
  ON "outages"("organizationId", "status");
CREATE INDEX "outages_org_severity_idx"
  ON "outages"("organizationId", "severity");
CREATE INDEX "outages_org_started_idx"
  ON "outages"("organizationId", "actualStartAt");

ALTER TABLE "outages"
  ADD CONSTRAINT "outages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Actual start/end timestamps immutable once set.
CREATE OR REPLACE FUNCTION outages_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."actualStartAt" IS NOT NULL AND NEW."actualStartAt" IS DISTINCT FROM OLD."actualStartAt" THEN
    RAISE EXCEPTION 'outages.actualStartAt is immutable once set (outage %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."actualEndAt" IS NOT NULL AND NEW."actualEndAt" IS DISTINCT FROM OLD."actualEndAt" THEN
    RAISE EXCEPTION 'outages.actualEndAt is immutable once set (outage %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outages_timestamps_immutable_trigger
  BEFORE UPDATE ON "outages"
  FOR EACH ROW
  EXECUTE FUNCTION outages_timestamps_immutable_fn();

-- ── ServiceCall ────────────────────────────────────────────────
-- Customer-initiated service request: outage report, new connection,
-- meter inspection, billing dispute, disconnection request. Routed
-- to technician queue by slice-2 dispatch helper.
CREATE TABLE "service_calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Reference label (e.g. "SC-2026-05-9876") — UNIQUE per tenant. */
    "callNumber" TEXT NOT NULL,
    "utilityCustomerId" TEXT,
    "meteringPointId" TEXT,
    /** Linked outage (if customer is reporting an outage). */
    "outageId" TEXT,
    /** Call type (DB CHECK):
     *  outage_report | new_connection | disconnection | reconnection
     *  | meter_inspection | meter_replacement | billing_dispute
     *  | usage_question | service_upgrade
     */
    "callType" TEXT NOT NULL,
    /** Priority (DB CHECK):
     *  routine | elevated | urgent | emergency
     */
    "priority" TEXT NOT NULL DEFAULT 'routine',
    /** Lifecycle (DB CHECK):
     *  received    — captured but not yet dispatched
     *  dispatched  — assigned to technician / crew
     *  in_progress — work started
     *  resolved    — work complete
     *  cancelled   — withdrawn before resolution
     */
    "status" TEXT NOT NULL DEFAULT 'received',
    /** Brief reason (free-form caller). */
    "subject" TEXT NOT NULL,
    "description" TEXT,
    /** Queue slug for technician routing (slice-2 carves to specific dispatch pools). */
    "queueSlug" TEXT,
    /** Assigned technician — soft FK to User. */
    "assignedToUserId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "resolutionNotes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_calls_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_type_check"
  CHECK ("callType" IN (
    'outage_report', 'new_connection', 'disconnection', 'reconnection',
    'meter_inspection', 'meter_replacement', 'billing_dispute',
    'usage_question', 'service_upgrade'
  ));

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_priority_check"
  CHECK ("priority" IN ('routine', 'elevated', 'urgent', 'emergency'));

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_status_check"
  CHECK ("status" IN (
    'received', 'dispatched', 'in_progress', 'resolved', 'cancelled'
  ));

-- Status-timestamp coherence.
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_dispatched_coherence_check"
  CHECK ("status" NOT IN ('dispatched', 'in_progress', 'resolved')
         OR "dispatchedAt" IS NOT NULL);
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_started_coherence_check"
  CHECK ("status" NOT IN ('in_progress', 'resolved')
         OR "startedAt" IS NOT NULL);
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_resolved_coherence_check"
  CHECK ("status" <> 'resolved' OR "resolvedAt" IS NOT NULL);
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled'
         OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE UNIQUE INDEX "service_calls_org_number_uniq"
  ON "service_calls"("organizationId", "callNumber");
CREATE INDEX "service_calls_org_status_idx"
  ON "service_calls"("organizationId", "status");
CREATE INDEX "service_calls_org_priority_idx"
  ON "service_calls"("organizationId", "priority");
CREATE INDEX "service_calls_customer_idx"
  ON "service_calls"("utilityCustomerId");
CREATE INDEX "service_calls_outage_idx"
  ON "service_calls"("outageId");
CREATE INDEX "service_calls_queue_status_idx"
  ON "service_calls"("organizationId", "queueSlug", "status");
-- Dispatcher view: "open calls assigned to technician X" must hit an
-- index (otherwise seq scan on every dispatch screen refresh).
CREATE INDEX "service_calls_assigned_status_idx"
  ON "service_calls"("organizationId", "assignedToUserId", "status");

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_utilityCustomerId_fkey"
  FOREIGN KEY ("utilityCustomerId") REFERENCES "utility_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_meteringPointId_fkey"
  FOREIGN KEY ("meteringPointId") REFERENCES "metering_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_outageId_fkey"
  FOREIGN KEY ("outageId") REFERENCES "outages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Terminal timestamps immutable once set.
CREATE OR REPLACE FUNCTION service_calls_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt" THEN
    RAISE EXCEPTION 'service_calls.dispatchedAt is immutable once set (call %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'service_calls.startedAt is immutable once set (call %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" THEN
    RAISE EXCEPTION 'service_calls.resolvedAt is immutable once set (call %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'service_calls.cancelledAt is immutable once set (call %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_calls_timestamps_immutable_trigger
  BEFORE UPDATE ON "service_calls"
  FOR EACH ROW
  EXECUTE FUNCTION service_calls_timestamps_immutable_fn();

-- ── Cross-table coherence (C2/C4/G5/R2 pattern) ────────────────
-- meter readings + metering points must belong to the same org as
-- their parent. service_calls + metering_points + outages × customer
-- get the same multi-tenant defense.

CREATE OR REPLACE FUNCTION metering_points_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  customer_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO customer_org_id
    FROM "utility_customers"
    WHERE "id" = NEW."utilityCustomerId";
  IF customer_org_id IS NULL THEN
    RAISE EXCEPTION 'metering_points.utilityCustomerId "%" does not resolve',
      NEW."utilityCustomerId" USING ERRCODE = 'check_violation';
  END IF;
  IF customer_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'metering_points: customer "%" belongs to org "%" but meter references org "%"',
      NEW."utilityCustomerId", customer_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metering_points_coherence_trigger
  BEFORE INSERT ON "metering_points"
  FOR EACH ROW
  EXECUTE FUNCTION metering_points_coherence_fn();

CREATE OR REPLACE FUNCTION meter_readings_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  meter_org_id TEXT;
  superseded_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO meter_org_id
    FROM "metering_points"
    WHERE "id" = NEW."meteringPointId";
  IF meter_org_id IS NULL THEN
    RAISE EXCEPTION 'meter_readings.meteringPointId "%" does not resolve',
      NEW."meteringPointId" USING ERRCODE = 'check_violation';
  END IF;
  IF meter_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'meter_readings: meter "%" belongs to org "%" but reading references org "%"',
      NEW."meteringPointId", meter_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Correction-chain org integrity: a corrected reading cannot
  -- supersede a reading from a different tenant (would leak history
  -- between tenants).
  IF NEW."supersedesReadingId" IS NOT NULL THEN
    SELECT "organizationId" INTO superseded_org_id
      FROM "meter_readings"
      WHERE "id" = NEW."supersedesReadingId";
    IF superseded_org_id IS NULL THEN
      RAISE EXCEPTION 'meter_readings.supersedesReadingId "%" does not resolve',
        NEW."supersedesReadingId" USING ERRCODE = 'check_violation';
    END IF;
    IF superseded_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'meter_readings: superseded reading "%" belongs to org "%" but correction references org "%"',
        NEW."supersedesReadingId", superseded_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meter_readings_coherence_trigger
  BEFORE INSERT ON "meter_readings"
  FOR EACH ROW
  EXECUTE FUNCTION meter_readings_coherence_fn();

-- ── service_calls coherence ────────────────────────────────────
-- All three optional FKs (utilityCustomerId / meteringPointId /
-- outageId) must point at rows in the same org as the call itself.
-- NULL on any of them is fine — orphan service-call (no linkage)
-- is a valid call type (e.g. usage_question with no specific meter).
CREATE OR REPLACE FUNCTION service_calls_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  customer_org_id TEXT;
  meter_org_id TEXT;
  outage_org_id TEXT;
BEGIN
  IF NEW."utilityCustomerId" IS NOT NULL THEN
    SELECT "organizationId" INTO customer_org_id
      FROM "utility_customers"
      WHERE "id" = NEW."utilityCustomerId";
    IF customer_org_id IS NULL THEN
      RAISE EXCEPTION 'service_calls.utilityCustomerId "%" does not resolve',
        NEW."utilityCustomerId" USING ERRCODE = 'check_violation';
    END IF;
    IF customer_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'service_calls: customer "%" belongs to org "%" but call references org "%"',
        NEW."utilityCustomerId", customer_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."meteringPointId" IS NOT NULL THEN
    SELECT "organizationId" INTO meter_org_id
      FROM "metering_points"
      WHERE "id" = NEW."meteringPointId";
    IF meter_org_id IS NULL THEN
      RAISE EXCEPTION 'service_calls.meteringPointId "%" does not resolve',
        NEW."meteringPointId" USING ERRCODE = 'check_violation';
    END IF;
    IF meter_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'service_calls: meter "%" belongs to org "%" but call references org "%"',
        NEW."meteringPointId", meter_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."outageId" IS NOT NULL THEN
    SELECT "organizationId" INTO outage_org_id
      FROM "outages"
      WHERE "id" = NEW."outageId";
    IF outage_org_id IS NULL THEN
      RAISE EXCEPTION 'service_calls.outageId "%" does not resolve',
        NEW."outageId" USING ERRCODE = 'check_violation';
    END IF;
    IF outage_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'service_calls: outage "%" belongs to org "%" but call references org "%"',
        NEW."outageId", outage_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_calls_coherence_trigger
  BEFORE INSERT ON "service_calls"
  FOR EACH ROW
  EXECUTE FUNCTION service_calls_coherence_fn();
