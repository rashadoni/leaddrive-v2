-- G6: Real-time Event Stream (Phase 6 / cross-cutting platform infrastructure).
--
-- Salesforce Data Cloud Platform Events / Pub-Sub API analogue. Server-side
-- pub/sub backbone that lets app code publish events into a typed stream and
-- have other code (in-process workers, cron, slice-2 webhooks) react.
--
-- Slice-1 ships schema + 5 pure helpers (types + event-validator +
-- subscription-filter-matcher + delivery-retry-policy + retention-pruner)
-- with vitest coverage. NO real-time dispatch yet — slice-1 is the
-- write side (validation, persistence, retention policy, retry math).
--
-- Slice-2 wires:
--   • Publisher API surface (`/api/v1/event-streams/[key]/publish`).
--   • Subscription dispatcher worker (walks active subscriptions,
--     marks deliveries, escalates to dead-letter on exhaust).
--   • Admin UI for stream + subscription authoring + dead-letter triage.
--   • Hooks into G5 SegmentActivation (real-time activation) +
--     N17 workflow triggers.
-- Slice-3 wires:
--   • External webhook dispatch (signed HMAC payloads).
--   • Replay-from-cursor for late subscribers.
--   • Per-tenant rate limiting.

-- ═══════════════════════════════════════════════════════════════
-- 1. event_streams — stream definition
-- ═══════════════════════════════════════════════════════════════
-- One row per logical stream (e.g. `contact.updated`, `deal.stage_changed`,
-- `inventory.low_stock`). Stream defines the event payload shape (via
-- jsonSchema) + retention policy + lifecycle status.
CREATE TABLE "event_streams" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Stable identifier of the stream within an org. Used as the publish
     * route segment (`/api/v1/event-streams/<streamKey>/publish`).
     * Lowercase + dots + underscores recommended (e.g. `contact.updated`).
     */
    "streamKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * JSON-schema-shaped object describing the event payload. Slice-1
     * validator does light shape-checking (required fields, type tags);
     * full JSON-Schema draft-07 validation is slice-2.
     */
    "payloadSchema" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft     — being authored (no publishing allowed)
     *   active    — publishers can write events, dispatcher delivers
     *   paused    — publishers blocked, dispatcher skips
     *   archived  — terminal; preserved for audit
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /**
     * Retention in seconds. After this age, retention-pruner cron deletes
     * the underlying events (subscriptions + delivery records cascade).
     * NULL = retain indefinitely. Default 30 days.
     */
    "retentionSeconds" INTEGER DEFAULT 2592000,
    /**
     * Cursor / sequence counter. Each published event in this stream gets
     * a monotonically-increasing sequence number from this counter. The
     * publisher (slice-2) takes a row lock + bumps. Slice-1 just defines
     * the column.
     */
    "lastSequence" BIGINT NOT NULL DEFAULT 0,
    /** Set on first transition to active. */
    "activatedAt" TIMESTAMP(3),
    /** Set on transition to archived. */
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_streams_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "event_streams"
  ADD CONSTRAINT "event_streams_status_check"
  CHECK ("status" IN ('draft', 'active', 'paused', 'archived'));

ALTER TABLE "event_streams"
  ADD CONSTRAINT "event_streams_retention_check"
  CHECK ("retentionSeconds" IS NULL OR "retentionSeconds" > 0);

ALTER TABLE "event_streams"
  ADD CONSTRAINT "event_streams_last_sequence_check"
  CHECK ("lastSequence" >= 0);

ALTER TABLE "event_streams"
  ADD CONSTRAINT "event_streams_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "event_streams_org_key_uniq"
  ON "event_streams"("organizationId", "streamKey");
CREATE INDEX "event_streams_org_status_idx"
  ON "event_streams"("organizationId", "status");

ALTER TABLE "event_streams"
  ADD CONSTRAINT "event_streams_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status-transition trigger (Salesforce-like state machine) +
