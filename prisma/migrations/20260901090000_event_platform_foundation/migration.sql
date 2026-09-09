-- Canonical event-platform persistence.
--
-- The command mutation, immutable domain event and event_outbox INSERT are
-- committed in one PostgreSQL transaction. Debezium is later restricted to
-- event_outbox INSERTs; there is deliberately no mutable "published" flag.
-- Immutable rows are protected by all three layers available to the current
-- production role split: minimum grants, FORCE RLS policies without
-- UPDATE/DELETE arms, and database triggers.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "event_command_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL,
  "eventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_command_receipts_command_type_nonempty" CHECK (char_length("commandType") BETWEEN 1 AND 160),
  CONSTRAINT "event_command_receipts_key_nonempty" CHECK (char_length("idempotencyKey") BETWEEN 8 AND 200),
  CONSTRAINT "event_command_receipts_request_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "event_command_receipts_response_status" CHECK ("responseStatus" BETWEEN 100 AND 599),
  CONSTRAINT "event_command_receipts_expiry" CHECK ("expiresAt" IS NULL OR "expiresAt" > "completedAt")
);

CREATE TABLE "event_aggregate_heads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "currentVersion" BIGINT NOT NULL DEFAULT 0,
  "lastEventId" UUID,
  "lastEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_aggregate_heads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_aggregate_heads_version_nonnegative" CHECK ("currentVersion" >= 0),
  CONSTRAINT "event_aggregate_heads_type_nonempty" CHECK (char_length("aggregateType") BETWEEN 1 AND 100),
  CONSTRAINT "event_aggregate_heads_id_nonempty" CHECK (char_length("aggregateId") BETWEEN 1 AND 191)
);

CREATE TABLE "domain_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "aggregateVersion" BIGINT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL,
  "dataSchema" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "subjectRef" TEXT,
  "correlationId" TEXT NOT NULL,
  "causationId" TEXT,
  "traceparent" TEXT,
  "commandId" TEXT,
  "producer" TEXT NOT NULL,
  "producerVersion" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "domain_events_aggregate_version_positive" CHECK ("aggregateVersion" > 0),
  CONSTRAINT "domain_events_event_version_positive" CHECK ("eventVersion" > 0),
  CONSTRAINT "domain_events_event_type_versioned" CHECK ("eventType" ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$'),
  CONSTRAINT "domain_events_event_version_matches_type" CHECK (
    "eventVersion" = substring("eventType" FROM '\.v([1-9][0-9]*)$')::INTEGER
  ),
  CONSTRAINT "domain_events_classification" CHECK ("classification" IN ('public', 'internal', 'confidential', 'restricted')),
  CONSTRAINT "domain_events_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "domain_events_traceparent" CHECK ("traceparent" IS NULL OR "traceparent" ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$')
);

CREATE TABLE "event_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "eventId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "partitionKey" TEXT NOT NULL,
  "envelope" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_outbox_event_type_versioned" CHECK ("eventType" ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$'),
  CONSTRAINT "event_outbox_topic_nonempty" CHECK (char_length("topic") BETWEEN 1 AND 249),
  CONSTRAINT "event_outbox_partition_key_nonempty" CHECK (char_length("partitionKey") BETWEEN 1 AND 512),
  CONSTRAINT "event_outbox_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "consumer_inbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "consumerName" TEXT NOT NULL,
  "consumerVersion" INTEGER NOT NULL,
  "eventId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "sourceTopic" TEXT NOT NULL,
  "sourcePartition" INTEGER NOT NULL,
  "sourceOffset" BIGINT NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consumer_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumer_inbox_version_positive" CHECK ("consumerVersion" > 0),
  CONSTRAINT "consumer_inbox_partition_nonnegative" CHECK ("sourcePartition" >= 0),
  CONSTRAINT "consumer_inbox_offset_nonnegative" CHECK ("sourceOffset" >= 0),
  CONSTRAINT "consumer_inbox_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "projection_builds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "projectionName" TEXT NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "buildKey" TEXT NOT NULL,
  "codeSha" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "effectsFenced" BOOLEAN NOT NULL DEFAULT true,
  "replayFrom" TIMESTAMP(3),
  "replayTo" TIMESTAMP(3),
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "promotedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_builds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projection_builds_version_positive" CHECK ("projectionVersion" > 0),
  CONSTRAINT "projection_builds_mode" CHECK ("mode" IN ('live', 'shadow', 'replay')),
  CONSTRAINT "projection_builds_status" CHECK ("status" IN ('pending', 'running', 'verifying', 'ready', 'promoted', 'failed', 'abandoned')),
  CONSTRAINT "projection_builds_replay_effect_fence" CHECK ("mode" = 'live' OR "effectsFenced"),
  CONSTRAINT "projection_builds_promotion" CHECK (("status" = 'promoted') = ("promotedAt" IS NOT NULL)),
  CONSTRAINT "projection_builds_replay_range" CHECK ("replayFrom" IS NULL OR "replayTo" IS NULL OR "replayTo" >= "replayFrom")
);

CREATE TABLE "projection_checkpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "buildId" UUID NOT NULL,
  "sourceTopic" TEXT NOT NULL,
  "sourcePartition" INTEGER NOT NULL,
  "sourceOffset" BIGINT NOT NULL,
  "lastEventId" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projection_checkpoints_partition_nonnegative" CHECK ("sourcePartition" >= 0),
  CONSTRAINT "projection_checkpoints_offset_nonnegative" CHECK ("sourceOffset" >= 0)
);

