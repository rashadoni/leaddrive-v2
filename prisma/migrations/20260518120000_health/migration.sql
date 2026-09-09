-- R2: Health Cloud (Phase 7 backlog item 1).
--
-- Salesforce Health Cloud analogue. Patient management for healthcare
-- verticals — primary-care clinics, telehealth, specialty practices.
--
-- IMPORTANT — HIPAA scope:
--   This slice ships SCHEMA + PURE HELPERS only. HIPAA compliance
--   (BAA, audit, encryption-at-rest beyond DB defaults, access controls
--   per minimum-necessary) is OUT OF SCOPE for slice 1. Caller-side
--   policy enforcement + DB-level pgcrypto column encryption land in
--   slice 2; certification audit is a year-long business workstream
--   beyond the developer-roadmap scope.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine + medical-
-- record-validator + care-plan-progress-calculator + appointment-
-- scheduler + types). NO admin UI, NO patient portal, NO encryption
-- hooks beyond declarative column flags.
--
-- Slice 2 wires:
--   • pgcrypto column encryption for taxId / SSN / address.
--   • Provider admin UI + patient intake forms.
--   • Telehealth integration (Twilio Video).
--   • Care-plan-progress cron.
--   • Extend coherence triggers to BEFORE UPDATE OF "patientId",
--     "organizationId" on health_encounters + health_care_plans
--     (close the re-parenting vector — medical_records is already
--     append-only so it's moot there).
--   • Add no_show timestamp coherence to health_encounters
--     (parallel to checked_in / started / completed / cancelled).
-- Slice 3 wires:
--   • HIPAA audit log (every PHI read logged).
--   • FHIR / HL7 ingest adapter for EHR cross-system records.
--   • AI triage + no-show prediction (reuse H1 agent framework).

-- ── HealthProvider ─────────────────────────────────────────────
-- Physician / nurse / specialist / technician record. Distinct from
-- the CRM User table because providers may have multiple practice
-- affiliations + must carry NPI/license numbers + specialty taxonomy.
CREATE TABLE "health_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional User link for providers who log into the CRM. */
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    /**
     * National Provider Identifier (US NPI — 10 digits). Other
     * jurisdictions: local equivalent license number (caller decides
     * format; slice-1 enforces only "non-empty 8-32 chars").
     */
    "npiNumber" TEXT,
    /**
     * Provider role (DB CHECK):
     *   physician | nurse_practitioner | physician_assistant
     *   | registered_nurse | specialist | therapist | technician | admin
     */
    "role" TEXT NOT NULL DEFAULT 'physician',
    /**
     * Specialty taxonomy slug — "cardiology", "pediatrics", etc.
     * Slice-1 free-form; slice-2 may add a Specialty table.
     */
    "specialty" TEXT,
    /** Department slug — slice-1 opaque. */
    "departmentSlug" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_providers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "health_providers"
  ADD CONSTRAINT "health_providers_role_check"
  CHECK ("role" IN (
    'physician', 'nurse_practitioner', 'physician_assistant',
    'registered_nurse', 'specialist', 'therapist', 'technician', 'admin'
  ));

ALTER TABLE "health_providers"
  ADD CONSTRAINT "health_providers_npi_check"
  CHECK ("npiNumber" IS NULL OR (length("npiNumber") >= 8 AND length("npiNumber") <= 32));

CREATE UNIQUE INDEX "health_providers_org_email_uniq"
  ON "health_providers"("organizationId", "email");
CREATE INDEX "health_providers_org_active_idx"
  ON "health_providers"("organizationId", "isActive");
CREATE INDEX "health_providers_org_role_idx"
  ON "health_providers"("organizationId", "role");
CREATE INDEX "health_providers_specialty_idx"
  ON "health_providers"("organizationId", "specialty");

ALTER TABLE "health_providers"
  ADD CONSTRAINT "health_providers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── HealthPatient ──────────────────────────────────────────────
-- Patient record. Distinct from CRM Contact because PHI columns need
-- slice-2 pgcrypto encryption + audit log. Soft FK to Contact +
-- UserPortal for patient-self-service slice-2.
--
-- PHI columns flagged in comments — slice-2 wraps with pgcrypto.
CREATE TABLE "health_patients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional Contact link for patients who came in via CRM. */
    "contactId" TEXT,
    /** Optional User link for patient portal self-service. */
    "userId" TEXT,
    /** Medical Record Number — institutional, UNIQUE per tenant. */
    "mrn" TEXT NOT NULL,
    /** Legal name (PHI). */
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    /** Date of birth (PHI — quasi-identifier). */
    "dateOfBirth" TIMESTAMP(3),
    /** Biological sex at birth (free-form caller). */
    "sexAtBirth" TEXT,
    /** Government tax / SSN (PHI — slice-2 pgcrypto wrap). */
    "taxId" TEXT,
    /** Address line 1 + city + postal code (PHI). */
    "addressLine1" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    /** Insurance carrier + policy id (PHI). */
    "insuranceCarrier" TEXT,
    "insurancePolicyId" TEXT,
    /** Emergency contact (PHI). */
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    /**
     * Lifecycle (DB CHECK):
     *   active     — under care
     *   inactive   — no recent encounters / not currently treated
     *   discharged — formally discharged from program
     *   deceased   — terminal
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    /** Primary care provider — soft FK to health_providers. */
    "primaryProviderId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargedAt" TIMESTAMP(3),
    "deceasedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_patients_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_status_check"
  CHECK ("status" IN ('active', 'inactive', 'discharged', 'deceased'));

ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_mrn_check"
  CHECK (length("mrn") >= 1 AND length("mrn") <= 64);

-- Status-timestamp coherence
ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_discharged_coherence_check"
  CHECK ("status" <> 'discharged' OR "dischargedAt" IS NOT NULL);
ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_deceased_coherence_check"
  CHECK ("status" <> 'deceased' OR "deceasedAt" IS NOT NULL);

CREATE UNIQUE INDEX "health_patients_org_mrn_uniq"
  ON "health_patients"("organizationId", "mrn");
CREATE INDEX "health_patients_org_status_idx"
  ON "health_patients"("organizationId", "status");
CREATE INDEX "health_patients_primary_provider_idx"
  ON "health_patients"("primaryProviderId");
CREATE INDEX "health_patients_contact_idx"
  ON "health_patients"("contactId");

ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_patients"
  ADD CONSTRAINT "health_patients_primaryProviderId_fkey"
  FOREIGN KEY ("primaryProviderId") REFERENCES "health_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- dischargedAt + deceasedAt immutable once set (IS DISTINCT FROM — N2 lesson).
CREATE OR REPLACE FUNCTION health_patients_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."dischargedAt" IS NOT NULL AND NEW."dischargedAt" IS DISTINCT FROM OLD."dischargedAt" THEN
    RAISE EXCEPTION 'health_patients.dischargedAt is immutable once set (patient %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deceasedAt" IS NOT NULL AND NEW."deceasedAt" IS DISTINCT FROM OLD."deceasedAt" THEN
    RAISE EXCEPTION 'health_patients.deceasedAt is immutable once set (patient %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_patients_timestamps_immutable_trigger
  BEFORE UPDATE ON "health_patients"
  FOR EACH ROW
  EXECUTE FUNCTION health_patients_timestamps_immutable_fn();

-- ── HealthMedicalRecord ────────────────────────────────────────
-- Per-event medical record: visit summary, diagnosis, lab result,
-- procedure, medication. Append-only — DB trigger blocks UPDATE.
-- Slice-2 may add a "corrections" table for medical-records-version
-- semantics (HIPAA-compliant amendment workflow).
CREATE TABLE "health_medical_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    /** Optional encounter link (if record was created during a visit). */
    "encounterId" TEXT,
    /** Provider who created the record. */
    "recordedByProviderId" TEXT,
    /**
     * Record type (DB CHECK):
     *   visit_summary | diagnosis | lab_result | procedure | medication
     *   | allergy | immunization | vital_signs | imaging | discharge_summary
     */
    "recordType" TEXT NOT NULL,
    /** Record date (clinical event date, NOT row-create time). */
    "recordedAt" TIMESTAMP(3) NOT NULL,
    /**
     * Type-specific structured payload (JSONB). Per-type shape
     * validated by medical-record-validator helper at INSERT:
     *   diagnosis     → { icd10Code, description, severity, status }
     *   lab_result    → { testName, value, unit, referenceRange, abnormal }
     *   procedure     → { cptCode, description, performedAt, outcome }
     *   medication    → { name, dosage, frequency, route, startDate, endDate? }
     *   allergy       → { allergen, reaction, severity }
     *   immunization  → { vaccine, doseNumber, administeredAt }
     *   vital_signs   → { bp, heartRate, temp, weight, height, ... }
     *   imaging       → { modality, bodyPart, findings, performedAt }
     *   visit_summary → { reasonForVisit, assessment, plan }
     *   discharge_summary → { primaryDiagnosis, instructions, followUp }
     */
    "details" JSONB NOT NULL DEFAULT '{}',
    /** Free-text clinician notes (PHI). */
    "clinicianNotes" TEXT,
    /**
     * Severity hint (DB CHECK):
     *   informational | low | moderate | high | critical
     */
    "severity" TEXT NOT NULL DEFAULT 'informational',
    /**
     * Sensitivity classification (DB CHECK):
     *   normal | sensitive | restricted
     * Slice-2 RBAC reads this to gate which providers can see which
     * records (mental-health / HIV / substance-use require restricted).
     */
    "sensitivity" TEXT NOT NULL DEFAULT 'normal',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_medical_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_type_check"
  CHECK ("recordType" IN (
    'visit_summary', 'diagnosis', 'lab_result', 'procedure', 'medication',
    'allergy', 'immunization', 'vital_signs', 'imaging', 'discharge_summary'
  ));

ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_severity_check"
  CHECK ("severity" IN ('informational', 'low', 'moderate', 'high', 'critical'));

ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_sensitivity_check"
  CHECK ("sensitivity" IN ('normal', 'sensitive', 'restricted'));

CREATE INDEX "health_medical_records_patient_recorded_idx"
  ON "health_medical_records"("patientId", "recordedAt");
CREATE INDEX "health_medical_records_org_type_idx"
  ON "health_medical_records"("organizationId", "recordType");
CREATE INDEX "health_medical_records_encounter_idx"
  ON "health_medical_records"("encounterId");
CREATE INDEX "health_medical_records_provider_idx"
  ON "health_medical_records"("recordedByProviderId");

ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "health_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medical_records"
  ADD CONSTRAINT "health_medical_records_recordedByProviderId_fkey"
  FOREIGN KEY ("recordedByProviderId") REFERENCES "health_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- health_encounters is created later in this same migration. The original
-- unconditional FK caused fresh installs to fail before reaching that CREATE.
-- Existing deployed databases are unaffected; the idempotent fix-forward
-- migration 20260519230000_fix_health_fk_order adds the FK after both tables
-- exist.
DO $$
BEGIN
  IF to_regclass('public.health_encounters') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'health_medical_records_encounterId_fkey'
     ) THEN
    ALTER TABLE "health_medical_records"
      ADD CONSTRAINT "health_medical_records_encounterId_fkey"
      FOREIGN KEY ("encounterId") REFERENCES "health_encounters"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Append-only: NO UPDATE allowed (HIPAA-friendly amendment via new row).
