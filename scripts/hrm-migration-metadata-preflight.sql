-- Fixed catalog/ledger projection only. Never select HR business rows or logs.
-- Observe actual fresh migration-role defaults BEFORE transaction-local bounds.
SELECT pg_catalog.json_build_object(
  'lockTimeoutMs',(SELECT setting::integer FROM pg_catalog.pg_settings WHERE name='lock_timeout'),
  'statementTimeoutMs',(SELECT setting::integer FROM pg_catalog.pg_settings WHERE name='statement_timeout'),
  'readOnlyForced',pg_catalog.current_setting('default_transaction_read_only')='on'
);

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SET LOCAL search_path=pg_catalog,public;

-- Refuse a missing/filtered migration ledger before reading its metadata.
DO $$
BEGIN
  IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public._prisma_migrations')) IS DISTINCT FROM 'r'
     OR pg_catalog.row_security_active('public._prisma_migrations'::regclass) THEN
    RAISE EXCEPTION 'HRM migration metadata ledger is unavailable';
  END IF;
END $$;

WITH
plan_migrations(name,checksum) AS (VALUES
  ('20261005193000_workforce_reconciliation_operations','c452e7f6d13dca1e5257d8353c252745d05cd4f18eae83cd45501f61664ef719'),
  ('20261006150000_workforce_transferred_assignment_window','239c19f1a973fd0687fc0d558d628befa50cbe3ce9e6a3a0b24c02361a7e533f')
),
plan_relations(name,required) AS (VALUES
  ('organizations',true),
  ('mtm_agent_workdays',true),('mtm_agent_workday_events',true),
  ('workforce_site_transitions',true),('workforce_attendance_evidence',true),
  ('workforce_evidence_assessments',true),('workforce_exception_cases',true),
  ('workforce_exception_decisions',true),
  ('workforce_timesheet_approvals',true),('mtm_audit_logs',true),
  ('workforce_shift_assignments',true),('workforce_shift_templates',true),
  ('workforce_shift_snapshots',true),('mtm_agents',true),
  ('workforce_reconciliation_tenant_states',false)
),
dependency_columns(table_name,name,type_name,not_null) AS (VALUES
  ('workforce_exception_decisions','caseId','text',true),
  ('workforce_exception_decisions','caseRevision','integer',true),
  ('mtm_agents','teamId','text',false),
  ('workforce_shift_templates','teamId','text',false),
  ('workforce_shift_templates','status','public."WorkforceDefinitionStatus"',true),
  ('workforce_shift_assignments','agentId','text',true),
  ('workforce_shift_assignments','templateId','text',true),
  ('workforce_shift_assignments','assignedByUserId','text',true),
  ('workforce_shift_assignments','effectiveFrom','date',true),
  ('workforce_shift_assignments','effectiveTo','date',false),
  ('workforce_shift_snapshots','assignmentId','text',false),
  ('workforce_shift_snapshots','workDate','date',true),
  ('workforce_timesheet_approvals','agentId','text',true),
  ('workforce_timesheet_approvals','periodStart','date',true),
  ('workforce_timesheet_approvals','periodEnd','date',true)
),
plan_indexes(name,table_name,keys,c_keys) AS (VALUES
  ('wf_reconciliation_due_attempt_org_idx','workforce_reconciliation_tenant_states',ARRAY['dueAt','lastAttemptAt','organizationId'],ARRAY[]::text[]),
  ('wf_recon_workdays_c_idx','mtm_agent_workdays',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_events_c_idx','mtm_agent_workday_events',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_transitions_c_idx','workforce_site_transitions',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_evidence_c_idx','workforce_attendance_evidence',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_assessments_c_idx','workforce_evidence_assessments',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_exceptions_c_idx','workforce_exception_cases',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_approvals_c_idx','workforce_timesheet_approvals',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_exports_c_idx','mtm_audit_logs',ARRAY['organizationId','id'],ARRAY['id']),
  ('wf_recon_approval_group_c_idx','workforce_timesheet_approvals',ARRAY['organizationId','agentId','periodStart','periodEnd','id'],ARRAY['agentId','id'])
),
role_state AS (
  SELECT oid,rolsuper,rolbypassrls,rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user
),
migrations AS (
  SELECT p.name,p.checksum,
    count(m.id)::integer AS rows,
    count(m.id) FILTER (WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)::integer AS applied,
    count(m.id) FILTER (WHERE m.finished_at IS NULL AND m.rolled_back_at IS NULL)::integer AS unresolved,
    count(m.id) FILTER (WHERE m.rolled_back_at IS NOT NULL)::integer AS rolled_back,
    COALESCE(bool_and(m.checksum=p.checksum) FILTER (WHERE m.id IS NOT NULL),true) AS checksum_match
  FROM plan_migrations p LEFT JOIN public._prisma_migrations m ON m.migration_name=p.name
  GROUP BY p.name,p.checksum
),
relations AS (
  SELECT p.name,p.required,c.oid,
    c.oid IS NOT NULL AS present,
    COALESCE(c.relkind='r',false) AS ordinary_table,
    COALESCE(c.relrowsecurity,false) AS rls,
    COALESCE(c.relforcerowsecurity,false) AS forced_rls,
    COALESCE((SELECT rolsuper FROM role_state) OR pg_catalog.pg_has_role(current_user,c.relowner,'USAGE'),false) AS owner_ability,
    CASE WHEN c.oid IS NULL THEN 0 ELSE pg_catalog.pg_total_relation_size(c.oid) END AS bytes,
    CASE WHEN c.oid IS NULL THEN 0 ELSE GREATEST(-1,c.reltuples::bigint) END AS estimated_rows,
    COALESCE((SELECT bool_and(a.attname IS NOT NULL AND a.atttypid='text'::regtype AND a.attnotnull)
      FROM (VALUES ('organizationId'),('id')) k(name)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=k.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE p.name<>'organizations' OR k.name='id'),false)
      AND COALESCE((SELECT bool_and(a.attname IS NOT NULL AND a.atttypid=to_regtype(k.type_name) AND a.attnotnull=k.not_null)
        FROM dependency_columns k LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=k.name AND a.attnum>0 AND NOT a.attisdropped
        WHERE k.table_name=p.name),true)
      AND (p.name<>'organizations' OR EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname='id'
        WHERE i.indrelid=c.oid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=1 AND i.indkey[0]=a.attnum))
      AND (p.name<>'workforce_shift_templates' OR (SELECT array_agg(e.enumlabel::text ORDER BY e.enumlabel) FROM pg_catalog.pg_enum e WHERE e.enumtypid=to_regtype('public."WorkforceDefinitionStatus"'))=ARRAY['ACTIVE','DRAFT','RETIRED'])
      AS key_columns_match
  FROM plan_relations p LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.'||p.name)
),
indexes AS (
  SELECT p.name,ic.oid IS NOT NULL AS present,
    COALESCE(ic.relkind='i' AND t.relname=p.table_name AND am.amname='btree'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=cardinality(p.keys) AND i.indnkeyatts=i.indnatts
      AND (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,n)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=p.keys
      AND (SELECT bool_and(k.option=0) FROM unnest(i.indoption::smallint[]) k(option))
      AND (SELECT bool_and(CASE WHEN a.attname=ANY(p.c_keys) THEN col.collname='C' ELSE k.collation_oid=a.attcollation END)
        FROM unnest(i.indkey::smallint[],i.indcollation::oid[]) WITH ORDINALITY k(attnum,collation_oid,n)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        LEFT JOIN pg_catalog.pg_collation col ON col.oid=k.collation_oid AND col.collnamespace='pg_catalog'::regnamespace)
      AND (SELECT bool_and(opc.opcdefault AND opc.opcintype=a.atttypid AND opc.opcmethod=ic.relam AND opc.opcnamespace='pg_catalog'::regnamespace)
        FROM unnest(i.indkey::smallint[],i.indclass::oid[]) k(attnum,opclass)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid=k.opclass),false) AS shape_match
  FROM plan_indexes p LEFT JOIN pg_catalog.pg_class ic ON ic.oid=pg_catalog.to_regclass('public.'||p.name)
  LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=ic.oid
  LEFT JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
  LEFT JOIN pg_catalog.pg_am am ON am.oid=ic.relam
),
guard AS (
  SELECT p.oid,p.prosrc,p.proowner,
    p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql'
      AND NOT p.prosecdef AND NOT p.proleakproof AND p.provolatile='v' AND p.proconfig IS NULL AS shape_match
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid=pg_catalog.to_regprocedure('public.workforce_guard_shift_assignment()')
),
ledger_guard_functions AS (
  SELECT plan.kind,p.oid,
    COALESCE(p.pronargs=0 AND p.prorettype='trigger'::regtype AND NOT p.proretset AND p.prokind='f'
      AND l.lanname='plpgsql' AND NOT p.prosecdef AND NOT p.proleakproof
      AND p.provolatile='v' AND p.proconfig IS NULL AND md5(p.prosrc)=plan.body_md5,false) AS matches
  FROM (VALUES
    ('append','workforce_reject_exception_decision_mutation','eba304d394c516e8439246844c269722'),
    ('revision','workforce_assign_exception_decision_revision','ff5eb1a7ab63f1c9e7d75f926180f643')
  ) plan(kind,name,body_md5)
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('public.'||plan.name||'()')
  LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
),
default_acl AS (
  SELECT d.defaclobjtype,x.grantee,x.privilege_type,x.is_grantable
  FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
  WHERE d.defaclrole=(SELECT oid FROM role_state)
    AND d.defaclnamespace IN (0,'public'::regnamespace) AND d.defaclobjtype='r'
)
SELECT pg_catalog.json_build_object(
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
  'repeatableRead',pg_catalog.current_setting('transaction_isolation')='repeatable read',
  'roleProfile',pg_catalog.json_build_object(
    'noSuperuser',COALESCE((SELECT NOT rolsuper FROM role_state),false),
    'bypassRls',COALESCE((SELECT rolbypassrls FROM role_state),false),
    'canLogin',COALESCE((SELECT rolcanlogin FROM role_state),false),
    'sessionIdentityUnchanged',current_user=session_user,
    'expectedIdentity',COALESCE(current_user=current_setting('hrm.preflight_expected_role',true) AND session_user=current_setting('hrm.preflight_expected_role',true),false)
  ),
  'ledger',pg_catalog.json_build_object(
    'totalRows',(SELECT count(*) FROM public._prisma_migrations),
    'unresolvedRows',(SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL),
    'known',(SELECT json_agg(json_build_object('name',name,'rows',rows,'applied',applied,'unresolved',unresolved,'rolledBack',rolled_back,'checksumMatch',checksum_match) ORDER BY name) FROM migrations)
  ),
  'relations',(SELECT json_agg(json_build_object('name',name,'present',present,'ordinaryTable',ordinary_table,'rls',rls,'forcedRls',forced_rls,'ownerAbility',owner_ability,'bytes',bytes,'estimatedRows',estimated_rows,'keyColumnsMatch',key_columns_match) ORDER BY name) FROM relations),
  'indexes',(SELECT json_agg(json_build_object('name',name,'present',present,'shapeMatch',shape_match) ORDER BY name) FROM indexes),
  'guard',pg_catalog.json_build_object(
    'present',EXISTS(SELECT 1 FROM guard),
    'shapeMatch',COALESCE((SELECT shape_match FROM guard),false),
    'bodyMd5',(SELECT md5(prosrc) FROM guard),
    'ownerAbility',COALESCE((SELECT (SELECT rolsuper FROM role_state) OR pg_has_role(current_user,proowner,'USAGE') FROM guard),false),
    'triggerBound',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass('public.workforce_shift_assignments') AND t.tgname='workforce_shift_assignments_guard' AND t.tgfoid=(SELECT oid FROM guard) AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=23)
  ),
  -- Catalog proof for the existing API's row UPDATE/DELETE/INSERT contract.
  -- It does not claim TRUNCATE protection or resistance to privileged bypass.
  'ledgerGuards',pg_catalog.json_build_object(
    'appendFunctionMatches',(SELECT matches FROM ledger_guard_functions WHERE kind='append'),
    'revisionFunctionMatches',(SELECT matches FROM ledger_guard_functions WHERE kind='revision'),
    'appendTriggerBound',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=to_regclass('public.workforce_exception_decisions') AND t.tgname='workforce_exception_decisions_append_only'
        AND t.tgfoid=(SELECT oid FROM ledger_guard_functions WHERE kind='append') AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgtype=27 AND t.tgqual IS NULL AND t.tgnargs=0 AND cardinality(t.tgattr::smallint[])=0 AND t.tgconstraint=0),
    'revisionTriggerBound',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=to_regclass('public.workforce_exception_decisions') AND t.tgname='workforce_exception_decisions_assign_case_revision'
        AND t.tgfoid=(SELECT oid FROM ledger_guard_functions WHERE kind='revision') AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgtype=7 AND t.tgqual IS NULL AND t.tgnargs=0 AND cardinality(t.tgattr::smallint[])=0 AND t.tgconstraint=0)
  ),
  'defaultAcl',pg_catalog.json_build_object(
    'canCreatePublicSchema',has_schema_privilege(current_user,'public','CREATE'),
    'explicitPrivilegeRows',(SELECT count(*) FROM default_acl),
    'publicPrivilegeRows',(SELECT count(*) FROM default_acl WHERE grantee=0),
    'nonOwnerWriteRows',(SELECT count(*) FROM default_acl WHERE grantee<>(SELECT oid FROM role_state) AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')),
    'grantableRows',(SELECT count(*) FROM default_acl WHERE is_grantable)
  ),
  'activity',pg_catalog.json_build_object(
    -- NULL state denotes another principal's unreadable activity fields.
    -- Observe actual coverage, without demanding a new monitoring grant.
    'visibilityComplete',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IS NULL),
    'otherActiveSessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IS DISTINCT FROM 'idle'),
    'otherOpenTransactions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL),
    'lockWaitSessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock')
  )
);
COMMIT;