CREATE TABLE "effect_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "sourceEventId" UUID,
  "effectType" TEXT NOT NULL,
  "effectKey" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "executionMode" TEXT NOT NULL DEFAULT 'live',
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerRequestId" TEXT,
  "providerResult" JSONB,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "reconciliationAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "effect_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "effect_outbox_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "effect_outbox_type_nonempty" CHECK (char_length("effectType") BETWEEN 1 AND 160),
  CONSTRAINT "effect_outbox_key_nonempty" CHECK (char_length("effectKey") BETWEEN 1 AND 300),
  CONSTRAINT "effect_outbox_destination_nonempty" CHECK (char_length("destination") BETWEEN 1 AND 300),
  CONSTRAINT "effect_outbox_execution_mode" CHECK ("executionMode" = 'live'),
  CONSTRAINT "effect_outbox_attempt_count_nonnegative" CHECK ("attemptCount" >= 0),
  CONSTRAINT "effect_outbox_status" CHECK ("status" IN ('pending', 'leased', 'succeeded', 'definitely_failed', 'reconciliation_required', 'dead')),
  CONSTRAINT "effect_outbox_lease_coherence" CHECK (
    ("status" = 'leased' AND "leaseToken" IS NOT NULL AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'leased' AND "leaseToken" IS NULL AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
  )
);

CREATE TABLE "effect_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "effectId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "leaseToken" UUID NOT NULL,
  "requestId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "responseCode" INTEGER,
  "providerReference" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "effect_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "effect_attempts_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "effect_attempts_outcome" CHECK ("outcome" IN ('started', 'succeeded', 'definitely_failed', 'reconciliation_required')),
  CONSTRAINT "effect_attempts_response_code" CHECK ("responseCode" IS NULL OR "responseCode" BETWEEN 100 AND 599),
  CONSTRAINT "effect_attempts_request_nonempty" CHECK (char_length("requestId") BETWEEN 1 AND 300),
  CONSTRAINT "effect_attempts_outcome_coherence" CHECK (
    ("outcome" = 'started' AND "completedAt" IS NULL AND "responseCode" IS NULL
      AND "providerReference" IS NULL AND "errorMessage" IS NULL)
    OR
    ("outcome" <> 'started' AND "completedAt" IS NOT NULL)
  )
);

-- Human/provider reconciliation is evidence, not an UPDATE comment on the
-- mutable outbox row. Exactly one immutable decision may resolve each
-- ambiguous attempt, and the state-machine transition below requires it.
CREATE TABLE "effect_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "effectId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "providerReference" TEXT,
  "evidence" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL DEFAULT '',
  "operatorRole" TEXT NOT NULL DEFAULT CURRENT_USER,
  "sessionIdentity" TEXT NOT NULL DEFAULT SESSION_USER,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "effect_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "effect_reconciliations_attempt_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "effect_reconciliations_decision" CHECK ("decision" IN ('retry', 'succeeded', 'dead')),
  CONSTRAINT "effect_reconciliations_reason_nonempty" CHECK (char_length("reason") BETWEEN 1 AND 2000),
  CONSTRAINT "effect_reconciliations_evidence_object" CHECK (jsonb_typeof("evidence") = 'object' AND "evidence" <> '{}'::JSONB),
  CONSTRAINT "effect_reconciliations_evidence_hash" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "effect_reconciliations_success_reference" CHECK ("decision" <> 'succeeded' OR char_length(COALESCE("providerReference", '')) > 0)
);

-- Deployment cutover gates are global operational evidence, not tenant data.
-- Only the migration role can see or mutate them. A pilot migration inserts a
-- durable migration_applied row in the same transaction as its schema/data
-- change; the release program may advance that row exactly once, to verified,
-- only after the rollback-client and deep-replay gates pass. This makes a
-- SIGKILL/reboot/retry unable to confuse "migration committed" with "release
-- verified".
CREATE TABLE "event_platform_cutover_gates" (
  "gateKey" TEXT NOT NULL,
  "migrationName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "migrationAppliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "verifiedArtifactSha" TEXT,
  "previousArtifactSha" TEXT,
  "previousClientHash" TEXT,
  "migrationChecksum" TEXT,
  "backupEvidenceHash" TEXT,
  CONSTRAINT "event_platform_cutover_gates_pkey" PRIMARY KEY ("gateKey"),
  CONSTRAINT "event_platform_cutover_gates_migration_key" UNIQUE ("migrationName"),
  CONSTRAINT "event_platform_cutover_gates_status" CHECK (
    ("status" = 'migration_applied'
      AND "verifiedAt" IS NULL
      AND "verifiedArtifactSha" IS NULL
      AND "previousArtifactSha" IS NULL
      AND "previousClientHash" IS NULL
      AND "migrationChecksum" IS NULL
      AND "backupEvidenceHash" IS NULL)
    OR
    ("status" = 'verified'
      AND "verifiedAt" IS NOT NULL
      AND "verifiedAt" >= "migrationAppliedAt"
      AND "verifiedArtifactSha" IS NOT NULL
      AND "verifiedArtifactSha" ~ '^[0-9a-f]{40}$'
      AND "previousArtifactSha" IS NOT NULL
      AND "previousArtifactSha" ~ '^[0-9a-f]{40}$'
      AND "previousClientHash" IS NOT NULL
      AND "previousClientHash" ~ '^[0-9a-f]{64}$'
      AND "migrationChecksum" IS NOT NULL
      AND "migrationChecksum" ~ '^[0-9a-f]{64}$'
      AND "backupEvidenceHash" IS NOT NULL
      AND "backupEvidenceHash" ~ '^[0-9a-f]{64}$')
  )
);

-- Composite tenant-scoped foreign keys below require their referenced unique
-- keys to exist before PostgreSQL can create the constraints.
CREATE UNIQUE INDEX "domain_events_org_id_key" ON "domain_events"("organizationId", "id");
CREATE UNIQUE INDEX "projection_builds_org_id_key" ON "projection_builds"("organizationId", "id");
CREATE UNIQUE INDEX "effect_outbox_org_id_key" ON "effect_outbox"("organizationId", "id");

