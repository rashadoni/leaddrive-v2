-- Separate disposable hosted classification job only. Apply AFTER the
-- unmodified Today fixture, NEVER with the report-browser extension.
-- The report fixture remains SELECT-only. This separate job grants only
-- decision/audit INSERT, the existing three login UPDATE columns and the
-- server-issued/consumed MFA nonce column. Factor enrollment is owner seeding;
-- the app role cannot change factors, credentials, recovery codes or grants.
-- The harness imports exact production decision revision/append-only routines
-- after synthetic historical seeding. This is not a full migration replay.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wf_manager_today_browser'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proname='wf_report_browser_audit_insert') THEN
    RAISE EXCEPTION 'Classification fixture requires its separate restricted hosted database';
  END IF;
END $$;

CREATE TABLE wf_classification_browser_allowed_cases (
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  PRIMARY KEY ("organizationId","caseId","actorUserId"),
  FOREIGN KEY ("organizationId","caseId") REFERENCES workforce_exception_cases("organizationId",id),
  FOREIGN KEY ("organizationId","actorUserId") REFERENCES users("organizationId",id)
);
GRANT SELECT ON wf_classification_browser_allowed_cases TO wf_manager_today_browser;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workforce_exception_employee_responses','mtm_hrm_requests','workforce_time_corrections','mtm_audit_logs','wf_classification_browser_allowed_cases'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY wf_classification_browser_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true)) '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))', table_name);
  END LOOP;
END $$;
GRANT INSERT ON workforce_exception_decisions,mtm_audit_logs TO wf_manager_today_browser;
GRANT UPDATE ("twoFactorNonce") ON users TO wf_manager_today_browser;
CREATE FUNCTION wf_classification_browser_mfa_nonce_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser'
    AND NEW."twoFactorNonce" IS DISTINCT FROM OLD."twoFactorNonce"
    AND (NOT OLD."isActive" OR NOT OLD."require2fa" OR NOT OLD."totpEnabled"
      OR OLD."totpSecret" IS NULL
      OR (NEW."twoFactorNonce" IS NOT NULL AND NEW."twoFactorNonce" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Classification browser MFA nonce requires an enrolled synthetic principal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_classification_browser_mfa_nonce_only BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION wf_classification_browser_mfa_nonce_only();
-- PostgreSQL SELECT ... FOR SHARE requires an UPDATE privilege. The real
-- historical-membership resolver locks the agent row; this one-column grant
-- permits that lock while the unconditional trigger rejects every mutation.
GRANT UPDATE (id) ON mtm_agents TO wf_manager_today_browser;
CREATE FUNCTION wf_classification_browser_agent_lock_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Classification browser employee facts are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER wf_classification_browser_agent_lock_only BEFORE UPDATE OR DELETE ON mtm_agents
  FOR EACH ROW EXECUTE FUNCTION wf_classification_browser_agent_lock_only();

CREATE FUNCTION wf_classification_browser_decision_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='wf_manager_today_browser' AND (
    NEW."decisionCode" <> ALL(ARRAY['CLASSIFY_FALSE_POSITIVE','CLASSIFY_CONFIRMED_EXCEPTION',
      'APPEAL_FULLY_UPHELD','APPEAL_PARTIALLY_UPHELD','APPEAL_REJECTED'])
    OR NOT EXISTS (SELECT 1 FROM wf_classification_browser_allowed_cases a
      WHERE a."organizationId"=NEW."organizationId" AND a."caseId"=NEW."caseId"
        AND a."actorUserId"=NEW."actorUserId")
    OR char_length(btrim(NEW.reason)) < 3 OR char_length(NEW.reason) > 1000
  ) THEN
    RAISE EXCEPTION 'Classification browser writes must target approved synthetic HR cases' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_classification_browser_decision_insert BEFORE INSERT ON workforce_exception_decisions
  FOR EACH ROW EXECUTE FUNCTION wf_classification_browser_decision_insert();

-- Synthetic audit whitelist, separately identified in receipts. It does not
-- claim that this fixture guard is a production MtmAuditLog migration.
CREATE FUNCTION wf_classification_browser_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action <> 'WORKFORCE_EXCEPTION_DECISION_RECORDED'
    OR NEW.entity <> 'workforce_exception_decision'
    OR NEW."metadataKind" IS DISTINCT FROM 'workforce_exception_lifecycle'
    OR NEW."agentId" IS NOT NULL OR NEW."oldData" IS NOT NULL
    OR NEW."ipAddress" IS NOT NULL OR NEW."userAgent" IS NOT NULL
    OR jsonb_typeof(NEW."newData") IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."newData")) <> 5
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW."newData") k(key)
      WHERE k.key <> ALL(ARRAY['caseId','operationId','decisionCode','caseRevision','policyMode']))
    OR NEW."newData"->>'policyMode' <> 'REVIEWED_V1'
    OR NOT EXISTS (SELECT 1 FROM workforce_exception_decisions d
      JOIN wf_classification_browser_allowed_cases a ON a."organizationId"=d."organizationId"
        AND a."caseId"=d."caseId" AND a."actorUserId"=d."actorUserId"
      WHERE d.id=NEW."entityId" AND d."organizationId"=NEW."organizationId"
        AND d."caseId"=NEW."newData"->>'caseId'
        AND d."operationId"=NEW."newData"->>'operationId'
        AND d."decisionCode"=NEW."newData"->>'decisionCode'
        AND d."caseRevision"::text=NEW."newData"->>'caseRevision') THEN
    RAISE EXCEPTION 'Classification browser audit must match an actual recorded decision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf_classification_browser_audit_insert BEFORE INSERT ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_classification_browser_audit_insert();
