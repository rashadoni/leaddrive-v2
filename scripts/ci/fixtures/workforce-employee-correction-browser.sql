-- Separate opt-in hosted disposable request-submission fixture only.
-- Apply after the unchanged Today base on this job's own PostgreSQL service.
-- Never combine with ACK/report/classification fixtures or apply to production.
-- Exact current request-link/revision functions are installed by its harness;
-- synthetic allowlist/audit guards below do not claim production migration replay.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wf_manager_today_browser'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN
      ('wf_employee_browser_audit_insert','wf_report_browser_audit_insert',
       'wf_classification_browser_audit_insert')) THEN
    RAISE EXCEPTION 'Correction browser requires its separate restricted hosted database';
  END IF;
END $$;

CREATE TABLE wf_correction_browser_allowed_days (
  "organizationId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  PRIMARY KEY ("organizationId","workdayId"),
  FOREIGN KEY ("organizationId","workdayId") REFERENCES mtm_agent_workdays("organizationId",id),
  FOREIGN KEY ("organizationId","caseId") REFERENCES workforce_exception_cases("organizationId",id),
  FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id),
  FOREIGN KEY ("organizationId","actorUserId") REFERENCES users("organizationId",id)
);
GRANT SELECT ON wf_correction_browser_allowed_days TO wf_manager_today_browser;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['mtm_hrm_requests','workforce_time_corrections',
    'workforce_exception_employee_responses','mtm_audit_logs','wf_correction_browser_allowed_days'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY wf_correction_browser_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true)) '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))', table_name);
  END LOOP;
END $$;
-- No Workforce fact, decision, correction, response, grant or status update.
GRANT INSERT ON mtm_hrm_requests,mtm_audit_logs TO wf_manager_today_browser;
GRANT UPDATE ("twoFactorNonce") ON users TO wf_manager_today_browser;
CREATE FUNCTION wf_correction_browser_mfa_nonce_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser'
    AND NEW."twoFactorNonce" IS DISTINCT FROM OLD."twoFactorNonce"
    AND (NOT OLD."isActive" OR NOT OLD."require2fa" OR NOT OLD."totpEnabled"
      OR OLD."totpSecret" IS NULL
      OR (NEW."twoFactorNonce" IS NOT NULL AND NEW."twoFactorNonce" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Correction browser MFA nonce requires an enrolled synthetic principal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_correction_browser_mfa_nonce_only BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION wf_correction_browser_mfa_nonce_only();

CREATE FUNCTION wf_correction_browser_request_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser' AND (
    NEW.type::text <> 'TIME_CORRECTION' OR NEW.status::text <> 'PENDING'
    OR NEW."requestedStartAt" IS NULL AND NEW."requestedEndAt" IS NULL
    OR NOT EXISTS (SELECT 1 FROM wf_correction_browser_allowed_days a
      JOIN mtm_agent_workdays w ON w."organizationId"=a."organizationId" AND w.id=a."workdayId"
      JOIN mtm_agents g ON g."organizationId"=a."organizationId" AND g.id=a."agentId"
      WHERE a."organizationId"=NEW."organizationId" AND a."agentId"=NEW."agentId"
        AND a."workdayId"=NEW."correctionWorkdayId" AND w."agentId"=a."agentId"
        AND g."userId"=a."actorUserId" AND NEW."startDate"=w."workDate"
        AND NEW."endDate"=w."workDate"
        AND (NEW."exceptionCaseId" IS NULL OR NEW."exceptionCaseId"=a."caseId"))
  ) THEN
    RAISE EXCEPTION 'Correction browser requests must target approved synthetic own days' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_correction_browser_request_insert BEFORE INSERT ON mtm_hrm_requests
  FOR EACH ROW EXECUTE FUNCTION wf_correction_browser_request_insert();

CREATE FUNCTION wf_correction_browser_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action <> 'WORKFORCE_SELF_REQUEST_SUBMITTED' OR NEW.entity <> 'hrm_request'
    OR NEW."metadataKind" IS DISTINCT FROM 'workforce_self_request' OR NEW."oldData" IS NOT NULL
    OR jsonb_typeof(NEW."newData") IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."newData")) <> 6
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."newData") k(key)
      WHERE k.key <> ALL(ARRAY['type','startDate','endDate','correctionRequested',
        'exceptionCaseLinked','exceptionCaseRevision']))
    OR NOT EXISTS (SELECT 1 FROM mtm_hrm_requests r
      JOIN wf_correction_browser_allowed_days a ON a."organizationId"=r."organizationId"
        AND a."agentId"=r."agentId" AND a."workdayId"=r."correctionWorkdayId"
      WHERE r.id=NEW."entityId" AND r."organizationId"=NEW."organizationId"
        AND r."agentId"=NEW."agentId" AND r.type::text='TIME_CORRECTION'
        AND NEW."newData"->>'type'=r.type::text
        AND NEW."newData"->>'startDate'=to_char(r."startDate",'YYYY-MM-DD')
        AND NEW."newData"->>'endDate'=to_char(r."endDate",'YYYY-MM-DD')
        AND NEW."newData"->'correctionRequested'='true'::jsonb
        AND NEW."newData"->'exceptionCaseLinked'=to_jsonb(r."exceptionCaseId" IS NOT NULL)
        AND NEW."newData"->'exceptionCaseRevision'=COALESCE(to_jsonb(r."exceptionCaseRevision"),'null'::jsonb)) THEN
    RAISE EXCEPTION 'Correction browser audit must match an actual submitted own request' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_correction_browser_audit_insert BEFORE INSERT ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_correction_browser_audit_insert();
CREATE FUNCTION wf_correction_browser_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Correction browser audit is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER wf_correction_browser_audit_immutable BEFORE UPDATE OR DELETE ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_correction_browser_audit_immutable();
COMMIT;