ALTER TABLE "event_command_receipts" ADD CONSTRAINT "event_command_receipts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_aggregate_heads" ADD CONSTRAINT "event_aggregate_heads_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_organizationId_eventId_fkey"
  FOREIGN KEY ("organizationId", "eventId") REFERENCES "domain_events"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consumer_inbox" ADD CONSTRAINT "consumer_inbox_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projection_builds" ADD CONSTRAINT "projection_builds_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projection_checkpoints" ADD CONSTRAINT "projection_checkpoints_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projection_checkpoints" ADD CONSTRAINT "projection_checkpoints_organizationId_buildId_fkey"
  FOREIGN KEY ("organizationId", "buildId") REFERENCES "projection_builds"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_outbox" ADD CONSTRAINT "effect_outbox_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_outbox" ADD CONSTRAINT "effect_outbox_organizationId_sourceEventId_fkey"
  FOREIGN KEY ("organizationId", "sourceEventId") REFERENCES "domain_events"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_attempts" ADD CONSTRAINT "effect_attempts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_attempts" ADD CONSTRAINT "effect_attempts_organizationId_effectId_fkey"
  FOREIGN KEY ("organizationId", "effectId") REFERENCES "effect_outbox"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_reconciliations" ADD CONSTRAINT "effect_reconciliations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "effect_reconciliations" ADD CONSTRAINT "effect_reconciliations_organizationId_effectId_fkey"
  FOREIGN KEY ("organizationId", "effectId") REFERENCES "effect_outbox"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "event_command_receipts_org_command_key" ON "event_command_receipts"("organizationId", "commandType", "idempotencyKey");
CREATE INDEX "event_command_receipts_org_created_idx" ON "event_command_receipts"("organizationId", "createdAt");
CREATE UNIQUE INDEX "event_aggregate_heads_stream_key" ON "event_aggregate_heads"("organizationId", "aggregateType", "aggregateId");
CREATE INDEX "event_aggregate_heads_org_updated_idx" ON "event_aggregate_heads"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "domain_events_stream_version_key" ON "domain_events"("organizationId", "aggregateType", "aggregateId", "aggregateVersion");
CREATE INDEX "domain_events_org_type_time_idx" ON "domain_events"("organizationId", "eventType", "occurredAt", "id");
CREATE INDEX "domain_events_stream_time_idx" ON "domain_events"("organizationId", "aggregateType", "aggregateId", "occurredAt");
CREATE INDEX "domain_events_correlation_idx" ON "domain_events"("organizationId", "correlationId");
CREATE UNIQUE INDEX "event_outbox_event_key" ON "event_outbox"("eventId");
CREATE UNIQUE INDEX "event_outbox_org_event_key" ON "event_outbox"("organizationId", "eventId");
CREATE INDEX "event_outbox_org_created_idx" ON "event_outbox"("organizationId", "createdAt", "id");
CREATE INDEX "event_outbox_created_idx" ON "event_outbox"("createdAt", "id");
CREATE UNIQUE INDEX "consumer_inbox_event_key" ON "consumer_inbox"("organizationId", "consumerName", "consumerVersion", "eventId");
CREATE UNIQUE INDEX "consumer_inbox_offset_key" ON "consumer_inbox"("consumerName", "consumerVersion", "sourceTopic", "sourcePartition", "sourceOffset");
CREATE INDEX "consumer_inbox_org_processed_idx" ON "consumer_inbox"("organizationId", "processedAt");
CREATE UNIQUE INDEX "projection_builds_build_key" ON "projection_builds"("organizationId", "projectionName", "buildKey");
CREATE INDEX "projection_builds_org_status_idx" ON "projection_builds"("organizationId", "projectionName", "status");
CREATE UNIQUE INDEX "projection_checkpoints_partition_key" ON "projection_checkpoints"("organizationId", "buildId", "sourceTopic", "sourcePartition");
CREATE INDEX "projection_checkpoints_org_updated_idx" ON "projection_checkpoints"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "effect_outbox_effect_key" ON "effect_outbox"("organizationId", "effectType", "effectKey");
CREATE INDEX "effect_outbox_due_idx" ON "effect_outbox"("status", "availableAt");
CREATE INDEX "effect_outbox_org_status_idx" ON "effect_outbox"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "effect_attempts_outcome_key" ON "effect_attempts"("organizationId", "effectId", "attemptNumber", "outcome");
CREATE UNIQUE INDEX "effect_attempts_terminal_key" ON "effect_attempts"("organizationId", "effectId", "attemptNumber")
  WHERE "outcome" <> 'started';
CREATE INDEX "effect_attempts_request_idx" ON "effect_attempts"("organizationId", "effectId", "requestId");
CREATE INDEX "effect_attempts_org_outcome_idx" ON "effect_attempts"("organizationId", "outcome", "attemptedAt");
CREATE UNIQUE INDEX "effect_reconciliations_attempt_key"
  ON "effect_reconciliations"("organizationId", "effectId", "attemptNumber");
CREATE INDEX "effect_reconciliations_org_time_idx"
  ON "effect_reconciliations"("organizationId", "reconciledAt", "id");

