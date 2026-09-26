-- A real AI call from the demo needs a phone the prospect has proven and an
-- explicit agreement to that one call. Both live in the demo control plane,
-- like the rest of the demo, behind the same system-bypass policy.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_grants" ADD COLUMN "liveCallEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "demo_phone_verifications" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "otpHash" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "otpSentAt" TIMESTAMP(3),
  "otpSendCount" INTEGER NOT NULL DEFAULT 0,
  "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "consentAt" TIMESTAMP(3),
  "consentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_phone_verifications_grant_phone_key"
  ON "demo_phone_verifications"("grantId", "phoneE164");

ALTER TABLE "demo_phone_verifications"
  ADD CONSTRAINT "demo_phone_verifications_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "demo_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only Azerbaijani numbers: the agent speaks Azerbaijani and the trunk is local.
ALTER TABLE "demo_phone_verifications"
  ADD CONSTRAINT "demo_phone_verifications_phone_check" CHECK ("phoneE164" ~ '^\+994[0-9]{9}$');

-- Consent is recorded only for a proven phone, and always with its wording.
ALTER TABLE "demo_phone_verifications"
  ADD CONSTRAINT "demo_phone_verifications_consent_check"
  CHECK ("consentAt" IS NULL OR ("verifiedAt" IS NOT NULL AND "consentVersion" IS NOT NULL));

ALTER TABLE "demo_phone_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_phone_verifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "demo_phone_verifications_system_bypass" ON "demo_phone_verifications"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

-- The access trail records the phone steps. Widened by exactly the two values
-- written by src/lib/demo-center/phone-verification.ts; the drift guard in
-- src/__tests__/demo-journey-assistant.test.ts reads this newest definition.
ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED'
));

COMMIT;
