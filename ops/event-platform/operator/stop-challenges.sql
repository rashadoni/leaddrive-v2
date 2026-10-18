-- INACTIVE contract addon. Disposable CI/staging only; no migration/bootstrap.
-- Apply after admission.sql as ld_kafka_control_owner. Observer role must be
-- independently provisioned. Stores authenticated claims, not process truth.
BEGIN;
DO $$ BEGIN
 IF current_user<>'ld_kafka_control_owner' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
 WHERE rolname='ld_kafka_operator_observer' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
 AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
 RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
END $$;
CREATE TABLE ld_kafka_operator.stop_challenges (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES ld_kafka_operator.requests(id),
 plan_hash text NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 worker_instance text NOT NULL,
 observer name NOT NULL REFERENCES ld_kafka_operator.identities(login_name),
 observer_principal text NOT NULL,
 controller name NOT NULL,
 controller_principal text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 receipt jsonb,
 receipt_hash text,
 consumed_at timestamptz,
 UNIQUE(request_id,generation),
 CHECK((receipt IS NULL)=(receipt_hash IS NULL)),
 CHECK(consumed_at IS NULL OR receipt IS NOT NULL)
);
REVOKE ALL ON ld_kafka_operator.stop_challenges FROM PUBLIC,ld_kafka_operator_admitter,ld_kafka_operator_controller,ld_kafka_operator_observer;

-- Read-only authentication helper; no row locks so read-back works inside a
-- genuine READ ONLY transaction. Mutations/final COMMIT recheck authority.
CREATE FUNCTION ld_kafka_operator.stop_actor(p_login name,p_org text,p_observer boolean)
RETURNS ld_kafka_operator.identities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i ld_kafka_operator.identities; r record;
BEGIN
 SELECT * INTO i FROM ld_kafka_operator.identities WHERE login_name=p_login AND organization_id=p_org;
 SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=p_login;
 IF i.login_name IS NULL OR NOT i.enabled OR i.valid_until<=clock_timestamp()
 OR r.rolname IS NULL OR NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
 OR (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil<=clock_timestamp())
 OR pg_has_role(p_login,'ld_kafka_control_owner','MEMBER') THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 IF p_observer THEN
  IF NOT pg_has_role(p_login,'ld_kafka_operator_observer','MEMBER') OR i.may_request OR i.may_approve OR i.may_consume
  OR pg_has_role(p_login,'ld_kafka_operator_admitter','MEMBER') OR pg_has_role(p_login,'ld_kafka_operator_controller','MEMBER')
  THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 ELSE
  IF NOT i.may_consume OR NOT pg_has_role(p_login,'ld_kafka_operator_controller','MEMBER') THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 END IF;
 RETURN i;
END $$;
CREATE FUNCTION ld_kafka_operator.current_stop_challenge(p_id uuid)
RETURNS ld_kafka_operator.stop_challenges LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c ld_kafka_operator.stop_challenges; q ld_kafka_operator.requests; a ld_kafka_operator.identities;
BEGIN
 SELECT * INTO c FROM ld_kafka_operator.stop_challenges WHERE id=p_id;
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=c.request_id;
 IF c.id IS NULL OR c.expires_at<=clock_timestamp() OR q.status<>'consumed' OR q.generation<>c.generation
 OR q.plan_hash<>c.plan_hash OR q.controller<>c.controller OR q.controller_principal<>c.controller_principal
 OR q.lease_until<=clock_timestamp() OR q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 a:=ld_kafka_operator.stop_actor(c.observer,q.organization_id,true);
 IF a.principal_id<>c.observer_principal THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 a:=ld_kafka_operator.stop_actor(c.controller,q.organization_id,false);
 IF a.principal_id<>c.controller_principal THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 RETURN c;
