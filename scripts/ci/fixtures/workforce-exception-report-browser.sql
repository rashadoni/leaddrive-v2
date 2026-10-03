-- Disposable hosted report-browser extension, applied AFTER the unmodified
-- Today fixture. Same fenced DB/role; never run against production.
-- Prisma db push supplies current fields/enums/tenant FKs. The Today selected
-- case/grant checks remain. Historical decision/request/response/ledger rows
-- are imported by the owner: this is NOT a production migration replay or
-- canonical approval/terminal/correction writer acceptance. No USER triggers
-- are disabled. All report business facts stay SELECT-only for the app role.
-- The real audited GET additionally needs append-only, tenant-scoped audit
-- INSERT. This extension grants no other business INSERT/UPDATE/DELETE.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wf_manager_today_browser'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit) THEN
    RAISE EXCEPTION 'Report fixture requires the fenced disposable Today database and restricted role';
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workforce_exception_employee_responses','mtm_hrm_requests','workforce_time_corrections','mtm_audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY wf_report_browser_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true)) '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))', table_name);
  END LOOP;
END $$;
GRANT INSERT ON public.mtm_audit_logs TO wf_manager_today_browser;

CREATE FUNCTION wf_report_browser_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action <> 'WORKFORCE_EXCEPTION_REPORT_VIEWED'
    OR NEW.entity <> 'workforce_exception_report'
    OR NEW."metadataKind" IS DISTINCT FROM 'workforce_exception_report'
    OR NEW."entityId" IS NULL OR NEW."entityId" !~ '^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$'
    OR NEW."agentId" IS NOT NULL OR NEW."oldData" IS NOT NULL
    OR jsonb_typeof(NEW."newData") IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."newData")) <> 12
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."newData") AS k(key) WHERE k.key <> ALL(ARRAY[
      'start','end','caseCount','employeeCount','openCount','awaitingEmployeeResponseCount',
      'hrReviewCount','resolvedCount','dataIntegrityReviewCount','recordedLinkedCorrectionCases',
      'firstResolutionSampleCount','firstResolutionIntegrityExcludedCount'])) THEN
    RAISE EXCEPTION 'Report browser audit must contain only the real aggregate view contract' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_report_browser_audit_insert
  BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION wf_report_browser_audit_insert();
CREATE FUNCTION wf_report_browser_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Report browser view audit is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER wf_report_browser_audit_immutable
  BEFORE UPDATE OR DELETE ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION wf_report_browser_audit_immutable();

DO $$
DECLARE app_oid oid; protected integer;
BEGIN
  SELECT oid INTO app_oid FROM pg_roles WHERE rolname='wf_manager_today_browser';
  SELECT count(*) INTO protected FROM pg_class c WHERE c.relnamespace='public'::regnamespace
    AND c.relname=ANY(ARRAY['workforce_exception_cases','workforce_exception_decisions',
      'workforce_exception_employee_responses','mtm_hrm_requests','workforce_time_corrections','mtm_audit_logs'])
    AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> app_oid;
  IF protected <> 6 OR NOT has_table_privilege(app_oid,'public.mtm_audit_logs','INSERT')
    OR has_any_column_privilege(app_oid,'public.mtm_audit_logs','UPDATE')
    OR has_table_privilege(app_oid,'public.mtm_audit_logs','DELETE')
    OR has_table_privilege(app_oid,'public.mtm_audit_logs','TRUNCATE') THEN
    RAISE EXCEPTION 'Report RLS and audit privileges are unsafe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
    AND c.relkind IN ('r','p') AND c.relname NOT IN ('users','mtm_audit_logs')
    AND (has_any_column_privilege(app_oid,c.oid,'INSERT') OR has_any_column_privilege(app_oid,c.oid,'UPDATE')
      OR has_table_privilege(app_oid,c.oid,'DELETE') OR has_table_privilege(app_oid,c.oid,'TRUNCATE'))) THEN
    RAISE EXCEPTION 'Report business facts must remain read-only';
  END IF;
END $$;
COMMIT;
