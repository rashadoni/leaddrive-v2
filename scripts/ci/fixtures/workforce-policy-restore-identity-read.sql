-- Apply only AFTER the historical migration proof and current schema alignment.
-- The old base schema has no identity_accounts table, so its earlier GRANT ON
-- ALL TABLES cannot grant the current Auth.js marker read on this new table.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() <> 'workforce_manager_today_browser' OR current_user <> 'postgres'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wf_policy_restore'
       AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole)
     OR EXISTS (SELECT 1 FROM public.identity_accounts) THEN
    RAISE EXCEPTION 'Identity marker fixture requires isolated owner, restricted role and empty identity state';
  END IF;
END $$;
ALTER TABLE public.identity_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_accounts FROM wf_policy_restore;
GRANT SELECT (id, "organizationId", "userId", "cutoverAt") ON public.identity_accounts TO wf_policy_restore;
CREATE POLICY wf_policy_restore_identity_marker_read ON public.identity_accounts
  FOR SELECT TO wf_policy_restore
  USING ("organizationId" = current_setting('app.org_id', true));
COMMIT;
