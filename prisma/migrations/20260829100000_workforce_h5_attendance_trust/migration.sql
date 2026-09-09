-- Workforce H5 attendance trust. This migration is strictly additive: it
-- introduces opt-in QR/device-trust storage without changing legacy workday
-- events, enrolling a device, issuing a station, or enabling a tenant policy.
-- It stores only public-key and proof fingerprints; biometric templates and
-- biometric results are never stored.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceAttendanceQrStationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "WorkforceAttendanceDeviceEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'REPLACED');
CREATE TYPE "WorkforceAttendanceVerificationMethod" AS ENUM ('QR', 'DEVICE_KEY');

-- Composite tenant key for an immutable canonical event. It lets verification
-- facts bind to a workday event without trusting an application-only org id.
CREATE UNIQUE INDEX "mtm_agent_workday_events_organizationId_id_key"
  ON "mtm_agent_workday_events"("organizationId", "id");

CREATE TABLE "workforce_attendance_qr_stations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "WorkforceAttendanceQrStationStatus" NOT NULL DEFAULT 'ACTIVE',
  "rotationSeconds" INTEGER NOT NULL DEFAULT 60,
  "createdByUserId" TEXT NOT NULL,
  "disabledByUserId" TEXT,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_attendance_qr_stations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_qr_stations_code_check" CHECK (
    NULLIF(btrim("code"), '') IS NOT NULL AND char_length("code") <= 64
  ),
  CONSTRAINT "workforce_attendance_qr_stations_name_check" CHECK (
    NULLIF(btrim("name"), '') IS NOT NULL AND char_length("name") <= 120
  ),
  CONSTRAINT "workforce_attendance_qr_stations_rotation_check" CHECK (
    "rotationSeconds" BETWEEN 30 AND 300
  ),
  CONSTRAINT "workforce_attendance_qr_stations_lifecycle_check" CHECK (
    ("status" = 'ACTIVE' AND "disabledByUserId" IS NULL AND "disabledAt" IS NULL)
    OR
    ("status" = 'DISABLED' AND "disabledByUserId" IS NOT NULL AND "disabledAt" IS NOT NULL)
  )
);

CREATE TABLE "workforce_attendance_device_enrollments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceLabel" TEXT NOT NULL,
  "publicKeySpki" TEXT NOT NULL,
  "publicKeyFingerprint" VARCHAR(64) NOT NULL,
  "status" "WorkforceAttendanceDeviceEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
  "keyVerifiedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "replacesEnrollmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_attendance_device_enrollments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_devices_label_check" CHECK (
    NULLIF(btrim("deviceLabel"), '') IS NOT NULL AND char_length("deviceLabel") <= 120
  ),
  CONSTRAINT "workforce_attendance_devices_key_check" CHECK (
    char_length("publicKeySpki") BETWEEN 1 AND 8192
    AND "publicKeyFingerprint" ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT "workforce_attendance_devices_replacement_check" CHECK (
    "replacesEnrollmentId" IS NULL OR "replacesEnrollmentId" <> "id"
  ),
  CONSTRAINT "workforce_attendance_devices_lifecycle_check" CHECK (
    (
      "status" = 'PENDING'
      AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL
      AND "revokedByUserId" IS NULL AND "revokedAt" IS NULL
    )
    OR
    (
      "status" = 'ACTIVE'
      AND "keyVerifiedAt" IS NOT NULL
      AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "revokedByUserId" IS NULL AND "revokedAt" IS NULL
    )
    OR
    (
      "status" IN ('REVOKED', 'REPLACED')
      AND "revokedByUserId" IS NOT NULL AND "revokedAt" IS NOT NULL
    )
  )
);

CREATE TABLE "workforce_attendance_device_enrollment_challenges" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "challengeFingerprint" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_attendance_device_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_device_challenges_fingerprint_check" CHECK (
    "challengeFingerprint" ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT "workforce_attendance_device_challenges_expiry_check" CHECK (
    "expiresAt" > "createdAt"
  ),
  CONSTRAINT "workforce_attendance_device_challenges_consumed_check" CHECK (
    "consumedAt" IS NULL OR "consumedAt" <= "expiresAt"
  )
);

