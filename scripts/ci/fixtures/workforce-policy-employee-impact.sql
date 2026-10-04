-- Disposable hosted fixture only. Run after unchanged Today/policy fixtures.
-- A separate role proves the loader works without business DML privileges.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser' OR current_user <> 'postgres'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wf_manager_today_browser'
       AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Employee impact requires its isolated hosted owner/fixture';
  END IF;
END $$;
CREATE ROLE wf_policy_impact_reader LOGIN PASSWORD :'impact_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT CONNECT ON DATABASE workforce_manager_today_browser TO wf_policy_impact_reader;
GRANT USAGE ON SCHEMA public TO wf_policy_impact_reader;
GRANT SELECT ON public.workforce_policies, public.mtm_settings, public.mtm_agents,
  public.workforce_employee_team_memberships TO wf_policy_impact_reader;
DO $$
DECLARE verified integer;
BEGIN
  SELECT count(*) INTO verified FROM pg_class c JOIN pg_roles r ON r.rolname='wf_policy_impact_reader'
  WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY[
    'workforce_policies','mtm_settings','mtm_agents','workforce_employee_team_memberships'])
    AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner<>r.oid
    AND has_table_privilege(r.oid,c.oid,'SELECT')
    AND NOT (has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE')
      OR has_table_privilege(r.oid,c.oid,'DELETE'));
  IF verified<>4 THEN RAISE EXCEPTION 'Employee impact SELECT-only FORCE RLS fixture is incomplete'; END IF;
END $$;
COMMIT;
