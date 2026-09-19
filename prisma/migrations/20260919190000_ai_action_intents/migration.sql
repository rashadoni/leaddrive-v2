-- Safe action-intent boundary for CRM writes proposed by the in-CRM voice
-- assistant. The model/provider may create or revise a proposal, but it never
-- receives a commit capability. A later commit route will claim one of these
-- rows with compare-and-swap only after an explicit UI button press.

SET lock_timeout = '3s';

CREATE TABLE "ai_action_intents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "voiceSessionId" TEXT NOT NULL,
  "parentIntentId" TEXT,
  "actionType" VARCHAR(64) NOT NULL,
  "rawPayload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "normalizedPayload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "preview" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "warnings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "state" VARCHAR(32) NOT NULL DEFAULT 'collecting',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "payloadHash" CHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "providerToolCallId" VARCHAR(255),
  "targetEntityType" VARCHAR(64),
  "targetEntityId" VARCHAR(191),
  "expectedUpdatedAt" TIMESTAMP(3),
  "resultEntityType" VARCHAR(64),
  "resultEntityId" VARCHAR(191),
  "resultPayload" JSONB,
  "errorCode" VARCHAR(64),
  "errorDetail" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "executionStartedAt" TIMESTAMP(3),
  "executionLeaseToken" UUID,
  "executionLeaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_action_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_action_intents_state_check" CHECK (
    "state" IN (
      'collecting',
      'awaiting_confirmation',
      'executing',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
      'stale'
    )
  ),
  CONSTRAINT "ai_action_intents_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "ai_action_intents_payload_hash_check" CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ai_action_intents_identity_shape_check" CHECK (
    char_length(btrim("actionType")) BETWEEN 1 AND 64
    AND char_length(btrim("voiceSessionId")) BETWEEN 1 AND 191
    AND char_length(btrim("idempotencyKey")) BETWEEN 8 AND 200
    AND (
      "providerToolCallId" IS NULL
      OR char_length(btrim("providerToolCallId")) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT "ai_action_intents_json_shape_check" CHECK (
    jsonb_typeof("rawPayload") IS NOT DISTINCT FROM 'object'
    AND jsonb_typeof("normalizedPayload") IS NOT DISTINCT FROM 'object'
    AND jsonb_typeof("preview") IS NOT DISTINCT FROM 'object'
    AND jsonb_typeof("warnings") IS NOT DISTINCT FROM 'array'
    AND (
      "errorDetail" IS NULL
      OR jsonb_typeof("errorDetail") IS NOT DISTINCT FROM 'object'
    )
  ),
  CONSTRAINT "ai_action_intents_parent_check" CHECK (
    "parentIntentId" IS NULL OR "parentIntentId" <> "id"
  ),
  CONSTRAINT "ai_action_intents_target_pair_check" CHECK (
    ("targetEntityType" IS NULL) = ("targetEntityId" IS NULL)
  ),
  CONSTRAINT "ai_action_intents_result_pair_check" CHECK (
    ("resultEntityType" IS NULL) = ("resultEntityId" IS NULL)
  ),
  CONSTRAINT "ai_action_intents_expiry_check" CHECK (
    "expiresAt" > "createdAt"
  ),
  CONSTRAINT "ai_action_intents_timestamp_order_check" CHECK (
    ("confirmedAt" IS NULL OR "confirmedAt" >= "createdAt")
    AND (
      "executionStartedAt" IS NULL
      OR (
        "confirmedAt" IS NOT NULL
        AND "executionStartedAt" >= "confirmedAt"
      )
    )
    AND (
      "executionLeaseExpiresAt" IS NULL
      OR (
        "executionStartedAt" IS NOT NULL
        AND "executionLeaseExpiresAt" > "executionStartedAt"
      )
    )
    AND (
      "completedAt" IS NULL
      OR "completedAt" >= COALESCE(
        "executionStartedAt",
        "confirmedAt",
        "createdAt"
      )
    )
  ),
  CONSTRAINT "ai_action_intents_lifecycle_check" CHECK (
    (
      "state" IN ('collecting', 'awaiting_confirmation')
      AND "confirmedAt" IS NULL
      AND "executionStartedAt" IS NULL
      AND "executionLeaseToken" IS NULL
      AND "executionLeaseExpiresAt" IS NULL
      AND "completedAt" IS NULL
      AND "resultPayload" IS NULL
      AND "resultEntityType" IS NULL
      AND "errorCode" IS NULL
      AND "errorDetail" IS NULL
    )
    OR (
      "state" = 'executing'
      AND "confirmedAt" IS NOT NULL
      AND "executionStartedAt" IS NOT NULL
      AND "executionLeaseToken" IS NOT NULL
      AND "executionLeaseExpiresAt" IS NOT NULL
      AND "completedAt" IS NULL
      AND "resultPayload" IS NULL
      AND "resultEntityType" IS NULL
      AND "errorCode" IS NULL
      AND "errorDetail" IS NULL
    )
    OR (
      "state" = 'succeeded'
      AND "confirmedAt" IS NOT NULL
      AND "executionStartedAt" IS NOT NULL
      AND "executionLeaseToken" IS NOT NULL
      AND "executionLeaseExpiresAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "resultPayload" IS NOT NULL
      AND "resultPayload" <> 'null'::jsonb
      AND "errorCode" IS NULL
      AND "errorDetail" IS NULL
    )
    OR (
      "state" = 'failed'
      AND "confirmedAt" IS NOT NULL
      AND "executionStartedAt" IS NOT NULL
      AND "executionLeaseToken" IS NOT NULL
      AND "executionLeaseExpiresAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "resultPayload" IS NULL
      AND "resultEntityType" IS NULL
      AND NULLIF(btrim("errorCode"), '') IS NOT NULL
    )
    OR (
      "state" IN ('cancelled', 'expired')
      AND "confirmedAt" IS NULL
      AND "executionStartedAt" IS NULL
      AND "executionLeaseToken" IS NULL
      AND "executionLeaseExpiresAt" IS NULL
      AND "completedAt" IS NOT NULL
      AND "resultPayload" IS NULL
      AND "resultEntityType" IS NULL
    )
    OR (
      "state" = 'stale'
      AND "completedAt" IS NOT NULL
      AND "resultPayload" IS NULL
      AND "resultEntityType" IS NULL
      AND NULLIF(btrim("errorCode"), '') IS NOT NULL
      AND (
        (
          "confirmedAt" IS NULL
          AND "executionStartedAt" IS NULL
          AND "executionLeaseToken" IS NULL
          AND "executionLeaseExpiresAt" IS NULL
        )
        OR (
          "confirmedAt" IS NOT NULL
          AND "executionStartedAt" IS NOT NULL
          AND "executionLeaseToken" IS NOT NULL
          AND "executionLeaseExpiresAt" IS NOT NULL
        )
      )
    )
  )
);

-- Idempotency is owned by the authenticated user. Provider tool-call IDs are
-- unique only inside their tenant-bound voice session because providers may
-- reuse identifiers in unrelated sessions.
CREATE UNIQUE INDEX "ai_action_intents_org_id_key"
  ON "ai_action_intents"("organizationId", "id");
CREATE UNIQUE INDEX "ai_action_intents_org_user_idempotency_key"
  ON "ai_action_intents"("organizationId", "userId", "idempotencyKey");
CREATE UNIQUE INDEX "ai_action_intents_org_session_provider_call_key"
  ON "ai_action_intents"("organizationId", "voiceSessionId", "providerToolCallId");

-- Prisma cannot express a partial unique index. Child intents belong to a
-- future compound plan and therefore do not compete with their active root.
CREATE UNIQUE INDEX "ai_action_intents_org_active_root_key"
  ON "ai_action_intents"("organizationId", "userId", "voiceSessionId")
  WHERE "parentIntentId" IS NULL
    AND "state" IN ('collecting', 'awaiting_confirmation', 'executing');

CREATE INDEX "ai_action_intents_org_user_state_created_idx"
  ON "ai_action_intents"("organizationId", "userId", "state", "createdAt");
CREATE INDEX "ai_action_intents_org_session_state_idx"
  ON "ai_action_intents"("organizationId", "voiceSessionId", "state");
CREATE INDEX "ai_action_intents_org_state_expiry_idx"
  ON "ai_action_intents"("organizationId", "state", "expiresAt");
CREATE INDEX "ai_action_intents_org_target_idx"
  ON "ai_action_intents"("organizationId", "targetEntityType", "targetEntityId");
CREATE INDEX "ai_action_intents_org_parent_idx"
  ON "ai_action_intents"("organizationId", "parentIntentId");

-- Every reference carries organizationId, so a caller cannot combine a user,
-- voice session or parent intent from another tenant even before RLS evaluates.
ALTER TABLE "ai_action_intents"
  ADD CONSTRAINT "ai_action_intents_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intents"
  ADD CONSTRAINT "ai_action_intents_user_fk"
  FOREIGN KEY ("organizationId", "userId")
  REFERENCES "users"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intents"
  ADD CONSTRAINT "ai_action_intents_voice_session_fk"
  FOREIGN KEY ("organizationId", "voiceSessionId")
  REFERENCES "voice_sessions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intents"
  ADD CONSTRAINT "ai_action_intents_parent_fk"
  FOREIGN KEY ("organizationId", "parentIntentId")
  REFERENCES "ai_action_intents"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Canonical LeadDrive tenant context is app.org_id. The bypass branch is
-- required for controlled maintenance and provisioning paths.
ALTER TABLE "ai_action_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_action_intents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_action_intents";
CREATE POLICY tenant_isolation ON "ai_action_intents"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
