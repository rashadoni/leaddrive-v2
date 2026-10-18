-- INACTIVE, disposable/staging contract ONLY. Not a Prisma migration, runtime
-- bootstrap or activation command. Requires independently provisioned NOLOGIN
-- owner/admitter/controller roles. Apply as ld_kafka_control_owner only.
-- No functions here connect to Kafka, change business state or grant access.
BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $$
BEGIN
  IF current_user <> 'ld_kafka_control_owner' OR
     (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
       ('ld_kafka_control_owner','ld_kafka_operator_admitter','ld_kafka_operator_controller')
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
       AND NOT rolcreatedb AND NOT rolreplication) <> 3 THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
END $$;
CREATE SCHEMA ld_kafka_operator AUTHORIZATION ld_kafka_control_owner;
REVOKE ALL ON SCHEMA ld_kafka_operator FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ld_kafka_operator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE ld_kafka_operator.identities (
  login_name name PRIMARY KEY,
  principal_id text NOT NULL UNIQUE CHECK (principal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  organization_id text NOT NULL CHECK (length(organization_id) BETWEEN 1 AND 200),
  may_request boolean NOT NULL DEFAULT false,
  may_approve boolean NOT NULL DEFAULT false,
  may_consume boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL
);
CREATE SEQUENCE ld_kafka_operator.fence_generation;
CREATE TABLE ld_kafka_operator.requests (
  id uuid PRIMARY KEY,
  plan jsonb NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  organization_id text NOT NULL,
  requester name NOT NULL REFERENCES ld_kafka_operator.identities(login_name),
  requester_principal text NOT NULL,
  approver_principal text,
  controller_principal text,
  controller name REFERENCES ld_kafka_operator.identities(login_name),
  approver name REFERENCES ld_kafka_operator.identities(login_name),
  status text NOT NULL CHECK (status IN ('requested', 'approved', 'consumed', 'revoked', 'settled')),
  expires_at timestamptz NOT NULL,
  generation bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status IN ('consumed', 'settled')) = (lease_until IS NOT NULL)),
  CHECK (status NOT IN ('approved', 'consumed', 'settled') OR approver IS NOT NULL)
);
CREATE TABLE ld_kafka_operator.audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES ld_kafka_operator.requests(id),
  actor name NOT NULL,
  transition text NOT NULL,
  generation bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ALL TABLES IN SCHEMA ld_kafka_operator FROM PUBLIC, ld_kafka_operator_admitter, ld_kafka_operator_controller;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ld_kafka_operator FROM PUBLIC, ld_kafka_operator_admitter, ld_kafka_operator_controller;

-- Session identity is the authenticated connection login. SET ROLE cannot
-- impersonate a second approver. Named/JIT logins must not have owner/admin roles.
CREATE FUNCTION ld_kafka_operator.identity(p_login name, p_org text, p_capability text)
RETURNS ld_kafka_operator.identities
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE i ld_kafka_operator.identities; r record;
BEGIN
  SELECT * INTO i FROM ld_kafka_operator.identities
    WHERE login_name = p_login AND organization_id = p_org FOR SHARE;
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = p_login;
  IF i.login_name IS NULL OR NOT i.enabled OR i.valid_until <= clock_timestamp()
     OR r.rolname IS NULL OR NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls
     OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
     OR (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil <= clock_timestamp())
     OR pg_catalog.pg_has_role(p_login, 'ld_kafka_control_owner', 'MEMBER')
     OR (p_capability = 'request' AND (NOT i.may_request OR NOT pg_catalog.pg_has_role(p_login, 'ld_kafka_operator_admitter', 'MEMBER')))
     OR (p_capability = 'approve' AND (NOT i.may_approve OR NOT pg_catalog.pg_has_role(p_login, 'ld_kafka_operator_admitter', 'MEMBER')))
     OR (p_capability = 'consume' AND (NOT i.may_consume OR NOT pg_catalog.pg_has_role(p_login, 'ld_kafka_operator_controller', 'MEMBER')))
     OR p_capability NOT IN ('request', 'approve', 'consume') THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  RETURN i;
END $$;

