-- Phase 1: explicit, policy-gated AI calls from an assigned lead.
-- The session row is created before provider dispatch. Its two tenant-local
-- unique keys make idempotent replay and one-active-call-per-lead-or-phone
-- database invariants rather than best-effort application checks.

SET lock_timeout = '3s';

ALTER TABLE "call_logs"
  ADD COLUMN "callMode" TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN "wasAnswered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerOutcome" TEXT,
  ADD COLUMN "conversationOutcome" TEXT,
  ADD COLUMN "consentAudit" JSONB,
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "call_logs"
  ADD CONSTRAINT "call_logs_callMode_check"
    CHECK ("callMode" IN ('human', 'ai')),
  ADD CONSTRAINT "call_logs_providerOutcome_check"
    CHECK (
      "providerOutcome" IS NULL
      OR "providerOutcome" IN ('connected', 'no_answer', 'busy', 'failed', 'cancelled')
    );

CREATE UNIQUE INDEX "call_logs_org_idempotency_key"
  ON "call_logs" ("organizationId", "idempotencyKey");

CREATE TABLE "voice_call_sessions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "assignedToSnapshot" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "activeLeadKey" TEXT,
  "activePhoneKey" TEXT,
  "targetPhoneE164" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'asterisk',
  "providerCallId" TEXT NOT NULL,
  "callLogId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "outcome" TEXT,
  "blockReason" TEXT,
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_call_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_call_sessions_status_check" CHECK (
    "status" IN (
      'prepared', 'dispatching', 'dispatch_uncertain', 'ringing', 'connected', 'completed',
      'no_answer', 'busy', 'failed', 'cancelled', 'blocked'
    )
  ),
  CONSTRAINT "voice_call_sessions_outcome_check" CHECK (
    "outcome" IS NULL
    OR "outcome" IN ('connected', 'no_answer', 'busy', 'failed', 'cancelled', 'blocked')
  )
);

CREATE UNIQUE INDEX "voice_call_sessions_callLogId_key"
  ON "voice_call_sessions" ("callLogId");
CREATE UNIQUE INDEX "voice_call_sessions_org_idempotency_key"
  ON "voice_call_sessions" ("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "voice_call_sessions_org_active_lead_key"
  ON "voice_call_sessions" ("organizationId", "activeLeadKey");
CREATE UNIQUE INDEX "voice_call_sessions_org_active_phone_key"
  ON "voice_call_sessions" ("organizationId", "activePhoneKey");
CREATE UNIQUE INDEX "voice_call_sessions_org_provider_call_key"
  ON "voice_call_sessions" ("organizationId", "provider", "providerCallId");
CREATE INDEX "voice_call_sessions_org_user_created_idx"
  ON "voice_call_sessions" ("organizationId", "requestedByUserId", "createdAt");
CREATE INDEX "voice_call_sessions_org_lead_created_idx"
  ON "voice_call_sessions" ("organizationId", "leadId", "createdAt");
CREATE INDEX "voice_call_sessions_org_status_lease_idx"
  ON "voice_call_sessions" ("organizationId", "status", "leaseUntil");

ALTER TABLE "voice_call_sessions"
  ADD CONSTRAINT "voice_call_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_call_sessions"
  ADD CONSTRAINT "voice_call_sessions_callLogId_fkey"
  FOREIGN KEY ("callLogId") REFERENCES "call_logs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "voice_consents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'sales',
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "source" TEXT,
  "reason" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmedBy" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_consents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_consents_scope_check"
    CHECK ("scope" IN ('sales', 'marketing', 'support', 'all')),
  CONSTRAINT "voice_consents_status_check"
    CHECK ("status" IN ('allowed', 'blocked', 'unknown', 'expired'))
);

CREATE UNIQUE INDEX "voice_consents_org_phone_scope_key"
  ON "voice_consents" ("organizationId", "phoneE164", "scope");
CREATE INDEX "voice_consents_org_status_expiry_idx"
  ON "voice_consents" ("organizationId", "status", "expiresAt");

ALTER TABLE "voice_consents"
  ADD CONSTRAINT "voice_consents_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "voice_suppressions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'all',
  "reason" TEXT NOT NULL,
  "source" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_suppressions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_suppressions_scope_check"
    CHECK ("scope" IN ('sales', 'marketing', 'support', 'all'))
);

CREATE UNIQUE INDEX "voice_suppressions_org_phone_scope_key"
  ON "voice_suppressions" ("organizationId", "phoneE164", "scope");
CREATE INDEX "voice_suppressions_org_active_expiry_idx"
  ON "voice_suppressions" ("organizationId", "isActive", "expiresAt");

ALTER TABLE "voice_suppressions"
  ADD CONSTRAINT "voice_suppressions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_call_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_call_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_call_sessions";
CREATE POLICY tenant_isolation ON "voice_call_sessions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "voice_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_consents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_consents";
CREATE POLICY tenant_isolation ON "voice_consents"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "voice_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_suppressions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_suppressions";
CREATE POLICY tenant_isolation ON "voice_suppressions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
