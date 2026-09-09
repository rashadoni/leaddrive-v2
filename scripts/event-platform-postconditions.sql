-- Production/CI postcondition for the canonical event-platform foundation and
-- the Finance Fund pilot. This file is deliberately read-only: a failed check
-- aborts application activation, but never attempts to repair evidence.

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';

DO $event_platform_postconditions$
DECLARE
  mismatch_count BIGINT;
  deep_verify BOOLEAN;
BEGIN
  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('20260901090000_event_platform_foundation'),
      ('20260901100000_fund_event_source_pilot')
    ) AS expected(migration_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public._prisma_migrations m
      WHERE m.migration_name = expected.migration_name
        AND m.finished_at IS NOT NULL
        AND m.rolled_back_at IS NULL
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % required migration(s) are not successfully applied', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public._prisma_migrations
   WHERE finished_at IS NULL AND rolled_back_at IS NULL;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: migration ledger has % unresolved migration(s)', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('event_command_receipts'),
      ('event_aggregate_heads'),
      ('domain_events'),
      ('event_outbox'),
      ('consumer_inbox'),
      ('projection_builds'),
      ('projection_checkpoints'),
      ('effect_outbox'),
      ('effect_attempts'),
      ('effect_reconciliations'),
      ('event_platform_cutover_gates'),
      ('fund_balance_projections'),
      ('funds'),
      ('fund_transactions')
    ) AS expected(relation_name)
   WHERE to_regclass('public.' || expected.relation_name) IS NULL;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % required relation(s) are missing', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('event_command_receipts'),
      ('event_aggregate_heads'),
      ('domain_events'),
      ('event_outbox'),
      ('consumer_inbox'),
      ('projection_builds'),
      ('projection_checkpoints'),
      ('effect_outbox'),
      ('effect_attempts'),
      ('effect_reconciliations'),
      ('event_platform_cutover_gates'),
      ('fund_balance_projections')
    ) AS expected(relation_name)
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = to_regclass('public.' || expected.relation_name)
   WHERE c.oid IS NULL OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % relation(s) are missing ENABLE/FORCE RLS', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('event_command_receipts'),
      ('event_aggregate_heads'),
      ('domain_events'),
      ('event_outbox'),
      ('consumer_inbox'),
      ('projection_builds'),
      ('projection_checkpoints'),
      ('effect_outbox'),
      ('effect_attempts'),
      ('effect_reconciliations'),
      ('event_platform_cutover_gates'),
      ('fund_balance_projections'),
      ('funds'),
      ('fund_transactions')
    ) AS expected(relation_name)
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = to_regclass('public.' || expected.relation_name)
   WHERE c.oid IS NULL OR c.relowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % protected relation(s) are not owned by migration role %', mismatch_count, current_user;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('event_command_receipts', 'event_platform_tenant_select'),
      ('event_command_receipts', 'event_platform_tenant_insert'),
      ('domain_events', 'event_platform_tenant_select'),
      ('domain_events', 'event_platform_tenant_insert'),
      ('event_outbox', 'event_platform_tenant_select'),
      ('event_outbox', 'event_platform_tenant_insert'),
      ('consumer_inbox', 'event_platform_tenant_select'),
      ('consumer_inbox', 'event_platform_tenant_insert'),
      ('effect_attempts', 'event_platform_tenant_select'),
      ('effect_attempts', 'event_platform_tenant_insert'),
      ('effect_reconciliations', 'event_platform_tenant_select'),
      ('effect_reconciliations', 'event_platform_tenant_insert'),
      ('event_aggregate_heads', 'tenant_isolation'),
      ('projection_builds', 'tenant_isolation'),
      ('projection_checkpoints', 'tenant_isolation'),
      ('effect_outbox', 'tenant_isolation'),
      ('fund_balance_projections', 'tenant_isolation')
    ) AS expected(table_name, policy_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = expected.table_name
        AND p.policyname = expected.policy_name
        AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%app.org_id%'
        AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) NOT LIKE '%app.rls_bypass%'
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % tenant policy/policies are missing', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('event_command_receipts', 'event_command_receipts_append_only_trigger'),
      ('event_command_receipts', 'event_command_receipts_reject_truncate_trigger'),
      ('event_aggregate_heads', 'event_aggregate_heads_commit_coherence_trigger'),
      ('domain_events', 'domain_events_set_payload_hash_trigger'),
      ('domain_events', 'domain_events_commit_coherence_trigger'),
      ('domain_events', 'domain_events_append_only_trigger'),
      ('domain_events', 'domain_events_reject_truncate_trigger'),
      ('event_outbox', 'event_outbox_set_payload_hash_trigger'),
      ('event_outbox', 'event_outbox_coherence_trigger'),
      ('event_outbox', 'event_outbox_append_only_trigger'),
      ('event_outbox', 'event_outbox_reject_truncate_trigger'),
      ('consumer_inbox', 'consumer_inbox_append_only_trigger'),
      ('consumer_inbox', 'consumer_inbox_reject_truncate_trigger'),
      ('projection_builds', 'projection_builds_state_machine_trigger'),
      ('effect_outbox', 'effect_outbox_set_payload_hash_trigger'),
      ('effect_outbox', 'effect_outbox_state_machine_trigger'),
      ('effect_outbox', 'effect_outbox_delete_guard_trigger'),
      ('effect_outbox', 'effect_outbox_reject_truncate_trigger'),
      ('effect_attempts', 'effect_attempts_coherence_trigger'),
      ('effect_attempts', 'effect_attempts_append_only_trigger'),
      ('effect_attempts', 'effect_attempts_reject_truncate_trigger'),
      ('effect_reconciliations', 'effect_reconciliations_coherence_trigger'),
      ('effect_reconciliations', 'effect_reconciliations_commit_coherence_trigger'),
      ('effect_reconciliations', 'effect_reconciliations_append_only_trigger'),
      ('effect_reconciliations', 'effect_reconciliations_reject_truncate_trigger'),
      ('event_platform_cutover_gates', 'event_platform_cutover_gates_guard_trigger'),
      ('event_platform_cutover_gates', 'event_platform_cutover_gates_reject_truncate_trigger'),
      ('fund_balance_projections', 'fund_balance_projections_coherence_trigger'),
      ('fund_balance_projections', 'fund_balance_projections_commit_coherence_trigger'),
      ('funds', 'funds_compat_insert_event_trigger'),
      ('funds', 'funds_compat_balance_trigger'),
      ('funds', 'funds_compat_metadata_event_trigger'),
      ('funds', 'funds_compat_delete_event_trigger'),
      ('funds', 'funds_commit_coherence_trigger'),
      ('fund_transactions', 'fund_transactions_event_source_guard_trigger'),
      ('fund_transactions', 'fund_transactions_reject_truncate_trigger'),
      ('fund_transactions', 'fund_transactions_commit_coherence_trigger')
    ) AS expected(table_name, trigger_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = expected.table_name
        AND t.tgname = expected.trigger_name
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A')
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % safety trigger(s) are missing or disabled', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.event_platform_cutover_gates
   WHERE "gateKey" = 'fund-event-source-v1'
     AND "migrationName" = '20260901100000_fund_event_source_pilot'
     AND "status" IN ('migration_applied', 'verified');
  IF mismatch_count <> 1 THEN
    RAISE EXCEPTION 'event-platform postcondition: Fund cutover gate is missing, duplicated or malformed';
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.event_platform_cutover_gates
   WHERE "gateKey" = 'fund-event-source-v1'
     AND NOT (
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
     );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: Fund cutover gate evidence is incomplete or malformed';
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
   WHERE c.oid = 'public.event_platform_cutover_gates'::regclass
     AND acl.grantee <> c.relowner;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: cutover-gate evidence is granted outside its migration-role owner';
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('funds', 'targetAmount'),
      ('funds', 'currentBalance'),
      ('fund_transactions', 'amount'),
      ('fund_balance_projections', 'balance')
    ) AS expected(table_name, column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = expected.table_name
        AND c.column_name = expected.column_name
        AND c.data_type = 'numeric'
        AND c.numeric_precision = 18
        AND c.numeric_scale = 4
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund money column(s) are not NUMERIC(18,4)', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('funds', 'funds_target_amount_nonnegative'),
      ('funds', 'funds_current_balance_nonnegative'),
      ('funds', 'funds_currency_iso'),
      ('fund_transactions', 'fund_transactions_amount_positive'),
      ('fund_transactions', 'fund_transactions_type'),
      ('fund_transactions', 'fund_transactions_organizationId_fundId_fkey')
    ) AS expected(table_name, constraint_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = expected.table_name
        AND con.conname = expected.constraint_name
        AND con.convalidated
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund constraint(s) are missing or unvalidated', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM (VALUES
      ('domain_events_fund_transaction_identity_key'),
      ('effect_reconciliations_attempt_key')
    ) AS expected(index_name)
   WHERE to_regclass('public.' || expected.index_name) IS NULL;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % reconciliation index(es) are missing', mismatch_count;
  END IF;

  -- Full-history hashing/rebuild is explicitly selected so an ever-growing
  -- event log cannot become a routine-deploy blocker. The caller owns the
  -- shell/statement deadline: production's first pilot activation supplies a
  -- two-hour fail-safe window, while routine deploys select structural/O(1)
  -- mode with a short deadline. CI's dedicated database always runs deep.
  deep_verify := current_database() = 'event_platform_test'
    OR COALESCE(current_setting('app.event_platform_force_deep', true), '') = 'on';

  IF deep_verify THEN

  SELECT count(*) INTO mismatch_count
    FROM public.domain_events e
    FULL JOIN public.event_outbox o
      ON o."organizationId" = e."organizationId" AND o."eventId" = e.id
   WHERE e.id IS NULL OR o.id IS NULL;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % domain event(s) have no outbox row', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.domain_events e
    JOIN public.event_outbox o
      ON o."organizationId" = e."organizationId" AND o."eventId" = e.id
   WHERE e."payloadHash" IS DISTINCT FROM public.event_platform_jsonb_sha256(e.data)
      OR o."payloadHash" IS DISTINCT FROM public.event_platform_jsonb_sha256(o.envelope)
      OR o."eventType" IS DISTINCT FROM e."eventType"
      OR o.topic IS DISTINCT FROM 'leaddrive.domain.' || split_part(e."eventType", '.', 1) || '.v1'
      OR o."partitionKey" IS DISTINCT FROM e."organizationId" || ':' || e."aggregateType" || ':' || e."aggregateId"
      OR o.envelope ->> 'specversion' IS DISTINCT FROM '1.0'
      OR o.envelope ->> 'id' IS DISTINCT FROM e.id::TEXT
      OR o.envelope ->> 'source' IS DISTINCT FROM e.source
      OR o.envelope ->> 'type' IS DISTINCT FROM e."eventType"
      OR ((o.envelope ->> 'time')::TIMESTAMPTZ AT TIME ZONE 'UTC') IS DISTINCT FROM e."occurredAt"
      OR o.envelope ->> 'datacontenttype' IS DISTINCT FROM 'application/json'
      OR o.envelope ->> 'dataschema' IS DISTINCT FROM e."dataSchema"
      OR o.envelope ->> 'organizationid' IS DISTINCT FROM e."organizationId"
      OR o.envelope ->> 'aggregatetype' IS DISTINCT FROM e."aggregateType"
      OR o.envelope ->> 'aggregateid' IS DISTINCT FROM e."aggregateId"
      OR o.envelope ->> 'aggregateversion' IS DISTINCT FROM e."aggregateVersion"::TEXT
      OR o.envelope ->> 'correlationid' IS DISTINCT FROM e."correlationId"
      OR o.envelope ->> 'causationid' IS DISTINCT FROM e."causationId"
      OR o.envelope ->> 'traceparent' IS DISTINCT FROM e.traceparent
      OR o.envelope ->> 'producer' IS DISTINCT FROM e.producer
      OR o.envelope ->> 'producerversion' IS DISTINCT FROM e."producerVersion"
      OR o.envelope ->> 'classification' IS DISTINCT FROM e.classification
      OR o.envelope ->> 'subjectref' IS DISTINCT FROM e."subjectRef"
      OR o.envelope -> 'data' IS DISTINCT FROM e.data;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % event/outbox envelope(s) are incoherent', mismatch_count;
  END IF;

  WITH stream_state AS (
    SELECT e."organizationId",
           e."aggregateType",
           e."aggregateId",
           count(*)::BIGINT AS event_count,
           min(e."aggregateVersion") AS first_version,
           max(e."aggregateVersion") AS last_version
      FROM public.domain_events e
     GROUP BY e."organizationId", e."aggregateType", e."aggregateId"
  )
  SELECT count(*) INTO mismatch_count
    FROM public.event_aggregate_heads h
    FULL JOIN stream_state s
      ON s."organizationId" = h."organizationId"
     AND s."aggregateType" = h."aggregateType"
     AND s."aggregateId" = h."aggregateId"
    LEFT JOIN public.domain_events last_event
      ON last_event."organizationId" = s."organizationId"
     AND last_event."aggregateType" = s."aggregateType"
     AND last_event."aggregateId" = s."aggregateId"
     AND last_event."aggregateVersion" = s.last_version
   WHERE h.id IS NULL
      OR h."currentVersion" IS DISTINCT FROM COALESCE(s.event_count, 0)
      OR (s.event_count IS NOT NULL AND (
        s.first_version <> 1
        OR s.last_version <> s.event_count
        OR h."lastEventId" IS DISTINCT FROM last_event.id
        OR h."lastEventAt" IS DISTINCT FROM last_event."occurredAt"
      ))
      OR (s.event_count IS NULL AND (h."lastEventId" IS NOT NULL OR h."lastEventAt" IS NOT NULL));
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % aggregate stream/head(s) contain a gap or pointer mismatch', mismatch_count;
  END IF;

  WITH rebuilt_funds AS (
    SELECT e."organizationId",
           e."aggregateId" AS fund_id,
           sum(CASE e."eventType"
             WHEN 'finance.fund-opened.v1' THEN (e.data ->> 'openingBalance')::NUMERIC
             WHEN 'finance.fund-transaction-recorded.v1' THEN (e.data ->> 'signedDelta')::NUMERIC
             ELSE 0::NUMERIC
           END)::NUMERIC(18,4) AS balance
      FROM public.domain_events e
     WHERE e."aggregateType" = 'fund'
     GROUP BY e."organizationId", e."aggregateId"
  )
  SELECT count(*) INTO mismatch_count
    FROM public.funds f
    FULL JOIN rebuilt_funds r
      ON r."organizationId" = f."organizationId" AND r.fund_id = f.id
    LEFT JOIN public.event_aggregate_heads h
      ON h."organizationId" = COALESCE(f."organizationId", r."organizationId")
     AND h."aggregateType" = 'fund'
     AND h."aggregateId" = COALESCE(f.id, r.fund_id)
    LEFT JOIN public.fund_balance_projections p
      ON p."organizationId" = f."organizationId"
     AND p."fundId" = f.id
     AND p.status = 'active'
   WHERE f.id IS NULL
      OR r.fund_id IS NULL
      OR h.id IS NULL
      OR p.id IS NULL
      OR f."currentBalance" IS DISTINCT FROM r.balance
      OR p.balance IS DISTINCT FROM r.balance
      OR p.currency IS DISTINCT FROM f.currency
      OR p."aggregateVersion" IS DISTINCT FROM h."currentVersion"
      OR p."lastEventId" IS DISTINCT FROM h."lastEventId";
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund source/projection(s) do not rebuild exactly', mismatch_count;
  END IF;

  WITH replay AS (
    SELECT e."organizationId",
           e."aggregateId",
           e."aggregateVersion",
           e."eventType",
           sum(CASE e."eventType"
             WHEN 'finance.fund-opened.v1' THEN (e.data ->> 'openingBalance')::NUMERIC
             WHEN 'finance.fund-transaction-recorded.v1' THEN (e.data ->> 'signedDelta')::NUMERIC
             ELSE 0::NUMERIC
           END) OVER (
             PARTITION BY e."organizationId", e."aggregateId"
             ORDER BY e."aggregateVersion"
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS running_balance,
           count(*) FILTER (WHERE e."eventType" = 'finance.fund-opened.v1') OVER (
             PARTITION BY e."organizationId", e."aggregateId"
           ) AS opening_count
      FROM public.domain_events e
     WHERE e."aggregateType" = 'fund'
  )
  SELECT count(DISTINCT (r."organizationId", r."aggregateId")) INTO mismatch_count
    FROM replay r
   WHERE r.running_balance < 0
      OR r.running_balance >= 100000000000000::NUMERIC
      OR r.opening_count <> 1
      OR (r."aggregateVersion" = 1 AND r."eventType" <> 'finance.fund-opened.v1');
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund stream(s) are not replayable within NUMERIC(18,4) from one opening event', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.fund_transactions t
    JOIN public.funds f
      ON f."organizationId" = t."organizationId" AND f.id = t."fundId"
    LEFT JOIN public.domain_events e
      ON e."organizationId" = t."organizationId"
     AND e."eventType" = 'finance.fund-transaction-recorded.v1'
     AND e.data ->> 'transactionId' = t.id
   WHERE e.id IS NULL
      OR e."aggregateType" <> 'fund'
      OR e."aggregateId" <> t."fundId"
      OR e.data ->> 'fundId' <> t."fundId"
      OR e.data ->> 'transactionType' <> t.type
      OR (e.data ->> 'amount')::NUMERIC <> t.amount
      OR (e.data ->> 'signedDelta')::NUMERIC <> CASE
          WHEN t.type IN ('deposit', 'transfer_in', 'auto_allocation') THEN t.amount
          ELSE -t.amount
        END
      OR e.data ->> 'currency' <> f.currency
      OR e."occurredAt" IS DISTINCT FROM t."createdAt";
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund transaction(s) lack exactly one canonical event', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.domain_events e
    LEFT JOIN public.fund_transactions t
      ON t."organizationId" = e."organizationId"
     AND t.id = e.data ->> 'transactionId'
   WHERE e."eventType" = 'finance.fund-transaction-recorded.v1'
     AND t.id IS NULL;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % Fund transaction event(s) have no ledger row', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
    FROM public.event_command_receipts r
    CROSS JOIN LATERAL unnest(r."eventIds") AS receipt_event(event_id)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.domain_events e
      WHERE e."organizationId" = r."organizationId"
        AND e.id::TEXT = receipt_event.event_id
   );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'event-platform postcondition: % command receipt event reference(s) are missing or cross-tenant', mismatch_count;
  END IF;
  END IF;
END
$event_platform_postconditions$;

COMMIT;

SELECT 'event-platform postconditions: PASS';
