-- Supplemental configured-backup attribution only; no ACL approval or business rows.
-- Supplemental live catalog evidence only; original identity/ACL gates stay unchanged.
-- The helper keeps runtime stdin open after this SELECT and rolls back both sessions.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
WITH identity_role AS (
  SELECT oid,rolsuper,rolbypassrls,rolcanlogin FROM pg_catalog.pg_roles
  WHERE rolname=session_user
), runtime_role AS (
  SELECT oid,rolsuper,rolbypassrls,rolcanlogin FROM pg_catalog.pg_roles
  WHERE rolname=pg_catalog.current_setting('hrm.live_runtime_role')
), acl_rows AS (
  SELECT CASE WHEN d.defaclnamespace=0 THEN 'GLOBAL' ELSE 'PUBLIC_SCHEMA' END AS scope,
    CASE WHEN x.grantee=0 THEN 'PUBLIC'
      WHEN x.grantee=(SELECT oid FROM identity_role) THEN 'OWNER'
      WHEN x.grantee=(SELECT oid FROM runtime_role) THEN 'EXPECTED_RUNTIME'
      ELSE 'OTHER' END AS recipient,
    x.grantee,x.privilege_type,x.is_grantable
  FROM pg_catalog.pg_default_acl d
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
  WHERE pg_catalog.current_setting('hrm.live_mode')='migration'
    AND d.defaclrole=(SELECT oid FROM identity_role)
    AND d.defaclnamespace IN (0,'public'::regnamespace) AND d.defaclobjtype='r'
), profiled_acl AS (
  SELECT a.*,r.oid IS NOT NULL AS present,
    COALESCE(NOT r.rolsuper,false) AS no_superuser,
    COALESCE(NOT r.rolbypassrls,false) AS no_bypass_rls,
    COALESCE(r.rolcanlogin,false) AS can_login,
    (SELECT count(*) FROM pg_catalog.pg_roles p
      WHERE r.oid IS NOT NULL AND p.oid<>r.oid AND (p.rolsuper OR p.rolbypassrls)
        AND pg_catalog.pg_has_role(r.oid,p.oid,'SET')) AS set_privileged_count
  FROM acl_rows a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
), grouped_acl AS (
  SELECT scope,recipient,privilege_type,is_grantable,present,no_superuser,no_bypass_rls,
    can_login,set_privileged_count,count(*) AS row_count
  FROM profiled_acl
  GROUP BY scope,recipient,privilege_type,is_grantable,present,no_superuser,no_bypass_rls,
    can_login,set_privileged_count
) , backup_role AS (
  SELECT oid,rolsuper,rolbypassrls,rolcanlogin,rolcreatedb,rolcreaterole,rolinherit,rolreplication
  FROM pg_catalog.pg_roles WHERE rolname=pg_catalog.current_setting('hrm.backup_expected_role')
), other_acl_rows AS (
  SELECT * FROM acl_rows WHERE recipient='OTHER'
), backup_read_only_override AS (
  SELECT pg_catalog.split_part(setting,'=',2)::boolean AS read_only
  FROM pg_catalog.pg_db_role_setting s
  CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) AS settings(setting)
  WHERE EXISTS(SELECT 1 FROM backup_role)
    AND s.setrole IN (0,(SELECT oid FROM backup_role))
    AND s.setdatabase IN (0,(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
    AND (s.setrole<>0 OR s.setdatabase<>0)
    AND pg_catalog.split_part(setting,'=',1)='default_transaction_read_only'
  ORDER BY CASE
    WHEN s.setrole=(SELECT oid FROM backup_role) AND s.setdatabase<>0 THEN 0
    WHEN s.setrole=(SELECT oid FROM backup_role) AND s.setdatabase=0 THEN 1
    ELSE 2 END
  LIMIT 1
), live_snapshot AS (
SELECT pg_catalog.json_build_object(
  'mode',pg_catalog.current_setting('hrm.live_mode'),
  'identity',pg_catalog.json_build_object(
    'expectedIdentity',session_user=pg_catalog.current_setting('hrm.live_expected_role'),
    'sessionIdentityUnchanged',current_user=session_user,
    'primary',NOT pg_catalog.pg_is_in_recovery(),
    'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
    'repeatableRead',pg_catalog.current_setting('transaction_isolation')='repeatable read',
    'probeNameVerified',CASE WHEN pg_catalog.current_setting('hrm.live_mode')='runtime'
      THEN pg_catalog.current_setting('application_name')=pg_catalog.current_setting('hrm.live_probe_name')
      ELSE pg_catalog.current_setting('application_name')='hrm_loopback_acl_inspection' END,
    'backendPid',pg_catalog.pg_backend_pid()::text,
    'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()),
    'databaseName',current_database(),
    'liveRuntimeSeen',CASE WHEN pg_catalog.current_setting('hrm.live_mode')='migration'
      THEN EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a
        WHERE a.pid=pg_catalog.current_setting('hrm.live_expected_pid')::integer
          AND a.application_name=pg_catalog.current_setting('hrm.live_probe_name')
          AND a.usename=pg_catalog.current_setting('hrm.live_runtime_role')
          AND a.datid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
      ELSE false END),
  'roleProfile',pg_catalog.json_build_object(
    'present',EXISTS(SELECT 1 FROM identity_role),
    'noSuperuser',COALESCE((SELECT NOT rolsuper FROM identity_role),false),
    'noBypassRls',COALESCE((SELECT NOT rolbypassrls FROM identity_role),false),
    'canLogin',COALESCE((SELECT rolcanlogin FROM identity_role),false),
    'setPrivilegedCount',(SELECT count(*) FROM pg_catalog.pg_roles p
      WHERE p.oid<>(SELECT oid FROM identity_role) AND (p.rolsuper OR p.rolbypassrls)
        AND pg_catalog.pg_has_role((SELECT oid FROM identity_role),p.oid,'SET'))),
  'acl',pg_catalog.json_build_object(
    'explicitPrivilegeRows',(SELECT count(*) FROM acl_rows),
    'publicPrivilegeRows',(SELECT count(*) FROM acl_rows WHERE grantee=0),
    'nonOwnerWriteRows',(SELECT count(*) FROM acl_rows
      WHERE grantee<>(SELECT oid FROM identity_role)
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')),
    'grantableRows',(SELECT count(*) FROM acl_rows WHERE is_grantable),
    'entries',COALESCE((SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
      'scope',scope,'recipient',recipient,'privilege',privilege_type,
      'grantable',is_grantable,'rowCount',row_count,
      'recipientProfile',pg_catalog.json_build_object(
        'present',present,'noSuperuser',no_superuser,'noBypassRls',no_bypass_rls,
        'canLogin',can_login,'setPrivilegedCount',set_privileged_count))
      ORDER BY scope COLLATE "C",recipient COLLATE "C",privilege_type COLLATE "C",
        is_grantable,present,no_superuser,no_bypass_rls,can_login,set_privileged_count)
      FROM grouped_acl),'[]'::json))) AS snapshot
)
SELECT pg_catalog.json_build_object(
  'snapshot',(SELECT snapshot FROM live_snapshot),
  'attribution',pg_catalog.json_build_object(
    'declaredRolePresent',EXISTS(SELECT 1 FROM backup_role),
    'separateFromRuntimeAndMigration',COALESCE((SELECT oid FROM backup_role)
      NOT IN ((SELECT oid FROM runtime_role),(SELECT oid FROM identity_role)),false),
    'noSuperuser',COALESCE((SELECT NOT rolsuper FROM backup_role),false),
    'bypassRls',COALESCE((SELECT rolbypassrls FROM backup_role),false),
    'canLogin',COALESCE((SELECT rolcanlogin FROM backup_role),false),
    'noCreateDb',COALESCE((SELECT NOT rolcreatedb FROM backup_role),false),
    'noCreateRole',COALESCE((SELECT NOT rolcreaterole FROM backup_role),false),
    'noInherit',COALESCE((SELECT NOT rolinherit FROM backup_role),false),
    'noReplication',COALESCE((SELECT NOT rolreplication FROM backup_role),false),
    'defaultReadOnly',COALESCE((SELECT read_only FROM backup_read_only_override),false),
    'outboundMemberships',(SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE member=(SELECT oid FROM backup_role)),
    'inboundMemberships',(SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE roleid=(SELECT oid FROM backup_role)),
    'setPrivilegedCount',(SELECT count(*) FROM pg_catalog.pg_roles p
      WHERE EXISTS(SELECT 1 FROM backup_role) AND p.oid<>(SELECT oid FROM backup_role)
        AND (p.rolsuper OR p.rolbypassrls)
        AND pg_catalog.pg_has_role((SELECT oid FROM backup_role),p.oid,'SET')),
    'otherPrivilegeRows',(SELECT count(*) FROM other_acl_rows),
    'matchedOtherPrivilegeRows',(SELECT count(*) FROM other_acl_rows WHERE grantee=(SELECT oid FROM backup_role)),
    'otherSelectRows',(SELECT count(*) FROM other_acl_rows WHERE privilege_type='SELECT'),
    'otherWriteRows',(SELECT count(*) FROM other_acl_rows
      WHERE privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')),
    'otherGrantableRows',(SELECT count(*) FROM other_acl_rows WHERE is_grantable),
    'otherRecipientCount',(SELECT count(DISTINCT grantee) FROM other_acl_rows),
    'matchedOtherRecipientCount',(SELECT count(DISTINCT grantee) FROM other_acl_rows
      WHERE grantee=(SELECT oid FROM backup_role))));
