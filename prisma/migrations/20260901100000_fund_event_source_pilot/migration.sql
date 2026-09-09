-- Finance Fund Profile-A pilot.
--
-- Existing balances are preserved exactly. Each fund receives one explicit
-- opening-baseline event equal to:
--
--   stored currentBalance - signed historical FundTransaction total
--
-- followed by one canonical event for every historical transaction. Replaying
-- that immutable stream therefore reproduces the pre-migration balance without
-- silently declaring the legacy ledger complete or overwriting production
-- money. All money columns move from float8 to NUMERIC(18,4).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  bad_type_count BIGINT;
  bad_amount_count BIGINT;
  bad_fund_amount_count BIGINT;
  bad_currency_count BIGINT;
  lossy_amount_count BIGINT;
  cross_tenant_count BIGINT;
  unreplayable_fund_count BIGINT;
BEGIN
  SELECT count(*) INTO bad_type_count
    FROM "fund_transactions"
   WHERE "type" NOT IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'auto_allocation');
  IF bad_type_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % transaction(s) have an unknown type', bad_type_count;
  END IF;

  SELECT count(*) INTO cross_tenant_count
    FROM "fund_transactions" t
    JOIN "funds" f ON f."id" = t."fundId"
   WHERE t."organizationId" <> f."organizationId";
  IF cross_tenant_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % transaction(s) reference a fund in another tenant', cross_tenant_count;
  END IF;

  SELECT count(*) INTO bad_amount_count
    FROM "fund_transactions"
   WHERE "amount" <= 0
      OR "amount" = 'NaN'::DOUBLE PRECISION
      OR "amount" = 'Infinity'::DOUBLE PRECISION
      OR "amount" = '-Infinity'::DOUBLE PRECISION;
  IF bad_amount_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % transaction(s) have non-positive or non-finite amounts', bad_amount_count;
  END IF;

  SELECT count(*) INTO bad_fund_amount_count
    FROM "funds"
   WHERE "currentBalance" < 0
      OR "currentBalance" = 'NaN'::DOUBLE PRECISION
      OR "currentBalance" = 'Infinity'::DOUBLE PRECISION
      OR "currentBalance" = '-Infinity'::DOUBLE PRECISION
      OR "targetAmount" < 0
      OR "targetAmount" = 'NaN'::DOUBLE PRECISION
      OR "targetAmount" = 'Infinity'::DOUBLE PRECISION
      OR "targetAmount" = '-Infinity'::DOUBLE PRECISION;
  IF bad_fund_amount_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % fund(s) have negative or non-finite balances/targets', bad_fund_amount_count;
  END IF;

  SELECT count(*) INTO bad_currency_count
    FROM "funds"
   WHERE "currency" !~ '^[A-Z]{3}$';
  IF bad_currency_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % fund(s) do not use an ISO 4217 currency code', bad_currency_count;
  END IF;

  -- NUMERIC(18,4) can represent at most 14 integral digits and four decimal
  -- places. Fail rather than silently round or overflow any legacy money.
  SELECT
    (SELECT count(*) FROM "fund_transactions"
      WHERE abs("amount") >= 100000000000000::DOUBLE PRECISION
         OR "amount"::NUMERIC <> round("amount"::NUMERIC, 4))
    +
    (SELECT count(*) FROM "funds"
      WHERE abs("currentBalance") >= 100000000000000::DOUBLE PRECISION
         OR "currentBalance"::NUMERIC <> round("currentBalance"::NUMERIC, 4)
         OR ("targetAmount" IS NOT NULL AND (
           abs("targetAmount") >= 100000000000000::DOUBLE PRECISION
           OR "targetAmount"::NUMERIC <> round("targetAmount"::NUMERIC, 4)
         )))
    INTO lossy_amount_count;
  IF lossy_amount_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % money row(s) cannot be represented exactly as NUMERIC(18,4)', lossy_amount_count;
  END IF;

  -- A final-balance equality check is insufficient: a negative opening
  -- baseline, or a negative historical prefix that later deposits hide, would
  -- produce an event stream that the non-negative Fund reducer cannot replay.
  -- Prove every intermediate balance before creating any canonical evidence.
  WITH signed_transactions AS (
    SELECT t."fundId" AS fund_id,
           t."createdAt" AS created_at,
           t."id" AS transaction_id,
           CASE WHEN t."type" IN ('deposit', 'transfer_in', 'auto_allocation')
                THEN round(t."amount"::NUMERIC, 4)
                ELSE -round(t."amount"::NUMERIC, 4)
           END AS signed_delta
      FROM "fund_transactions" t
  ), baselines AS (
    SELECT f."id" AS fund_id,
           round(f."currentBalance"::NUMERIC, 4)
             - COALESCE(sum(s.signed_delta), 0::NUMERIC) AS opening_balance
      FROM "funds" f
      LEFT JOIN signed_transactions s ON s.fund_id = f."id"
     GROUP BY f."id", f."currentBalance"
  ), replay_prefixes AS (
    SELECT s.fund_id,
           b.opening_balance
             + sum(s.signed_delta) OVER (
                 PARTITION BY s.fund_id
                 ORDER BY s.created_at, s.transaction_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS replay_balance
      FROM signed_transactions s
      JOIN baselines b ON b.fund_id = s.fund_id
  )
  SELECT count(*) INTO unreplayable_fund_count
    FROM baselines b
   WHERE b.opening_balance < 0
      OR b.opening_balance >= 100000000000000::NUMERIC
      OR EXISTS (
        SELECT 1 FROM replay_prefixes p
         WHERE p.fund_id = b.fund_id
           AND (p.replay_balance < 0 OR p.replay_balance >= 100000000000000::NUMERIC)
      );
  IF unreplayable_fund_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % fund stream(s) have an opening or historical replay prefix outside NUMERIC(18,4)', unreplayable_fund_count;
  END IF;
END $$;

ALTER TABLE "funds"
  ALTER COLUMN "targetAmount" TYPE NUMERIC(18,4)
    USING CASE WHEN "targetAmount" IS NULL THEN NULL ELSE round("targetAmount"::NUMERIC, 4) END,
  ALTER COLUMN "currentBalance" TYPE NUMERIC(18,4)
    USING round("currentBalance"::NUMERIC, 4),
  ALTER COLUMN "currentBalance" SET DEFAULT 0;

ALTER TABLE "fund_transactions"
  ALTER COLUMN "amount" TYPE NUMERIC(18,4)
    USING round("amount"::NUMERIC, 4);

CREATE UNIQUE INDEX "funds_org_id_key" ON "funds"("organizationId", "id");
ALTER TABLE "fund_transactions" DROP CONSTRAINT "fund_transactions_fundId_fkey";
ALTER TABLE "fund_transactions" ADD CONSTRAINT "fund_transactions_organizationId_fundId_fkey"
  FOREIGN KEY ("organizationId", "fundId") REFERENCES "funds"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funds"
  ADD CONSTRAINT "funds_target_amount_nonnegative" CHECK ("targetAmount" IS NULL OR "targetAmount" >= 0),
  ADD CONSTRAINT "funds_current_balance_nonnegative" CHECK ("currentBalance" >= 0),
  ADD CONSTRAINT "funds_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "fund_transactions"
  ADD CONSTRAINT "fund_transactions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "fund_transactions_type" CHECK ("type" IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'auto_allocation'));

-- Legacy application roles historically owned these relations and could
-- disable their safety triggers. Transfer ownership to the non-runtime
-- migration role while restoring only the DML privileges the rollback artifact
-- needs during the compatibility window.
DO $$
DECLARE
  legacy_app_owner TEXT;
BEGIN
  SELECT tableowner INTO legacy_app_owner
    FROM pg_tables WHERE schemaname = 'public' AND tablename = 'funds';
  -- The relation owner changes below, so preserve the discovered runtime role
  -- for grants on the projection table created later in this transaction.
  PERFORM set_config(
    'app.event_platform_legacy_fund_owner',
    COALESCE(legacy_app_owner, ''),
    true
  );
  IF legacy_app_owner IS NOT NULL AND legacy_app_owner <> current_user THEN
    EXECUTE format('ALTER TABLE public.funds OWNER TO %I', current_user);
    EXECUTE format('ALTER TABLE public.fund_transactions OWNER TO %I', current_user);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.funds TO %I', legacy_app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.fund_transactions TO %I', legacy_app_owner);
  END IF;
