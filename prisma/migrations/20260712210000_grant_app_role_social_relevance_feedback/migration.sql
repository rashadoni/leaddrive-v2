-- Hotfix: social_relevance_feedback was the first table created end-to-end by
-- the dedicated NOSUPERUSER BYPASSRLS migration role (prisma migrate deploy in
-- the #306 deploy). The table is therefore owned by the migration role, and
-- the application role received NO privileges on it: every read — the mentions
-- feed include and the weekly quality report — failed with "permission denied"
-- (HTTP 500). Older tables work because they predate the role split or were
-- blanket-granted manually during the PR1–PR6 rollout.
--
-- The application role is derived dynamically as the owner of the long-lived
-- social_mentions table, so this migration is a no-op on single-role
-- environments (local dev, CI, fresh installs) where creator == app role.
-- ALTER DEFAULT PRIVILEGES makes every FUTURE migration-created table carry
-- the same DML automatically, so the next schema slice cannot reintroduce
-- this failure mode. FORCE RLS on the table still governs the application
-- role after the grant — this widens privileges only up to the tenant policy.
DO $$
DECLARE
  app_owner text;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'social_mentions';

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_relevance_feedback TO %I',
      app_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      current_user, app_owner
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      current_user, app_owner
    );
  END IF;
END $$;
