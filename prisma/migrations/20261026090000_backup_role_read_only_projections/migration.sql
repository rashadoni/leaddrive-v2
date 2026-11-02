-- 20260906120000_projection_replay_control_plane mirrors INSERT/UPDATE on
-- projection_activations and INSERT on projection_promotion_events to every
-- role that can SELECT projection_builds. The backup role reads every table,
-- so it was swept up too. scripts/backup/postgres-backup.sh refuses to dump
-- with a role that can write anything, and on production 13.140.132.245 the
-- owner-operated backup of 2026-10-21 stopped there (ROLE_POLICY). The two
-- grants were revoked by hand that night with the owner's approval; this
-- migration makes the same correction for every other database.
--
-- The backup role is recognised by what it is, not by its name, because names
-- differ per environment and naming a missing role would fail the migration:
-- it bypasses RLS, is not a superuser, and is pinned to read-only transactions
-- (scripts/backup/bootstrap-backup-role.sql). The application role never has
-- that read-only setting, so its write access is untouched. SELECT stays.
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
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.projection_activations, public.projection_promotion_events FROM %I',
      read_only_role
    );
  END LOOP;
END $$;