CREATE OR REPLACE FUNCTION health_medical_records_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'health_medical_records is append-only; UPDATE not allowed (record %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_medical_records_no_update_trigger
  BEFORE UPDATE ON "health_medical_records"
  FOR EACH ROW
  EXECUTE FUNCTION health_medical_records_no_update_fn();

-- ── HealthEncounter ────────────────────────────────────────────
-- Appointment / visit / telehealth session. Lifecycle from scheduled
-- to completed/no-show/cancelled. Cancellation reasons captured.
CREATE TABLE "health_encounters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    /**
     * Encounter type (DB CHECK):
     *   in_person | telehealth | phone | home_visit | inpatient
     */
    "encounterType" TEXT NOT NULL DEFAULT 'in_person',
    /** Reason for visit (free-form). */
    "reason" TEXT,
    /**
     * Lifecycle (DB CHECK):
     *   scheduled | checked_in | in_progress | completed
     *   | no_show | cancelled
     */
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "scheduledEndAt" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancellationReason" TEXT,
    /** Location — clinic room / telehealth URL / phone-call ref. */
    "location" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_encounters_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_type_check"
  CHECK ("encounterType" IN ('in_person', 'telehealth', 'phone', 'home_visit', 'inpatient'));

ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_status_check"
  CHECK ("status" IN (
    'scheduled', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled'
  ));

ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_time_check"
  CHECK ("scheduledEndAt" > "scheduledStartAt");

