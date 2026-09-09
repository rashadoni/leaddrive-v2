-- PR6: approved social outbound outbox. Every live-send gate defaults closed.

SELECT set_config('app.rls_bypass', 'on', false);

ALTER TABLE "social_accounts"
  ADD COLUMN "outboundLiveEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "outboundEmergencyStopped" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "outboundCapability" TEXT,
  ADD COLUMN "outboundVerifiedAt" TIMESTAMP(3);

CREATE TABLE "social_outbound_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "liveEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emergencyStopped" BOOLEAN NOT NULL DEFAULT true,
  "allowedPlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxPerHour" INTEGER NOT NULL DEFAULT 10,
  "quietHoursStart" INTEGER,
  "quietHoursEnd" INTEGER,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "requireSeparateApprover" BOOLEAN NOT NULL DEFAULT true,
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "releaseReviewedAt" TIMESTAMP(3),
  "releaseReviewedBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_outbound_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_outbound_policies_rate_check" CHECK ("maxPerHour" BETWEEN 1 AND 1000),
  CONSTRAINT "social_outbound_policies_quiet_start_check" CHECK ("quietHoursStart" IS NULL OR "quietHoursStart" BETWEEN 0 AND 23),
  CONSTRAINT "social_outbound_policies_quiet_end_check" CHECK ("quietHoursEnd" IS NULL OR "quietHoursEnd" BETWEEN 0 AND 23),
  CONSTRAINT "social_outbound_policies_separate_approver_check" CHECK ("requireSeparateApprover"),
  CONSTRAINT "social_outbound_policies_release_gate_check" CHECK (
    NOT "liveEnabled" OR (NOT "emergencyStopped" AND "releaseReviewedAt" IS NOT NULL AND "releaseReviewedBy" IS NOT NULL)
  )
);

CREATE TABLE "outbound_social_replies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "draftId" TEXT,
  "subjectId" TEXT NOT NULL,
  "replyIdentityId" TEXT NOT NULL,
  "senderAccountId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "adapterType" TEXT NOT NULL,
  "targetExternalId" TEXT NOT NULL,
  "targetContentVersion" INTEGER NOT NULL,
  "replyText" TEXT NOT NULL,
  "replyTextSha256" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvalSnapshot" JSONB NOT NULL DEFAULT '{}',
  "currentPolicySnapshot" JSONB NOT NULL DEFAULT '{}',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerRequestId" TEXT,
  "externalReplyId" TEXT,
  "lastError" TEXT,
  "unknownOutcomeAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_social_replies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_social_replies_state_check" CHECK ("state" IN ('PENDING','APPROVED','QUEUED','SENDING','SENT','FAILED','CANCELED','RECONCILIATION_REQUIRED')),
  CONSTRAINT "outbound_social_replies_adapter_check" CHECK ("adapterType" IN ('DIRECT','PROVIDER')),
  CONSTRAINT "outbound_social_replies_attempt_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" BETWEEN 1 AND 10),
  CONSTRAINT "outbound_social_replies_content_check" CHECK (length("replyText") BETWEEN 1 AND 2000 AND "targetContentVersion" > 0)
);

CREATE TABLE "outbound_social_reply_approvals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "outboundReplyId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "approvedBy" TEXT NOT NULL,
  "approverRole" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_social_reply_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_social_reply_approvals_decision_check" CHECK ("decision" IN ('APPROVED','REJECTED'))
);

CREATE TABLE "outbound_social_reply_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "outboundReplyId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_social_reply_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_social_reply_events_actor_check" CHECK ("actorType" IN ('USER','WORKER','SYSTEM'))
);

CREATE UNIQUE INDEX "social_outbound_policies_organizationId_key" ON "social_outbound_policies"("organizationId");
CREATE UNIQUE INDEX "outbound_social_replies_org_id_key" ON "outbound_social_replies"("organizationId", "id");
CREATE UNIQUE INDEX "outbound_social_replies_org_idempotency_key" ON "outbound_social_replies"("organizationId", "idempotencyKey");
CREATE INDEX "outbound_social_replies_queue_idx" ON "outbound_social_replies"("state", "nextAttemptAt", "leaseExpiresAt");
CREATE INDEX "outbound_social_replies_org_platform_created_idx" ON "outbound_social_replies"("organizationId", "platform", "createdAt");
CREATE INDEX "outbound_social_replies_org_mention_created_idx" ON "outbound_social_replies"("organizationId", "mentionId", "createdAt");
CREATE UNIQUE INDEX "outbound_social_reply_approvals_org_id_key" ON "outbound_social_reply_approvals"("organizationId", "id");
CREATE UNIQUE INDEX "outbound_social_reply_approvals_org_reply_key" ON "outbound_social_reply_approvals"("organizationId", "outboundReplyId");
CREATE INDEX "outbound_social_reply_approvals_org_created_idx" ON "outbound_social_reply_approvals"("organizationId", "createdAt");
CREATE UNIQUE INDEX "outbound_social_reply_events_org_id_key" ON "outbound_social_reply_events"("organizationId", "id");
CREATE INDEX "outbound_social_reply_events_org_reply_created_idx" ON "outbound_social_reply_events"("organizationId", "outboundReplyId", "createdAt");

