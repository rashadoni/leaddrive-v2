-- ISOLATED COMPOSITION PROOF ONLY. Not a runtime executor or migration.
-- Owner-only verified evidence below is seeded by the test harness AFTER the
-- actual canonical reducer/snapshot gate succeeds. Real verifier provisioning,
-- physical receipts and operational installation are NOT implemented.
BEGIN;
DO $$ BEGIN IF current_user<>'ld_kafka_control_owner' THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF; END $$;
CREATE TABLE ld_kafka_operator.fund_verified_evidence (
 request_id uuid PRIMARY KEY REFERENCES ld_kafka_operator.requests(id),
 plan jsonb NOT NULL,
 raw_manifest text NOT NULL,
 material_hash text NOT NULL CHECK(material_hash ~ '^[0-9a-f]{64}$'),
 previous_build uuid NOT NULL,
 valid_until timestamptz NOT NULL,
 retained_until timestamptz NOT NULL,
 CHECK(plan->>'evidenceSha256'='sha256:'||encode(public.digest(convert_to(raw_manifest,'UTF8'),'sha256'),'hex'))
);
REVOKE ALL ON ld_kafka_operator.fund_verified_evidence FROM PUBLIC,ld_kafka_operator_admitter,ld_kafka_operator_controller,ld_kafka_operator_observer;

-- Invoker rights: a scoped read-only verifier can capture this in the SAME
-- RepeatableRead transaction as its canonical fold. Definer transition uses its
-- own separately provisioned tenant-RLS SELECT grants. Hash is not approval.
-- Fixed row caps + cap sentinel and 1MiB encoded material. Oversized inputs
-- return NULL; trusted caller must also set statement/lock/transaction timeouts.
CREATE TABLE ld_kafka_operator.fund_transition_commits (
 request_id uuid PRIMARY KEY REFERENCES ld_kafka_operator.requests(id),
 plan_hash text NOT NULL,generation bigint NOT NULL,valid_until timestamptz NOT NULL,
 retained_until timestamptz NOT NULL,action text NOT NULL
);
REVOKE ALL ON ld_kafka_operator.fund_transition_commits FROM PUBLIC,ld_kafka_operator_admitter,ld_kafka_operator_controller,ld_kafka_operator_observer;
CREATE FUNCTION ld_kafka_operator.fund_material_hash(p_org text,p_build uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
 WITH build_rows AS MATERIALIZED (SELECT b.* FROM public.projection_builds b WHERE b."organizationId"=p_org AND b.id=p_build ORDER BY b.id LIMIT 2),
 funds_rows AS MATERIALIZED (SELECT f.* FROM public.funds f WHERE f."organizationId"=p_org ORDER BY f.id LIMIT 201),
 ledger_rows AS MATERIALIZED (SELECT l.* FROM public.fund_transactions l WHERE l."organizationId"=p_org ORDER BY l.id LIMIT 1001),
 events_rows AS MATERIALIZED (SELECT e.* FROM public.domain_events e WHERE e."organizationId"=p_org ORDER BY e.id LIMIT 1001),
 outbox_rows AS MATERIALIZED (SELECT o.* FROM public.event_outbox o WHERE o."organizationId"=p_org ORDER BY o.id LIMIT 1001),
 heads_rows AS MATERIALIZED (SELECT h.* FROM public.event_aggregate_heads h WHERE h."organizationId"=p_org ORDER BY h.id LIMIT 201),
 projections_rows AS MATERIALIZED (SELECT p.* FROM public.fund_balance_projections p WHERE p."organizationId"=p_org AND (p.status='active' AND p."projectionVersion"=1 OR EXISTS(SELECT 1 FROM public.projection_builds b WHERE b."organizationId"=p_org AND b.id=p_build AND p."projectionVersion"=b."projectionVersion" AND p."buildKey"=b."buildKey")) ORDER BY p.id LIMIT 401),
 checkpoints_rows AS MATERIALIZED (SELECT c.* FROM public.projection_checkpoints c WHERE c."organizationId"=p_org AND c."buildId"=p_build ORDER BY c.id LIMIT 129),
 effects_rows AS MATERIALIZED (SELECT x.* FROM public.effect_outbox x WHERE x."organizationId"=p_org AND x."executionMode" IN ('shadow','replay') ORDER BY x.id LIMIT 1),
 inbox_rows AS MATERIALIZED (SELECT i.* FROM public.consumer_inbox i WHERE i."organizationId"=p_org AND i."consumerName"='fund-shadow:'||p_build::text AND i."consumerVersion"=1 ORDER BY i.id LIMIT 1001),
 material AS MATERIALIZED (SELECT jsonb_build_object(
 'build',(SELECT to_jsonb(r) FROM build_rows r LIMIT 1),
 'funds',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM funds_rows r),
 'ledger',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM ledger_rows r),
 'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM events_rows r),
 'outbox',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM outbox_rows r),
 'heads',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM heads_rows r),
 'projections',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM projections_rows r),
 'checkpoints',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM checkpoints_rows r),
 'effects',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM effects_rows r),
 'inbox',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM inbox_rows r))::text AS body WHERE (SELECT count(*) FROM build_rows)<=1 AND (SELECT count(*) FROM funds_rows)<=200 AND (SELECT count(*) FROM ledger_rows)<=1000 AND (SELECT count(*) FROM events_rows)<=1000 AND (SELECT count(*) FROM outbox_rows)<=1000 AND (SELECT count(*) FROM heads_rows)<=200 AND (SELECT count(*) FROM projections_rows)<=400 AND (SELECT count(*) FROM checkpoints_rows)<=128 AND (SELECT count(*) FROM effects_rows)<=0 AND (SELECT count(*) FROM inbox_rows)<=1000)
 SELECT CASE WHEN octet_length(body)<=1048576 THEN encode(public.digest(convert_to(body,'UTF8'),'sha256'),'hex') ELSE NULL END FROM material
