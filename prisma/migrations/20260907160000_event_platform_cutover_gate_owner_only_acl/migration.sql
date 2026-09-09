-- The Fund cutover gate must be readable and writable by its migration-role
-- owner and by nobody else. `scripts/event-platform-postconditions.sql` asserts
-- exactly that: it counts every ACL entry on event_platform_cutover_gates whose
-- grantee is not the table owner and fails the deployment if the count is not
-- zero.
--
-- The table is created by 20260901090000_event_platform_foundation, which never
-- grants anything on it. But a production database can carry ALTER DEFAULT
-- PRIVILEGES for the migration role, and those grants land on the new table the
-- moment it is created, without a single GRANT statement in the migration. On
-- production 13.140.132.245 that gave the backup role SELECT, and the
-- postcondition failed after the irreversible migration had already committed
-- and PM2 had already been stopped. The deployment could not finish and the
-- site stayed down until the grant was removed by hand on 2026-09-07.
--
-- So the migration set has to strip the table itself rather than assume no one
-- granted anything. Written as a loop over the actual ACL because the roles
-- differ per environment: production uses hermes/leaddrive_migrator/
-- leaddrive_backup, CI uses its own, and naming a role that does not exist
-- would fail the migration.
DO $$
DECLARE
  grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(acl.grantee)
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
     WHERE c.oid = 'public.event_platform_cutover_gates'::regclass
       AND acl.grantee <> c.relowner
       AND acl.grantee <> 0
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.event_platform_cutover_gates FROM %I',
      grantee_name
    );
  END LOOP;

  -- grantee 0 is PUBLIC and has no role name to format above.
  EXECUTE 'REVOKE ALL ON TABLE public.event_platform_cutover_gates FROM PUBLIC';
END
$$;