CREATE FUNCTION wf_classification_browser_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Synthetic classification audit is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER wf_classification_browser_audit_immutable BEFORE UPDATE OR DELETE ON mtm_audit_logs
  FOR EACH ROW EXECUTE FUNCTION wf_classification_browser_audit_immutable();

DO $$
DECLARE app_oid oid;
BEGIN
  SELECT oid INTO app_oid FROM pg_roles WHERE rolname='wf_manager_today_browser';
  IF NOT has_table_privilege(app_oid,'workforce_exception_decisions','INSERT')
    OR NOT has_table_privilege(app_oid,'mtm_audit_logs','INSERT')
    OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND c.relkind IN ('r','p') AND c.relname NOT IN ('users','mtm_agents','workforce_exception_decisions','mtm_audit_logs')
      AND (has_any_column_privilege(app_oid,c.oid,'INSERT') OR has_any_column_privilege(app_oid,c.oid,'UPDATE')
        OR has_table_privilege(app_oid,c.oid,'DELETE') OR has_table_privilege(app_oid,c.oid,'TRUNCATE')))
    OR has_any_column_privilege(app_oid,'workforce_exception_decisions','UPDATE')
    OR has_table_privilege(app_oid,'workforce_exception_decisions','DELETE,TRUNCATE')
    OR has_any_column_privilege(app_oid,'mtm_audit_logs','UPDATE')
    OR has_table_privilege(app_oid,'mtm_audit_logs','DELETE,TRUNCATE')
    OR has_table_privilege(app_oid,'mtm_agents','UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(app_oid,'users','UPDATE,INSERT,DELETE,TRUNCATE')
    OR NOT has_column_privilege(app_oid,'users','twoFactorNonce','UPDATE')
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='users'::regclass
      AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname<>ALL(ARRAY['lastLogin','loginCount','updatedAt','twoFactorNonce'])
      AND has_column_privilege(app_oid,a.attrelid,a.attname,'UPDATE'))
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='mtm_agents'::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'id'
      AND has_column_privilege(app_oid,a.attrelid,a.attname,'UPDATE')) THEN
    RAISE EXCEPTION 'Classification fixture business privileges are unsafe';
  END IF;
END $$;
COMMIT;