ALTER TABLE "social_outbound_policies" ADD CONSTRAINT "social_outbound_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_draftId_fkey"
  FOREIGN KEY ("organizationId", "draftId") REFERENCES "social_mention_ai_drafts"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_subjectId_fkey"
  FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_replyIdentityId_fkey"
  FOREIGN KEY ("organizationId", "replyIdentityId") REFERENCES "social_reply_identities"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "outbound_social_replies" ADD CONSTRAINT "outbound_social_replies_organizationId_senderAccountId_fkey"
  FOREIGN KEY ("organizationId", "senderAccountId") REFERENCES "social_accounts"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "outbound_social_reply_approvals" ADD CONSTRAINT "outbound_social_reply_approvals_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_reply_approvals" ADD CONSTRAINT "outbound_social_reply_approvals_organizationId_outboundRep_fkey"
  FOREIGN KEY ("organizationId", "outboundReplyId") REFERENCES "outbound_social_replies"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_reply_events" ADD CONSTRAINT "outbound_social_reply_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_social_reply_events" ADD CONSTRAINT "outbound_social_reply_events_organizationId_outboundReplyI_fkey"
  FOREIGN KEY ("organizationId", "outboundReplyId") REFERENCES "outbound_social_replies"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing tenants and connections remain locked until a separate release
-- review explicitly enables every layer.
INSERT INTO "social_outbound_policies" (
  "id", "organizationId", "liveEnabled", "emergencyStopped",
  "allowedPlatforms", "maxPerHour", "requireSeparateApprover",
  "policyVersion", "createdAt", "updatedAt"
)
SELECT
  'outbound-policy-' || md5(o."id"), o."id", false, true,
  ARRAY[]::TEXT[], 10, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
ON CONFLICT ("organizationId") DO NOTHING;

DO $rls$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'social_outbound_policies', 'outbound_social_replies', 'outbound_social_reply_approvals',
    'outbound_social_reply_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.org_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $rls$;

-- Approval decisions and transition events are append-only for tenant-scoped
-- application sessions. Maintenance with the explicit RLS bypass remains
-- possible for retention and organization deletion workflows.
DROP POLICY "outbound_social_reply_approvals_tenant_isolation" ON "outbound_social_reply_approvals";
CREATE POLICY "outbound_social_reply_approvals_tenant_select" ON "outbound_social_reply_approvals"
  FOR SELECT USING ("organizationId" = current_setting('app.org_id', true));
CREATE POLICY "outbound_social_reply_approvals_tenant_insert" ON "outbound_social_reply_approvals"
  FOR INSERT WITH CHECK ("organizationId" = current_setting('app.org_id', true));

DROP POLICY "outbound_social_reply_events_tenant_isolation" ON "outbound_social_reply_events";
CREATE POLICY "outbound_social_reply_events_tenant_select" ON "outbound_social_reply_events"
  FOR SELECT USING ("organizationId" = current_setting('app.org_id', true));
CREATE POLICY "outbound_social_reply_events_tenant_insert" ON "outbound_social_reply_events"
  FOR INSERT WITH CHECK ("organizationId" = current_setting('app.org_id', true));

CREATE OR REPLACE FUNCTION "enforce_outbound_social_reply_separate_approver"()
RETURNS trigger
LANGUAGE plpgsql
AS $approval_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "outbound_social_replies" r
    WHERE r."organizationId" = NEW."organizationId"
      AND r."id" = NEW."outboundReplyId"
      AND r."requestedBy" = NEW."approvedBy"
  ) THEN
    RAISE EXCEPTION 'outbound reply requester cannot approve their own request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$approval_guard$;

CREATE TRIGGER "outbound_social_reply_separate_approver_guard"
BEFORE INSERT ON "outbound_social_reply_approvals"
FOR EACH ROW EXECUTE FUNCTION "enforce_outbound_social_reply_separate_approver"();

SELECT set_config('app.rls_bypass', 'off', false);
