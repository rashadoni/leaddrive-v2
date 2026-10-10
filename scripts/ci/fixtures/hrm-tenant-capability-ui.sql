-- Synthetic hosted CI fixture only, after candidate `prisma db push`.
-- This tests handler writes and tenant RLS with actual PostgreSQL; it is not a
-- replay of every production migration/trigger and never targets production.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() <> 'hrm_tenant_capability_ui' THEN
    RAISE EXCEPTION 'HRM UI fixture requires its exact disposable database';
  END IF;
END $$;
CREATE ROLE hrm_tenant_ui LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT CONNECT ON DATABASE hrm_tenant_capability_ui TO hrm_tenant_ui;
GRANT USAGE ON SCHEMA public TO hrm_tenant_ui;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hrm_tenant_ui;
GRANT UPDATE ("lastLogin", "loginCount", "updatedAt") ON public.users TO hrm_tenant_ui;
GRANT UPDATE ON public.organizations TO hrm_tenant_ui;
GRANT INSERT ON public.workforce_policies, public.workforce_shift_templates,
  public.mtm_audit_logs, public.audit_logs TO hrm_tenant_ui;

-- Same tenant/bypass context contract as application Prisma. The DB role itself
-- never bypasses RLS; only an authenticated superadmin handler sets the context.
DO $$ DECLARE target record; BEGIN
  FOR target IN
    SELECT DISTINCT c.relname
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND a.attname = 'organizationId' AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.relname);
    EXECUTE format('CREATE POLICY hrm_ui_tenant ON public.%I USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target.relname);
  END LOOP;
END $$;

-- Reproduce the active default uniqueness relevant to approval. Other
-- production lifecycle constraints are intentionally outside this UI fixture.
CREATE UNIQUE INDEX hrm_ui_one_active_org_default ON public.workforce_shift_templates ("organizationId")
  WHERE "isDefault" AND "status" = 'ACTIVE' AND "teamId" IS NULL;

-- Fixture-only failure injection proves that a provisioning audit failure rolls
-- the entitlement and both profile rows back in the application's transaction.
-- Application role has no access to this admin-owned control table.
CREATE TABLE public.hrm_ui_failure_control ("organizationId" text PRIMARY KEY);
CREATE FUNCTION public.hrm_ui_reject_provisioning_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.action = 'WORKFORCE_DEFAULT_PROFILE_PROVISIONED'
     AND EXISTS (SELECT 1 FROM public.hrm_ui_failure_control WHERE "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Disposable HRM fixture injected audit failure' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hrm_ui_reject_provisioning_audit() FROM PUBLIC;
CREATE TRIGGER hrm_ui_reject_provisioning_audit BEFORE INSERT ON public.mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.hrm_ui_reject_provisioning_audit();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_tenant_ui' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Disposable application role must obey RLS';
  END IF;
  IF has_table_privilege('hrm_tenant_ui', 'public.hrm_ui_failure_control', 'SELECT')
     OR has_table_privilege('hrm_tenant_ui', 'public.organizations', 'DELETE')
     OR has_table_privilege('hrm_tenant_ui', 'public.workforce_policies', 'UPDATE') THEN
    RAISE EXCEPTION 'Disposable application privileges exceeded the fixture boundary';
  END IF;
END $$;
COMMIT;