CREATE OR REPLACE FUNCTION event_platform_jsonb_sha256(value JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT encode(public.digest(pg_catalog.convert_to(value::TEXT, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION domain_events_set_payload_hash_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW."payloadHash" := public.event_platform_jsonb_sha256(NEW."data");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION event_outbox_set_payload_hash_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW."payloadHash" := public.event_platform_jsonb_sha256(NEW."envelope");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION effect_reconciliations_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_effect public."effect_outbox"%ROWTYPE;
  ambiguous_attempt_count INTEGER;
BEGIN
  IF current_user <> 'leaddrive_effect_operator' THEN
    RAISE EXCEPTION 'effect reconciliation evidence requires the dedicated operator role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO current_effect
    FROM public."effect_outbox"
   WHERE "organizationId" = NEW."organizationId"
     AND "id" = NEW."effectId"
   FOR UPDATE;
  IF NOT FOUND
     OR current_effect."status" <> 'reconciliation_required'
     OR current_effect."attemptCount" <> NEW."attemptNumber" THEN
    RAISE EXCEPTION 'reconciliation evidence does not match an ambiguous current effect attempt'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO ambiguous_attempt_count
    FROM public."effect_attempts"
   WHERE "organizationId" = NEW."organizationId"
     AND "effectId" = NEW."effectId"
     AND "attemptNumber" = NEW."attemptNumber"
     AND "outcome" = 'reconciliation_required';
  IF ambiguous_attempt_count <> 1 THEN
    RAISE EXCEPTION 'reconciliation evidence requires one matching ambiguous attempt row'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW."operatorRole" := current_user;
  NEW."sessionIdentity" := session_user;
  NEW."evidenceHash" := public.event_platform_jsonb_sha256(NEW."evidence");
  NEW."reconciledAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION effect_reconciliation_commit_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_status TEXT;
  current_status TEXT;
  current_attempt INTEGER;
BEGIN
  expected_status := CASE NEW."decision"
    WHEN 'retry' THEN 'pending'
    WHEN 'succeeded' THEN 'succeeded'
    ELSE 'dead'
  END;

  SELECT e."status", e."attemptCount"
    INTO current_status, current_attempt
    FROM public."effect_outbox" e
   WHERE e."organizationId" = NEW."organizationId"
     AND e."id" = NEW."effectId";
  IF NOT FOUND
     OR current_status IS DISTINCT FROM expected_status
     OR current_attempt IS DISTINCT FROM NEW."attemptNumber" THEN
    RAISE EXCEPTION 'reconciliation evidence must commit with its matching effect transition (effect=% attempt=% decision=%)',
      NEW."effectId", NEW."attemptNumber", NEW."decision"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The routing columns are deliberately duplicated outside the JSON envelope
-- so Kafka Connect can route without parsing business payloads. Fail the
-- transaction if those copies ever disagree with the canonical event: a
-- mismatched topic/key/header would silently destroy ordering or tenancy.
CREATE OR REPLACE FUNCTION event_outbox_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  source_event public."domain_events"%ROWTYPE;
  expected_topic TEXT;
  expected_key TEXT;
BEGIN
  SELECT * INTO source_event
    FROM public."domain_events"
   WHERE "organizationId" = NEW."organizationId"
     AND "id" = NEW."eventId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_outbox source event missing'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  expected_topic := 'leaddrive.domain.' || split_part(source_event."eventType", '.', 1) || '.v1';
  expected_key := source_event."organizationId" || ':' || source_event."aggregateType" || ':' || source_event."aggregateId";

  IF jsonb_typeof(NEW."envelope") IS DISTINCT FROM 'object'
     OR NEW."eventType" IS DISTINCT FROM source_event."eventType"
     OR NEW."topic" IS DISTINCT FROM expected_topic
     OR NEW."partitionKey" IS DISTINCT FROM expected_key
     OR NEW."envelope" ->> 'specversion' IS DISTINCT FROM '1.0'
     OR NEW."envelope" ->> 'id' IS DISTINCT FROM source_event."id"::TEXT
     OR NEW."envelope" ->> 'source' IS DISTINCT FROM source_event."source"
     OR NEW."envelope" ->> 'type' IS DISTINCT FROM source_event."eventType"
     OR (NEW."envelope" ->> 'time')::TIMESTAMPTZ AT TIME ZONE 'UTC' IS DISTINCT FROM source_event."occurredAt"
     OR NEW."envelope" ->> 'datacontenttype' IS DISTINCT FROM 'application/json'
     OR NEW."envelope" ->> 'dataschema' IS DISTINCT FROM source_event."dataSchema"
     OR NEW."envelope" ->> 'organizationid' IS DISTINCT FROM source_event."organizationId"
     OR NEW."envelope" ->> 'aggregatetype' IS DISTINCT FROM source_event."aggregateType"
     OR NEW."envelope" ->> 'aggregateid' IS DISTINCT FROM source_event."aggregateId"
     OR (NEW."envelope" ->> 'aggregateversion')::BIGINT IS DISTINCT FROM source_event."aggregateVersion"
     OR NEW."envelope" ->> 'correlationid' IS DISTINCT FROM source_event."correlationId"
     OR NEW."envelope" ->> 'causationid' IS DISTINCT FROM source_event."causationId"
     OR NEW."envelope" ->> 'traceparent' IS DISTINCT FROM source_event."traceparent"
     OR NEW."envelope" ->> 'producer' IS DISTINCT FROM source_event."producer"
     OR NEW."envelope" ->> 'producerversion' IS DISTINCT FROM source_event."producerVersion"
     OR NEW."envelope" ->> 'classification' IS DISTINCT FROM source_event."classification"
     OR NEW."envelope" ->> 'subjectref' IS DISTINCT FROM source_event."subjectRef"
     OR NEW."envelope" -> 'data' IS DISTINCT FROM source_event."data" THEN
    RAISE EXCEPTION 'event_outbox routing/envelope mismatch for event %', NEW."eventId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION effect_outbox_set_payload_hash_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW."payloadHash" := public.event_platform_jsonb_sha256(NEW."payload");
  RETURN NEW;
END;
$$;

-- Deferred stream invariant: an application transaction may allocate the head
-- before inserting its event and outbox, while a migration may insert events
-- before the heads. Commit validation uses indexed boundary/adjacency probes,
-- never a full stream rescan per row. This keeps both bulk bootstrap and a
-- long-lived aggregate O(number of appended events), rather than quadratic or
-- O(total history) on every command.
CREATE OR REPLACE FUNCTION event_stream_commit_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  head public."event_aggregate_heads"%ROWTYPE;
  boundary_event public."domain_events"%ROWTYPE;
  matching_outbox_count INTEGER;
BEGIN
  -- A trigger RECORD exposes only the columns of its firing table. Keep the
  -- head-only fields in a nested branch; SQL expression planning may resolve
  -- NEW.currentVersion even when an outer boolean predicate is false.
  IF TG_TABLE_NAME = 'event_aggregate_heads' THEN
    IF TG_OP = 'UPDATE' AND (
      NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."aggregateType" IS DISTINCT FROM OLD."aggregateType"
      OR NEW."aggregateId" IS DISTINCT FROM OLD."aggregateId"
      OR NEW."currentVersion" <> OLD."currentVersion" + 1
    ) THEN
      RAISE EXCEPTION 'aggregate head identity is immutable and version must advance by exactly one (%/%/%)',
        OLD."organizationId", OLD."aggregateType", OLD."aggregateId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO head
    FROM public."event_aggregate_heads"
   WHERE "organizationId" = NEW."organizationId"
     AND "aggregateType" = NEW."aggregateType"
     AND "aggregateId" = NEW."aggregateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event stream has no aggregate head (%/%/%)',
      NEW."organizationId", NEW."aggregateType", NEW."aggregateId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF head."currentVersion" = 0 THEN
    IF TG_TABLE_NAME = 'domain_events'
       OR head."lastEventId" IS NOT NULL
       OR head."lastEventAt" IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public."domain_events" e
          WHERE e."organizationId" = head."organizationId"
            AND e."aggregateType" = head."aggregateType"
            AND e."aggregateId" = head."aggregateId"
          LIMIT 1
       ) THEN
      RAISE EXCEPTION 'empty event stream head is incoherent (%/%/%)',
        head."organizationId", head."aggregateType", head."aggregateId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO boundary_event
    FROM public."domain_events" e
   WHERE e."organizationId" = head."organizationId"
     AND e."aggregateType" = head."aggregateType"
     AND e."aggregateId" = head."aggregateId"
     AND e."aggregateVersion" = head."currentVersion";
  IF NOT FOUND
     OR head."lastEventId" IS DISTINCT FROM boundary_event."id"
     OR head."lastEventAt" IS DISTINCT FROM boundary_event."occurredAt" THEN
    RAISE EXCEPTION 'event stream head does not match its final version (%/%/%)',
      head."organizationId", head."aggregateType", head."aggregateId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'event_aggregate_heads' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."domain_events" e
       WHERE e."organizationId" = head."organizationId"
         AND e."aggregateType" = head."aggregateType"
         AND e."aggregateId" = head."aggregateId"
         AND e."aggregateVersion" = 1
    ) THEN
      RAISE EXCEPTION 'event stream has no version 1 boundary (%/%/%)',
        head."organizationId", head."aggregateType", head."aggregateId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."aggregateVersion" < 1
     OR NEW."aggregateVersion" > head."currentVersion" THEN
    RAISE EXCEPTION 'event version lies outside its aggregate head (%/%/% v%)',
      NEW."organizationId", NEW."aggregateType", NEW."aggregateId", NEW."aggregateVersion"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO matching_outbox_count
    FROM public."event_outbox" o
   WHERE o."organizationId" = NEW."organizationId"
     AND o."eventId" = NEW."id";
  IF matching_outbox_count <> 1 THEN
    RAISE EXCEPTION 'event has no unique outbox row (%/%/% v%)',
      NEW."organizationId", NEW."aggregateType", NEW."aggregateId", NEW."aggregateVersion"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."aggregateVersion" > 1 AND NOT EXISTS (
    SELECT 1 FROM public."domain_events" predecessor
     WHERE predecessor."organizationId" = NEW."organizationId"
       AND predecessor."aggregateType" = NEW."aggregateType"
       AND predecessor."aggregateId" = NEW."aggregateId"
       AND predecessor."aggregateVersion" = NEW."aggregateVersion" - 1
  ) THEN
    RAISE EXCEPTION 'event stream predecessor is missing (%/%/% v%)',
      NEW."organizationId", NEW."aggregateType", NEW."aggregateId", NEW."aggregateVersion"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."aggregateVersion" < head."currentVersion" AND NOT EXISTS (
    SELECT 1 FROM public."domain_events" successor
     WHERE successor."organizationId" = NEW."organizationId"
       AND successor."aggregateType" = NEW."aggregateType"
       AND successor."aggregateId" = NEW."aggregateId"
       AND successor."aggregateVersion" = NEW."aggregateVersion" + 1
  ) THEN
    RAISE EXCEPTION 'event stream successor is missing (%/%/% v%)',
      NEW."organizationId", NEW."aggregateType", NEW."aggregateId", NEW."aggregateVersion"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- effect_outbox is mutable only through this explicit state machine. Identity
-- and payload are immutable, terminal evidence must already exist in the
-- append-only effect_attempts ledger, and an expired/ambiguous lease can never
-- be silently retried as though the provider definitely did nothing.
CREATE OR REPLACE FUNCTION effect_outbox_state_machine_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_outcome TEXT;
  evidence_count INTEGER;
  started_count INTEGER;
  reconciliation_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending'
       OR NEW."attemptCount" <> 0
       OR NEW."leaseOwner" IS NOT NULL
       OR NEW."leaseToken" IS NOT NULL
       OR NEW."leaseExpiresAt" IS NOT NULL
       OR NEW."providerRequestId" IS NOT NULL
       OR NEW."providerResult" IS NOT NULL
       OR NEW."lastError" IS NOT NULL
       OR NEW."completedAt" IS NOT NULL
       OR NEW."reconciliationAt" IS NOT NULL THEN
      RAISE EXCEPTION 'new effect must start in a clean pending state (id=%)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."sourceEventId" IS DISTINCT FROM OLD."sourceEventId"
     OR NEW."effectType" IS DISTINCT FROM OLD."effectType"
     OR NEW."effectKey" IS DISTINCT FROM OLD."effectKey"
     OR NEW."destination" IS DISTINCT FROM OLD."destination"
     OR NEW."executionMode" IS DISTINCT FROM OLD."executionMode"
     OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'effect identity and payload are immutable (id=%)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF OLD."status" IN ('succeeded', 'dead') THEN
      RAISE EXCEPTION 'terminal effect cannot be updated (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."attemptCount" <> OLD."attemptCount"
       OR NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId"
       OR NEW."providerResult" IS DISTINCT FROM OLD."providerResult"
       OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
       OR NEW."reconciliationAt" IS DISTINCT FROM OLD."reconciliationAt"
       OR (OLD."status" = 'leased' AND (
         NEW."leaseToken" IS DISTINCT FROM OLD."leaseToken"
         OR NEW."leaseOwner" IS DISTINCT FROM OLD."leaseOwner"
       )) THEN
      RAISE EXCEPTION 'effect attempt/lease identity is immutable without a state transition (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'pending' AND NEW."status" = 'leased' THEN
    IF NEW."attemptCount" <> OLD."attemptCount" + 1
       OR NEW."leaseToken" IS NULL
       OR NEW."leaseOwner" IS NULL
       OR NEW."leaseExpiresAt" IS NULL
       OR NEW."leaseExpiresAt" <= CURRENT_TIMESTAMP
       OR COALESCE(NEW."providerRequestId", '') = ''
       OR NEW."providerResult" IS NOT NULL
       OR NEW."completedAt" IS NOT NULL
       OR NEW."reconciliationAt" IS NOT NULL THEN
      RAISE EXCEPTION 'invalid effect lease acquisition (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- The worker protocol inserts `started` before making the provider call. An
  -- expired lease with no such row is therefore safe to requeue; once started
  -- exists, the outcome is ambiguous and must follow the reconciliation path.
  IF OLD."status" = 'leased' AND NEW."status" = 'pending' THEN
    SELECT count(*) INTO started_count
      FROM public."effect_attempts"
     WHERE "organizationId" = OLD."organizationId"
       AND "effectId" = OLD."id"
       AND "attemptNumber" = OLD."attemptCount"
       AND "leaseToken" = OLD."leaseToken"
       AND "requestId" = OLD."providerRequestId"
       AND "outcome" = 'started';
    IF OLD."leaseExpiresAt" >= CURRENT_TIMESTAMP
       OR started_count <> 0
       OR NEW."attemptCount" <> OLD."attemptCount"
       OR NEW."leaseToken" IS NOT NULL
       OR NEW."leaseOwner" IS NOT NULL
       OR NEW."leaseExpiresAt" IS NOT NULL
       OR NEW."providerRequestId" IS NOT NULL THEN
      RAISE EXCEPTION 'expired effect lease cannot be safely requeued (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'leased'
     AND NEW."status" IN ('succeeded', 'definitely_failed', 'reconciliation_required') THEN
    expected_outcome := CASE NEW."status"
      WHEN 'succeeded' THEN 'succeeded'
      WHEN 'definitely_failed' THEN 'definitely_failed'
      ELSE 'reconciliation_required'
    END;
    SELECT count(*) INTO evidence_count
      FROM public."effect_attempts"
     WHERE "organizationId" = OLD."organizationId"
       AND "effectId" = OLD."id"
       AND "attemptNumber" = OLD."attemptCount"
       AND "leaseToken" = OLD."leaseToken"
       AND "requestId" = OLD."providerRequestId"
       AND "outcome" = expected_outcome;
    IF evidence_count <> 1
       OR NEW."attemptCount" <> OLD."attemptCount"
       OR NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId"
       OR NEW."leaseToken" IS NOT NULL
       OR NEW."leaseOwner" IS NOT NULL
       OR NEW."leaseExpiresAt" IS NOT NULL THEN
      RAISE EXCEPTION 'effect terminal transition lacks matching attempt evidence (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" IN ('succeeded', 'dead') AND NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'terminal effect requires completedAt (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'reconciliation_required' AND NEW."reconciliationAt" IS NULL THEN
      RAISE EXCEPTION 'ambiguous effect requires reconciliationAt (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'definitely_failed' AND NEW."status" IN ('pending', 'dead') THEN
    IF current_user <> 'leaddrive_effect_operator'
       OR NEW."attemptCount" <> OLD."attemptCount"
       OR (NEW."status" = 'pending' AND NEW."providerRequestId" IS NOT NULL)
       OR (NEW."status" = 'pending' AND NEW."providerResult" IS NOT NULL)
       OR (NEW."status" = 'dead' AND NEW."completedAt" IS NULL) THEN
      RAISE EXCEPTION 'effect retry/dead-letter requires the dedicated operator role (id=%)', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'reconciliation_required'
     AND NEW."status" IN ('pending', 'succeeded', 'dead') THEN
    IF current_user <> 'leaddrive_effect_operator'
       OR NEW."attemptCount" <> OLD."attemptCount" THEN
      RAISE EXCEPTION 'effect reconciliation requires the dedicated operator role (id=%)', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO reconciliation_count
      FROM public."effect_reconciliations"
     WHERE "organizationId" = OLD."organizationId"
       AND "effectId" = OLD."id"
       AND "attemptNumber" = OLD."attemptCount"
       AND "decision" = CASE NEW."status"
         WHEN 'pending' THEN 'retry'
         WHEN 'succeeded' THEN 'succeeded'
         ELSE 'dead'
       END;
    IF reconciliation_count <> 1 THEN
      RAISE EXCEPTION 'effect reconciliation transition lacks immutable decision evidence (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" IN ('succeeded', 'dead') AND NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'reconciled terminal effect requires completedAt (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'pending' AND NEW."providerRequestId" IS NOT NULL THEN
      RAISE EXCEPTION 'reconciled retry must clear providerRequestId (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'pending' AND (
      NEW."providerResult" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL
      OR NEW."reconciliationAt" IS NOT NULL
      OR NEW."lastError" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'reconciled retry must clear provider result/error/completion markers (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid effect state transition % -> % (id=%)', OLD."status", NEW."status", OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION effect_attempts_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_effect public."effect_outbox"%ROWTYPE;
  started_count INTEGER;
BEGIN
  SELECT * INTO current_effect
    FROM public."effect_outbox"
   WHERE "organizationId" = NEW."organizationId"
     AND "id" = NEW."effectId"
   FOR UPDATE;
  IF NOT FOUND
     OR current_effect."status" <> 'leased'
     OR current_effect."attemptCount" <> NEW."attemptNumber"
     OR current_effect."leaseToken" IS DISTINCT FROM NEW."leaseToken"
     OR current_effect."providerRequestId" IS DISTINCT FROM NEW."requestId" THEN
    RAISE EXCEPTION 'effect attempt does not match the active lease'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."outcome" <> 'started' THEN
    SELECT count(*) INTO started_count
      FROM public."effect_attempts"
     WHERE "organizationId" = NEW."organizationId"
       AND "effectId" = NEW."effectId"
       AND "attemptNumber" = NEW."attemptNumber"
       AND "leaseToken" = NEW."leaseToken"
       AND "requestId" = NEW."requestId"
       AND "outcome" = 'started';
    IF started_count <> 1 THEN
      RAISE EXCEPTION 'terminal effect attempt requires one matching started row'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION projection_builds_state_machine_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending' OR NEW."promotedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'projection build must start pending and unpromoted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."projectionName" IS DISTINCT FROM OLD."projectionName"
     OR NEW."projectionVersion" IS DISTINCT FROM OLD."projectionVersion"
     OR NEW."buildKey" IS DISTINCT FROM OLD."buildKey"
     OR NEW."codeSha" IS DISTINCT FROM OLD."codeSha"
     OR NEW."mode" IS DISTINCT FROM OLD."mode"
     OR NEW."effectsFenced" IS DISTINCT FROM OLD."effectsFenced"
     OR NEW."replayFrom" IS DISTINCT FROM OLD."replayFrom"
     OR NEW."replayTo" IS DISTINCT FROM OLD."replayTo"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'projection build identity and replay fence are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF OLD."status" IN ('promoted', 'failed', 'abandoned') THEN
      RAISE EXCEPTION 'terminal projection build cannot be updated'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('running', 'failed', 'abandoned'))
    OR (OLD."status" = 'running' AND NEW."status" IN ('verifying', 'failed', 'abandoned'))
    OR (OLD."status" = 'verifying' AND NEW."status" IN ('ready', 'failed', 'abandoned'))
    OR (OLD."status" = 'ready' AND NEW."status" IN ('promoted', 'failed', 'abandoned'))
  ) THEN
    RAISE EXCEPTION 'invalid projection build transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'running' AND NEW."startedAt" IS NULL THEN
    RAISE EXCEPTION 'running projection build requires startedAt'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IN ('ready', 'promoted') AND NEW."completedAt" IS NULL THEN
    RAISE EXCEPTION 'ready projection build requires completedAt'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION event_platform_cutover_gate_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'migration_applied'
       OR NEW."verifiedAt" IS NOT NULL
       OR NEW."verifiedArtifactSha" IS NOT NULL
       OR NEW."previousArtifactSha" IS NOT NULL
       OR NEW."previousClientHash" IS NOT NULL
       OR NEW."migrationChecksum" IS NOT NULL
       OR NEW."backupEvidenceHash" IS NOT NULL THEN
      RAISE EXCEPTION 'cutover gate must begin at migration_applied (gate=%)', NEW."gateKey"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'migration_applied'
       OR NEW."status" <> 'verified'
       OR NEW."gateKey" IS DISTINCT FROM OLD."gateKey"
       OR NEW."migrationName" IS DISTINCT FROM OLD."migrationName"
       OR NEW."migrationAppliedAt" IS DISTINCT FROM OLD."migrationAppliedAt"
       OR NEW."verifiedAt" IS NULL
       OR NEW."verifiedArtifactSha" IS NULL
       OR NEW."verifiedArtifactSha" !~ '^[0-9a-f]{40}$'
       OR NEW."previousArtifactSha" IS NULL
       OR NEW."previousArtifactSha" !~ '^[0-9a-f]{40}$'
       OR NEW."previousClientHash" IS NULL
       OR NEW."previousClientHash" !~ '^[0-9a-f]{64}$'
       OR NEW."migrationChecksum" IS NULL
       OR NEW."migrationChecksum" !~ '^[0-9a-f]{64}$'
       OR NEW."backupEvidenceHash" IS NULL
       OR NEW."backupEvidenceHash" !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid or repeated cutover-gate transition (gate=%)', OLD."gateKey"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cutover-gate evidence cannot be deleted (gate=%)', OLD."gateKey"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER domain_events_set_payload_hash_trigger
  BEFORE INSERT ON "domain_events" FOR EACH ROW EXECUTE FUNCTION domain_events_set_payload_hash_fn();
CREATE TRIGGER event_outbox_set_payload_hash_trigger
  BEFORE INSERT ON "event_outbox" FOR EACH ROW EXECUTE FUNCTION event_outbox_set_payload_hash_fn();
CREATE TRIGGER event_outbox_coherence_trigger
  BEFORE INSERT ON "event_outbox" FOR EACH ROW EXECUTE FUNCTION event_outbox_coherence_fn();
CREATE CONSTRAINT TRIGGER domain_events_commit_coherence_trigger
  AFTER INSERT ON "domain_events"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION event_stream_commit_coherence_fn();
CREATE CONSTRAINT TRIGGER event_aggregate_heads_commit_coherence_trigger
  AFTER INSERT OR UPDATE ON "event_aggregate_heads"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION event_stream_commit_coherence_fn();
CREATE TRIGGER effect_outbox_set_payload_hash_trigger
  BEFORE INSERT OR UPDATE OF "payload" ON "effect_outbox" FOR EACH ROW EXECUTE FUNCTION effect_outbox_set_payload_hash_fn();
CREATE TRIGGER effect_outbox_state_machine_trigger
  BEFORE INSERT OR UPDATE ON "effect_outbox" FOR EACH ROW EXECUTE FUNCTION effect_outbox_state_machine_fn();
CREATE TRIGGER effect_attempts_coherence_trigger
  BEFORE INSERT ON "effect_attempts" FOR EACH ROW EXECUTE FUNCTION effect_attempts_coherence_fn();
CREATE TRIGGER effect_reconciliations_coherence_trigger
  BEFORE INSERT ON "effect_reconciliations" FOR EACH ROW EXECUTE FUNCTION effect_reconciliations_coherence_fn();
CREATE CONSTRAINT TRIGGER effect_reconciliations_commit_coherence_trigger
  AFTER INSERT ON "effect_reconciliations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION effect_reconciliation_commit_coherence_fn();
CREATE TRIGGER projection_builds_state_machine_trigger
  BEFORE INSERT OR UPDATE ON "projection_builds" FOR EACH ROW EXECUTE FUNCTION projection_builds_state_machine_fn();
CREATE TRIGGER event_platform_cutover_gates_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON "event_platform_cutover_gates"
  FOR EACH ROW EXECUTE FUNCTION event_platform_cutover_gate_guard_fn();

-- UPDATE is never a correction: append a correcting event/attempt/receipt.
-- DELETE is accepted only as the nested FK cascade of one explicit tenant
-- deletion transaction. The parent Organization must already be absent from
-- the transaction snapshot, so a direct child-table DELETE cannot set a GUC
-- and imitate the cascade.
CREATE OR REPLACE FUNCTION event_platform_append_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only; UPDATE rejected (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(current_setting('app.event_history_purge', true), '') <> 'on'
     OR pg_trigger_depth() <= 1
     OR EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION '% is append-only; DELETE rejected (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION event_platform_delete_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.event_history_purge', true), '') <> 'on'
     OR pg_trigger_depth() <= 1
     OR EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION '% DELETE rejected outside a whole-tenant cascade (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION event_platform_reject_truncate_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; TRUNCATE rejected', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER event_platform_cutover_gates_reject_truncate_trigger
  BEFORE TRUNCATE ON "event_platform_cutover_gates"
  FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'event_command_receipts', 'domain_events', 'event_outbox',
    'consumer_inbox', 'effect_attempts', 'effect_reconciliations'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION event_platform_append_only_fn()',
      table_name || '_append_only_trigger', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn()',
      table_name || '_reject_truncate_trigger', table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER effect_outbox_delete_guard_trigger
  BEFORE DELETE ON "effect_outbox"
  FOR EACH ROW EXECUTE FUNCTION event_platform_delete_only_fn();
CREATE TRIGGER effect_outbox_reject_truncate_trigger
  BEFORE TRUNCATE ON "effect_outbox"
  FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn();

-- Tenant isolation is installed in this same migration: there is no deployment
-- window where a canonical table exists without FORCE RLS.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'event_command_receipts', 'event_aggregate_heads', 'domain_events',
    'event_outbox', 'consumer_inbox', 'projection_builds',
    'projection_checkpoints', 'effect_outbox', 'effect_attempts',
    'effect_reconciliations', 'event_platform_cutover_gates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'event_command_receipts', 'domain_events', 'event_outbox',
    'consumer_inbox', 'effect_attempts', 'effect_reconciliations'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY event_platform_tenant_select ON %I FOR SELECT USING '
      || '("organizationId" = current_setting(''app.org_id'', true))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY event_platform_tenant_insert ON %I FOR INSERT WITH CHECK '
      || '("organizationId" = current_setting(''app.org_id'', true))',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'event_aggregate_heads', 'projection_builds',
    'projection_checkpoints', 'effect_outbox'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING '
      || '("organizationId" = current_setting(''app.org_id'', true)) '
      || 'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
      table_name
    );
  END LOOP;
