-- Separate GitHub-hosted disposable employee self-flow rehearsal only.
-- Apply after the unchanged Today fixture. NEVER apply to production or
-- alongside the report/classification extensions. Production response
-- routines and the concurrent cycle index are installed separately from
-- their exact migration statements; this fixture is not migration replay.
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
      ('wf_report_browser_audit_insert','wf_classification_browser_audit_insert')) THEN
    RAISE EXCEPTION 'Employee browser requires its separate restricted hosted database';
  END IF;
END $$;

CREATE TABLE wf_employee_browser_allowed_cases (
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  PRIMARY KEY ("organizationId","caseId","actorUserId"),
  FOREIGN KEY ("organizationId","caseId") REFERENCES workforce_exception_cases("organizationId",id),
  FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id),
  FOREIGN KEY ("organizationId","workdayId") REFERENCES mtm_agent_workdays("organizationId",id),
  FOREIGN KEY ("organizationId","actorUserId") REFERENCES users("organizationId",id)
);
GRANT SELECT ON wf_employee_browser_allowed_cases TO wf_manager_today_browser;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workforce_exception_employee_responses',
    'mtm_hrm_requests','workforce_time_corrections','mtm_audit_logs',
    'wf_employee_browser_allowed_cases'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY wf_employee_browser_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true)) '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))', table_name);
  END LOOP;
END $$;
GRANT INSERT ON workforce_exception_employee_responses,mtm_audit_logs TO wf_manager_today_browser;
-- Existing login columns are unchanged; this single additional column
-- permits real verification/consumption of an already enrolled MFA nonce.
GRANT UPDATE ("twoFactorNonce") ON users TO wf_manager_today_browser;
CREATE FUNCTION wf_employee_browser_mfa_nonce_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser'
    AND NEW."twoFactorNonce" IS DISTINCT FROM OLD."twoFactorNonce"
    AND (NOT OLD."isActive" OR NOT OLD."require2fa" OR NOT OLD."totpEnabled"
      OR OLD."totpSecret" IS NULL
      OR (NEW."twoFactorNonce" IS NOT NULL AND NEW."twoFactorNonce" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Employee browser MFA nonce requires an enrolled synthetic principal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_employee_browser_mfa_nonce_only BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION wf_employee_browser_mfa_nonce_only();

-- A synthetic write allowlist supplements, and never replaces, the exact
-- production ownership/revision/append-only triggers installed by the harness.
CREATE FUNCTION wf_employee_browser_response_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser' AND (
    NEW."responseCode" <> 'ACKNOWLEDGED' OR NEW."correctionRequestId" IS NOT NULL
    OR NEW."observedCaseRevision" IS NULL OR NEW."observedCaseRevision" < 0
    OR NOT EXISTS (SELECT 1 FROM wf_employee_browser_allowed_cases a
      WHERE a."organizationId"=NEW."organizationId" AND a."caseId"=NEW."caseId"
        AND a."agentId"=NEW."agentId" AND a."workdayId"=NEW."workdayId"
        AND a."actorUserId"=NEW."actorUserId")
  ) THEN
    RAISE EXCEPTION 'Employee browser responses must target approved synthetic own cases' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_employee_browser_response_insert BEFORE INSERT ON workforce_exception_employee_responses
  FOR EACH ROW EXECUTE FUNCTION wf_employee_browser_response_insert();

-- Audit shape/link guard is deliberately identified as synthetic. It is
-- not a claim that an MtmAuditLog production migration has been replayed.
CREATE FUNCTION wf_employee_browser_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action <> 'WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RECORDED'
    OR NEW.entity <> 'workforce_exception_employee_response'
    OR NEW."metadataKind" IS DISTINCT FROM 'workforce_exception_employee_response'
    OR NEW."oldData" IS NOT NULL OR NEW."ipAddress" IS NOT NULL OR NEW."userAgent" IS NOT NULL
    OR jsonb_typeof(NEW."newData") IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."newData")) <> 5
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."newData") k(key)
      WHERE k.key <> ALL(ARRAY['caseId','workdayId','observedCaseRevision',
        'segmentLinked','correctionRequested']))
    OR NEW."newData"->'segmentLinked' IS DISTINCT FROM 'false'::jsonb
    OR NEW."newData"->'correctionRequested' IS DISTINCT FROM 'false'::jsonb
    OR NOT EXISTS (SELECT 1 FROM workforce_exception_employee_responses r
      JOIN wf_employee_browser_allowed_cases a ON a."organizationId"=r."organizationId"
        AND a."caseId"=r."caseId" AND a."actorUserId"=r."actorUserId"
      WHERE r.id=NEW."entityId" AND r."organizationId"=NEW."organizationId"
        AND r."agentId"=NEW."agentId" AND r."caseId"=NEW."newData"->>'caseId'
        AND r."workdayId"=NEW."newData"->>'workdayId'
        AND r."observedCaseRevision"::text=NEW."newData"->>'observedCaseRevision') THEN
    RAISE EXCEPTION 'Employee browser audit must match an actual recorded own response' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_employee_browser_audit_insert BEFORE INSERT ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_employee_browser_audit_insert();
CREATE FUNCTION wf_employee_browser_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Employee browser audit is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER wf_employee_browser_audit_immutable BEFORE UPDATE OR DELETE ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_employee_browser_audit_immutable();
COMMIT;
