-- Read-only parameterized snapshot; NOT a migration/runtime entrypoint.
-- $1 tenant, $2 build UUID, $3 fund cap+1, $4 event cap+1, $5 checkpoint cap+1.
WITH b AS MATERIALIZED (
  SELECT id::text AS id,"organizationId" AS org,"projectionName" AS projection,
    "projectionVersion" AS version,"buildKey" AS key,"codeSha" AS sha,
    mode,status,"effectsFenced" AS fenced,"replayFrom" AS replay_from,"replayTo" AS replay_to
  FROM public.projection_builds WHERE "organizationId"=$1 AND id=$2::uuid
), f AS MATERIALIZED (
  SELECT id,"currentBalance"::text AS balance,currency FROM public.funds
  WHERE "organizationId"=$1 ORDER BY id LIMIT $3
), e AS MATERIALIZED (
  SELECT d."aggregateId" AS fund,d."aggregateVersion"::text AS version,d.id::text AS id,
    d."eventType" AS type,d."payloadHash" AS data_hash,o."payloadHash" AS outbox_hash,
    CASE WHEN octet_length(o.envelope::text)<=16384 THEN o.envelope ELSE NULL END AS envelope,
    coalesce(d."payloadHash"=public.event_platform_jsonb_sha256(d.data)
      AND o."eventId"=d.id AND o."payloadHash"=public.event_platform_jsonb_sha256(o.envelope)
      AND o.envelope->'data'=d.data AND o.envelope->>'id'=d.id::text
      AND o.envelope->>'type'=d."eventType" AND o.envelope->>'organizationid'=$1
      AND o.envelope->>'aggregatetype'='fund' AND o.envelope->>'aggregateid'=d."aggregateId"
      AND o.envelope->>'aggregateversion'=d."aggregateVersion"::text
      AND octet_length(o.envelope::text)<=16384,false) AS integrity
  FROM public.domain_events d LEFT JOIN public.event_outbox o
    ON o."organizationId"=d."organizationId" AND o."eventId"=d.id
  WHERE d."organizationId"=$1 AND d."aggregateType"='fund'
  ORDER BY d."aggregateId",d."aggregateVersion" LIMIT $4
), h AS MATERIALIZED (
  SELECT "aggregateId" AS fund,"currentVersion"::text AS version,"lastEventId"::text AS last_event
  FROM public.event_aggregate_heads WHERE "organizationId"=$1 AND "aggregateType"='fund'
  ORDER BY "aggregateId" LIMIT $3
), active AS MATERIALIZED (
  SELECT "fundId" AS fund,balance::text AS balance,currency,"aggregateVersion"::text AS version,
    "lastEventId"::text AS last_event
  FROM public.fund_balance_projections WHERE "organizationId"=$1 AND status='active' AND "projectionVersion"=1
  ORDER BY "fundId" LIMIT $3
), shadow AS MATERIALIZED (
  SELECT p."fundId" AS fund,p.balance::text AS balance,p.currency,p."aggregateVersion"::text AS version,
    p."lastEventId"::text AS last_event,p.status,p.evidence->>'lastEventId' AS evidence_last_event,
    p.evidence->>'lastEventAt' AS evidence_last_at
  FROM public.fund_balance_projections p JOIN b ON p."projectionVersion"=b.version AND p."buildKey"=b.key
  WHERE p."organizationId"=$1 ORDER BY p."fundId" LIMIT $3
), c AS MATERIALIZED (
  SELECT "sourceTopic" AS topic,"sourcePartition" AS partition,"sourceOffset"::text AS last_offset,
    "lastEventId"::text AS last_event FROM public.projection_checkpoints
  WHERE "organizationId"=$1 AND "buildId"=$2::uuid ORDER BY "sourceTopic","sourcePartition" LIMIT $5
), inbox AS MATERIALIZED (
  SELECT "eventId"::text AS event,"eventType" AS type,"payloadHash" AS hash,"sourceTopic" AS topic,
    "sourcePartition" AS partition,"sourceOffset"::text AS offset FROM public.consumer_inbox
  WHERE "organizationId"=$1 AND "consumerName"='fund-shadow:' || $2::text AND "consumerVersion"=1
  ORDER BY "eventId" LIMIT $4
), effects AS MATERIALIZED (
  SELECT id FROM public.effect_outbox WHERE "organizationId"=$1 AND "executionMode" IN ('shadow','replay') LIMIT 1
)
SELECT jsonb_build_object(
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'databaseSnapshot',pg_current_snapshot()::text,
  'builds',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM b),'[]'::jsonb),
  'funds',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM f),'[]'::jsonb),
  'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY fund,version::bigint) FROM e),'[]'::jsonb),
  'heads',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY fund) FROM h),'[]'::jsonb),
  'active',coalesce((SELECT jsonb_agg(to_jsonb(active) ORDER BY fund) FROM active),'[]'::jsonb),
  'shadow',coalesce((SELECT jsonb_agg(to_jsonb(shadow) ORDER BY fund) FROM shadow),'[]'::jsonb),
  'checkpoints',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY topic,partition) FROM c),'[]'::jsonb),
  'inbox',coalesce((SELECT jsonb_agg(to_jsonb(inbox) ORDER BY event) FROM inbox),'[]'::jsonb),
  'nonLiveEffectPresent',EXISTS(SELECT 1 FROM effects)
) AS snapshot;
