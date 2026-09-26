-- Append-only evidence for the voice action confirmation and execution
-- lifecycle. This first slice records one-time UI confirmation proofs; later
-- execution transitions use the same closed event vocabulary.

SET lock_timeout = '3s';

CREATE TABLE "ai_action_intent_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" VARCHAR(64) NOT NULL,
  "intentRevision" INTEGER NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "correlationId" VARCHAR(191),
  "eventData" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_action_intent_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_action_intent_events_revision_check" CHECK ("intentRevision" >= 1),
  CONSTRAINT "ai_action_intent_events_payload_hash_check" CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ai_action_intent_events_type_check" CHECK (
    "eventType" IN (
      'drafted',
      'draft_updated',
      'confirmation_proof_issued',
      'confirmation_consumed',
      'execution_claimed',
      'execution_lease_recovered',
      'succeeded',
      'failed',
      'stale',
      'cancelled',
      'expired'
    )
  ),
  CONSTRAINT "ai_action_intent_events_json_shape_check" CHECK (
    jsonb_typeof("eventData") IS NOT DISTINCT FROM 'object'
  ),
  CONSTRAINT "ai_action_intent_events_confirmation_shape_check" CHECK (
    "eventType" <> 'confirmation_proof_issued'
    OR (
      "eventData" ? 'tokenHash'
      AND "eventData" ? 'expiresAt'
      AND jsonb_typeof("eventData" -> 'tokenHash') = 'string'
      AND jsonb_typeof("eventData" -> 'expiresAt') = 'string'
      AND ("eventData" ->> 'tokenHash') ~ '^[0-9a-f]{64}$'
      AND NULLIF(btrim("eventData" ->> 'expiresAt'), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "ai_action_intent_events_org_id_key"
  ON "ai_action_intent_events"("organizationId", "id");
CREATE UNIQUE INDEX "ai_action_intent_events_correlation_key"
  ON "ai_action_intent_events"("organizationId", "intentId", "eventType", "correlationId");
CREATE INDEX "ai_action_intent_events_org_intent_created_idx"
  ON "ai_action_intent_events"("organizationId", "intentId", "createdAt");
CREATE INDEX "ai_action_intent_events_org_user_created_idx"
  ON "ai_action_intent_events"("organizationId", "userId", "createdAt");

ALTER TABLE "ai_action_intent_events"
  ADD CONSTRAINT "ai_action_intent_events_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intent_events"
  ADD CONSTRAINT "ai_action_intent_events_intent_fk"
  FOREIGN KEY ("organizationId", "intentId")
  REFERENCES "ai_action_intents"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intent_events"
  ADD CONSTRAINT "ai_action_intent_events_user_fk"
  FOREIGN KEY ("organizationId", "userId")
  REFERENCES "users"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_intent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_action_intent_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ai_action_intent_events_tenant_select" ON "ai_action_intent_events"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

CREATE POLICY "ai_action_intent_events_tenant_insert" ON "ai_action_intent_events"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Evidence is append-only even for bypassed/table-owner sessions. Preserve
-- only the organization/intent FK cascade contract so tenant deletion cannot
-- leave orphaned forensic rows.
CREATE FUNCTION "ai_action_intent_events_append_only_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $append_only$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ai_action_intent_events is append-only — TRUNCATE rejected'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ai_action_intent_events is append-only — UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ai_action_intent_events is append-only — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$append_only$;

CREATE TRIGGER "ai_action_intent_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "ai_action_intent_events"
  FOR EACH ROW
  EXECUTE FUNCTION "ai_action_intent_events_append_only_fn"();

CREATE TRIGGER "ai_action_intent_events_no_truncate_trigger"
  BEFORE TRUNCATE ON "ai_action_intent_events"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "ai_action_intent_events_append_only_fn"();
