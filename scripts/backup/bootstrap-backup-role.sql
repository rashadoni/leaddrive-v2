\set ON_ERROR_STOP on

\if :{?backup_role}
\else
  \echo 'ERROR: pass -v backup_role=leaddrive_backup'
  \quit 1
\endif

-- Run this file as the database owner/managed admin.  The role is deliberately
-- created NOLOGIN: set its password interactively with \password and enable
-- LOGIN only after the grants and preflight checks below succeed.  This keeps a
-- plaintext password out of the repository, shell history and SQL logs.
SELECT format(
  'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
  :'backup_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'backup_role'
) \gexec

SELECT format(
  'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
  :'backup_role'
) \gexec

SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'backup_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'backup_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'backup_role') \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'backup_role') \gexec
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'backup_role') \gexec
SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', :'backup_role') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'backup_role') \gexec
SELECT format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'backup_role') \gexec

-- Default privileges are owned by the object-creating role, not by the backup
-- role.  Cover every owner currently creating tables/sequences in public so a
-- future migration cannot silently produce a partial dump.
SELECT DISTINCT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
  owner_name,
  :'backup_role'
)
FROM (
  SELECT tableowner AS owner_name FROM pg_tables WHERE schemaname = 'public'
  UNION
  SELECT sequenceowner AS owner_name FROM pg_sequences WHERE schemaname = 'public'
) owners
ORDER BY 1
\gexec

SELECT DISTINCT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I',
  owner_name,
  :'backup_role'
)
FROM (
  SELECT tableowner AS owner_name FROM pg_tables WHERE schemaname = 'public'
  UNION
  SELECT sequenceowner AS owner_name FROM pg_sequences WHERE schemaname = 'public'
) owners
ORDER BY 1
\gexec

-- These rows are the operator-visible proof.  Expected: super=f, bypass=t,
-- login=f, memberships=0.  Enable LOGIN only after setting the password.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole,
       rolinherit, rolreplication
FROM pg_roles
WHERE rolname = :'backup_role';

SELECT count(*) AS memberships
FROM pg_auth_members m
JOIN pg_roles member_role ON member_role.oid = m.member
WHERE member_role.rolname = :'backup_role';

SELECT count(*) AS roles_that_can_assume_backup_role
FROM pg_auth_members m
JOIN pg_roles granted_role ON granted_role.oid = m.roleid
WHERE granted_role.rolname = :'backup_role';

SELECT
  (SELECT count(*)
     FROM pg_auth_members m
     JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = :'backup_role') AS backup_outbound_memberships,
  (SELECT count(*)
     FROM pg_auth_members m
     JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE granted_role.rolname = :'backup_role') AS backup_inbound_memberships
\gset

\if :backup_outbound_memberships
  \echo 'ERROR: backup role inherits another role; revoke membership before enabling LOGIN'
  \quit 1
\endif
\if :backup_inbound_memberships
  \echo 'ERROR: another role can assume the BYPASSRLS backup role; revoke membership before enabling LOGIN'
  \quit 1
\endif
