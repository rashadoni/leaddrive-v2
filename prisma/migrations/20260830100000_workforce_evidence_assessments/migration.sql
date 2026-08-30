-- C4: raw attendance evidence and its derived assessment are deliberately
-- separate. Raw evidence is encrypted at the application boundary, expires
-- after the recorded 30-day policy and can be purged without removing a
-- non-reversible assessment/verdict used by ordinary reporting.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceEvidenceCaptureSource" AS ENUM ('LOCATION', 'QR', 'DEVICE', 'KIOSK', 'MANUAL');
CREATE TYPE "WorkforceEvidenceAssessmentKind" AS ENUM ('GEOFENCE', 'LOCATION_QUALITY', 'PROOF_POLICY');
CREATE TYPE "WorkforceEvidenceAssessmentVerdict" AS ENUM (
  'INSIDE', 'OUTSIDE', 'UNKNOWN', 'ELIGIBLE', 'REVIEW_REQUIRED', 'UNAVAILABLE', 'SATISFIED'
);

CREATE TABLE "workforce_attendance_evidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdayEventId" TEXT,
  "siteTransitionId" TEXT,
  "operationReference" VARCHAR(191) NOT NULL,
  "source" "WorkforceEvidenceCaptureSource" NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "redactedReceipt" JSONB NOT NULL,
  "rawEnvelopeCiphertext" TEXT,
  "rawExpiresAt" TIMESTAMP(3) NOT NULL,
  "rawPurgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_attendance_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_evidence_subject_check" CHECK (
    ("workdayEventId" IS NOT NULL AND "siteTransitionId" IS NULL)
    OR ("workdayEventId" IS NULL AND "siteTransitionId" IS NOT NULL)
  ),
  CONSTRAINT "workforce_attendance_evidence_schema_check" CHECK ("schemaVersion" >= 1),
  CONSTRAINT "workforce_attendance_evidence_hash_check" CHECK ("payloadHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_attendance_evidence_raw_expiry_check" CHECK ("rawExpiresAt" > "capturedAt"),
  CONSTRAINT "workforce_attendance_evidence_purge_check" CHECK (
    ("rawEnvelopeCiphertext" IS NOT NULL AND "rawPurgedAt" IS NULL)
    OR (
      "rawEnvelopeCiphertext" IS NULL
      AND "rawPurgedAt" IS NOT NULL
      AND "rawPurgedAt" >= "rawExpiresAt"
    )
  ),
  CONSTRAINT "workforce_attendance_evidence_receipt_check" CHECK (
    jsonb_typeof("redactedReceipt") = 'object'
    AND NOT ("redactedReceipt" ? 'latitude')
    AND NOT ("redactedReceipt" ? 'longitude')
    AND NOT ("redactedReceipt" ? 'accuracyMeters')
  )
);

CREATE TABLE "workforce_evidence_assessments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "kind" "WorkforceEvidenceAssessmentKind" NOT NULL,
  "assessorVersion" VARCHAR(64) NOT NULL,
  "verdict" "WorkforceEvidenceAssessmentVerdict" NOT NULL,
  "reasonCodes" JSONB NOT NULL,
  "geofenceRevisionId" VARCHAR(191),
  "distanceMeters" DOUBLE PRECISION,
  "accuracyMeters" DOUBLE PRECISION,
  "assessedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_evidence_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_evidence_assessments_version_check" CHECK (
    NULLIF(btrim("assessorVersion"), '') IS NOT NULL
  ),
  CONSTRAINT "workforce_evidence_assessments_reasons_check" CHECK (
    jsonb_typeof("reasonCodes") = 'array' AND jsonb_array_length("reasonCodes") > 0
  ),
  CONSTRAINT "workforce_evidence_assessments_measurement_check" CHECK (
    ("distanceMeters" IS NULL OR "distanceMeters" >= 0)
    AND ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0)
  )
);

CREATE UNIQUE INDEX "workforce_attendance_evidence_organizationId_id_key"
  ON "workforce_attendance_evidence"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_evidence_org_operation_key"
  ON "workforce_attendance_evidence"("organizationId", "operationReference");
CREATE INDEX "workforce_attendance_evidence_org_event_captured_idx"
  ON "workforce_attendance_evidence"("organizationId", "workdayEventId", "capturedAt");
CREATE INDEX "workforce_attendance_evidence_org_transition_captured_idx"
  ON "workforce_attendance_evidence"("organizationId", "siteTransitionId", "capturedAt");
CREATE INDEX "workforce_attendance_evidence_org_purge_idx"
  ON "workforce_attendance_evidence"("organizationId", "rawExpiresAt", "rawPurgedAt");

CREATE UNIQUE INDEX "workforce_evidence_assessments_organizationId_id_key"
  ON "workforce_evidence_assessments"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_evidence_assessments_org_evidence_kind_version_key"
  ON "workforce_evidence_assessments"("organizationId", "evidenceId", "kind", "assessorVersion");
CREATE INDEX "workforce_evidence_assessments_org_evidence_assessed_idx"
  ON "workforce_evidence_assessments"("organizationId", "evidenceId", "assessedAt");
CREATE INDEX "workforce_evidence_assessments_org_kind_verdict_assessed_idx"
  ON "workforce_evidence_assessments"("organizationId", "kind", "verdict", "assessedAt");

ALTER TABLE "workforce_attendance_evidence"
  ADD CONSTRAINT "workforce_attendance_evidence_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_evidence_event_fkey"
    FOREIGN KEY ("organizationId", "workdayEventId") REFERENCES "mtm_agent_workday_events"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_evidence_transition_fkey"
    FOREIGN KEY ("organizationId", "siteTransitionId") REFERENCES "workforce_site_transitions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_evidence_assessments"
  ADD CONSTRAINT "workforce_evidence_assessments_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_evidence_assessments_evidence_fkey"
    FOREIGN KEY ("organizationId", "evidenceId") REFERENCES "workforce_attendance_evidence"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence is immutable except for a one-way raw-ciphertext purge after its
-- own expiry. Derived receipt/hash/subject fields are never rewritten.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance evidence cannot be deleted; purge raw ciphertext only' USING ERRCODE = '55000';
  END IF;

  IF OLD."rawPurgedAt" IS NULL
     AND NEW."rawEnvelopeCiphertext" IS NULL
     AND NEW."rawPurgedAt" IS NOT NULL
     AND NEW."rawPurgedAt" >= OLD."rawExpiresAt"
     AND (to_jsonb(NEW) - ARRAY['rawEnvelopeCiphertext', 'rawPurgedAt'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['rawEnvelopeCiphertext', 'rawPurgedAt']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Workforce attendance evidence is immutable except for an expired raw-ciphertext purge' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_attendance_evidence_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_evidence"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_evidence();

CREATE OR REPLACE FUNCTION workforce_reject_evidence_assessment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce evidence assessments are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_evidence_assessments_append_only
  BEFORE UPDATE OR DELETE ON "workforce_evidence_assessments"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_evidence_assessment_mutation();

ALTER TABLE "workforce_attendance_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_attendance_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_attendance_evidence_tenant_isolation ON "workforce_attendance_evidence"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "workforce_evidence_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_evidence_assessments" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_evidence_assessments_tenant_isolation ON "workforce_evidence_assessments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