-- immutability on activatedAt / archivedAt / streamKey. Uses IS DISTINCT
-- FROM for NULL-safety (N2 lesson). Mirrors C11 BehavioralSegment trigger.
CREATE OR REPLACE FUNCTION event_streams_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- streamKey immutable (it's the publish-route identifier).
  IF NEW."streamKey" IS DISTINCT FROM OLD."streamKey" THEN
    RAISE EXCEPTION 'event_streams.streamKey is immutable (stream %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- activatedAt set once.
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'event_streams.activatedAt is immutable once set (stream %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- archivedAt set once.
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'event_streams.archivedAt is immutable once set (stream %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Status transitions: draft→active|archived, active→paused|archived,
  -- paused→active|archived, archived terminal.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'event_streams status: archived is terminal (stream %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'event_streams status: draft → % is invalid (stream %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('paused', 'archived') THEN
      RAISE EXCEPTION 'event_streams status: active → % is invalid (stream %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'paused' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'event_streams status: paused → % is invalid (stream %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_streams_lifecycle_trigger
  BEFORE UPDATE ON "event_streams"
  FOR EACH ROW
  EXECUTE FUNCTION event_streams_lifecycle_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. event_stream_events — append-only event log
-- ═══════════════════════════════════════════════════════════════
-- Each row = one published event. Slice-2 publisher inserts; **never
-- updated** (append-only is enforced by trigger below). Retention-pruner
-- DELETEs rows older than parent stream.retentionSeconds.
CREATE TABLE "event_stream_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    /**
     * Monotonic per-stream sequence (bumped from event_streams.lastSequence
     * inside the publish transaction). Slice-2 subscribers track cursors
     * against this for ordered + at-least-once delivery semantics.
     */
    "sequence" BIGINT NOT NULL,
    /**
     * Logical event type within the stream — finer-grained than streamKey.
     * Example: streamKey=`deal.lifecycle`, eventType=`deal.stage_changed`.
     * Subscription filter can match on eventType.
     */
    "eventType" TEXT NOT NULL,
    /**
     * Stable idempotency key. Two publish calls with the same key inside
     * the dedup window become one event (slice-2 enforces via UPSERT).
     * NULL = no dedup requested.
     */
    "idempotencyKey" TEXT,
    /**
     * The event payload, validated against parent stream.payloadSchema.
     * Slice-1 validator is the gate.
     */
    "payload" JSONB NOT NULL DEFAULT '{}',
    /**
     * Optional record-link metadata for traceability: which entity emitted.
     * Example: { sourceType: "deal", sourceId: "d_123", actorId: "u_42" }.
     */
    "source" JSONB NOT NULL DEFAULT '{}',
    /**
     * Wall-clock time the publisher claims the event happened. Defaults
     * to CURRENT_TIMESTAMP if the publisher doesn't override.
     */
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_stream_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "event_stream_events"
  ADD CONSTRAINT "event_stream_events_sequence_check"
  CHECK ("sequence" > 0);

-- Per-stream sequence uniqueness: protects monotonicity invariant.
CREATE UNIQUE INDEX "event_stream_events_stream_sequence_uniq"
  ON "event_stream_events"("streamId", "sequence");

-- Per-stream idempotency-key uniqueness when set (NULLs allowed many).
CREATE UNIQUE INDEX "event_stream_events_stream_idempotency_uniq"
  ON "event_stream_events"("streamId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "event_stream_events_org_stream_idx"
  ON "event_stream_events"("organizationId", "streamId");
CREATE INDEX "event_stream_events_stream_occurred_idx"
  ON "event_stream_events"("streamId", "occurredAt");
CREATE INDEX "event_stream_events_org_occurred_idx"
  ON "event_stream_events"("organizationId", "occurredAt");

ALTER TABLE "event_stream_events"
  ADD CONSTRAINT "event_stream_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_events"
  ADD CONSTRAINT "event_stream_events_streamId_fkey"
  FOREIGN KEY ("streamId") REFERENCES "event_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: block all UPDATEs. Retention-pruner DELETEs rows whole,
-- so DELETE is allowed.
CREATE OR REPLACE FUNCTION event_stream_events_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'event_stream_events is append-only (event % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_events_append_only_trigger
  BEFORE UPDATE ON "event_stream_events"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_events_append_only_fn();

-- Cross-table coherence: event.organizationId MUST match parent
-- stream.organizationId (multi-tenant defense). Mirrors G5 coherence pattern.
CREATE OR REPLACE FUNCTION event_stream_events_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  stream_org_id TEXT;
  stream_status TEXT;
BEGIN
  SELECT "organizationId", "status" INTO stream_org_id, stream_status
    FROM "event_streams"
    WHERE "id" = NEW."streamId";
  IF stream_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_events.streamId "%" does not resolve',
      NEW."streamId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF stream_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_events: stream "%" belongs to org "%" but event references org "%"',
      NEW."streamId", stream_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Publish allowed only while stream is active. paused/archived blocks
  -- new events; draft means stream is not yet open for publish.
  IF stream_status <> 'active' THEN
    RAISE EXCEPTION 'event_stream_events: cannot publish into stream "%" (status %)',
      NEW."streamId", stream_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_events_coherence_trigger
  BEFORE INSERT ON "event_stream_events"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_events_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. event_stream_subscriptions — subscriber config
-- ═══════════════════════════════════════════════════════════════
-- A subscription declares interest in events on a stream, optionally
-- filtered by eventType + payload predicates, with a delivery target
-- (slice-1 just records; slice-2 dispatches).
CREATE TABLE "event_stream_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /**
     * Target type (DB CHECK):
     *   webhook         — slice-3 HTTP delivery
     *   internal_queue  — slice-2 in-process worker dispatch
     *   workflow        — N17 workflow rule fires
     *   activation      — G5 SegmentActivation triggers
     */
    "targetType" TEXT NOT NULL,
    /** Target-table-specific id; soft FK because target tables are diverse. */
    "targetRef" TEXT NOT NULL,
    /**
     * Optional eventType filter. If non-null, only events whose
     * `eventType` equals this string are delivered. Slice-2 wildcard
     * matching (e.g. `deal.*`) is a separate column.
     */
    "eventTypeFilter" TEXT,
    /**
     * Optional payload-path predicates as JSON. Shape:
     *   { "payload.dealStage": { "eq": "won" }, "payload.amount": { "gt": 1000 } }
     * Slice-1 subscription-filter-matcher implements eq/neq/in/gt/lt/contains.
     */
    "payloadFilter" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   active    — dispatcher delivers
     *   paused    — temporarily off; dispatcher skips
     *   archived  — terminal
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    /**
     * Max delivery attempts before escalating to dead-letter.
     * Defaults to 5; subscription-author tunable in slice-2 UI.
     */
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    /**
     * Delivery cursor — last sequence successfully delivered. Slice-2
     * dispatcher uses this to resume after restart.
     */
    "lastDeliveredSequence" BIGINT NOT NULL DEFAULT 0,
    /** Set on transition to archived. */
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_stream_subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_target_type_check"
  CHECK ("targetType" IN ('webhook', 'internal_queue', 'workflow', 'activation'));

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_status_check"
  CHECK ("status" IN ('active', 'paused', 'archived'));

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_max_attempts_check"
  CHECK ("maxAttempts" >= 1 AND "maxAttempts" <= 50);

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_cursor_check"
  CHECK ("lastDeliveredSequence" >= 0);

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "event_stream_subscriptions_stream_target_uniq"
  ON "event_stream_subscriptions"("streamId", "targetType", "targetRef");
CREATE INDEX "event_stream_subscriptions_org_status_idx"
  ON "event_stream_subscriptions"("organizationId", "status");
CREATE INDEX "event_stream_subscriptions_stream_status_idx"
  ON "event_stream_subscriptions"("streamId", "status");

ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_subscriptions"
  ADD CONSTRAINT "event_stream_subscriptions_streamId_fkey"
  FOREIGN KEY ("streamId") REFERENCES "event_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status transitions: active↔paused, either → archived, archived terminal.
-- streamId immutable. archivedAt immutable once set.
CREATE OR REPLACE FUNCTION event_stream_subscriptions_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- streamId immutable.
  IF NEW."streamId" IS DISTINCT FROM OLD."streamId" THEN
    RAISE EXCEPTION 'event_stream_subscriptions.streamId is immutable (subscription %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- archivedAt set once.
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'event_stream_subscriptions.archivedAt is immutable once set (subscription %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Status transitions.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'event_stream_subscriptions status: archived is terminal (subscription %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('paused', 'archived') THEN
      RAISE EXCEPTION 'event_stream_subscriptions status: active → % is invalid (subscription %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'paused' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'event_stream_subscriptions status: paused → % is invalid (subscription %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_subscriptions_lifecycle_trigger
  BEFORE UPDATE ON "event_stream_subscriptions"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_subscriptions_lifecycle_fn();

-- Cross-table coherence: subscription.organizationId MUST match parent
-- stream.organizationId. Mirrors event_stream_events coherence pattern.
CREATE OR REPLACE FUNCTION event_stream_subscriptions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  stream_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO stream_org_id
    FROM "event_streams"
    WHERE "id" = NEW."streamId";
  IF stream_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_subscriptions.streamId "%" does not resolve',
      NEW."streamId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF stream_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_subscriptions: stream "%" belongs to org "%" but subscription references org "%"',
      NEW."streamId", stream_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- INSERT-only: streamId is immutable (lifecycle trigger blocks change),
-- so re-checking on UPDATE is dead code. Architect-suggested narrowing.
CREATE TRIGGER event_stream_subscriptions_coherence_trigger
  BEFORE INSERT ON "event_stream_subscriptions"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_subscriptions_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. event_stream_delivery_attempts — per-attempt audit (append-only)
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 dispatcher inserts one row per delivery attempt (success or
-- transient fail). Slice-1 just defines the contract; the attemptNumber
-- + outcome columns drive retry policy + dead-letter escalation.
CREATE TABLE "event_stream_delivery_attempts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    /**
     * Attempt number (1-based). Slice-2 dispatcher increments on each
     * retry. delivery-retry-policy.ts computes next-delay from this.
     */
    "attemptNumber" INTEGER NOT NULL,
    /**
     * Outcome (DB CHECK):
     *   pending    — queued, not yet attempted
     *   succeeded  — delivered, no further retries
     *   failed     — transient fail; retry-policy decides next attempt
     *   exhausted  — failed at maxAttempts; subscription escalates to dead-letter
     */
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    /** Set on transition out of pending. */
    "attemptedAt" TIMESTAMP(3),
    /** Set on transition to succeeded/failed/exhausted. */
    "completedAt" TIMESTAMP(3),
    /** HTTP-style status (webhook target) or null for internal targets. */
    "responseCode" INTEGER,
    "errorMessage" TEXT,
    /** Slice-2 dispatcher fills with target-specific receipts. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_stream_delivery_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_outcome_check"
  CHECK ("outcome" IN ('pending', 'succeeded', 'failed', 'exhausted'));

ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_number_check"
  CHECK ("attemptNumber" >= 1);

-- Status-timestamp coherence
ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_completed_coherence_check"
  CHECK (
    "outcome" NOT IN ('succeeded', 'failed', 'exhausted')
    OR "completedAt" IS NOT NULL
  );
ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_failed_coherence_check"
  CHECK (
    "outcome" NOT IN ('failed', 'exhausted')
    OR "errorMessage" IS NOT NULL
  );

-- One attempt-number per (subscription, event) — defends idempotency.
CREATE UNIQUE INDEX "event_stream_delivery_attempts_sub_event_attempt_uniq"
  ON "event_stream_delivery_attempts"("subscriptionId", "eventId", "attemptNumber");

CREATE INDEX "event_stream_delivery_attempts_org_outcome_idx"
  ON "event_stream_delivery_attempts"("organizationId", "outcome");
CREATE INDEX "event_stream_delivery_attempts_sub_outcome_idx"
  ON "event_stream_delivery_attempts"("subscriptionId", "outcome");
CREATE INDEX "event_stream_delivery_attempts_event_idx"
  ON "event_stream_delivery_attempts"("eventId");

ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "event_stream_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_delivery_attempts"
  ADD CONSTRAINT "event_stream_delivery_attempts_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "event_stream_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Once outcome leaves pending, the row is immutable (audit semantics).
-- attemptNumber + identifier columns are always immutable.
CREATE OR REPLACE FUNCTION event_stream_delivery_attempts_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- Identifier columns immutable.
  IF NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.subscriptionId is immutable (attempt %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.eventId is immutable (attempt %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.attemptNumber is immutable (attempt %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Once outcome leaves pending, all audit-relevant fields freeze —
  -- including metadata (dispatcher's target-specific receipt is final
  -- after completion). Architect close-out: original draft omitted
  -- metadata; that left a mutability hole on what's effectively a
  -- per-attempt audit record. Fixed.
  IF OLD."outcome" <> 'pending' AND (
       NEW."outcome" IS DISTINCT FROM OLD."outcome"
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    OR NEW."responseCode" IS DISTINCT FROM OLD."responseCode"
    OR NEW."errorMessage" IS DISTINCT FROM OLD."errorMessage"
    OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
  ) THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts is immutable after completion (attempt %, outcome %)', OLD."id", OLD."outcome"
      USING ERRCODE = 'check_violation';
  END IF;
  -- attemptedAt set once.
  IF OLD."attemptedAt" IS NOT NULL AND NEW."attemptedAt" IS DISTINCT FROM OLD."attemptedAt" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.attemptedAt is immutable once set (attempt %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_delivery_attempts_immutable_trigger
  BEFORE UPDATE ON "event_stream_delivery_attempts"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_delivery_attempts_immutable_fn();

-- Cross-table coherence: attempt.organizationId MUST match subscription
-- AND event orgIds (multi-tenant defense; same pattern as G5).
CREATE OR REPLACE FUNCTION event_stream_delivery_attempts_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  sub_org_id TEXT;
  evt_org_id TEXT;
  sub_stream_id TEXT;
  evt_stream_id TEXT;
BEGIN
  SELECT "organizationId", "streamId" INTO sub_org_id, sub_stream_id
    FROM "event_stream_subscriptions"
    WHERE "id" = NEW."subscriptionId";
  IF sub_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.subscriptionId "%" does not resolve',
      NEW."subscriptionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF sub_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts: subscription "%" belongs to org "%" but attempt references org "%"',
      NEW."subscriptionId", sub_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId", "streamId" INTO evt_org_id, evt_stream_id
    FROM "event_stream_events"
    WHERE "id" = NEW."eventId";
  IF evt_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts.eventId "%" does not resolve',
      NEW."eventId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF evt_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts: event "%" belongs to org "%" but attempt references org "%"',
      NEW."eventId", evt_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  -- Subscription + event must share the same stream (you cannot deliver
  -- event from stream A through subscription on stream B).
  IF sub_stream_id <> evt_stream_id THEN
    RAISE EXCEPTION 'event_stream_delivery_attempts: subscription stream "%" but event stream "%" — mismatched',
      sub_stream_id, evt_stream_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- INSERT-only: subscriptionId + eventId are immutable (immutability
-- trigger blocks change), so re-checking on UPDATE is dead. Architect-
-- suggested narrowing — mirrors event_stream_events_coherence (INSERT-only).
CREATE TRIGGER event_stream_delivery_attempts_coherence_trigger
  BEFORE INSERT ON "event_stream_delivery_attempts"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_delivery_attempts_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 5. event_stream_dead_letters — exhausted deliveries (append-only)
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 dispatcher inserts one row when an (event, subscription) pair
-- exhausts maxAttempts. Operator triages via slice-2 UI; resolved/discarded
-- transitions are part of the row lifecycle.
CREATE TABLE "event_stream_dead_letters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    /** Snapshot of the final failed attempt count. */
    "finalAttemptCount" INTEGER NOT NULL,
    /** Last error message from the exhausting attempt. */
    "lastError" TEXT,
    /**
     * Triage state (DB CHECK + transition trigger):
     *   open       — needs operator triage
     *   replaying  — operator requested redelivery; dispatcher in-flight
     *   resolved   — terminal: delivered (or operator marked OK)
     *   discarded  — terminal: operator decided to skip
     */
    "triageStatus" TEXT NOT NULL DEFAULT 'open',
    /** Set on transition to replaying. */
    "replayedAt" TIMESTAMP(3),
    /** Set on transition to resolved. */
    "resolvedAt" TIMESTAMP(3),
    /** Set on transition to discarded. */
    "discardedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_stream_dead_letters_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_triage_status_check"
  CHECK ("triageStatus" IN ('open', 'replaying', 'resolved', 'discarded'));

ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_final_attempts_check"
  CHECK ("finalAttemptCount" >= 1);

ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_resolved_coherence_check"
  CHECK ("triageStatus" <> 'resolved' OR "resolvedAt" IS NOT NULL);
ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_discarded_coherence_check"
  CHECK ("triageStatus" <> 'discarded' OR "discardedAt" IS NOT NULL);
ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_replaying_coherence_check"
  CHECK ("triageStatus" <> 'replaying' OR "replayedAt" IS NOT NULL);

-- One dead-letter row per (subscription, event) — defends idempotency
-- if dispatcher retries the escalation insert.
CREATE UNIQUE INDEX "event_stream_dead_letters_sub_event_uniq"
  ON "event_stream_dead_letters"("subscriptionId", "eventId");

CREATE INDEX "event_stream_dead_letters_org_triage_idx"
  ON "event_stream_dead_letters"("organizationId", "triageStatus");
CREATE INDEX "event_stream_dead_letters_sub_triage_idx"
  ON "event_stream_dead_letters"("subscriptionId", "triageStatus");

ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "event_stream_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_stream_dead_letters"
  ADD CONSTRAINT "event_stream_dead_letters_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "event_stream_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Triage transitions: open ↔ replaying, replaying → resolved/discarded,
-- open → resolved/discarded (manual close). resolved + discarded terminal.
-- Identifier + finalAttemptCount + terminal-timestamps immutable.
CREATE OR REPLACE FUNCTION event_stream_dead_letters_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- Identifier columns immutable.
  IF NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId" THEN
    RAISE EXCEPTION 'event_stream_dead_letters.subscriptionId is immutable (DL %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" THEN
    RAISE EXCEPTION 'event_stream_dead_letters.eventId is immutable (DL %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."finalAttemptCount" IS DISTINCT FROM OLD."finalAttemptCount" THEN
    RAISE EXCEPTION 'event_stream_dead_letters.finalAttemptCount is immutable (DL %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Terminal timestamps set-once.
  IF OLD."resolvedAt" IS NOT NULL AND NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" THEN
    RAISE EXCEPTION 'event_stream_dead_letters.resolvedAt is immutable once set (DL %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."discardedAt" IS NOT NULL AND NEW."discardedAt" IS DISTINCT FROM OLD."discardedAt" THEN
    RAISE EXCEPTION 'event_stream_dead_letters.discardedAt is immutable once set (DL %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Triage transitions.
  IF NEW."triageStatus" IS DISTINCT FROM OLD."triageStatus" THEN
    IF OLD."triageStatus" IN ('resolved', 'discarded') THEN
      RAISE EXCEPTION 'event_stream_dead_letters triageStatus: % is terminal (DL %)', OLD."triageStatus", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."triageStatus" = 'open' AND NEW."triageStatus" NOT IN ('replaying', 'resolved', 'discarded') THEN
      RAISE EXCEPTION 'event_stream_dead_letters triageStatus: open → % is invalid (DL %)', NEW."triageStatus", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."triageStatus" = 'replaying' AND NEW."triageStatus" NOT IN ('open', 'resolved', 'discarded') THEN
      RAISE EXCEPTION 'event_stream_dead_letters triageStatus: replaying → % is invalid (DL %)', NEW."triageStatus", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_dead_letters_lifecycle_trigger
  BEFORE UPDATE ON "event_stream_dead_letters"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_dead_letters_lifecycle_fn();

-- Cross-table coherence: same orgId match as delivery_attempts + same stream.
CREATE OR REPLACE FUNCTION event_stream_dead_letters_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  sub_org_id TEXT;
  evt_org_id TEXT;
  sub_stream_id TEXT;
  evt_stream_id TEXT;
BEGIN
  SELECT "organizationId", "streamId" INTO sub_org_id, sub_stream_id
    FROM "event_stream_subscriptions"
    WHERE "id" = NEW."subscriptionId";
  IF sub_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_dead_letters.subscriptionId "%" does not resolve',
      NEW."subscriptionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF sub_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_dead_letters: subscription "%" belongs to org "%" but DL references org "%"',
      NEW."subscriptionId", sub_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId", "streamId" INTO evt_org_id, evt_stream_id
    FROM "event_stream_events"
    WHERE "id" = NEW."eventId";
  IF evt_org_id IS NULL THEN
    RAISE EXCEPTION 'event_stream_dead_letters.eventId "%" does not resolve',
      NEW."eventId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF evt_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'event_stream_dead_letters: event "%" belongs to org "%" but DL references org "%"',
      NEW."eventId", evt_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF sub_stream_id <> evt_stream_id THEN
    RAISE EXCEPTION 'event_stream_dead_letters: subscription stream "%" but event stream "%" — mismatched',
      sub_stream_id, evt_stream_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- INSERT-only: subscriptionId + eventId immutable (lifecycle trigger).
CREATE TRIGGER event_stream_dead_letters_coherence_trigger
  BEFORE INSERT ON "event_stream_dead_letters"
  FOR EACH ROW
  EXECUTE FUNCTION event_stream_dead_letters_coherence_fn();
