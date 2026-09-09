-- Deterministic social-discovery auto-review apply ledger.
--
-- The first production mode is intentionally REJECT_ONLY. Apply creates
-- SUPPRESSED decision tombstones without mutating ingest_envelopes; rollback
-- remains possible until rollbackUntil. A separate zero-provider finalizer
-- may later make the irreversible envelope change and mark rows FINALIZED.

SELECT set_config('app.rls_bypass', 'on', false);

-- A short, recoverable lease serializes a manual REVIEW accept/reject against
-- automatic suppression before mention persistence or workflows can begin.
ALTER TABLE "ingest_envelopes"
  ADD COLUMN "reviewMutationKey" TEXT,
  ADD COLUMN "reviewMutationUntil" TIMESTAMP(3),
  ADD CONSTRAINT "ingest_envelopes_review_mutation_pair_check"
    CHECK (
      ("reviewMutationKey" IS NULL AND "reviewMutationUntil" IS NULL)
      OR (
        length(btrim("reviewMutationKey")) > 0
        AND "reviewMutationUntil" IS NOT NULL
      )
    );

CREATE INDEX "ingest_envelopes_review_mutation_idx"
  ON "ingest_envelopes"("organizationId", "reviewMutationUntil");

-- JSON persisted in this ledger is an allowlisted audit projection, never a
-- copy of provider payload/content/author/credential material. The recursive
-- guard blocks common sensitive keys even when nested. A second guard enforces
-- exact top-level keys and scalar-only values for each ledger JSON column.
CREATE FUNCTION social_discovery_auto_review_json_is_sanitized(candidate JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  item RECORD;
  normalized_key TEXT;
BEGIN
  IF candidate IS NULL THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(candidate) = 'object' THEN
    FOR item IN SELECT key, value FROM jsonb_each(candidate)
    LOOP
      normalized_key := regexp_replace(lower(item.key), '[^a-z0-9]', '', 'g');
      IF normalized_key = ANY (ARRAY[
        'rawpayload',
        'providerpayload',
        'rawbody',
        'body',
        'text',
        'content',
        'snippet',
        'title',
        'description',
        'message',
        'comment',
        'author',
        'authorname',
        'authorhandle',
        'authoravatar',
        'url',
        'urls',
        'link',
        'links',
        'href',
        'sourceurl',
        'observedurl',
        'externalurl',
        'profileurl',
        'posturl',
        'canonicalurl',
        'parentposturl',
        'permalink',
        'email',
        'phone',
        'password',
        'token',
        'accesstoken',
        'refreshtoken',
        'secret',
        'apikey',
        'authorization',
        'cookie',
        'cookies',
        'headers'
      ]::TEXT[]) THEN
        RETURN FALSE;
      END IF;
      IF NOT social_discovery_auto_review_json_is_sanitized(item.value) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(candidate) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(candidate)
    LOOP
      IF NOT social_discovery_auto_review_json_is_sanitized(item.value) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE FUNCTION social_discovery_auto_review_json_is_allowed_scalar_object(
  candidate JSONB,
  allowed_keys TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  item RECORD;
BEGIN
  IF candidate IS NULL OR jsonb_typeof(candidate) <> 'object' THEN
    RETURN FALSE;
  END IF;

  FOR item IN SELECT key, value FROM jsonb_each(candidate)
  LOOP
    IF NOT (item.key = ANY (allowed_keys)) THEN
      RETURN FALSE;
    END IF;

    IF jsonb_typeof(item.value) NOT IN ('string', 'number', 'boolean', 'null') THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE TABLE "discovery_auto_review_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "resolverVersion" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'REJECT_ONLY',
  "state" TEXT NOT NULL DEFAULT 'APPLIED',
  "requestedBy" TEXT NOT NULL,
  "plannedGroupCount" INTEGER NOT NULL,
  "plannedRowCount" INTEGER NOT NULL,
  "appliedGroupCount" INTEGER NOT NULL DEFAULT 0,
  "appliedRowCount" INTEGER NOT NULL DEFAULT 0,
  "skippedGroupCount" INTEGER NOT NULL DEFAULT 0,
  "skippedRowCount" INTEGER NOT NULL DEFAULT 0,
  "rolledBackGroupCount" INTEGER NOT NULL DEFAULT 0,
  "rolledBackRowCount" INTEGER NOT NULL DEFAULT 0,
  "rollbackUntil" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "error" TEXT,
  "finalizeAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "finalizeLastAttemptAt" TIMESTAMP(3),
  "finalizeNextAttemptAt" TIMESTAMP(3),
  "finalizeLastError" TEXT,
  "retentionClass" TEXT NOT NULL DEFAULT 'AUDIT_TOMBSTONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "discovery_auto_review_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discovery_auto_review_runs_mode_check"
    CHECK ("mode" IN ('REJECT_ONLY')),
  CONSTRAINT "discovery_auto_review_runs_state_check"
    CHECK ("state" IN ('APPLIED', 'ROLLED_BACK', 'FINALIZED', 'FAILED')),
  CONSTRAINT "discovery_auto_review_runs_retention_check"
    CHECK ("retentionClass" IN ('AUDIT_TOMBSTONE')),
  CONSTRAINT "discovery_auto_review_runs_identity_check"
    CHECK (
      length(btrim("idempotencyKey")) > 0
      AND length(btrim("requestFingerprint")) > 0
      AND length(btrim("resolverVersion")) > 0
      AND length(btrim("requestedBy")) > 0
    ),
  CONSTRAINT "discovery_auto_review_runs_counts_check"
    CHECK (
      "plannedGroupCount" >= 0
      AND "plannedRowCount" >= 0
      AND "appliedGroupCount" >= 0
      AND "appliedRowCount" >= 0
      AND "skippedGroupCount" >= 0
      AND "skippedRowCount" >= 0
      AND "rolledBackGroupCount" >= 0
      AND "rolledBackRowCount" >= 0
      AND "appliedGroupCount" + "skippedGroupCount" <= "plannedGroupCount"
      AND "appliedRowCount" + "skippedRowCount" <= "plannedRowCount"
      AND "rolledBackGroupCount" <= "appliedGroupCount"
      AND "rolledBackRowCount" <= "appliedRowCount"
    ),
  CONSTRAINT "discovery_auto_review_runs_time_check"
    CHECK (
      "rollbackUntil" >= "completedAt"
      AND ("rolledBackAt" IS NULL OR "rolledBackAt" >= "completedAt")
      AND ("finalizedAt" IS NULL OR "finalizedAt" >= "rollbackUntil")
    ),
  CONSTRAINT "discovery_auto_review_runs_state_time_check"
    CHECK (
      (
        "state" = 'APPLIED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NULL
        AND "rolledBackGroupCount" = 0
        AND "rolledBackRowCount" = 0
        AND "error" IS NULL
      )
      OR (
        "state" = 'ROLLED_BACK'
        AND "rolledBackAt" IS NOT NULL
        AND "rolledBackAt" <= "rollbackUntil"
        AND "finalizedAt" IS NULL
        AND "rolledBackGroupCount" = "appliedGroupCount"
        AND "rolledBackRowCount" = "appliedRowCount"
        AND "error" IS NULL
      )
      OR (
        "state" = 'FINALIZED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NOT NULL
        AND "rolledBackGroupCount" = 0
        AND "rolledBackRowCount" = 0
        AND "error" IS NULL
      )
      OR (
        "state" = 'FAILED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NULL
        AND "rolledBackGroupCount" = 0
        AND "rolledBackRowCount" = 0
        AND "error" IS NOT NULL
      )
    ),
  CONSTRAINT "discovery_auto_review_runs_error_size_check"
    CHECK ("error" IS NULL OR length("error") <= 1000),
  CONSTRAINT "discovery_auto_review_runs_finalize_retry_check"
    CHECK (
      "finalizeAttemptCount" >= 0
      AND (
        (
          "finalizeAttemptCount" = 0
          AND "finalizeLastAttemptAt" IS NULL
          AND "finalizeNextAttemptAt" IS NULL
          AND "finalizeLastError" IS NULL
        )
        OR (
          "finalizeAttemptCount" > 0
          AND "finalizeLastAttemptAt" IS NOT NULL
          AND "finalizeNextAttemptAt" IS NOT NULL
          AND "finalizeNextAttemptAt" > "finalizeLastAttemptAt"
          AND "finalizeLastError" ~ '^review_apply_[a-z0-9_]+$'
        )
      )
    )
);

CREATE UNIQUE INDEX "discovery_auto_review_runs_org_id_key"
  ON "discovery_auto_review_runs"("organizationId", "id");
CREATE UNIQUE INDEX "discovery_auto_review_runs_org_idempotency_key"
  ON "discovery_auto_review_runs"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "discovery_auto_review_runs_active_subject_key"
  ON "discovery_auto_review_runs"("organizationId", "subjectId")
  WHERE "state" = 'APPLIED';
CREATE INDEX "discovery_auto_review_runs_subject_state_idx"
  ON "discovery_auto_review_runs"("organizationId", "subjectId", "state", "createdAt");
CREATE INDEX "discovery_auto_review_runs_rollback_idx"
  ON "discovery_auto_review_runs"("organizationId", "state", "rollbackUntil");
CREATE INDEX "discovery_auto_review_runs_due_global_idx"
  ON "discovery_auto_review_runs"(
    "finalizeAttemptCount",
    "rollbackUntil",
    "id"
  )
  WHERE "state" = 'APPLIED';

CREATE TABLE "discovery_auto_review_decisions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "resolverVersion" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'REJECT',
  "state" TEXT NOT NULL DEFAULT 'SUPPRESSED',
  "reason" TEXT NOT NULL,
  "groupKeyHmac" TEXT NOT NULL,
  "beforeStatus" TEXT NOT NULL,
  "beforeReason" TEXT,
  "beforeConfidence" DOUBLE PRECISION,
  "beforeDecidedAt" TIMESTAMP(3),
  "beforePurgeAt" TIMESTAMP(3) NOT NULL,
  "beforeContentHmac" TEXT NOT NULL,
  "beforeUpdatedAt" TIMESTAMP(3) NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "rollbackUntil" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "discovery_auto_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discovery_auto_review_decisions_action_check"
    CHECK ("action" IN ('REJECT')),
  CONSTRAINT "discovery_auto_review_decisions_state_check"
    CHECK ("state" IN ('SUPPRESSED', 'ROLLED_BACK', 'FINALIZED', 'SUPERSEDED')),
  CONSTRAINT "discovery_auto_review_decisions_identity_check"
    CHECK (
      length(btrim("resolverVersion")) > 0
      AND length(btrim("reason")) > 0
      AND length(btrim("groupKeyHmac")) > 0
      AND length(btrim("beforeContentHmac")) > 0
    ),
  CONSTRAINT "discovery_auto_review_decisions_before_check"
    CHECK (
      "beforeStatus" = 'REVIEW'
      AND (
        "beforeConfidence" IS NULL
        OR ("beforeConfidence" >= 0 AND "beforeConfidence" <= 1)
      )
    ),
  CONSTRAINT "discovery_auto_review_decisions_evidence_check"
    CHECK (
      jsonb_typeof("evidence") = 'object'
      AND octet_length("evidence"::TEXT) <= 16384
      AND social_discovery_auto_review_json_is_sanitized("evidence")
      AND social_discovery_auto_review_json_is_allowed_scalar_object(
        "evidence",
        ARRAY[
          'policyVersion',
          'reviewReason',
          'locationClassification',
          'locationHost',
          'matchedOfficialHost',
          'resolvedPublishedAt',
          'publishedAtSource',
          'freshness',
          'titleIdentityMatchCount',
          'locationIdentityMatchCount'
        ]::TEXT[]
      )
    ),
  CONSTRAINT "discovery_auto_review_decisions_time_check"
    CHECK (
      "rollbackUntil" >= "appliedAt"
      AND ("rolledBackAt" IS NULL OR "rolledBackAt" >= "appliedAt")
      AND ("finalizedAt" IS NULL OR "finalizedAt" >= "rollbackUntil")
      AND ("supersededAt" IS NULL OR "supersededAt" >= "appliedAt")
    ),
  CONSTRAINT "discovery_auto_review_decisions_state_time_check"
    CHECK (
      (
        "state" = 'SUPPRESSED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NULL
        AND "supersededAt" IS NULL
      )
      OR (
        "state" = 'ROLLED_BACK'
        AND "rolledBackAt" IS NOT NULL
        AND "rolledBackAt" <= "rollbackUntil"
        AND "finalizedAt" IS NULL
        AND "supersededAt" IS NULL
      )
      OR (
        "state" = 'FINALIZED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NOT NULL
        AND "supersededAt" IS NULL
      )
      OR (
        "state" = 'SUPERSEDED'
        AND "rolledBackAt" IS NULL
        AND "finalizedAt" IS NULL
        AND "supersededAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "discovery_auto_review_decisions_org_id_key"
  ON "discovery_auto_review_decisions"("organizationId", "id");
-- Durable tombstone: deliberately remains unique in ROLLED_BACK, FINALIZED and
-- SUPERSEDED states so one resolver version cannot act twice on an envelope.
CREATE UNIQUE INDEX "discovery_auto_review_decisions_org_envelope_resolver_key"
  ON "discovery_auto_review_decisions"("organizationId", "envelopeId", "resolverVersion");
CREATE INDEX "discovery_auto_review_decisions_run_state_idx"
  ON "discovery_auto_review_decisions"("organizationId", "runId", "state");
CREATE INDEX "discovery_auto_review_decisions_envelope_idx"
  ON "discovery_auto_review_decisions"("organizationId", "envelopeId", "createdAt");
CREATE INDEX "discovery_auto_review_decisions_rollback_idx"
  ON "discovery_auto_review_decisions"("organizationId", "state", "rollbackUntil");

CREATE TABLE "discovery_auto_review_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "discovery_auto_review_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discovery_auto_review_events_event_type_check"
    CHECK (
      "eventType" IN (
        'RUN_APPLIED',
        'RUN_ROLLED_BACK',
        'RUN_FINALIZED',
        'RUN_FAILED',
        'DECISION_SUPPRESSED',
        'DECISION_ROLLED_BACK',
        'DECISION_FINALIZED',
        'DECISION_SUPERSEDED'
      )
    ),
  CONSTRAINT "discovery_auto_review_events_actor_type_check"
    CHECK ("actorType" IN ('USER', 'WORKER', 'SYSTEM')),
  CONSTRAINT "discovery_auto_review_events_actor_check"
    CHECK ("actorType" <> 'USER' OR "actorId" IS NOT NULL),
  CONSTRAINT "discovery_auto_review_events_payload_check"
    CHECK (
      jsonb_typeof("payload") = 'object'
      AND octet_length("payload"::TEXT) <= 8192
      AND social_discovery_auto_review_json_is_sanitized("payload")
      AND social_discovery_auto_review_json_is_allowed_scalar_object(
        "payload",
        ARRAY[
          'groupCount',
          'rowCount',
          'resolverVersion',
          'mode',
          'skippedGroupCount',
          'skippedRowCount',
          'planFingerprint',
          'rollbackRequestId',
          'finalizedRowCount',
          'supersededRowCount'
        ]::TEXT[]
      )
    )
);

CREATE UNIQUE INDEX "discovery_auto_review_events_org_id_key"
  ON "discovery_auto_review_events"("organizationId", "id");
CREATE INDEX "discovery_auto_review_events_run_created_idx"
  ON "discovery_auto_review_events"("organizationId", "runId", "createdAt");
CREATE INDEX "discovery_auto_review_events_type_created_idx"
  ON "discovery_auto_review_events"("organizationId", "eventType", "createdAt");

ALTER TABLE "discovery_auto_review_runs"
  ADD CONSTRAINT "discovery_auto_review_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_runs"
  ADD CONSTRAINT "discovery_auto_review_runs_organizationId_subjectId_fkey"
  FOREIGN KEY ("organizationId", "subjectId")
  REFERENCES "monitoring_subjects"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_decisions"
  ADD CONSTRAINT "discovery_auto_review_decisions_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_decisions"
  ADD CONSTRAINT "discovery_auto_review_decisions_organizationId_runId_fkey"
  FOREIGN KEY ("organizationId", "runId")
  REFERENCES "discovery_auto_review_runs"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_decisions"
  ADD CONSTRAINT "discovery_auto_review_decisions_organizationId_envelopeId_fkey"
  FOREIGN KEY ("organizationId", "envelopeId")
  REFERENCES "ingest_envelopes"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_events"
  ADD CONSTRAINT "discovery_auto_review_events_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_events"
  ADD CONSTRAINT "discovery_auto_review_events_organizationId_runId_fkey"
  FOREIGN KEY ("organizationId", "runId")
  REFERENCES "discovery_auto_review_runs"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "discovery_auto_review_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "discovery_auto_review_runs_tenant_isolation"
  ON "discovery_auto_review_runs"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "discovery_auto_review_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "discovery_auto_review_decisions_tenant_isolation"
  ON "discovery_auto_review_decisions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "discovery_auto_review_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "discovery_auto_review_events_tenant_isolation"
  ON "discovery_auto_review_events"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Decision rows are durable tombstones. Their identity, source snapshot and
-- evidence never change; only the one-way SUPPRESSED -> terminal lifecycle is
-- mutable. Tenant deletion remains possible through the Organization FK.
CREATE FUNCTION discovery_auto_review_decisions_lifecycle_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'discovery_auto_review_decisions is a durable tombstone ledger — TRUNCATE rejected'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discovery_auto_review_decisions is a durable tombstone ledger — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  IF ROW(
    NEW."id",
    NEW."organizationId",
    NEW."runId",
    NEW."envelopeId",
    NEW."resolverVersion",
    NEW."action",
    NEW."reason",
    NEW."groupKeyHmac",
    NEW."beforeStatus",
    NEW."beforeReason",
    NEW."beforeConfidence",
    NEW."beforeDecidedAt",
    NEW."beforePurgeAt",
    NEW."beforeContentHmac",
    NEW."beforeUpdatedAt",
    NEW."evidence",
    NEW."rollbackUntil",
    NEW."appliedAt",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."organizationId",
    OLD."runId",
    OLD."envelopeId",
    OLD."resolverVersion",
    OLD."action",
    OLD."reason",
    OLD."groupKeyHmac",
    OLD."beforeStatus",
    OLD."beforeReason",
    OLD."beforeConfidence",
    OLD."beforeDecidedAt",
    OLD."beforePurgeAt",
    OLD."beforeContentHmac",
    OLD."beforeUpdatedAt",
    OLD."evidence",
    OLD."rollbackUntil",
    OLD."appliedAt",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'discovery_auto_review_decisions immutable fields cannot change (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."state" <> 'SUPPRESSED'
    OR NEW."state" NOT IN ('ROLLED_BACK', 'FINALIZED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid discovery_auto_review_decisions lifecycle transition % -> % (id=%)',
      OLD."state", NEW."state", OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER discovery_auto_review_decisions_lifecycle_trigger
  BEFORE UPDATE OR DELETE ON "discovery_auto_review_decisions"
  FOR EACH ROW
  EXECUTE FUNCTION discovery_auto_review_decisions_lifecycle_fn();

CREATE TRIGGER discovery_auto_review_decisions_no_truncate_trigger
  BEFORE TRUNCATE ON "discovery_auto_review_decisions"
  FOR EACH STATEMENT
  EXECUTE FUNCTION discovery_auto_review_decisions_lifecycle_fn();

-- Events are forensic evidence. Even a bypassed or table-owning session may
-- append new facts but cannot rewrite/delete/truncate prior event rows.
CREATE FUNCTION discovery_auto_review_events_append_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'discovery_auto_review_events is append-only — TRUNCATE rejected'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Preserve the Organization ON DELETE CASCADE contract. Direct event
  -- deletion runs at trigger depth 1 and remains forbidden; only an
  -- FK-triggered tenant cascade may remove the tenant's complete ledger.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'discovery_auto_review_events is append-only — UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discovery_auto_review_events is append-only — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER discovery_auto_review_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON "discovery_auto_review_events"
  FOR EACH ROW
  EXECUTE FUNCTION discovery_auto_review_events_append_only_fn();

CREATE TRIGGER discovery_auto_review_events_no_truncate_trigger
  BEFORE TRUNCATE ON "discovery_auto_review_events"
  FOR EACH STATEMENT
  EXECUTE FUNCTION discovery_auto_review_events_append_only_fn();

SELECT set_config('app.rls_bypass', 'off', false);