END $$;

CREATE TABLE "fund_balance_projections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "buildKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'shadow',
  "balance" NUMERIC(18,4) NOT NULL,
  "currency" TEXT NOT NULL,
  "aggregateVersion" BIGINT NOT NULL,
  "lastEventId" UUID,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "promotedAt" TIMESTAMP(3),
  CONSTRAINT "fund_balance_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_balance_projections_version_positive" CHECK ("projectionVersion" > 0),
  CONSTRAINT "fund_balance_projections_aggregate_version_nonnegative" CHECK ("aggregateVersion" >= 0),
  CONSTRAINT "fund_balance_projections_balance_nonnegative" CHECK ("balance" >= 0),
  CONSTRAINT "fund_balance_projections_status" CHECK ("status" IN ('shadow', 'active', 'retired', 'failed')),
  CONSTRAINT "fund_balance_projections_promotion" CHECK (
    ("status" <> 'active' OR "promotedAt" IS NOT NULL)
    AND ("status" NOT IN ('shadow', 'failed') OR "promotedAt" IS NULL)
  )
);

ALTER TABLE "fund_balance_projections" ADD CONSTRAINT "fund_balance_projections_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fund_balance_projections" ADD CONSTRAINT "fund_balance_projections_fundId_fkey"
  FOREIGN KEY ("organizationId", "fundId") REFERENCES "funds"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "fund_balance_projections_build_key"
  ON "fund_balance_projections"("organizationId", "fundId", "projectionVersion", "buildKey");
CREATE UNIQUE INDEX "fund_balance_projections_one_active_key"
  ON "fund_balance_projections"("organizationId", "fundId")
  WHERE "status" = 'active';
CREATE INDEX "fund_balance_projections_status_idx"
  ON "fund_balance_projections"("organizationId", "status", "fundId");

CREATE OR REPLACE FUNCTION fund_balance_projections_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  fund_org TEXT;
  fund_currency TEXT;
BEGIN
  SELECT "organizationId", "currency" INTO fund_org, fund_currency
    FROM public."funds" WHERE "id" = NEW."fundId";
  IF fund_org IS NULL OR fund_org <> NEW."organizationId" THEN
    RAISE EXCEPTION 'fund balance projection tenant/fund mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF fund_currency <> NEW."currency" THEN
    RAISE EXCEPTION 'fund balance projection currency mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fund_balance_projections_coherence_trigger
  BEFORE INSERT OR UPDATE ON "fund_balance_projections"
  FOR EACH ROW EXECUTE FUNCTION fund_balance_projections_coherence_fn();

