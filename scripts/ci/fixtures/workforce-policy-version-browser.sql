-- Prepared isolated hosted read-only policy comparison fixture; NOT EXECUTED.
-- Apply once after current Prisma db push and the unchanged Today fixture.
-- This adds selected policy CHECKs and populated-table RLS control support.
-- Owner imports historical definitions; this is not a canonical policy writer,
-- activation/rollback proof, full migration replay or production seed tool.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser'
     OR current_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_roles WHERE rolname = 'wf_manager_today_browser'
       AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
     ) THEN
    RAISE EXCEPTION 'Policy comparison requires the isolated owner and restricted fixture role';
  END IF;
END $$;
REVOKE ALL ON public.workforce_policies FROM wf_manager_today_browser;
GRANT SELECT ON public.workforce_policies TO wf_manager_today_browser;
ALTER TABLE public.workforce_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY wf_policy_version_tenant ON public.workforce_policies
  USING ("organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on');

-- Selected checks from 20260828223000 / 20260829140000. Prisma db push supplies
-- current enum types, ordinary tenant foreign keys and declared indexes.
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_positive CHECK (version > 0);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_name_nonempty CHECK (btrim(name) <> '');
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_definition_object CHECK (jsonb_typeof(definition) = 'object');
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_hash_format CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_effective_range CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_retired CHECK (status <> 'RETIRED' OR "retiredAt" IS NOT NULL);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_active CHECK (status <> 'ACTIVE' OR "retiredAt" IS NULL);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_draft CHECK (
  status <> 'DRAFT' OR ("activatedByUserId" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_lifecycle CHECK (
  "retiredAt" IS NULL OR "activatedAt" IS NULL OR "retiredAt" >= "activatedAt"
);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_actor CHECK (
  (provenance = 'TENANT_ADMIN' AND "createdByUserId" IS NOT NULL AND "systemProfileVersion" IS NULL)
  OR (provenance = 'SYSTEM_PROVISIONING' AND "createdByUserId" IS NULL AND NULLIF(btrim("systemProfileVersion"), '') IS NOT NULL)
);
ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_policy_version_activation CHECK (
  (provenance = 'TENANT_ADMIN' AND (status = 'DRAFT' OR ("activatedAt" IS NOT NULL AND "activatedByUserId" IS NOT NULL)))
  OR (provenance = 'SYSTEM_PROVISIONING' AND status IN ('ACTIVE','RETIRED') AND "activatedAt" IS NOT NULL AND "activatedByUserId" IS NULL)
);
COMMIT;
