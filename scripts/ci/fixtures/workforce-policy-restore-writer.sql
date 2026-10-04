-- Dedicated hosted disposable writer. The existing browser role is unchanged.
-- SELECT/INSERT audit containment below is extra fixture protection, not a
-- claim that production mtm_audit_logs has a global append-only trigger.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() <> 'workforce_manager_today_browser' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Restore writer requires its isolated hosted owner';
  END IF;
END $$;
CREATE ROLE wf_policy_restore LOGIN PASSWORD :'restore_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT CONNECT ON DATABASE workforce_manager_today_browser TO wf_policy_restore;
GRANT USAGE ON SCHEMA public TO wf_policy_restore;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wf_policy_restore;
GRANT INSERT ON public.workforce_policies, public.mtm_audit_logs TO wf_policy_restore;
GRANT UPDATE ("lastLogin", "loginCount", "updatedAt") ON public.users TO wf_policy_restore;
ALTER TABLE public.mtm_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtm_audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY wf_policy_restore_audit_tenant ON public.mtm_audit_logs
  USING ("organizationId" = current_setting('app.org_id',true))
  WITH CHECK ("organizationId" = current_setting('app.org_id',true));
CREATE FUNCTION wf_fixture_restore_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Disposable restore audit fixture is append only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER wf_fixture_restore_audit_guard BEFORE UPDATE OR DELETE ON public.mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_fixture_restore_audit_immutable();
COMMIT;
