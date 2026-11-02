-- The backup role must be able to read every table, or pg_dump cannot take a
-- copy at all: on production 13.140.132.245 the owner-operated backup of
-- 2026-10-22 (run 39752397963) stopped at
--   pg_dump: error: query failed: ERROR: permission denied for table event_platform_cutover_gates
-- 20260907160000_event_platform_cutover_gate_owner_only_acl strips every grant
-- from the Fund cutover gate, including the backup role's SELECT, and
-- scripts/event-platform-postconditions.sql refused any non-owner ACL entry.
--
-- Reading the gate gives the backup role nothing it cannot already read in the
-- dump of every other event-platform table, and the gate itself stays
-- writable by its owner only. So the read-only backup role gets SELECT here,
-- and the postcondition (changed in the same release) accepts exactly that
-- entry: SELECT, not grantable, to a non-superuser BYPASSRLS role pinned to
-- read-only transactions. The application role still cannot read the gate.
--
-- The role is recognised by its attributes, as in
-- 20261026090000_backup_role_read_only_projections, because names differ per
-- environment and naming a missing role would fail the migration.
DO $$
DECLARE
  read_only_role text;
BEGIN
  FOR read_only_role IN
    SELECT r.rolname
      FROM pg_catalog.pg_roles r
     WHERE r.rolbypassrls
       AND NOT r.rolsuper
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.pg_db_role_setting s
          WHERE s.setrole = r.oid
            AND 'default_transaction_read_only=on' = ANY (s.setconfig)
       )
  LOOP
    EXECUTE format(
      'GRANT SELECT ON TABLE public.event_platform_cutover_gates TO %I',
      read_only_role
    );
  END LOOP;
END $$;
