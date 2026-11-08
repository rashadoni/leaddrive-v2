-- Social Monitoring keeps nothing older than 30 days (owner, 2026-11-08:
-- «чтоб не было информации больше 30и дней… бренд мониторинг интересен когда
-- новый. это как новость»). The nightly retention pass deletes the
-- auto-review ledger together with the envelopes it describes, so the two
-- ledger triggers let a DELETE through when that pass says so with its own
-- transaction-local flag (SET LOCAL app.social_monitoring_retention_purge =
-- 'on'), the same opt-in shape as app.audit_log_purge. Without the flag every
-- rule below is unchanged: TRUNCATE, UPDATE of identity fields and direct
-- DELETE stay rejected.

CREATE OR REPLACE FUNCTION discovery_auto_review_decisions_lifecycle_fn()
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
  IF TG_OP = 'DELETE' AND current_setting('app.social_monitoring_retention_purge', true) = 'on' THEN
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

CREATE OR REPLACE FUNCTION discovery_auto_review_events_append_only_fn()
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
  -- FK-triggered tenant cascade, or the 30-day retention pass under its own
  -- flag, may remove ledger rows.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.social_monitoring_retention_purge', true) = 'on' THEN
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