CREATE FUNCTION ld_kafka_operator.request(p_id uuid, p_plan jsonb, p_expires_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE i ld_kafka_operator.identities; h text; k text;
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object' OR octet_length(p_plan::text) > 32768
     OR (SELECT count(*) FROM jsonb_object_keys(p_plan)) <> 12 THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  FOREACH k IN ARRAY ARRAY['organizationId','buildId','projectionName','releaseSha','artifactSha256',
    'environment','clusterId','topicId','groupId','action','evidenceSha256','expectedPointerVersion'] LOOP
    IF jsonb_typeof(p_plan->k) IS DISTINCT FROM 'string' OR length(p_plan->>k) NOT BETWEEN 1 AND 249 THEN
      RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
    END IF;
  END LOOP;
  IF p_plan->>'projectionName' <> 'finance.fund-balance'
     OR p_plan->>'action' NOT IN ('shadow-rebuild','stop','promote','rollback')
     OR p_plan->>'releaseSha' !~ '^[0-9a-f]{40}$'
     OR p_plan->>'artifactSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR p_plan->>'evidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR p_plan->>'buildId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_plan->>'environment' !~ '^[a-z][a-z0-9]{0,31}$'
     OR p_plan->>'clusterId' !~ '^[A-Za-z0-9_-]{1,249}$'
     OR p_plan->>'topicId' !~ '^[A-Za-z0-9_-]{21}[AQgw]$'
     OR p_plan->>'topicId' = 'AAAAAAAAAAAAAAAAAAAAAA'
     OR p_plan->>'groupId' !~ ('^ld\.' || (p_plan->>'environment') || '\.finance\.fund-shadow\.v[1-9][0-9]*\.[a-z][a-z0-9-]{0,62}$')
     OR p_plan->>'expectedPointerVersion' !~ '^(0|[1-9][0-9]{0,18})$'
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  i := ld_kafka_operator.identity(session_user, p_plan->>'organizationId', 'request');
  h := encode(public.digest(convert_to(p_plan::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO ld_kafka_operator.requests(id, plan, plan_hash, organization_id, requester, requester_principal, status, expires_at)
    VALUES(p_id, p_plan, h, i.organization_id, session_user, i.principal_id, 'requested', p_expires_at);
  INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(p_id,session_user,'requested',0);
  RETURN h;
END $$;

CREATE FUNCTION ld_kafka_operator.approve(p_id uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests; a ld_kafka_operator.identities; r ld_kafka_operator.identities;
BEGIN
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR q.status <> 'requested' OR q.plan_hash IS DISTINCT FROM p_hash OR q.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  a := ld_kafka_operator.identity(session_user, q.organization_id, 'approve');
  r := ld_kafka_operator.identity(q.requester, q.organization_id, 'request');
  IF a.principal_id = r.principal_id OR r.principal_id <> q.requester_principal THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  IF q.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  UPDATE ld_kafka_operator.requests SET approver = session_user, approver_principal = a.principal_id, status = 'approved' WHERE id = p_id;
  INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(p_id,session_user,'approved',0);
END $$;

-- Returns a single-use admission token, NOT activation authority. The future
-- controller must independently verify runtime/build/receipts and compose all
-- guarded SQL with assert_current in ONE transaction. No live dispatcher exists.
CREATE FUNCTION ld_kafka_operator.consume(p_id uuid, p_hash text, p_plan jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests; g bigint; r ld_kafka_operator.identities; a ld_kafka_operator.identities; c ld_kafka_operator.identities;
BEGIN
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR q.status <> 'approved' OR q.plan_hash IS DISTINCT FROM p_hash
     OR q.plan IS DISTINCT FROM p_plan OR q.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  c := ld_kafka_operator.identity(session_user, q.organization_id, 'consume');
  r := ld_kafka_operator.identity(q.requester, q.organization_id, 'request');
  a := ld_kafka_operator.identity(q.approver, q.organization_id, 'approve');
  IF r.principal_id <> q.requester_principal OR a.principal_id <> q.approver_principal
     OR r.principal_id = a.principal_id THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  IF q.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  g := nextval('ld_kafka_operator.fence_generation');
  UPDATE ld_kafka_operator.requests SET status = 'consumed', generation = g, controller = session_user, controller_principal = c.principal_id,
    lease_until = LEAST(q.expires_at, clock_timestamp() + interval '5 minutes') WHERE id = p_id;
  INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(p_id,session_user,'consumed',g);
  RETURN g;
END $$;

CREATE FUNCTION ld_kafka_operator.assert_current(p_id uuid, p_hash text, p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests; r ld_kafka_operator.identities; a ld_kafka_operator.identities; c ld_kafka_operator.identities;
BEGIN
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR q.status <> 'consumed' OR q.controller IS DISTINCT FROM session_user OR q.generation IS DISTINCT FROM p_generation
     OR q.plan_hash IS DISTINCT FROM p_hash OR q.expires_at <= clock_timestamp()
     OR q.lease_until <= clock_timestamp() THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  c := ld_kafka_operator.identity(session_user, q.organization_id, 'consume');
  IF c.principal_id <> q.controller_principal THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  r := ld_kafka_operator.identity(q.requester, q.organization_id, 'request');
  a := ld_kafka_operator.identity(q.approver, q.organization_id, 'approve');
  IF r.principal_id <> q.requester_principal OR a.principal_id <> q.approver_principal
     OR r.principal_id = a.principal_id THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  IF q.expires_at <= clock_timestamp() OR q.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
END $$;

CREATE FUNCTION ld_kafka_operator.revoke(p_id uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests; i ld_kafka_operator.identities; g bigint;
BEGIN
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id = p_id FOR UPDATE;
  IF q.id IS NULL OR q.status IN ('revoked','settled') OR q.plan_hash IS DISTINCT FROM p_hash THEN
    RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED';
  END IF;
  -- A controller can revoke even after a requesting operator loses access.
  IF session_user = q.requester THEN
    i := ld_kafka_operator.identity(session_user, q.organization_id, 'request');
    IF i.principal_id <> q.requester_principal THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  ELSIF session_user = q.approver THEN
    i := ld_kafka_operator.identity(session_user, q.organization_id, 'approve');
    IF i.principal_id <> q.approver_principal THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  ELSE
    i := ld_kafka_operator.identity(session_user, q.organization_id, 'consume');
  END IF;
  g := nextval('ld_kafka_operator.fence_generation');
  UPDATE ld_kafka_operator.requests SET status='revoked', generation=g, lease_until=NULL WHERE id=p_id;
  INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(p_id,session_user,'revoked',g);
END $$;

CREATE FUNCTION ld_kafka_operator.settle(p_id uuid, p_hash text, p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM ld_kafka_operator.assert_current(p_id,p_hash,p_generation);
  UPDATE ld_kafka_operator.requests SET status='settled' WHERE id=p_id;
  INSERT INTO ld_kafka_operator.audit(request_id,actor,transition,generation) VALUES(p_id,session_user,'settled',p_generation);
END $$;

CREATE FUNCTION ld_kafka_operator.inspect(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests;
BEGIN
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'KAFKA_OPERATOR_ADMISSION_DENIED'; END IF;
  IF pg_catalog.pg_has_role(session_user,'ld_kafka_operator_controller','MEMBER') THEN
    PERFORM ld_kafka_operator.identity(session_user,q.organization_id,'consume');
  ELSIF session_user=q.requester THEN
    PERFORM ld_kafka_operator.identity(session_user,q.organization_id,'request');
  ELSE
    PERFORM ld_kafka_operator.identity(session_user,q.organization_id,'approve');
  END IF;
  RETURN jsonb_build_object('id',q.id,'plan',q.plan,'planHash',q.plan_hash,'expiresAt',q.expires_at,
    'status',q.status,'requester',q.requester_principal,'approver',q.approver_principal,'generation',q.generation);
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ld_kafka_operator FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.inspect(uuid) TO ld_kafka_operator_admitter, ld_kafka_operator_controller;
GRANT USAGE ON SCHEMA ld_kafka_operator TO ld_kafka_operator_admitter, ld_kafka_operator_controller;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.request(uuid,jsonb,timestamptz), ld_kafka_operator.approve(uuid,text),
  ld_kafka_operator.revoke(uuid,text) TO ld_kafka_operator_admitter;
GRANT EXECUTE ON FUNCTION ld_kafka_operator.consume(uuid,text,jsonb), ld_kafka_operator.assert_current(uuid,text,bigint),
  ld_kafka_operator.settle(uuid,text,bigint), ld_kafka_operator.revoke(uuid,text) TO ld_kafka_operator_controller;
COMMIT;