-- Status-timestamp coherence
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_checked_in_coherence_check"
  CHECK ("status" NOT IN ('checked_in', 'in_progress', 'completed') OR "checkedInAt" IS NOT NULL);
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_started_coherence_check"
  CHECK ("status" NOT IN ('in_progress', 'completed') OR "startedAt" IS NOT NULL);
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_completed_coherence_check"
  CHECK ("status" <> 'completed' OR "completedAt" IS NOT NULL);
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE INDEX "health_encounters_patient_scheduled_idx"
  ON "health_encounters"("patientId", "scheduledStartAt");
CREATE INDEX "health_encounters_provider_scheduled_idx"
  ON "health_encounters"("providerId", "scheduledStartAt");
CREATE INDEX "health_encounters_org_status_idx"
  ON "health_encounters"("organizationId", "status");
CREATE INDEX "health_encounters_org_type_idx"
  ON "health_encounters"("organizationId", "encounterType");

ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "health_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_encounters"
  ADD CONSTRAINT "health_encounters_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "health_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Encounter terminal timestamps immutable once set.
CREATE OR REPLACE FUNCTION health_encounters_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."checkedInAt" IS NOT NULL AND NEW."checkedInAt" IS DISTINCT FROM OLD."checkedInAt" THEN
    RAISE EXCEPTION 'health_encounters.checkedInAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'health_encounters.startedAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'health_encounters.completedAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'health_encounters.cancelledAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_encounters_timestamps_immutable_trigger
  BEFORE UPDATE ON "health_encounters"
  FOR EACH ROW
  EXECUTE FUNCTION health_encounters_timestamps_immutable_fn();

