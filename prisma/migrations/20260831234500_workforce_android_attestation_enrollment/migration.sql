-- Server-bound Android Key Attestation enrollment preparation. This is
-- strictly additive and deliberately creates no tenant policy, trusted device
-- or enrollment from a raw certificate chain. The verifier retains only a
-- minimal accepted receipt; raw certificates and challenge bytes are never
-- durable Workforce data.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceAndroidAttestationSecurityLevel" AS ENUM (
  'TRUSTED_ENVIRONMENT',
  'STRONGBOX'
);

ALTER TABLE "workforce_attendance_device_enrollments"
  ADD COLUMN "attestationVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "attestationSecurityLevel" "WorkforceAndroidAttestationSecurityLevel",
  ADD COLUMN "attestationRootCertificateSha256" VARCHAR(64),
  ADD CONSTRAINT "workforce_attendance_devices_attestation_receipt_check" CHECK (
    (
      "attestationVerifiedAt" IS NULL
      AND "attestationSecurityLevel" IS NULL
      AND "attestationRootCertificateSha256" IS NULL
    )
    OR
    (
      "attestationVerifiedAt" IS NOT NULL
      AND "attestationSecurityLevel" IS NOT NULL
      AND "attestationRootCertificateSha256" ~ '^[A-Fa-f0-9]{64}$'
    )
  );

CREATE TABLE "workforce_attendance_device_attestation_challenges" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "challengeFingerprint" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_attendance_device_attestation_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_device_attestation_challenges_fingerprint_check" CHECK (
    "challengeFingerprint" ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT "workforce_attendance_device_attestation_challenges_expiry_check" CHECK (
    "expiresAt" > "createdAt"
  ),
  CONSTRAINT "workforce_attendance_device_attestation_challenges_consumed_check" CHECK (
    "consumedAt" IS NULL OR "consumedAt" <= "expiresAt"
  )
);

CREATE UNIQUE INDEX "wf_attest_challenge_org_id_key"
  ON "workforce_attendance_device_attestation_challenges"("organizationId", "id");
CREATE UNIQUE INDEX "wf_attest_challenge_fingerprint_key"
  ON "workforce_attendance_device_attestation_challenges"("organizationId", "challengeFingerprint");
CREATE INDEX "wf_attest_challenge_org_agent_expiry_idx"
  ON "workforce_attendance_device_attestation_challenges"("organizationId", "agentId", "expiresAt");

ALTER TABLE "workforce_attendance_device_attestation_challenges"
  ADD CONSTRAINT "wf_attest_challenge_org_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "wf_attest_challenge_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The minimal receipt is immutable. A pre-attestation enrollment must be
-- revoked/replaced instead of being retroactively upgraded by a caller.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_device_attestation_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."attestationVerifiedAt" IS DISTINCT FROM OLD."attestationVerifiedAt"
     OR NEW."attestationSecurityLevel" IS DISTINCT FROM OLD."attestationSecurityLevel"
     OR NEW."attestationRootCertificateSha256" IS DISTINCT FROM OLD."attestationRootCertificateSha256" THEN
    RAISE EXCEPTION 'Workforce attendance device attestation receipt is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_device_enrollments_attestation_receipt_guard
  BEFORE UPDATE ON "workforce_attendance_device_enrollments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_device_attestation_receipt();

CREATE OR REPLACE FUNCTION workforce_guard_attendance_device_attestation_challenge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance device attestation challenges cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['consumedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['consumedAt'])
     OR OLD."consumedAt" IS NOT NULL
     OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'Workforce attendance device attestation challenge may be consumed only once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_device_attestation_challenges_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_device_attestation_challenges"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_device_attestation_challenge();

ALTER TABLE "workforce_attendance_device_attestation_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_attendance_device_attestation_challenges" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_attendance_device_attestation_challenges_tenant_select
  ON "workforce_attendance_device_attestation_challenges" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_attendance_device_attestation_challenges_tenant_insert
  ON "workforce_attendance_device_attestation_challenges" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_attendance_device_attestation_challenges_tenant_update
  ON "workforce_attendance_device_attestation_challenges" FOR UPDATE
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I',
      'workforce_attendance_device_attestation_challenges',
      app_owner
    );
  END IF;
END $$;
