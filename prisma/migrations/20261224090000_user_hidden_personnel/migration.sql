-- Personnel («Kadr uçotu») became its own tick on the user card (owner,
-- 2026-11-21: HR are not agents). Until now hiding Route & Field hid Personnel
-- with it; from this release it does not. Everyone who already had `mtm` hidden
-- gets the Personnel tick too, so no person sees more than before. `users` is
-- under FORCE ROW LEVEL SECURITY and a migration runs without app.org_id, so
-- the update goes through snapshot/disable/restore.
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  remaining_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'users'::regclass;

  ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;

  UPDATE "users"
  SET "hiddenModules" = array_append("hiddenModules", 'personnel')
  WHERE 'mtm' = ANY("hiddenModules")
    AND NOT ('personnel' = ANY("hiddenModules"));

  SELECT COUNT(*)
  INTO remaining_count
  FROM "users"
  WHERE 'mtm' = ANY("hiddenModules")
    AND NOT ('personnel' = ANY("hiddenModules"));

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Users with Route & Field hidden but Personnel visible remain: %', remaining_count;
  END IF;

  IF had_rls THEN
    ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
