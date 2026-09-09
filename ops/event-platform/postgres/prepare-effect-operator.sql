\set ON_ERROR_STOP on

-- DBA-only preparation for provider/effect reconciliation. The role is a
-- NOLOGIN capability role: named human/JIT operator identities receive
-- time-bounded membership and must SET ROLE so database triggers can prove
-- that an ambiguous outcome was resolved through the reviewed operator path.
DO $effect_operator_role$
DECLARE
  role_state RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'leaddrive_effect_operator'
  ) THEN
    CREATE ROLE leaddrive_effect_operator
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
         rolreplication, rolbypassrls
    INTO role_state
    FROM pg_catalog.pg_roles
   WHERE rolname = 'leaddrive_effect_operator';
  IF role_state.rolsuper
     OR role_state.rolinherit
     OR role_state.rolcreaterole
     OR role_state.rolcreatedb
     OR role_state.rolcanlogin
     OR role_state.rolreplication
     OR role_state.rolbypassrls THEN
    RAISE EXCEPTION 'leaddrive_effect_operator must remain NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;

  -- NOINHERIT does not prevent SET ROLE. Preparation must begin with no role
  -- edges in either direction: inbound membership could let a web/worker role
  -- impersonate the operator, while outbound membership could expand the
  -- operator's privileges. Named/JIT access is granted only after this script
  -- under a separately reviewed, expiring change record.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members memberships
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = memberships.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = memberships.member
     WHERE granted_role.rolname = 'leaddrive_effect_operator'
        OR member_role.rolname = 'leaddrive_effect_operator'
  ) THEN
    RAISE EXCEPTION 'leaddrive_effect_operator must have no inbound or outbound role memberships during preparation';
  END IF;
END
$effect_operator_role$;

REVOKE ALL ON SCHEMA public FROM leaddrive_effect_operator;
GRANT USAGE ON SCHEMA public TO leaddrive_effect_operator;
REVOKE ALL ON TABLE
  public.effect_outbox,
  public.effect_attempts,
  public.effect_reconciliations
FROM leaddrive_effect_operator;
GRANT SELECT ON TABLE
  public.effect_outbox,
  public.effect_attempts,
  public.effect_reconciliations
TO leaddrive_effect_operator;
GRANT INSERT ON TABLE public.effect_reconciliations TO leaddrive_effect_operator;
GRANT UPDATE ON TABLE public.effect_outbox TO leaddrive_effect_operator;

DO $effect_operator_verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members memberships
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = memberships.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = memberships.member
     WHERE granted_role.rolname = 'leaddrive_effect_operator'
        OR member_role.rolname = 'leaddrive_effect_operator'
  ) THEN
    RAISE EXCEPTION 'effect operator gained an inbound/outbound membership during preparation';
  END IF;
END
$effect_operator_verify$;

-- Membership is intentionally not granted here. The change record must name
-- an individual/JIT login role and expiry, then an independent DBA grants and
-- later revokes that membership. Never grant this role to the web, worker,
-- CDC, backup, or migration identities.