ALTER TABLE "fund_balance_projections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fund_balance_projections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fund_balance_projections"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

REVOKE ALL ON TABLE "fund_balance_projections" FROM PUBLIC;
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  app_owner := NULLIF(
    current_setting('app.event_platform_legacy_fund_owner', true),
    ''
  );
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    REVOKE ALL ON TABLE "fund_balance_projections" FROM PUBLIC;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON TABLE fund_balance_projections TO %I',
      app_owner
    );
  END IF;
END $$;

-- Enforce and accelerate the ledger/event identity used by reconciliation.
-- PostgreSQL/Prisma cannot express this partial JSON expression as a model
-- attribute, so it remains an explicit migration invariant.
CREATE UNIQUE INDEX "domain_events_fund_transaction_identity_key"
  ON "domain_events"("organizationId", (("data" ->> 'transactionId')))
  WHERE "eventType" = 'finance.fund-transaction-recorded.v1';

-- One opening baseline per legacy fund. It records both the stored projection
-- and signed legacy total as evidence; no balance row is rewritten.
WITH legacy_totals AS (
  SELECT f."id" AS fund_id,
         f."organizationId" AS organization_id,
         f."currency",
         f."currentBalance" AS stored_balance,
         f."createdAt" AS occurred_at,
         count(t."id")::BIGINT AS transaction_count,
         COALESCE(sum(
           CASE WHEN t."type" IN ('deposit', 'transfer_in', 'auto_allocation')
                THEN t."amount" ELSE -t."amount" END
         ), 0::NUMERIC)::NUMERIC(18,4) AS signed_total
    FROM "funds" f
    LEFT JOIN "fund_transactions" t ON t."fundId" = f."id"
   GROUP BY f."id", f."organizationId", f."currency", f."currentBalance", f."createdAt"
)
INSERT INTO "domain_events" (
  "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
  "eventType", "eventVersion", "source", "dataSchema", "classification",
  "subjectRef", "correlationId", "commandId", "producer", "producerVersion",
  "data", "occurredAt"
)
SELECT organization_id,
       'fund',
       fund_id,
       1,
       'finance.fund-opened.v1',
       1,
       'urn:leaddrive:finance',
       'urn:leaddrive:schema:finance.fund-opened:v1',
       'confidential',
       'fund/' || fund_id,
       'bootstrap-' || fund_id,
       'legacy-bootstrap-fund-' || fund_id,
       'finance-migration',
       '20260901100000',
       jsonb_build_object(
         'fundId', fund_id,
         'currency', currency,
         'openingBalance', (stored_balance - signed_total)::TEXT,
         'storedBalance', stored_balance::TEXT,
         'signedLegacyTransactionTotal', signed_total::TEXT,
         'legacyTransactionCount', transaction_count,
         'legacyBootstrap', true
       ),
       occurred_at
  FROM legacy_totals;

WITH ordered_transactions AS (
  SELECT t.*,
         f."currency",
         row_number() OVER (PARTITION BY t."fundId" ORDER BY t."createdAt", t."id") + 1 AS aggregate_version
    FROM "fund_transactions" t
    JOIN "funds" f ON f."id" = t."fundId"
)
INSERT INTO "domain_events" (
  "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
  "eventType", "eventVersion", "source", "dataSchema", "classification",
  "subjectRef", "correlationId", "commandId", "producer", "producerVersion",
  "data", "occurredAt"
)
SELECT "organizationId",
       'fund',
       "fundId",
       aggregate_version,
       'finance.fund-transaction-recorded.v1',
       1,
       'urn:leaddrive:finance',
       'urn:leaddrive:schema:finance.fund-transaction-recorded:v1',
       'confidential',
       'fund/' || "fundId",
       'bootstrap-' || "fundId",
       'legacy-bootstrap-fund-transaction-' || "id",
       'finance-migration',
       '20260901100000',
       jsonb_strip_nulls(jsonb_build_object(
         'fundId', "fundId",
         'transactionId', "id",
         'transactionType', "type",
         'amount', "amount"::TEXT,
         'signedDelta', (CASE WHEN "type" IN ('deposit', 'transfer_in', 'auto_allocation') THEN "amount" ELSE -"amount" END)::TEXT,
         'currency', "currency",
         'relatedType', "relatedType",
         'relatedId', "relatedId",
         'legacyBootstrap', true
       )),
       "createdAt"
  FROM ordered_transactions;

WITH stream_state AS (
  SELECT e."organizationId",
         e."aggregateId",
         count(*)::BIGINT AS event_count,
         max(e."aggregateVersion") AS last_version
    FROM "domain_events" e
   WHERE e."aggregateType" = 'fund'
   GROUP BY e."organizationId", e."aggregateId"
)
INSERT INTO "event_aggregate_heads" (
  "organizationId", "aggregateType", "aggregateId", "currentVersion",
  "lastEventId", "lastEventAt", "updatedAt"
)
SELECT f."organizationId",
       'fund',
       f."id",
       stream_state.event_count,
       last_event."id",
       last_event."occurredAt",
       CURRENT_TIMESTAMP
  FROM "funds" f
  JOIN stream_state
    ON stream_state."organizationId" = f."organizationId"
   AND stream_state."aggregateId" = f."id"
  JOIN "domain_events" last_event
    ON last_event."organizationId" = stream_state."organizationId"
   AND last_event."aggregateType" = 'fund'
   AND last_event."aggregateId" = stream_state."aggregateId"
   AND last_event."aggregateVersion" = stream_state.last_version;

