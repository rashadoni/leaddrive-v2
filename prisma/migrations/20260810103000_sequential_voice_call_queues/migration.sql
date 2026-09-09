-- Phase 2: immutable selected-lead queues with a strictly sequential dispatch
-- lane. No configuration is enabled by this migration. Both queue creation
-- and start require all three gates: ChannelConfig.settings.voiceQueueEnabled,
-- VOICE_CALL_QUEUE_EXECUTION_ENABLED=true, and the pilot organisation binding.

SET lock_timeout = '3s';

ALTER TABLE "voice_call_sessions"
  ADD COLUMN "activeOrganizationKey" TEXT,
  ADD CONSTRAINT "voice_call_sessions_active_organization_key_check"
    CHECK ("activeOrganizationKey" IS NULL OR "activeOrganizationKey" = "organizationId");

CREATE UNIQUE INDEX "voice_call_sessions_org_active_organization_key"
  ON "voice_call_sessions" ("organizationId", "activeOrganizationKey");

CREATE TABLE "voice_call_queues" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "selectionHash" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'selected',
  "name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "totalItems" INTEGER NOT NULL,
  "consentAudit" JSONB NOT NULL DEFAULT '{}',
  "activeOrganizationKey" TEXT,
  "activeOwnerKey" TEXT,
  "startedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_call_queues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_call_queues_source_check"
    CHECK ("source" IN ('selected')),
  CONSTRAINT "voice_call_queues_status_check"
    CHECK ("status" IN ('prepared', 'running', 'paused', 'completed', 'cancelled', 'attention_required')),
  CONSTRAINT "voice_call_queues_total_items_check"
    CHECK ("totalItems" BETWEEN 1 AND 100),
  CONSTRAINT "voice_call_queues_active_keys_check" CHECK (
    (
      "status" IN ('running', 'paused', 'attention_required')
      AND "activeOrganizationKey" = "organizationId"
      AND "activeOwnerKey" = "organizationId" || ':' || "ownerUserId"
    )
    OR (
      "status" IN ('prepared', 'completed', 'cancelled')
      AND "activeOrganizationKey" IS NULL
      AND "activeOwnerKey" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "voice_call_queues_org_idempotency_key"
  ON "voice_call_queues" ("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "voice_call_queues_org_active_org_key"
  ON "voice_call_queues" ("organizationId", "activeOrganizationKey");
CREATE UNIQUE INDEX "voice_call_queues_org_active_owner_key"
  ON "voice_call_queues" ("organizationId", "activeOwnerKey");
CREATE INDEX "voice_call_queues_org_owner_created_idx"
  ON "voice_call_queues" ("organizationId", "ownerUserId", "createdAt");
CREATE INDEX "voice_call_queues_org_status_updated_idx"
  ON "voice_call_queues" ("organizationId", "status", "updatedAt");

ALTER TABLE "voice_call_queues"
  ADD CONSTRAINT "voice_call_queues_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "voice_call_queue_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "queueId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "assignedToSnapshot" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "outcome" TEXT,
  "blockReason" TEXT,
  "eligibilitySnapshot" JSONB NOT NULL DEFAULT '{}',
  "queuedLeadKey" TEXT,
  "queuedPhoneKey" TEXT,
  "activeOrganizationKey" TEXT,
  "activeOwnerKey" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "voiceCallSessionId" TEXT,
  "availableAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_call_queue_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_call_queue_items_position_check" CHECK ("position" >= 0),
  CONSTRAINT "voice_call_queue_items_status_check" CHECK (
    "status" IN (
      'pending', 'claimed', 'dispatching', 'waiting_terminal', 'dispatch_uncertain',
      'completed', 'no_answer', 'busy', 'failed', 'cancelled', 'blocked', 'skipped'
    )
  ),
  CONSTRAINT "voice_call_queue_items_outcome_check" CHECK (
    "outcome" IS NULL
    OR "outcome" IN ('connected', 'no_answer', 'busy', 'failed', 'cancelled', 'blocked', 'skipped')
  ),
  CONSTRAINT "voice_call_queue_items_active_keys_check" CHECK (
    (
      "status" IN ('claimed', 'dispatching', 'waiting_terminal', 'dispatch_uncertain')
      AND "activeOrganizationKey" = "organizationId"
      AND "activeOwnerKey" = "organizationId" || ':' || "ownerUserId"
    )
    OR (
      "status" NOT IN ('claimed', 'dispatching', 'waiting_terminal', 'dispatch_uncertain')
      AND "activeOrganizationKey" IS NULL
      AND "activeOwnerKey" IS NULL
    )
  ),
  CONSTRAINT "voice_call_queue_items_lease_pair_check" CHECK (
    ("leaseToken" IS NULL AND "leaseUntil" IS NULL)
    OR ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
  ),
  CONSTRAINT "voice_call_queue_items_queued_lead_check" CHECK (
    (
      "status" IN ('pending', 'claimed', 'dispatching', 'waiting_terminal', 'dispatch_uncertain')
      AND "queuedLeadKey" = "leadId"
      AND "queuedPhoneKey" IS NOT NULL
    )
    OR (
      "status" IN ('completed', 'no_answer', 'busy', 'failed', 'cancelled', 'blocked', 'skipped')
      AND "queuedLeadKey" IS NULL
      AND "queuedPhoneKey" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "voice_call_queue_items_voiceCallSessionId_key"
  ON "voice_call_queue_items" ("voiceCallSessionId");
CREATE UNIQUE INDEX "voice_call_queue_items_queue_position_key"
  ON "voice_call_queue_items" ("queueId", "position");
CREATE UNIQUE INDEX "voice_call_queue_items_org_idempotency_key"
  ON "voice_call_queue_items" ("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "voice_call_queue_items_org_queued_lead_key"
  ON "voice_call_queue_items" ("organizationId", "queuedLeadKey");
CREATE UNIQUE INDEX "voice_call_queue_items_org_queued_phone_key"
  ON "voice_call_queue_items" ("organizationId", "queuedPhoneKey");
CREATE UNIQUE INDEX "voice_call_queue_items_org_active_org_key"
  ON "voice_call_queue_items" ("organizationId", "activeOrganizationKey");
CREATE UNIQUE INDEX "voice_call_queue_items_org_active_owner_key"
  ON "voice_call_queue_items" ("organizationId", "activeOwnerKey");
CREATE INDEX "voice_call_queue_items_org_queue_status_position_idx"
  ON "voice_call_queue_items" ("organizationId", "queueId", "status", "position");
CREATE INDEX "voice_call_queue_items_org_owner_status_idx"
  ON "voice_call_queue_items" ("organizationId", "ownerUserId", "status", "updatedAt");
CREATE INDEX "voice_call_queue_items_org_session_idx"
  ON "voice_call_queue_items" ("organizationId", "voiceCallSessionId");

ALTER TABLE "voice_call_queue_items"
  ADD CONSTRAINT "voice_call_queue_items_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "voice_call_queue_items_queueId_fkey"
  FOREIGN KEY ("queueId") REFERENCES "voice_call_queues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "voice_call_queue_items_voiceCallSessionId_fkey"
  FOREIGN KEY ("voiceCallSessionId") REFERENCES "voice_call_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "voice_call_queues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_call_queues" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_call_queues";
CREATE POLICY tenant_isolation ON "voice_call_queues"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "voice_call_queue_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_call_queue_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_call_queue_items";
CREATE POLICY tenant_isolation ON "voice_call_queue_items"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