END $$;
CREATE FUNCTION ld_kafka_operator.issue_stop_challenge(p_request uuid,p_hash text,p_generation bigint,p_id uuid,p_worker text,p_observer name,p_expires timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; o ld_kafka_operator.identities; c ld_kafka_operator.stop_challenges;
BEGIN
 PERFORM ld_kafka_operator.assert_current(p_request,p_hash,p_generation);
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_request;
 o:=ld_kafka_operator.stop_actor(p_observer,q.organization_id,true);
 IF q.plan->>'action'<>'stop' OR p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
 OR p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '1 minute'
 OR p_expires>q.lease_until THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 INSERT INTO ld_kafka_operator.stop_challenges(id,request_id,plan_hash,generation,worker_instance,observer,observer_principal,controller,controller_principal,expires_at)
 VALUES(p_id,q.id,q.plan_hash,q.generation,p_worker,p_observer,o.principal_id,session_user,q.controller_principal,p_expires) RETURNING * INTO c;
 RETURN jsonb_build_object('challengeId',c.id,'receiptId',c.id,'requestId',q.id,'generation',c.generation::text,
 'workerInstanceId',c.worker_instance,'observerId',c.observer_principal,'issuedAt',c.created_at,'expiresAt',c.expires_at,'plan',q.plan);
END $$;
CREATE FUNCTION ld_kafka_operator.record_stop_receipt(p_id uuid,p_receipt jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c ld_kafka_operator.stop_challenges; q ld_kafka_operator.requests; k text; t timestamptz; previous timestamptz; p jsonb;
BEGIN
 PERFORM 1 FROM ld_kafka_operator.stop_challenges WHERE id=p_id FOR UPDATE;
 c:=ld_kafka_operator.current_stop_challenge(p_id);
 IF session_user<>c.observer OR c.receipt IS NOT NULL OR c.consumed_at IS NOT NULL
 OR p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object' OR octet_length(p_receipt::text)>65536 THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=c.request_id;
 FOREACH k IN ARRAY ARRAY['organizationId','buildId','projectionName','releaseSha','artifactSha256','environment','clusterId','topicId','groupId','expectedPointerVersion'] LOOP
 IF jsonb_typeof(p_receipt->k) IS DISTINCT FROM 'string' OR p_receipt->>k IS DISTINCT FROM q.plan->>k THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 END LOOP;
 IF p_receipt->>'apiVersion' IS DISTINCT FROM 'event-platform.leaddrive.io/v1' OR p_receipt->>'kind' IS DISTINCT FROM 'WorkerStopReceipt'
 OR p_receipt->>'receiptId' IS DISTINCT FROM c.id::text OR p_receipt->>'challengeId' IS DISTINCT FROM c.id::text
 OR p_receipt->>'requestId' IS DISTINCT FROM c.request_id::text OR p_receipt->>'generation' IS DISTINCT FROM c.generation::text
 OR jsonb_typeof(p_receipt->'generation') IS DISTINCT FROM 'string'
 OR p_receipt->>'workerInstanceId' IS DISTINCT FROM c.worker_instance OR p_receipt->>'observerId' IS DISTINCT FROM c.observer_principal
 OR p_receipt->>'termination' IS DISTINCT FROM 'closed'
 OR p_receipt->'inFlightSql' IS DISTINCT FROM '"0"'::jsonb OR p_receipt->'pendingAcks' IS DISTINCT FROM '"0"'::jsonb OR p_receipt->'activeChildren' IS DISTINCT FROM '"0"'::jsonb
 THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 previous:=c.created_at;
 FOREACH k IN ARRAY ARRAY['requestedAt','intakeStoppedAt','ackFencedAt','sqlSettledAt','checkpointObservedAt','childClosedAt','observedAt'] LOOP
 IF COALESCE(p_receipt->>k,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 t:=(p_receipt->>k)::timestamptz;
 IF t<previous OR t>clock_timestamp() OR t>=c.expires_at THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 previous:=t;
 END LOOP;
 IF jsonb_typeof(p_receipt->'partitions') IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipt->'partitions') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 IF (SELECT count(DISTINCT value->>'partition') FROM jsonb_array_elements(p_receipt->'partitions'))<>jsonb_array_length(p_receipt->'partitions') THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_receipt->'partitions') LOOP
 IF jsonb_typeof(p->'partition') IS DISTINCT FROM 'number' OR COALESCE(p->>'partition','') !~ '^(0|[1-9][0-9]{0,2})$' OR (p->>'partition')::int>=128
 OR jsonb_typeof(p->'checkpointNext') IS DISTINCT FROM 'string' OR COALESCE(p->>'checkpointNext','') !~ '^(0|[1-9][0-9]{0,18})$' OR (p->>'checkpointNext')::numeric>9223372036854775807
 THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 END LOOP;
 UPDATE ld_kafka_operator.stop_challenges SET receipt=p_receipt,receipt_hash=encode(public.digest(convert_to(p_receipt::text,'UTF8'),'sha256'),'hex') WHERE id=p_id;
 RETURN (SELECT receipt_hash FROM ld_kafka_operator.stop_challenges WHERE id=p_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED';
END $$;
CREATE FUNCTION ld_kafka_operator.read_stop_receipt(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c ld_kafka_operator.stop_challenges;
BEGIN
 c:=ld_kafka_operator.current_stop_challenge(p_id);
 IF session_user<>c.controller OR c.receipt IS NULL THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 RETURN c.receipt;
END $$;
CREATE FUNCTION ld_kafka_operator.consume_stop_challenge(p_id uuid,p_receipt_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c ld_kafka_operator.stop_challenges;
BEGIN
 PERFORM 1 FROM ld_kafka_operator.stop_challenges WHERE id=p_id FOR UPDATE;
 c:=ld_kafka_operator.current_stop_challenge(p_id);
 IF session_user<>c.controller OR c.consumed_at IS NOT NULL OR c.receipt IS NULL OR c.receipt_hash IS DISTINCT FROM p_receipt_hash THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 PERFORM ld_kafka_operator.assert_current(c.request_id,c.plan_hash,c.generation);
 PERFORM 1 FROM ld_kafka_operator.identities WHERE login_name=c.observer FOR SHARE;
 UPDATE ld_kafka_operator.stop_challenges SET consumed_at=clock_timestamp() WHERE id=p_id;
END $$;
CREATE FUNCTION ld_kafka_operator.stop_challenge_commit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; o ld_kafka_operator.identities;
BEGIN
 PERFORM ld_kafka_operator.check_token(NEW.request_id,NEW.plan_hash,NEW.generation,true);
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=NEW.request_id;
 o:=ld_kafka_operator.stop_actor(NEW.observer,q.organization_id,true);
 IF NEW.expires_at<=clock_timestamp() OR o.principal_id<>NEW.observer_principal THEN RAISE EXCEPTION 'KAFKA_STOP_CHALLENGE_DENIED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stop_challenge_commit_guard AFTER UPDATE ON ld_kafka_operator.stop_challenges
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.consumed_at IS NOT NULL) EXECUTE FUNCTION ld_kafka_operator.stop_challenge_commit_guard();
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.stop_actor(name,text,boolean),ld_kafka_operator.current_stop_challenge(uuid),
 ld_kafka_operator.issue_stop_challenge(uuid,text,bigint,uuid,text,name,timestamptz),ld_kafka_operator.record_stop_receipt(uuid,jsonb),
 ld_kafka_operator.read_stop_receipt(uuid),ld_kafka_operator.consume_stop_challenge(uuid,text),ld_kafka_operator.stop_challenge_commit_guard() FROM PUBLIC;
GRANT USAGE ON SCHEMA ld_kafka_operator TO ld_kafka_operator_observer;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.record_stop_receipt(uuid,jsonb) TO ld_kafka_operator_observer;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.issue_stop_challenge(uuid,text,bigint,uuid,text,name,timestamptz),
 ld_kafka_operator.read_stop_receipt(uuid),ld_kafka_operator.consume_stop_challenge(uuid,text) TO ld_kafka_operator_controller;
COMMIT;