INSERT INTO "event_outbox" (
  "organizationId", "eventId", "eventType", "topic", "partitionKey", "envelope"
)
SELECT e."organizationId",
       e."id",
       e."eventType",
       'leaddrive.domain.finance.v1',
       e."organizationId" || ':fund:' || e."aggregateId",
       jsonb_strip_nulls(jsonb_build_object(
         'specversion', '1.0',
         'id', e."id"::TEXT,
         'source', e."source",
         'type', e."eventType",
         'time', to_char(e."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'datacontenttype', 'application/json',
         'dataschema', e."dataSchema",
         'organizationid', e."organizationId",
         'aggregatetype', e."aggregateType",
         'aggregateid', e."aggregateId",
         'aggregateversion', e."aggregateVersion",
         'correlationid', e."correlationId",
         'causationid', e."causationId",
         'traceparent', e."traceparent",
         'producer', e."producer",
         'producerversion', e."producerVersion",
         'classification', e."classification",
         'subjectref', e."subjectRef",
         'data', e."data"
       ))
  FROM "domain_events" e
 WHERE e."producer" = 'finance-migration'
   AND e."producerVersion" = '20260901100000';

DO $$
DECLARE
  mismatch_count BIGINT;
BEGIN
  WITH rebuilt AS (
    SELECT e."organizationId",
           e."aggregateId" AS fund_id,
           sum(
             CASE e."eventType"
               WHEN 'finance.fund-opened.v1' THEN (e."data" ->> 'openingBalance')::NUMERIC
               WHEN 'finance.fund-transaction-recorded.v1' THEN (e."data" ->> 'signedDelta')::NUMERIC
               ELSE 0::NUMERIC
             END
           )::NUMERIC(18,4) AS balance
      FROM "domain_events" e
     WHERE e."aggregateType" = 'fund'
     GROUP BY e."organizationId", e."aggregateId"
  )
  SELECT count(*) INTO mismatch_count
    FROM "funds" f
    JOIN rebuilt r
      ON r."organizationId" = f."organizationId" AND r.fund_id = f."id"
   WHERE r.balance IS DISTINCT FROM f."currentBalance";

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'fund event bootstrap refused: % rebuilt balance(s) differ from stored projection', mismatch_count;
  END IF;
END $$;

WITH rebuilt AS (
  SELECT e."organizationId",
         e."aggregateId" AS fund_id,
         sum(
           CASE e."eventType"
             WHEN 'finance.fund-opened.v1' THEN (e."data" ->> 'openingBalance')::NUMERIC
             WHEN 'finance.fund-transaction-recorded.v1' THEN (e."data" ->> 'signedDelta')::NUMERIC
             ELSE 0::NUMERIC
           END
         )::NUMERIC(18,4) AS balance
    FROM "domain_events" e
   WHERE e."aggregateType" = 'fund'
   GROUP BY e."organizationId", e."aggregateId"
)
INSERT INTO "fund_balance_projections" (
  "organizationId", "fundId", "projectionVersion", "buildKey", "status",
  "balance", "currency", "aggregateVersion", "lastEventId", "evidence",
  "promotedAt"
)
SELECT f."organizationId",
       f."id",
       1,
       'bootstrap-20260901100000',
       'active',
       r.balance,
       f."currency",
       h."currentVersion",
       h."lastEventId",
       jsonb_build_object(
         'source', 'legacy-current-balance',
         'verifiedByMigration', '20260901100000_fund_event_source_pilot'
       ),
       CURRENT_TIMESTAMP
  FROM "funds" f
  JOIN rebuilt r
    ON r."organizationId" = f."organizationId" AND r.fund_id = f."id"
  JOIN "event_aggregate_heads" h
    ON h."organizationId" = f."organizationId"
   AND h."aggregateType" = 'fund'
   AND h."aggregateId" = f."id";

-- Expand/contract compatibility bridge.
--
-- Production applies migrations while the previous PM2 artifact is still
-- serving. That artifact writes FundTransaction first and increments Fund in a
-- second statement, with no event GUC. Rejecting it here would create a deploy
-- outage and make automatic rollback unsafe. During the rollback window the DB
-- therefore canonicalizes those legacy writes itself. The new code sets
-- app.event_source_write/app.event_projection_write and performs the richer
-- command receipt + event append path explicitly. Once the previous artifact
-- is outside the rollback window, a later contract migration may replace this
-- bridge with reject-only guards.
CREATE OR REPLACE FUNCTION fund_append_compat_event(
  p_organization_id TEXT,
  p_fund_id TEXT,
  p_event_type TEXT,
  p_data_schema TEXT,
  p_data JSONB,
  p_occurred_at TIMESTAMP
)
RETURNS TABLE(event_id UUID, aggregate_version BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_event_id UUID := public.gen_random_uuid();
  next_version BIGINT;
  correlation_id TEXT;
  event_envelope JSONB;
  normalized_occurred_at TIMESTAMP(3) := p_occurred_at;
BEGIN
  IF pg_trigger_depth() < 1 THEN
    RAISE EXCEPTION 'fund compatibility append is trigger-only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.event_aggregate_heads (
    "organizationId", "aggregateType", "aggregateId", "currentVersion",
    "lastEventId", "lastEventAt", "createdAt", "updatedAt"
  ) VALUES (
    p_organization_id, 'fund', p_fund_id, 1,
    next_event_id, normalized_occurred_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("organizationId", "aggregateType", "aggregateId") DO UPDATE
    SET "currentVersion" = public.event_aggregate_heads."currentVersion" + 1,
        "lastEventId" = EXCLUDED."lastEventId",
        "lastEventAt" = EXCLUDED."lastEventAt",
        "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "currentVersion" INTO next_version;

  correlation_id := 'legacy-compat-' || next_event_id::TEXT;

  INSERT INTO public.domain_events (
    "id", "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
    "eventType", "eventVersion", "source", "dataSchema", "classification",
    "subjectRef", "correlationId", "commandId", "producer", "producerVersion",
    "data", "occurredAt"
  ) VALUES (
    next_event_id, p_organization_id, 'fund', p_fund_id, next_version,
    p_event_type, 1, 'urn:leaddrive:finance', p_data_schema, 'confidential',
    'fund/' || p_fund_id, correlation_id, correlation_id,
    'finance-db-compat', '20260901100000-compat', p_data, normalized_occurred_at
  );

  event_envelope := jsonb_strip_nulls(jsonb_build_object(
    'specversion', '1.0',
    'id', next_event_id::TEXT,
    'source', 'urn:leaddrive:finance',
    'type', p_event_type,
    'time', to_char(normalized_occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'datacontenttype', 'application/json',
    'dataschema', p_data_schema,
    'organizationid', p_organization_id,
    'aggregatetype', 'fund',
    'aggregateid', p_fund_id,
    'aggregateversion', next_version,
    'correlationid', correlation_id,
    'producer', 'finance-db-compat',
    'producerversion', '20260901100000-compat',
    'classification', 'confidential',
    'subjectref', 'fund/' || p_fund_id,
    'data', p_data
  ));

  INSERT INTO public.event_outbox (
    "organizationId", "eventId", "eventType", "topic", "partitionKey", "envelope"
  ) VALUES (
    p_organization_id, next_event_id, p_event_type,
    'leaddrive.domain.finance.v1', p_organization_id || ':fund:' || p_fund_id,
    event_envelope
  );

  RETURN QUERY SELECT next_event_id, next_version;
END;
$$;

CREATE OR REPLACE FUNCTION funds_compat_insert_event_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  appended RECORD;
  event_data JSONB;
BEGIN
  IF COALESCE(current_setting('app.event_source_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  event_data := jsonb_strip_nulls(jsonb_build_object(
    'fundId', NEW."id",
    'currency', NEW."currency",
    'openingBalance', NEW."currentBalance"::TEXT,
    'targetAmount', CASE WHEN NEW."targetAmount" IS NULL THEN NULL ELSE NEW."targetAmount"::TEXT END,
    'name', NEW."name",
    'description', NEW."description",
    'color', NEW."color",
    'isActive', NEW."isActive",
    'legacyCompatibilityWrite', true
  ));
  SELECT * INTO appended FROM public.fund_append_compat_event(
    NEW."organizationId", NEW."id", 'finance.fund-opened.v1',
    'urn:leaddrive:schema:finance.fund-opened:v1', event_data, NEW."createdAt"
  );

  INSERT INTO public.fund_balance_projections (
    "organizationId", "fundId", "projectionVersion", "buildKey", "status",
    "balance", "currency", "aggregateVersion", "lastEventId", "evidence",
    "promotedAt"
  ) VALUES (
    NEW."organizationId", NEW."id", 1, 'compat-live-' || NEW."id", 'active',
    NEW."currentBalance", NEW."currency", appended.aggregate_version,
    appended.event_id,
    jsonb_build_object('source', 'legacy-compat-trigger', 'eventId', appended.event_id),
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION funds_compat_balance_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  projected_balance NUMERIC(18,4);
BEGIN
  IF NEW."currentBalance" IS NOT DISTINCT FROM OLD."currentBalance"
     OR COALESCE(current_setting('app.event_projection_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT "balance" INTO projected_balance
    FROM public.fund_balance_projections
   WHERE "organizationId" = OLD."organizationId"
     AND "fundId" = OLD."id"
     AND "projectionVersion" = 1
     AND "status" = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fund balance projection missing for compatibility write'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The pinned atomic expand route inserts the ledger row first and then
  -- increments Fund inside the same interactive transaction. The INSERT
  -- trigger has already advanced the exact projection, so snap that required
  -- second statement to the projection. The deferred coherence triggers reject
  -- an INSERT that tries to commit without this balance statement.
  NEW."currentBalance" := projected_balance;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION funds_compat_metadata_event_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed_fields TEXT[] := ARRAY[]::TEXT[];
  event_type TEXT := 'finance.fund-metadata-updated.v1';
  data_schema TEXT := 'urn:leaddrive:schema:finance.fund-metadata-updated:v1';
  event_data JSONB;
  appended RECORD;
  updated_count INTEGER;
BEGIN
  -- Currency is part of every historical money fact and cannot be converted
  -- by relabeling the aggregate/projection in place. This check intentionally
  -- precedes the new-writer GUC so application code cannot opt around it.
  IF NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    RAISE EXCEPTION 'fund currency is immutable after creation'
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(current_setting('app.event_source_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW."name" IS DISTINCT FROM OLD."name" THEN changed_fields := array_append(changed_fields, 'name'); END IF;
  IF NEW."description" IS DISTINCT FROM OLD."description" THEN changed_fields := array_append(changed_fields, 'description'); END IF;
  IF NEW."targetAmount" IS DISTINCT FROM OLD."targetAmount" THEN changed_fields := array_append(changed_fields, 'targetAmount'); END IF;
  IF NEW."color" IS DISTINCT FROM OLD."color" THEN changed_fields := array_append(changed_fields, 'color'); END IF;
  IF NEW."isActive" IS DISTINCT FROM OLD."isActive" THEN changed_fields := array_append(changed_fields, 'isActive'); END IF;
  IF cardinality(changed_fields) = 0 THEN RETURN NEW; END IF;

  IF OLD."isActive" AND NOT NEW."isActive" THEN
    event_type := 'finance.fund-archived.v1';
    data_schema := 'urn:leaddrive:schema:finance.fund-archived:v1';
  ELSIF NOT OLD."isActive" AND NEW."isActive" THEN
    event_type := 'finance.fund-reactivated.v1';
    data_schema := 'urn:leaddrive:schema:finance.fund-reactivated:v1';
  END IF;

  event_data := jsonb_strip_nulls(jsonb_build_object(
    'fundId', NEW."id",
    'changedFields', to_jsonb(changed_fields),
    'name', NEW."name",
    'description', NEW."description",
    'targetAmount', CASE WHEN NEW."targetAmount" IS NULL THEN NULL ELSE NEW."targetAmount"::TEXT END,
    'currency', NEW."currency",
    'color', NEW."color",
    'isActive', NEW."isActive",
    'legacyCompatibilityWrite', true
  ));
  SELECT * INTO appended FROM public.fund_append_compat_event(
    NEW."organizationId", NEW."id", event_type, data_schema, event_data,
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  );

  UPDATE public.fund_balance_projections
     SET "currency" = NEW."currency",
         "aggregateVersion" = appended.aggregate_version,
         "lastEventId" = appended.event_id,
         "evidence" = jsonb_build_object('source', 'legacy-compat-trigger', 'eventId', appended.event_id)
   WHERE "organizationId" = NEW."organizationId"
     AND "fundId" = NEW."id"
     AND "projectionVersion" = 1
     AND "status" = 'active';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'fund metadata compatibility projection invariant failed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION funds_compat_delete_event_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('app.event_history_purge', true), '') = 'on'
     AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE "id" = OLD."organizationId") THEN
    RETURN OLD;
  END IF;
  -- A BEFORE DELETE trigger cannot both return the deleted Prisma row and
  -- safely turn the operation into an UPDATE. Fail closed for every standalone
  -- Fund delete, including a rollback artifact: the supported command is the
  -- event-producing isActive=false archive. Whole-tenant FK cascades remain the
  -- only audited purge path above.
  RAISE EXCEPTION 'fund hard delete is forbidden; archive it instead'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION fund_transactions_event_source_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  fund_currency TEXT;
  fund_active BOOLEAN;
  projected_balance NUMERIC(18,4);
  signed_delta NUMERIC(18,4);
  resulting_balance NUMERIC(18,4);
  event_data JSONB;
  appended RECORD;
  updated_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.event_source_write', true), '') = 'on' THEN
      RETURN NEW;
    END IF;

    SELECT f."currency", f."isActive", p."balance"
      INTO fund_currency, fund_active, projected_balance
      FROM public.funds f
      JOIN public.fund_balance_projections p
        ON p."organizationId" = f."organizationId"
       AND p."fundId" = f."id"
       AND p."projectionVersion" = 1
       AND p."status" = 'active'
     WHERE f."id" = NEW."fundId"
       AND f."organizationId" = NEW."organizationId"
     FOR UPDATE OF f, p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fund transaction tenant/fund/projection mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT fund_active THEN
      RAISE EXCEPTION 'archived fund cannot accept transactions'
        USING ERRCODE = 'check_violation';
    END IF;

    signed_delta := CASE
      WHEN NEW."type" IN ('deposit', 'transfer_in', 'auto_allocation') THEN NEW."amount"
      ELSE -NEW."amount"
    END;
    resulting_balance := projected_balance + signed_delta;
    IF resulting_balance < 0 THEN
      RAISE EXCEPTION 'insufficient fund balance'
        USING ERRCODE = 'check_violation';
    END IF;

    event_data := jsonb_strip_nulls(jsonb_build_object(
      'fundId', NEW."fundId",
      'transactionId', NEW."id",
      'transactionType', NEW."type",
      'amount', NEW."amount"::TEXT,
      'signedDelta', signed_delta::TEXT,
      'resultingBalance', resulting_balance::TEXT,
      'currency', fund_currency,
      'relatedType', NEW."relatedType",
      'relatedId', NEW."relatedId",
      'legacyCompatibilityWrite', true
    ));
    SELECT * INTO appended FROM public.fund_append_compat_event(
      NEW."organizationId", NEW."fundId", 'finance.fund-transaction-recorded.v1',
      'urn:leaddrive:schema:finance.fund-transaction-recorded:v1',
      event_data, NEW."createdAt"
    );

    UPDATE public.fund_balance_projections
       SET "balance" = resulting_balance,
           "aggregateVersion" = appended.aggregate_version,
           "lastEventId" = appended.event_id,
           "evidence" = jsonb_build_object('source', 'legacy-compat-trigger', 'eventId', appended.event_id)
     WHERE "organizationId" = NEW."organizationId"
       AND "fundId" = NEW."fundId"
       AND "projectionVersion" = 1
       AND "status" = 'active';
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION 'fund transaction compatibility projection invariant failed'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Do not mutate funds here. The prerequisite release is pinned to an
    -- INSERT-first atomic route whose conditional second statement still has
    -- to observe the pre-withdrawal source balance. Updating it in this BEFORE
    -- INSERT trigger would make a valid exact/partial withdrawal fail its own
    -- currentBalance >= amount predicate. Commit-time coherence below makes
    -- omission of that second statement impossible.
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'fund_transactions is append-only; UPDATE rejected (id=%)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(current_setting('app.event_history_purge', true), '') <> 'on'
     OR pg_trigger_depth() <= 1
     OR EXISTS (SELECT 1 FROM public.organizations WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION 'fund_transactions is append-only; DELETE rejected (id=%)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER funds_compat_insert_event_trigger
  AFTER INSERT ON "funds"
  FOR EACH ROW EXECUTE FUNCTION funds_compat_insert_event_fn();
CREATE TRIGGER funds_compat_balance_trigger
  BEFORE UPDATE OF "currentBalance" ON "funds"
  FOR EACH ROW EXECUTE FUNCTION funds_compat_balance_fn();
CREATE TRIGGER funds_compat_metadata_event_trigger
  AFTER UPDATE ON "funds"
  FOR EACH ROW EXECUTE FUNCTION funds_compat_metadata_event_fn();
CREATE TRIGGER funds_compat_delete_event_trigger
  BEFORE DELETE ON "funds"
  FOR EACH ROW EXECUTE FUNCTION funds_compat_delete_event_fn();
CREATE TRIGGER fund_transactions_event_source_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON "fund_transactions"
  FOR EACH ROW EXECUTE FUNCTION fund_transactions_event_source_guard_fn();
CREATE TRIGGER fund_transactions_reject_truncate_trigger
  BEFORE TRUNCATE ON "fund_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn();

-- Commit-time proof that every material Fund mutation and every ledger INSERT
-- has a same-transaction canonical event, and that the active projection agrees
-- with both the compatibility row and aggregate head. PostgreSQL xmin is the
-- transaction identity here; it cannot be forged by an application GUC.
CREATE OR REPLACE FUNCTION fund_commit_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  fund_xid TEXT;
  event_xid TEXT;
  projection_balance NUMERIC(18,4);
  projection_currency TEXT;
  projection_version BIGINT;
  projection_event UUID;
  head_version BIGINT;
  head_event UUID;
  event_type TEXT;
  event_data JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."name" IS NOT DISTINCT FROM OLD."name"
     AND NEW."description" IS NOT DISTINCT FROM OLD."description"
     AND NEW."targetAmount" IS NOT DISTINCT FROM OLD."targetAmount"
     AND NEW."currentBalance" IS NOT DISTINCT FROM OLD."currentBalance"
     AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
     AND NEW."color" IS NOT DISTINCT FROM OLD."color"
     AND NEW."isActive" IS NOT DISTINCT FROM OLD."isActive" THEN
    RETURN NEW;
  END IF;

  SELECT f.xmin::TEXT,
         p."balance", p."currency", p."aggregateVersion", p."lastEventId",
         h."currentVersion", h."lastEventId",
         e.xmin::TEXT, e."eventType", e."data"
    INTO fund_xid, projection_balance, projection_currency, projection_version,
         projection_event, head_version, head_event, event_xid, event_type, event_data
    FROM public.funds f
    JOIN public.fund_balance_projections p
      ON p."organizationId" = f."organizationId"
     AND p."fundId" = f."id"
     AND p."status" = 'active'
    JOIN public.event_aggregate_heads h
      ON h."organizationId" = f."organizationId"
     AND h."aggregateType" = 'fund'
     AND h."aggregateId" = f."id"
    JOIN public.domain_events e
      ON e."organizationId" = h."organizationId"
     AND e."id" = h."lastEventId"
   WHERE f."organizationId" = NEW."organizationId"
     AND f."id" = NEW."id";

  IF NOT FOUND
     OR fund_xid IS DISTINCT FROM event_xid
     OR projection_balance IS DISTINCT FROM NEW."currentBalance"
     OR projection_currency IS DISTINCT FROM NEW."currency"
     OR projection_version IS DISTINCT FROM head_version
     OR projection_event IS DISTINCT FROM head_event THEN
    RAISE EXCEPTION 'fund commit lacks same-transaction event/projection coherence (id=%)', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF event_type IS DISTINCT FROM 'finance.fund-opened.v1'
       OR event_data ->> 'fundId' IS DISTINCT FROM NEW."id"
       OR event_data ->> 'currency' IS DISTINCT FROM NEW."currency"
       OR (event_data ->> 'openingBalance')::NUMERIC IS DISTINCT FROM NEW."currentBalance" THEN
      RAISE EXCEPTION 'fund opening event does not describe inserted source state (id=%)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."currentBalance" IS DISTINCT FROM OLD."currentBalance" THEN
    IF event_type IS DISTINCT FROM 'finance.fund-transaction-recorded.v1'
       OR event_data ->> 'fundId' IS DISTINCT FROM NEW."id"
       OR event_data ->> 'currency' IS DISTINCT FROM NEW."currency"
       OR (event_data ->> 'resultingBalance')::NUMERIC IS DISTINCT FROM NEW."currentBalance" THEN
      RAISE EXCEPTION 'fund balance event does not describe updated source state (id=%)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD."isActive" AND NOT NEW."isActive" THEN
    IF event_type IS DISTINCT FROM 'finance.fund-archived.v1'
       OR event_data ->> 'fundId' IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'fund archive event does not describe updated source state (id=%)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT OLD."isActive" AND NEW."isActive" THEN
    IF event_type IS DISTINCT FROM 'finance.fund-reactivated.v1'
       OR event_data ->> 'fundId' IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'fund reactivation event does not describe updated source state (id=%)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF event_type IS DISTINCT FROM 'finance.fund-metadata-updated.v1'
     OR event_data ->> 'fundId' IS DISTINCT FROM NEW."id"
     OR event_data ->> 'name' IS DISTINCT FROM NEW."name"
     OR event_data ->> 'description' IS DISTINCT FROM NEW."description"
     OR (event_data ->> 'targetAmount')::NUMERIC IS DISTINCT FROM NEW."targetAmount"
     OR event_data ->> 'currency' IS DISTINCT FROM NEW."currency"
     OR event_data ->> 'color' IS DISTINCT FROM NEW."color"
     OR (event_data ->> 'isActive')::BOOLEAN IS DISTINCT FROM NEW."isActive" THEN
    RAISE EXCEPTION 'fund metadata event does not describe updated source state (id=%)', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fund_transaction_commit_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  matching_events BIGINT;
BEGIN
  SELECT count(*) INTO matching_events
    FROM public.domain_events e
    JOIN public.fund_transactions t
      ON t."organizationId" = NEW."organizationId" AND t."id" = NEW."id"
    JOIN public.funds f
      ON f."organizationId" = t."organizationId" AND f."id" = t."fundId"
   WHERE e."organizationId" = NEW."organizationId"
     AND e."aggregateType" = 'fund'
     AND e."aggregateId" = NEW."fundId"
     AND e."eventType" = 'finance.fund-transaction-recorded.v1'
     AND e."data" ->> 'transactionId' = NEW."id"
     AND (e."data" ->> 'amount')::NUMERIC = NEW."amount"
     AND e."data" ->> 'transactionType' = NEW."type"
     AND (e."data" ->> 'signedDelta')::NUMERIC = CASE
       WHEN NEW."type" IN ('deposit', 'transfer_in', 'auto_allocation') THEN NEW."amount"
       ELSE -NEW."amount"
     END
     AND (e."data" ->> 'resultingBalance')::NUMERIC = f."currentBalance"
     AND e."data" ->> 'currency' = f."currency"
     AND e."occurredAt" IS NOT DISTINCT FROM NEW."createdAt"
     AND e.xmin::TEXT = t.xmin::TEXT;
  IF matching_events <> 1 THEN
    RAISE EXCEPTION 'fund transaction commit lacks one same-transaction canonical event (id=%)', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fund_balance_projection_commit_coherence_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  active_count BIGINT;
  coherent_count BIGINT;
BEGIN
  SELECT count(*) INTO active_count
    FROM public.fund_balance_projections p
   WHERE p."organizationId" = NEW."organizationId"
     AND p."fundId" = NEW."fundId"
     AND p."status" = 'active';

  SELECT count(*) INTO coherent_count
    FROM public.fund_balance_projections p
    JOIN public.funds f
      ON f."organizationId" = p."organizationId" AND f."id" = p."fundId"
    JOIN public.event_aggregate_heads h
      ON h."organizationId" = p."organizationId"
     AND h."aggregateType" = 'fund'
     AND h."aggregateId" = p."fundId"
   WHERE p."organizationId" = NEW."organizationId"
     AND p."fundId" = NEW."fundId"
     AND p."status" = 'active'
     AND p."balance" IS NOT DISTINCT FROM f."currentBalance"
     AND p."currency" IS NOT DISTINCT FROM f."currency"
     AND p."aggregateVersion" IS NOT DISTINCT FROM h."currentVersion"
     AND p."lastEventId" IS NOT DISTINCT FROM h."lastEventId";

  IF active_count <> 1 OR coherent_count <> 1 THEN
    RAISE EXCEPTION 'fund projection commit lacks exactly one coherent active row (fund=%)', NEW."fundId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER funds_commit_coherence_trigger
  AFTER INSERT OR UPDATE ON "funds"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fund_commit_coherence_fn();
CREATE CONSTRAINT TRIGGER fund_transactions_commit_coherence_trigger
  AFTER INSERT ON "fund_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fund_transaction_commit_coherence_fn();
CREATE CONSTRAINT TRIGGER fund_balance_projections_commit_coherence_trigger
  AFTER INSERT OR UPDATE ON "fund_balance_projections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fund_balance_projection_commit_coherence_fn();

REVOKE ALL ON FUNCTION fund_append_compat_event(TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMP) FROM PUBLIC;
REVOKE ALL ON FUNCTION funds_compat_insert_event_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION funds_compat_balance_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION funds_compat_metadata_event_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION funds_compat_delete_event_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION fund_transactions_event_source_guard_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION fund_commit_coherence_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION fund_transaction_commit_coherence_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION fund_balance_projection_commit_coherence_fn() FROM PUBLIC;

-- This row commits atomically with the Fund schema, bootstrap events and
-- projection. It deliberately does NOT claim the release is safe to activate:
-- the deploy program advances it to verified only after loading the exact
-- previous Prisma client and completing the deep stream/projection proof.
INSERT INTO "event_platform_cutover_gates" (
  "gateKey", "migrationName", "status"
) VALUES (
  'fund-event-source-v1',
  '20260901100000_fund_event_source_pilot',
  'migration_applied'
);

COMMIT;
