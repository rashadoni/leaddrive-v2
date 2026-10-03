-- Disposable hosted browser database only. Prisma db push creates the current
-- candidate models but cannot express these RLS policies or partial indexes.
-- Browser authentication still goes through the real credentials provider;
-- fixture seeding/inspection uses the separate ephemeral admin connection.
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'workforce_calendar_browser' THEN
    RAISE EXCEPTION 'Calendar browser fixture requires its isolated database';
  END IF;
END
$$;

CREATE ROLE wf_calendar_browser
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE workforce_calendar_browser TO wf_calendar_browser;
GRANT USAGE ON SCHEMA public TO wf_calendar_browser;
-- Normal Auth.js/dashboard reads and updates remain real. No hard-delete,
-- truncate, DDL or RLS-bypass privilege is needed by this browser scenario.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO wf_calendar_browser;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wf_calendar_browser;
-- PostgreSQL 16 LOCK privilege rules allow SHARE ROW EXCLUSIVE to a role with
-- UPDATE. The reversal therefore does not require ownership or DELETE/TRUNCATE.
-- https://www.postgresql.org/docs/16/sql-lock.html

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'mtm_teams', 'mtm_agents', 'mtm_work_calendar_days', 'mtm_audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY workforce_calendar_browser_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true) '
      'OR current_setting(''app.rls_bypass'', true) = ''on'') '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) '
      'OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name
    );
  END LOOP;
END
$$;

-- Preserve the production calendar's one-active-row-per-scope invariant.
ALTER TABLE public.mtm_work_calendar_days
  ADD CONSTRAINT mtm_work_calendar_days_single_scope_check
  CHECK (num_nonnulls("teamId", "agentId") <= 1);
CREATE UNIQUE INDEX mtm_work_calendar_days_active_org_scope_key
  ON public.mtm_work_calendar_days("organizationId", "date")
  WHERE "teamId" IS NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX mtm_work_calendar_days_active_team_scope_key
  ON public.mtm_work_calendar_days("organizationId", "date", "teamId")
  WHERE "teamId" IS NOT NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX mtm_work_calendar_days_active_agent_scope_key
  ON public.mtm_work_calendar_days("organizationId", "date", "agentId")
  WHERE "agentId" IS NOT NULL AND "teamId" IS NULL AND "deletedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'wf_calendar_browser'
      AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'Calendar browser application role is not restricted';
  END IF;
  IF (
    SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('users', 'mtm_teams', 'mtm_agents', 'mtm_work_calendar_days', 'mtm_audit_logs')
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) <> 5 THEN
    RAISE EXCEPTION 'Calendar browser fixture requires five forced-RLS tables';
  END IF;
END
$$;

COMMIT;