$$;
-- PostgreSQL 16 deferred invoker guards use the COMMIT role. This policy
-- helper permits only the exact approved target/event in a live barrier tx,
-- including settlement, and exposes no source/private rows. Provisioning of
-- corresponding SELECT/row-lock column rights is isolated fixture-only below.
CREATE FUNCTION ld_kafka_operator.fund_guard_scope(p_org text,p_build uuid,p_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE token record;
BEGIN
 FOR token IN SELECT q.id,q.plan_hash,q.generation FROM ld_kafka_operator.source_barriers s
 JOIN ld_kafka_operator.requests q ON q.id=s.request_id AND q.generation=s.generation
 WHERE s.transaction_id=pg_current_xact_id_if_assigned() AND s.backend_pid=pg_backend_pid()
 AND s.organization_id=p_org AND q.organization_id=p_org AND q.controller=session_user
 AND q.plan->>'buildId'=p_build::text AND (p_key IS NULL OR p_key=q.id::text) LOOP
  PERFORM ld_kafka_operator.check_token(token.id,token.plan_hash,token.generation,true);
  RETURN true;
 END LOOP;
 RETURN false;
END $$;
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.fund_guard_scope(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.fund_guard_scope(text,uuid,text) TO ld_kafka_operator_controller;
CREATE FUNCTION ld_kafka_operator.apply_fund_transition(p_request uuid,p_hash text,p_generation bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; e ld_kafka_operator.fund_verified_evidence;
 b public.projection_builds; p public.projection_activations; changed integer; next_version bigint; guards integer;
BEGIN
 PERFORM ld_kafka_operator.assert_source_barrier(p_request,p_hash,p_generation);
 PERFORM ld_kafka_operator.assert_fund_registration(p_request,p_hash,p_generation);
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_request;
 PERFORM set_config('app.org_id',q.organization_id,true);
 IF q.plan->>'action' NOT IN ('promote','rollback') THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 -- Inbox/checkpoint/effect-intent writes additionally share the source lock in this proof.
 SELECT count(*) INTO guards FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 AND c.relname IN ('consumer_inbox','projection_checkpoints','effect_outbox') AND c.relkind='r'
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)
 AND NOT t.tgisinternal AND NOT t.tgdeferrable AND t.tgenabled='A' AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
 AND t.tgfoid='ld_kafka_operator.source_write_guard()'::regprocedure
 AND ((t.tgname='kafka_source_row_guard' AND t.tgtype=31) OR (t.tgname='kafka_source_truncate_guard' AND t.tgtype=34));
 IF guards<>6 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 SELECT * INTO e FROM ld_kafka_operator.fund_verified_evidence WHERE request_id=q.id FOR SHARE;
 IF e.request_id IS NULL OR e.plan IS DISTINCT FROM q.plan OR e.valid_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 SELECT * INTO b FROM public.projection_builds WHERE "organizationId"=q.organization_id AND id=(q.plan->>'buildId')::uuid FOR UPDATE NOWAIT;
 IF b.id IS NULL OR b."projectionName"<>q.plan->>'projectionName' OR b."codeSha"<>q.plan->>'releaseSha'
 OR b.mode<>'shadow' OR NOT b."effectsFenced" OR b."replayFrom" IS NOT NULL OR b."replayTo" IS NOT NULL
 OR (q.plan->>'action'='promote' AND b.status<>'ready')
 OR (q.plan->>'action'='rollback' AND (b.status<>'promoted' OR e.retained_until<=clock_timestamp()))
 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 SELECT * INTO p FROM public.projection_activations WHERE "organizationId"=q.organization_id AND "projectionName"=q.plan->>'projectionName' FOR UPDATE NOWAIT;
 -- Bounded composition requires an existing pointer; first activation is not
 -- silently authorized by absence. Version arithmetic must remain BIGINT.
 IF p.id IS NULL OR p."activeBuildId" IS DISTINCT FROM e.previous_build OR p."activeBuildId"=b.id
 OR p."activationVersion"::text<>q.plan->>'expectedPointerVersion' OR p."activationVersion"=9223372036854775807
 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 IF ld_kafka_operator.fund_material_hash(q.organization_id,b.id) IS DISTINCT FROM e.material_hash
 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 next_version:=p."activationVersion"+1;
 IF q.plan->>'action'='promote' THEN
 UPDATE public.projection_builds SET status='promoted',"promotedAt"=clock_timestamp() WHERE id=b.id AND "organizationId"=q.organization_id AND status='ready';
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 END IF;
 INSERT INTO public.projection_promotion_events("organizationId","projectionName","targetBuildId","previousBuildId",action,"requestKey","requestedBy","approvedBy","evidenceHash",evidence,"resultingPointerVersion")
 VALUES(q.organization_id,q.plan->>'projectionName',b.id,p."activeBuildId",q.plan->>'action',q.id::text,q.requester_principal,q.approver_principal,
 substring(q.plan->>'evidenceSha256' FROM 8),jsonb_build_object('requestId',q.id,'planHash',q.plan_hash,'generation',q.generation::text,'materialHash',e.material_hash),next_version);
 UPDATE public.projection_activations SET "activeBuildId"=b.id,"activationVersion"=next_version WHERE id=p.id AND "organizationId"=q.organization_id AND "activationVersion"=p."activationVersion" AND "activeBuildId"=p."activeBuildId";
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 INSERT INTO ld_kafka_operator.fund_transition_commits(request_id,plan_hash,generation,valid_until,retained_until,action)
 VALUES(q.id,q.plan_hash,q.generation,e.valid_until,e.retained_until,q.plan->>'action');
 PERFORM ld_kafka_operator.settle(p_request,p_hash,p_generation);
 RETURN next_version::text;
END $$;
CREATE FUNCTION ld_kafka_operator.fund_transition_commit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM ld_kafka_operator.check_token(NEW.request_id,NEW.plan_hash,NEW.generation,true);
 PERFORM ld_kafka_operator.assert_fund_registration(NEW.request_id,NEW.plan_hash,NEW.generation,true);
 IF NEW.valid_until<=clock_timestamp() OR (NEW.action='rollback' AND NEW.retained_until<=clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM ld_kafka_operator.source_barriers WHERE request_id=NEW.request_id AND generation=NEW.generation
 AND transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'FUND_TRANSITION_DENIED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER fund_transition_commit_guard AFTER INSERT ON ld_kafka_operator.fund_transition_commits
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ld_kafka_operator.fund_transition_commit_guard();
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.fund_transition_commit_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.fund_material_hash(text,uuid),ld_kafka_operator.apply_fund_transition(uuid,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.apply_fund_transition(uuid,text,bigint) TO ld_kafka_operator_controller;
COMMIT;
