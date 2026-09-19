-- Private Demo Center: persisted prospect requests, one-session grants and an
-- append-only access trail. The tables are platform control-plane data, so
-- normal tenant contexts cannot read or mutate them; only explicit RLS bypass
-- paths (public capability handlers and superadmin handlers) are admitted.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "demo_requests" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "jobTitle" TEXT,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "emailDomain" TEXT NOT NULL,
  "phone" TEXT,
  "message" TEXT,
  "requestedModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "locale" TEXT NOT NULL DEFAULT 'az',
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "source" TEXT NOT NULL DEFAULT 'website',
  "consentAt" TIMESTAMP(3) NOT NULL,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_requests_status_check" CHECK ("status" IN ('SUBMITTED', 'UNDER_REVIEW', 'FULFILLED', 'REJECTED')),
  CONSTRAINT "demo_requests_locale_check" CHECK ("locale" IN ('az', 'ru', 'en'))
);

CREATE TABLE "demo_grants" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUING',
  "tokenHash" TEXT NOT NULL,
  "tokenHint" TEXT NOT NULL,
  "moduleIds" TEXT[] NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'az',
  "watermark" TEXT NOT NULL,
  "linkExpiresAt" TIMESTAMP(3) NOT NULL,
  "sessionDurationMinutes" INTEGER NOT NULL DEFAULT 120,
  "inactivityMinutes" INTEGER NOT NULL DEFAULT 30,
  "otpHash" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "otpSentAt" TIMESTAMP(3),
  "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  "otpSendCount" INTEGER NOT NULL DEFAULT 0,
  "verificationHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "deliveryMessageId" TEXT,
  "deliveryError" TEXT,
  "sessionHash" TEXT,
  "sessionStartedAt" TIMESTAMP(3),
  "sessionLastSeenAt" TIMESTAMP(3),
  "sessionExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revocationReason" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_grants_request_fkey" FOREIGN KEY ("requestId") REFERENCES "demo_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "demo_grants_status_check" CHECK ("status" IN ('ISSUING', 'SENT', 'OTP_SENT', 'OTP_VERIFIED', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'REVOKED', 'DELIVERY_FAILED')),
  CONSTRAINT "demo_grants_locale_check" CHECK ("locale" IN ('az', 'ru', 'en')),
  CONSTRAINT "demo_grants_modules_nonempty_check" CHECK (cardinality("moduleIds") BETWEEN 1 AND 19),
  CONSTRAINT "demo_grants_modules_allowlist_check" CHECK (
    "moduleIds" <@ ARRAY[
      'crm', 'sales', 'contracts', 'marketing', 'loyalty', 'omnichannel',
      'support', 'finance', 'analytics', 'mtm', 'health', 'insurance',
      'public-sector', 'media', 'energy', 'settings', 'ai', 'voip', 'sms-otp'
    ]::TEXT[]
  ),
  CONSTRAINT "demo_grants_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "demo_grants_verification_hash_check" CHECK ("verificationHash" IS NULL OR "verificationHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "demo_grants_session_hash_check" CHECK ("sessionHash" IS NULL OR "sessionHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "demo_grants_session_duration_check" CHECK ("sessionDurationMinutes" BETWEEN 15 AND 240),
  CONSTRAINT "demo_grants_inactivity_check" CHECK ("inactivityMinutes" BETWEEN 5 AND 60),
  CONSTRAINT "demo_grants_otp_attempts_check" CHECK ("otpAttempts" BETWEEN 0 AND 5),
  CONSTRAINT "demo_grants_otp_send_count_check" CHECK ("otpSendCount" BETWEEN 0 AND 5),
  CONSTRAINT "demo_grants_terminal_state_check" CHECK (
    ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL)
    AND ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL)
  ),
  CONSTRAINT "demo_grants_otp_state_check" CHECK (
    "status" <> 'OTP_SENT'
    OR ("otpHash" IS NOT NULL AND "otpExpiresAt" IS NOT NULL AND "otpSentAt" IS NOT NULL)
  ),
  CONSTRAINT "demo_grants_verified_state_check" CHECK (
    "status" <> 'OTP_VERIFIED'
    OR ("verificationHash" IS NOT NULL AND "verificationExpiresAt" IS NOT NULL AND "verifiedAt" IS NOT NULL)
  ),
  CONSTRAINT "demo_grants_active_state_check" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "sessionHash" IS NOT NULL
      AND "sessionStartedAt" IS NOT NULL
      AND "sessionLastSeenAt" IS NOT NULL
      AND "sessionExpiresAt" IS NOT NULL
    )
  )
);

CREATE TABLE "demo_access_events" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "moduleId" TEXT,
  "stepId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_access_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_access_events_grant_fkey" FOREIGN KEY ("grantId") REFERENCES "demo_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
    'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
    'OTP_VERIFIED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
    'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED'
  ))
);

CREATE INDEX "demo_requests_status_created_idx" ON "demo_requests"("status", "createdAt");
CREATE INDEX "demo_requests_email_created_idx" ON "demo_requests"("emailNormalized", "createdAt");
CREATE INDEX "demo_requests_domain_idx" ON "demo_requests"("emailDomain");
CREATE UNIQUE INDEX "demo_grants_tokenHash_key" ON "demo_grants"("tokenHash");
CREATE UNIQUE INDEX "demo_grants_verificationHash_key" ON "demo_grants"("verificationHash");
CREATE UNIQUE INDEX "demo_grants_sessionHash_key" ON "demo_grants"("sessionHash");
CREATE UNIQUE INDEX "demo_grants_one_open_per_request_key" ON "demo_grants"("requestId")
  WHERE "status" IN ('ISSUING', 'SENT', 'OTP_SENT', 'OTP_VERIFIED', 'ACTIVE');
CREATE INDEX "demo_grants_request_created_idx" ON "demo_grants"("requestId", "createdAt");
CREATE INDEX "demo_grants_status_expiry_idx" ON "demo_grants"("status", "linkExpiresAt");
CREATE INDEX "demo_grants_session_status_idx" ON "demo_grants"("sessionHash", "status");
CREATE INDEX "demo_access_events_grant_time_idx" ON "demo_access_events"("grantId", "occurredAt");
CREATE INDEX "demo_access_events_type_time_idx" ON "demo_access_events"("eventType", "occurredAt");

ALTER TABLE "demo_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "demo_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "demo_access_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_access_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "demo_requests_system_bypass" ON "demo_requests"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "demo_grants_system_bypass" ON "demo_grants"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "demo_access_events_system_bypass" ON "demo_access_events"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

-- The migration role may differ from the runtime role. Mirror the runtime DML
-- grants from the established organizations table without broadening RLS.
DO $$
DECLARE app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'organizations';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_requests TO %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_grants TO %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_access_events TO %I', app_owner);
  END IF;
END $$;

COMMIT;