END $$;

-- The production migration role owns new relations; the application owner of
-- funds is discovered without embedding a deployment-specific role name.
-- Default privileges are intentionally narrowed here for canonical history.
DO $$
DECLARE
  app_owner TEXT;
  table_name TEXT;
BEGIN
  SELECT tableowner INTO app_owner
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'funds';

  FOREACH table_name IN ARRAY ARRAY[
    'event_command_receipts', 'event_aggregate_heads', 'domain_events',
    'event_outbox', 'consumer_inbox', 'projection_builds',
    'projection_checkpoints', 'effect_outbox', 'effect_attempts',
    'effect_reconciliations', 'event_platform_cutover_gates'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
  END LOOP;

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('REVOKE ALL ON TABLE event_platform_cutover_gates FROM %I', app_owner);

    FOREACH table_name IN ARRAY ARRAY[
      'event_command_receipts', 'domain_events', 'event_outbox',
      'consumer_inbox', 'effect_attempts'
    ]
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, app_owner);
      EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO %I', table_name, app_owner);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE effect_reconciliations FROM %I', app_owner);
    EXECUTE format('GRANT SELECT ON TABLE effect_reconciliations TO %I', app_owner);

    FOREACH table_name IN ARRAY ARRAY[
      'event_aggregate_heads', 'projection_builds',
      'projection_checkpoints', 'effect_outbox'
    ]
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, app_owner);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', table_name, app_owner);
    END LOOP;
  END IF;

  -- The DBA-created operator is optional at foundation install time. If it is
  -- already provisioned, grant only the evidence/state permissions required
  -- for an audited reconciliation transaction.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leaddrive_effect_operator') THEN
    EXECUTE 'GRANT SELECT ON TABLE effect_outbox, effect_attempts, effect_reconciliations'
      || ' TO leaddrive_effect_operator';
    EXECUTE 'GRANT INSERT ON TABLE effect_reconciliations TO leaddrive_effect_operator';
    EXECUTE 'GRANT UPDATE ON TABLE effect_outbox TO leaddrive_effect_operator';
  END IF;
END $$;

COMMIT;
