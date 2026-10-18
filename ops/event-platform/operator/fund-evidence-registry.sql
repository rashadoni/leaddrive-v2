-- INACTIVE addon to the isolated Fund composition. No migration/bootstrap.
-- Provision the NOLOGIN verifier group independently; credentials/keys are never
-- operator inputs. A verifier login is a trusted service, not a human endpoint.
BEGIN;
DO $$ BEGIN
 IF current_user<>'ld_kafka_control_owner' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
 WHERE rolname='ld_kafka_operator_verifier' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
 AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
 RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
END $$;
CREATE TABLE ld_kafka_operator.fund_evidence_registrations (
 request_id uuid PRIMARY KEY REFERENCES ld_kafka_operator.fund_verified_evidence(request_id),
 plan_hash text NOT NULL,generation bigint NOT NULL,
 verifier name NOT NULL,verifier_principal text NOT NULL,
 provenance_hash text NOT NULL CHECK(provenance_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ld_kafka_operator.fund_evidence_registrations FROM PUBLIC,ld_kafka_operator_verifier,ld_kafka_operator_controller,ld_kafka_operator_admitter;
CREATE FUNCTION ld_kafka_operator.fund_verifier(p_login name,p_org text)
RETURNS ld_kafka_operator.identities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i ld_kafka_operator.identities; r record;
BEGIN
 SELECT * INTO i FROM ld_kafka_operator.identities WHERE login_name=p_login AND organization_id=p_org;
 SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=p_login;
 IF i.login_name IS NULL OR NOT i.enabled OR i.valid_until<=clock_timestamp()
 OR i.may_request OR i.may_approve OR i.may_consume
 OR r.rolname IS NULL OR NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
 OR (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil<=clock_timestamp())
 OR NOT pg_has_role(p_login,'ld_kafka_operator_verifier','MEMBER')
 OR pg_has_role(p_login,'ld_kafka_control_owner','MEMBER')
 OR pg_has_role(p_login,'ld_kafka_operator_admitter','MEMBER')
 OR pg_has_role(p_login,'ld_kafka_operator_controller','MEMBER')
 OR pg_has_role(p_login,'ld_kafka_operator_observer','MEMBER')
 THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 RETURN i;
END $$;
CREATE FUNCTION ld_kafka_operator.fund_registration_current(p_id uuid,p_hash text,p_generation bigint,p_login name,p_settled boolean DEFAULT false)
RETURNS ld_kafka_operator.requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; v ld_kafka_operator.identities; a ld_kafka_operator.identities;
BEGIN
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_id FOR SHARE;
 IF q.id IS NULL OR q.plan_hash IS DISTINCT FROM p_hash OR q.generation IS DISTINCT FROM p_generation OR p_generation<=0
 OR (q.status<>'consumed' AND NOT(p_settled AND q.status='settled'))
 OR q.expires_at<=clock_timestamp() OR q.lease_until<=clock_timestamp()
 OR q.plan->>'action' NOT IN ('promote','rollback') THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 v:=ld_kafka_operator.fund_verifier(p_login,q.organization_id);
 IF v.principal_id IN(q.requester_principal,q.approver_principal,q.controller_principal)
 THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 a:=ld_kafka_operator.identity(q.requester,q.organization_id,'request');
 IF a.principal_id<>q.requester_principal THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 a:=ld_kafka_operator.identity(q.approver,q.organization_id,'approve');
 IF a.principal_id<>q.approver_principal OR a.principal_id=q.requester_principal THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 a:=ld_kafka_operator.identity(q.controller,q.organization_id,'consume');
 IF a.principal_id<>q.controller_principal THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 RETURN q;
END $$;
CREATE FUNCTION ld_kafka_operator.read_fund_verification_request(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; previous uuid;
BEGIN
 SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_id;
 q:=ld_kafka_operator.fund_registration_current(q.id,q.plan_hash,q.generation,session_user);
 SELECT "activeBuildId" INTO previous FROM public.projection_activations WHERE "organizationId"=q.organization_id AND "projectionName"=q.plan->>'projectionName';
 RETURN jsonb_build_object('requestId',q.id,'plan',q.plan,'planHash',q.plan_hash,'generation',q.generation::text,
 'operatorPrincipals',jsonb_build_array(q.requester_principal,q.approver_principal,q.controller_principal),
 'previousBuildId',previous,'leaseUntil',to_char(q.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
CREATE FUNCTION ld_kafka_operator.register_fund_evidence(p_id uuid,p_hash text,p_generation bigint,p_raw text,p_material text,p_previous uuid,p_valid timestamptz,p_retained timestamptz,p_provenance text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q ld_kafka_operator.requests; m jsonb; k text; v ld_kafka_operator.identities;
BEGIN
 q:=ld_kafka_operator.fund_registration_current(p_id,p_hash,p_generation,session_user);
 IF p_raw IS NULL OR octet_length(p_raw)>1048576 OR p_material IS NULL OR p_material !~ '^[0-9a-f]{64}$'
 OR p_provenance IS NULL OR p_provenance !~ '^[0-9a-f]{64}$'
 OR p_previous IS NULL OR p_previous::text=q.plan->>'buildId'
 OR p_valid IS NULL OR p_valid<=clock_timestamp() OR p_valid>clock_timestamp()+interval '1 minute' OR p_valid>q.lease_until
 OR p_retained IS NULL OR p_retained<=clock_timestamp() OR p_retained>clock_timestamp()+interval '24 hours'
 OR q.plan->>'evidenceSha256'<>'sha256:'||encode(public.digest(convert_to(p_raw,'UTF8'),'sha256'),'hex')
 THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 m:=p_raw::jsonb;
 IF m->>'kind' IS DISTINCT FROM 'OperatorRecoveryEvidence' OR m->>'previousBuildId' IS DISTINCT FROM p_previous::text
 THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 FOREACH k IN ARRAY ARRAY['organizationId','buildId','projectionName','releaseSha','artifactSha256','environment','clusterId','topicId','groupId','action','expectedPointerVersion'] LOOP
 IF m->>k IS DISTINCT FROM q.plan->>k THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 END LOOP;
 v:=ld_kafka_operator.fund_verifier(session_user,q.organization_id);
 INSERT INTO ld_kafka_operator.fund_verified_evidence VALUES(q.id,q.plan,p_raw,p_material,p_previous,p_valid,p_retained);
 INSERT INTO ld_kafka_operator.fund_evidence_registrations(request_id,plan_hash,generation,verifier,verifier_principal,provenance_hash)
 VALUES(q.id,q.plan_hash,q.generation,session_user,v.principal_id,p_provenance);
 INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(q.id,session_user,'fund-evidence-registered',q.generation);
END $$;
CREATE FUNCTION ld_kafka_operator.assert_fund_registration(p_id uuid,p_hash text,p_generation bigint,p_settled boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r ld_kafka_operator.fund_evidence_registrations; q ld_kafka_operator.requests; v ld_kafka_operator.identities;
BEGIN
 SELECT * INTO r FROM ld_kafka_operator.fund_evidence_registrations WHERE request_id=p_id;
 IF r.request_id IS NULL OR r.plan_hash IS DISTINCT FROM p_hash OR r.generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 q:=ld_kafka_operator.fund_registration_current(p_id,p_hash,p_generation,r.verifier,p_settled);
 v:=ld_kafka_operator.fund_verifier(r.verifier,q.organization_id);
 IF v.principal_id<>r.verifier_principal THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
END $$;
CREATE FUNCTION ld_kafka_operator.fund_registration_commit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM ld_kafka_operator.assert_fund_registration(NEW.request_id,NEW.plan_hash,NEW.generation,true);
 IF NOT EXISTS(SELECT 1 FROM ld_kafka_operator.fund_verified_evidence e WHERE e.request_id=NEW.request_id AND e.valid_until>clock_timestamp())
 THEN RAISE EXCEPTION 'FUND_VERIFICATION_DENIED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER fund_registration_commit_guard AFTER INSERT ON ld_kafka_operator.fund_evidence_registrations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ld_kafka_operator.fund_registration_commit_guard();
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ld_kafka_operator FROM ld_kafka_operator_verifier;
REVOKE EXECUTE ON FUNCTION ld_kafka_operator.fund_verifier(name,text),ld_kafka_operator.fund_registration_current(uuid,text,bigint,name,boolean),ld_kafka_operator.read_fund_verification_request(uuid),ld_kafka_operator.register_fund_evidence(uuid,text,bigint,text,text,uuid,timestamptz,timestamptz,text),ld_kafka_operator.assert_fund_registration(uuid,text,bigint,boolean),ld_kafka_operator.fund_registration_commit_guard() FROM PUBLIC;
GRANT USAGE ON SCHEMA ld_kafka_operator TO ld_kafka_operator_verifier;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.register_fund_evidence(uuid,text,bigint,text,text,uuid,timestamptz,timestamptz,text) TO ld_kafka_operator_verifier;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.read_fund_verification_request(uuid) TO ld_kafka_operator_verifier;
COMMIT;
