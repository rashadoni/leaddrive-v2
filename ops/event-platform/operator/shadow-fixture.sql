-- TEST-ONLY shadow-pointer composition. NOT a migration/runtime controller.
-- No real app tables, consumer groups, provider effects or offsets exist here.
BEGIN;
CREATE SCHEMA ld_operator_shadow_fixture AUTHORIZATION ld_kafka_control_owner;
REVOKE ALL ON SCHEMA ld_operator_shadow_fixture FROM PUBLIC;
CREATE TABLE ld_operator_shadow_fixture.builds (
  organization_id text NOT NULL,
  id uuid NOT NULL,
  code_sha text NOT NULL CHECK (code_sha ~ '^[0-9a-f]{40}$'),
  status text NOT NULL CHECK (status IN ('ready','promoted')),
  effects_fenced boolean NOT NULL,
  retained_until timestamptz NOT NULL,
  PRIMARY KEY(organization_id,id)
);
CREATE TABLE ld_operator_shadow_fixture.pointers (
  organization_id text PRIMARY KEY,
  build_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  FOREIGN KEY(organization_id,build_id) REFERENCES ld_operator_shadow_fixture.builds(organization_id,id)
);
CREATE TABLE ld_operator_shadow_fixture.verified_evidence (
  digest text PRIMARY KEY,
  raw_receipt text NOT NULL,
  plan jsonb NOT NULL,
  previous_build_id uuid NOT NULL,
  valid_until timestamptz NOT NULL,
  CHECK(digest = 'sha256:' || encode(public.digest(convert_to(raw_receipt,'UTF8'),'sha256'),'hex'))
);
CREATE TABLE ld_operator_shadow_fixture.transitions (
  request_id uuid PRIMARY KEY REFERENCES ld_kafka_operator.requests(id),
  organization_id text NOT NULL,
  old_build uuid NOT NULL,
  new_build uuid NOT NULL,
  resulting_version bigint NOT NULL,
  action text NOT NULL
);

-- Only a trusted verifier may register verified evidence/build metadata. The
-- fixture harness does that as owner AFTER the JS gate succeeds. Controllers
-- can invoke a transition but cannot assert verification or edit a pointer.
CREATE FUNCTION ld_operator_shadow_fixture.transition(p_request uuid, p_hash text, p_generation bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q ld_kafka_operator.requests; b ld_operator_shadow_fixture.builds;
  e ld_operator_shadow_fixture.verified_evidence; p ld_operator_shadow_fixture.pointers; changed integer;
BEGIN
  PERFORM ld_kafka_operator.assert_current(p_request,p_hash,p_generation);
  SELECT * INTO q FROM ld_kafka_operator.requests WHERE id=p_request;
  IF q.plan->>'action' NOT IN ('promote','rollback') THEN RAISE EXCEPTION 'SHADOW_TRANSITION_DENIED'; END IF;
  SELECT * INTO e FROM ld_operator_shadow_fixture.verified_evidence
    WHERE digest=q.plan->>'evidenceSha256' FOR SHARE;
  IF e.digest IS NULL OR e.plan IS DISTINCT FROM q.plan OR e.valid_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'SHADOW_TRANSITION_DENIED';
  END IF;
  SELECT * INTO b FROM ld_operator_shadow_fixture.builds WHERE organization_id=q.organization_id
    AND id=(q.plan->>'buildId')::uuid FOR UPDATE;
  IF b.id IS NULL OR NOT b.effects_fenced OR b.code_sha <> q.plan->>'releaseSha'
     OR (q.plan->>'action'='promote' AND b.status <> 'ready')
     OR (q.plan->>'action'='rollback' AND (b.status <> 'promoted' OR b.retained_until <= clock_timestamp())) THEN
    RAISE EXCEPTION 'SHADOW_TRANSITION_DENIED';
  END IF;
  SELECT * INTO p FROM ld_operator_shadow_fixture.pointers WHERE organization_id=q.organization_id FOR UPDATE;
  IF p.organization_id IS NULL OR p.build_id=(q.plan->>'buildId')::uuid
     OR p.build_id IS DISTINCT FROM e.previous_build_id OR p.version::text <> q.plan->>'expectedPointerVersion' THEN
    RAISE EXCEPTION 'SHADOW_TRANSITION_DENIED';
  END IF;
  UPDATE ld_operator_shadow_fixture.pointers SET build_id=b.id,version=p.version+1
    WHERE organization_id=q.organization_id AND version=p.version AND build_id=p.build_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'SHADOW_TRANSITION_DENIED'; END IF;
  IF q.plan->>'action'='promote' THEN
    UPDATE ld_operator_shadow_fixture.builds SET status='promoted' WHERE organization_id=q.organization_id AND id=b.id;
  END IF;
  INSERT INTO ld_operator_shadow_fixture.transitions(request_id,organization_id,old_build,new_build,resulting_version,action)
    VALUES(q.id,q.organization_id,p.build_id,b.id,p.version+1,q.plan->>'action');
  PERFORM ld_kafka_operator.settle(p_request,p_hash,p_generation);
  RETURN p.version+1;
END $$;
REVOKE EXECUTE ON FUNCTION ld_operator_shadow_fixture.transition(uuid,text,bigint) FROM PUBLIC;
GRANT USAGE ON SCHEMA ld_operator_shadow_fixture TO ld_kafka_operator_controller;
GRANT EXECUTE ON FUNCTION ld_operator_shadow_fixture.transition(uuid,text,bigint) TO ld_kafka_operator_controller;
COMMIT;