CREATE TABLE "workforce_attendance_verifications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayEventId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "policyDefinitionHash" VARCHAR(64) NOT NULL,
  "method" "WorkforceAttendanceVerificationMethod" NOT NULL,
  "stationId" TEXT,
  "deviceEnrollmentId" TEXT,
  "nonceFingerprint" VARCHAR(64),
  "proofFingerprint" VARCHAR(64),
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_attendance_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_verifications_method_check" CHECK (
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
  ),
  CONSTRAINT "workforce_attendance_verifications_policy_check" CHECK (
    "policyVersion" > 0 AND "policyDefinitionHash" ~ '^[A-Fa-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "workforce_attendance_qr_stations_organizationId_id_key"
  ON "workforce_attendance_qr_stations"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_qr_stations_organizationId_code_key"
  ON "workforce_attendance_qr_stations"("organizationId", "code");
CREATE INDEX "workforce_attendance_qr_stations_org_status_created_idx"
  ON "workforce_attendance_qr_stations"("organizationId", "status", "createdAt");
CREATE INDEX "workforce_attendance_qr_stations_org_created_by_idx"
  ON "workforce_attendance_qr_stations"("organizationId", "createdByUserId");
CREATE INDEX "workforce_attendance_qr_stations_org_disabled_by_idx"
  ON "workforce_attendance_qr_stations"("organizationId", "disabledByUserId");

CREATE UNIQUE INDEX "workforce_attendance_devices_organization_id_key"
  ON "workforce_attendance_device_enrollments"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_devices_public_key_key"
  ON "workforce_attendance_device_enrollments"("organizationId", "publicKeyFingerprint");
CREATE INDEX "workforce_attendance_devices_org_agent_status_created_idx"
  ON "workforce_attendance_device_enrollments"("organizationId", "agentId", "status", "createdAt");
CREATE INDEX "workforce_attendance_devices_org_approved_by_idx"
  ON "workforce_attendance_device_enrollments"("organizationId", "approvedByUserId");
CREATE INDEX "workforce_attendance_devices_org_revoked_by_idx"
  ON "workforce_attendance_device_enrollments"("organizationId", "revokedByUserId");
CREATE INDEX "workforce_attendance_devices_org_replaces_idx"
  ON "workforce_attendance_device_enrollments"("organizationId", "replacesEnrollmentId");

CREATE UNIQUE INDEX "workforce_attendance_device_challenges_organization_id_key"
  ON "workforce_attendance_device_enrollment_challenges"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_device_challenges_challenge_key"
  ON "workforce_attendance_device_enrollment_challenges"("organizationId", "challengeFingerprint");
CREATE INDEX "workforce_attendance_device_challenges_org_enrollment_expiry_idx"
  ON "workforce_attendance_device_enrollment_challenges"("organizationId", "enrollmentId", "expiresAt");

CREATE UNIQUE INDEX "workforce_attendance_verifications_organization_id_key"
  ON "workforce_attendance_verifications"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_attendance_verifications_event_method_key"
  ON "workforce_attendance_verifications"("organizationId", "workdayEventId", "method");
CREATE UNIQUE INDEX "workforce_attendance_verifications_nonce_key"
  ON "workforce_attendance_verifications"("organizationId", "nonceFingerprint");
CREATE INDEX "workforce_attendance_verifications_org_agent_time_idx"
  ON "workforce_attendance_verifications"("organizationId", "agentId", "verifiedAt");
CREATE INDEX "workforce_attendance_verifications_org_policy_version_idx"
  ON "workforce_attendance_verifications"("organizationId", "policyId", "policyVersion");
CREATE INDEX "workforce_attendance_verifications_org_station_time_idx"
  ON "workforce_attendance_verifications"("organizationId", "stationId", "verifiedAt");
CREATE INDEX "workforce_attendance_verifications_org_device_time_idx"
  ON "workforce_attendance_verifications"("organizationId", "deviceEnrollmentId", "verifiedAt");

ALTER TABLE "workforce_attendance_qr_stations"
  ADD CONSTRAINT "workforce_attendance_qr_stations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_qr_stations_createdByUserId_fkey"
    FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_qr_stations_disabledByUserId_fkey"
    FOREIGN KEY ("organizationId", "disabledByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_attendance_device_enrollments"
  ADD CONSTRAINT "workforce_attendance_devices_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_devices_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_devices_approved_by_fkey"
    FOREIGN KEY ("organizationId", "approvedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_devices_revoked_by_fkey"
    FOREIGN KEY ("organizationId", "revokedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_devices_replaces_fkey"
    FOREIGN KEY ("organizationId", "replacesEnrollmentId") REFERENCES "workforce_attendance_device_enrollments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_attendance_device_enrollment_challenges"
  ADD CONSTRAINT "workforce_attendance_device_challenges_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_device_challenges_enrollment_fkey"
    FOREIGN KEY ("organizationId", "enrollmentId") REFERENCES "workforce_attendance_device_enrollments"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workforce_attendance_verifications"
  ADD CONSTRAINT "workforce_attendance_verifications_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_verifications_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_verifications_event_fkey"
    FOREIGN KEY ("organizationId", "workdayEventId") REFERENCES "mtm_agent_workday_events"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_verifications_policy_fkey"
    FOREIGN KEY ("organizationId", "policyId") REFERENCES "workforce_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_verifications_station_fkey"
    FOREIGN KEY ("organizationId", "stationId") REFERENCES "workforce_attendance_qr_stations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_verifications_device_fkey"
    FOREIGN KEY ("organizationId", "deviceEnrollmentId") REFERENCES "workforce_attendance_device_enrollments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Station identity remains stable for audit. A disabled station is never
-- silently re-enabled; emergency replacement uses a new station and preserves
-- all prior verification facts.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_qr_station()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance QR stations cannot be deleted; disable them instead' USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Workforce attendance QR station identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE' THEN
    IF NEW."status" = 'ACTIVE' THEN
      IF NEW."disabledByUserId" IS NOT NULL OR NEW."disabledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Active Workforce attendance QR station cannot have disable metadata' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'DISABLED' AND NEW."disabledByUserId" IS NOT NULL AND NEW."disabledAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Workforce attendance QR station lifecycle is immutable after disable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_attendance_qr_stations_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_qr_stations"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_qr_station();

-- A pending enrollment may first prove possession of its public key and then
-- receive manager approval. Once active, only one terminal revocation or
-- replacement transition is possible; public key and employee identity remain
-- immutable throughout the lifecycle.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_device_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance device enrollments cannot be deleted; revoke them instead' USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
     OR NEW."deviceLabel" IS DISTINCT FROM OLD."deviceLabel"
     OR NEW."publicKeySpki" IS DISTINCT FROM OLD."publicKeySpki"
     OR NEW."publicKeyFingerprint" IS DISTINCT FROM OLD."publicKeyFingerprint"
     OR NEW."replacesEnrollmentId" IS DISTINCT FROM OLD."replacesEnrollmentId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Workforce attendance device enrollment identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'PENDING' THEN
    IF NEW."status" = 'PENDING' THEN
      IF NEW."approvedByUserId" IS NOT NULL OR NEW."approvedAt" IS NOT NULL
         OR NEW."revokedByUserId" IS NOT NULL OR NEW."revokedAt" IS NOT NULL
         OR (OLD."keyVerifiedAt" IS NOT NULL AND NEW."keyVerifiedAt" IS DISTINCT FROM OLD."keyVerifiedAt")
         OR (OLD."keyVerifiedAt" IS NOT NULL AND NEW."keyVerifiedAt" IS NULL) THEN
        RAISE EXCEPTION 'Pending Workforce attendance device enrollment may only record its first key proof' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."status" = 'ACTIVE'
       AND NEW."keyVerifiedAt" IS NOT NULL
       AND NEW."approvedByUserId" IS NOT NULL AND NEW."approvedAt" IS NOT NULL
       AND NEW."revokedByUserId" IS NULL AND NEW."revokedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW."status" = 'REVOKED'
       AND NEW."revokedByUserId" IS NOT NULL AND NEW."revokedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
  ELSIF OLD."status" = 'ACTIVE' THEN
    IF NEW."keyVerifiedAt" IS DISTINCT FROM OLD."keyVerifiedAt"
       OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
      RAISE EXCEPTION 'Active Workforce attendance device approval is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW."status" IN ('REVOKED', 'REPLACED')
       AND NEW."revokedByUserId" IS NOT NULL AND NEW."revokedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Invalid Workforce attendance device enrollment lifecycle transition' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER workforce_attendance_device_enrollments_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_device_enrollments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_device_enrollment();

CREATE OR REPLACE FUNCTION workforce_guard_attendance_device_challenge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance device challenges cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['consumedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['consumedAt'])
     OR OLD."consumedAt" IS NOT NULL
     OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'Workforce attendance device challenge may be consumed only once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_device_challenges_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_device_enrollment_challenges"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_device_challenge();

-- A tenant-scoped FK does not prove that the verification's employee matches
-- the canonical workday event, nor that its selected station/device was valid
-- at acceptance. Enforce those facts before the verification becomes
-- append-only and its QR nonce unique index seals replay protection.
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
  ELSIF NEW."method" = 'DEVICE_KEY'::"WorkforceAttendanceVerificationMethod" THEN
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

CREATE TRIGGER workforce_attendance_verifications_validate_insert
  BEFORE INSERT ON "workforce_attendance_verifications"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_attendance_verification_insert();

CREATE OR REPLACE FUNCTION workforce_h5_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce attendance verification records cannot be %', TG_OP USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_attendance_verifications_append_only
  BEFORE UPDATE OR DELETE ON "workforce_attendance_verifications"
  FOR EACH ROW EXECUTE FUNCTION workforce_h5_reject_immutable_mutation();

-- H5 data is tenant-scoped and fail-closed. Station/device lifecycle tables
-- intentionally omit DELETE, while consumed challenges and verification facts
-- receive only the minimum mutation paths required by their guards.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workforce_attendance_qr_stations',
    'workforce_attendance_device_enrollments',
    'workforce_attendance_device_enrollment_challenges'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_select', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_insert', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_update', table_name
    );
  END LOOP;

  EXECUTE 'ALTER TABLE "workforce_attendance_verifications" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "workforce_attendance_verifications" FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY workforce_attendance_verifications_tenant_select ON "workforce_attendance_verifications" FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')';
  EXECUTE 'CREATE POLICY workforce_attendance_verifications_tenant_insert ON "workforce_attendance_verifications" FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')';
END $$;

-- A migration runner can own the tables while the established application role
-- owns mtm_agents. Do not grant DELETE: historical verification/revocation
-- evidence remains available until a separately approved retention workflow.
DO $$
DECLARE
  app_owner TEXT;
  table_name TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    FOREACH table_name IN ARRAY ARRAY[
      'workforce_attendance_qr_stations',
      'workforce_attendance_device_enrollments',
      'workforce_attendance_device_enrollment_challenges'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', 'workforce_attendance_verifications', app_owner);
  END IF;
END $$;
