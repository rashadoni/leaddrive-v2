-- Workforce C5: one Standard API verdict is an ephemeral action proof. Keep
-- only its tenant-bound SHA-256 fingerprint in the existing append-only
-- ledger; this migration does not enable a policy or rewrite prior events.
SET lock_timeout = '3s';

ALTER TABLE "workforce_attendance_verifications"
  DROP CONSTRAINT "workforce_attendance_verifications_method_check";

ALTER TABLE "workforce_attendance_verifications"
  ADD CONSTRAINT "workforce_attendance_verifications_method_check" CHECK (
    (
      "method" = 'QR'
      AND "stationId" IS NOT NULL
      AND "nonceFingerprint" IS NOT NULL AND "nonceFingerprint" ~ '^[A-Fa-f0-9]{64}$'
      AND "deviceEnrollmentId" IS NULL AND "proofFingerprint" IS NULL
    )
    OR
    (
      "method" = 'DEVICE_KEY'
      AND "deviceEnrollmentId" IS NOT NULL
      AND "proofFingerprint" IS NOT NULL AND "proofFingerprint" ~ '^[A-Fa-f0-9]{64}$'
      AND "stationId" IS NULL AND "nonceFingerprint" IS NULL
    )
    OR
    (
      "method" = 'PLAY_INTEGRITY'
      AND "deviceEnrollmentId" IS NOT NULL
      AND "proofFingerprint" IS NOT NULL AND "proofFingerprint" ~ '^[A-Fa-f0-9]{64}$'
      AND "stationId" IS NULL AND "nonceFingerprint" IS NULL
    )
  );

-- PLAY_INTEGRITY is bound to the same active, verified device enrollment as
-- the signature fact. Replacing the trigger function preserves its original
-- QR and DEVICE_KEY validation while adding that tenant/employee lifecycle
-- backstop for the new proof method.
CREATE OR REPLACE FUNCTION workforce_validate_attendance_verification_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_row RECORD;
  policy_row RECORD;
  station_row RECORD;
  enrollment_row RECORD;
BEGIN
  SELECT * INTO event_row
  FROM "mtm_agent_workday_events"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayEventId";
  IF NOT FOUND OR event_row."agentId" <> NEW."agentId" THEN
    RAISE EXCEPTION 'Workforce attendance verification must match its canonical workday event and employee' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO policy_row
  FROM "workforce_policies"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policyId";
  IF NOT FOUND
     OR policy_row."version" <> NEW."policyVersion"
     OR policy_row."definitionHash" <> NEW."policyDefinitionHash" THEN
    RAISE EXCEPTION 'Workforce attendance verification must preserve its exact policy version and definition hash' USING ERRCODE = '23514';
  END IF;

  IF NEW."method" = 'QR'::"WorkforceAttendanceVerificationMethod" THEN
    SELECT * INTO station_row
    FROM "workforce_attendance_qr_stations"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."stationId";
    IF NOT FOUND OR station_row."status" <> 'ACTIVE'::"WorkforceAttendanceQrStationStatus" THEN
      RAISE EXCEPTION 'Workforce attendance QR verification requires an active tenant station' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."method" IN ('DEVICE_KEY'::"WorkforceAttendanceVerificationMethod", 'PLAY_INTEGRITY'::"WorkforceAttendanceVerificationMethod") THEN
    SELECT * INTO enrollment_row
    FROM "workforce_attendance_device_enrollments"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."deviceEnrollmentId";
    IF NOT FOUND
       OR enrollment_row."agentId" <> NEW."agentId"
       OR enrollment_row."status" <> 'ACTIVE'::"WorkforceAttendanceDeviceEnrollmentStatus"
       OR enrollment_row."keyVerifiedAt" IS NULL THEN
      RAISE EXCEPTION 'Workforce attendance device verification requires an active verified enrollment for the employee' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- v5 adds an action-bound Play Integrity token fingerprint to the mobile
-- transport digest. Older immutable events continue to validate unchanged.
ALTER TABLE "mtm_agent_workday_events"
  DROP CONSTRAINT "mtm_agent_workday_events_schema_version_check";

ALTER TABLE "mtm_agent_workday_events"
  ADD CONSTRAINT "mtm_agent_workday_events_schema_version_check"
  CHECK ("schemaVersion" IN (1, 2, 3, 4, 5));
