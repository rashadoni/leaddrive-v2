-- INACTIVE preparation only. Apply as ld_kafka_control_owner after admission.
-- No public-table triggers installed here; separate fixture attachment required.
BEGIN;
DO $$ BEGIN IF current_user<>'ld_kafka_control_owner' THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF; END $$;
CREATE TABLE ld_kafka_operator.source_barriers (
 request_id uuid NOT NULL REFERENCES ld_kafka_operator.requests(id),
 generation bigint NOT NULL,
 transaction_id xid8 NOT NULL,
 backend_pid integer NOT NULL,
 organization_id text NOT NULL,
 acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,generation,transaction_id)
);
REVOKE ALL ON ld_kafka_operator.source_barriers FROM PUBLIC,ld_kafka_operator_admitter,ld_kafka_operator_controller,ld_kafka_operator_observer;

CREATE FUNCTION ld_kafka_operator.source_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old_org text; new_org text; org text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('funds','fund_transactions','domain_events','event_outbox','event_aggregate_heads','fund_balance_projections')
 OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'KAFKA_SOURCE_WRITE_DENIED'; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN old_org:=to_jsonb(OLD)->>'organizationId'; END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN new_org:=to_jsonb(NEW)->>'organizationId'; END IF;
 IF (TG_OP IN ('UPDATE','DELETE') AND old_org IS NULL) OR (TG_OP IN ('INSERT','UPDATE') AND new_org IS NULL)
 THEN RAISE EXCEPTION 'KAFKA_SOURCE_WRITE_DENIED'; END IF;
 -- Both old/new scopes participate; deterministic order avoids cross-tenant
 -- move lock-order surprises. Hash collisions serialize/deny, never authorize.
 FOR org IN SELECT DISTINCT x FROM unnest(ARRAY[old_org,new_org]) x WHERE x IS NOT NULL ORDER BY x LOOP
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ld-kafka-fund-source:'||org,271828))
  THEN RAISE EXCEPTION 'KAFKA_SOURCE_WRITE_DENIED'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE FUNCTION ld_kafka_operator.acquire_source_barrier(p_request uuid,p_hash text,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; profile record; tid xid8;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR current_setting('transaction_read_only')<>'off'
 THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF;
 PERFORM ld_kafka_operator.assert_current(p_request,p_hash,p_generation);
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_request;
 IF q.plan->>'action' NOT IN ('promote','rollback') THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF;
 -- Exact unfiltered ALWAYS row and TRUNCATE guards on all six ordinary,
 -- non-inherited tables. Trusted schema-owner DDL must stay frozen throughout
 -- control; no DB contract can protect against its own schema administrator.
 SELECT count(DISTINCT c.oid) AS tables,count(t.oid) AS guards,
 bool_and(c.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)) AS safe
 INTO profile FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal AND NOT t.tgdeferrable
 AND t.tgenabled='A' AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
 AND t.tgfoid='ld_kafka_operator.source_write_guard()'::regprocedure
 AND ((t.tgname='kafka_source_row_guard' AND t.tgtype=31) OR (t.tgname='kafka_source_truncate_guard' AND t.tgtype=34))
 WHERE n.nspname='public' AND c.relname IN ('funds','fund_transactions','domain_events','event_outbox','event_aggregate_heads','fund_balance_projections');
 IF profile.tables<>6 OR profile.guards<>12 OR profile.safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ld-kafka-fund-source:'||q.organization_id,271828))
 THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF;
 tid:=pg_current_xact_id();
 INSERT INTO ld_kafka_operator.source_barriers(request_id,generation,transaction_id,backend_pid,organization_id)
 VALUES(q.id,q.generation,tid,pg_backend_pid(),q.organization_id) ON CONFLICT DO NOTHING;
 INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(q.id,session_user,'source-barrier-acquired',q.generation);
 RETURN jsonb_build_object('kind','FundSourceBarrierHandle','requestId',q.id,'generation',q.generation::text,'organizationId',q.organization_id,'transactionId',tid::text);
END $$;
CREATE FUNCTION ld_kafka_operator.assert_source_barrier(p_request uuid,p_hash text,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests;
BEGIN
 PERFORM ld_kafka_operator.assert_current(p_request,p_hash,p_generation);
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_request;
 IF NOT EXISTS(SELECT 1 FROM ld_kafka_operator.source_barriers WHERE request_id=q.id AND generation=q.generation
 AND transaction_id=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND organization_id=q.organization_id)
 THEN RAISE EXCEPTION 'KAFKA_SOURCE_BARRIER_DENIED'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.source_write_guard(),ld_kafka_operator.acquire_source_barrier(uuid,text,bigint),ld_kafka_operator.assert_source_barrier(uuid,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.acquire_source_barrier(uuid,text,bigint),ld_kafka_operator.assert_source_barrier(uuid,text,bigint) TO ld_kafka_operator_controller;
COMMIT;