-- ── HealthCarePlan ─────────────────────────────────────────────
-- Care plan — defined goals + interventions for a patient over a
-- period. Slice-2 care-plan-progress-calculator walks linked records
-- to compute progress per goal.
CREATE TABLE "health_care_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /** Lead provider managing the plan. */
    "providerId" TEXT,
    /**
     * Plan goals (JSONB). Shape:
     *   [{ id, label, metric, targetValue, comparator: 'gte'|'lte'|'eq',
     *      kpiSource: 'medical_record_count'|'medication_adherence' }]
     * care-plan-progress-calculator walks goals at compute time.
     */
    "goals" JSONB NOT NULL DEFAULT '[]',
    /** Start of the plan's active window. */
    "startDate" TIMESTAMP(3) NOT NULL,
    /** End of the active window. NULL = open-ended. */
    "endDate" TIMESTAMP(3),
    /**
     * Lifecycle (DB CHECK):
     *   draft | active | paused | completed | cancelled
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_care_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_status_check"
  CHECK ("status" IN ('draft', 'active', 'paused', 'completed', 'cancelled'))
;

ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_period_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- Status-timestamp coherence
ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'paused', 'completed') OR "activatedAt" IS NOT NULL);
ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_completed_coherence_check"
  CHECK ("status" <> 'completed' OR "completedAt" IS NOT NULL);
ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE INDEX "health_care_plans_patient_status_idx"
  ON "health_care_plans"("patientId", "status");
CREATE INDEX "health_care_plans_org_status_idx"
  ON "health_care_plans"("organizationId", "status");
CREATE INDEX "health_care_plans_provider_idx"
  ON "health_care_plans"("providerId");

ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "health_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_care_plans"
  ADD CONSTRAINT "health_care_plans_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "health_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Care-plan terminal timestamps immutable once set.
CREATE OR REPLACE FUNCTION health_care_plans_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'health_care_plans.activatedAt is immutable once set (plan %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'health_care_plans.completedAt is immutable once set (plan %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'health_care_plans.cancelledAt is immutable once set (plan %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_care_plans_timestamps_immutable_trigger
  BEFORE UPDATE ON "health_care_plans"
  FOR EACH ROW
  EXECUTE FUNCTION health_care_plans_timestamps_immutable_fn();

-- ── Cross-table coherence (C2/C4/G5 pattern) ───────────────────
-- Medical records + encounters + care plans MUST belong to the same
-- org as their parent patient. Defends multi-tenant leakage.
CREATE OR REPLACE FUNCTION health_medical_records_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  patient_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO patient_org_id
    FROM "health_patients"
    WHERE "id" = NEW."patientId";
  IF patient_org_id IS NULL THEN
    RAISE EXCEPTION 'health_medical_records.patientId "%" does not resolve',
      NEW."patientId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF patient_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'health_medical_records: patient "%" belongs to org "%" but record references org "%"',
      NEW."patientId", patient_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_medical_records_coherence_trigger
  BEFORE INSERT ON "health_medical_records"
  FOR EACH ROW
  EXECUTE FUNCTION health_medical_records_coherence_fn();

-- Encounter ↔ patient org match (same multi-tenant defense).
CREATE OR REPLACE FUNCTION health_encounters_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  patient_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO patient_org_id
    FROM "health_patients"
    WHERE "id" = NEW."patientId";
  IF patient_org_id IS NULL THEN
    RAISE EXCEPTION 'health_encounters.patientId "%" does not resolve',
      NEW."patientId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF patient_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'health_encounters: patient "%" belongs to org "%" but encounter references org "%"',
      NEW."patientId", patient_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_encounters_coherence_trigger
  BEFORE INSERT ON "health_encounters"
  FOR EACH ROW
  EXECUTE FUNCTION health_encounters_coherence_fn();

-- Care plan ↔ patient org match (same multi-tenant defense).
CREATE OR REPLACE FUNCTION health_care_plans_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  patient_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO patient_org_id
    FROM "health_patients"
    WHERE "id" = NEW."patientId";
  IF patient_org_id IS NULL THEN
    RAISE EXCEPTION 'health_care_plans.patientId "%" does not resolve',
      NEW."patientId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF patient_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'health_care_plans: patient "%" belongs to org "%" but plan references org "%"',
      NEW."patientId", patient_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER health_care_plans_coherence_trigger
  BEFORE INSERT ON "health_care_plans"
  FOR EACH ROW
  EXECUTE FUNCTION health_care_plans_coherence_fn();
