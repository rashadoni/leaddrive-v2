-- Fund shadow pilot: retire everything of earlier pilots. Run as postgres by
-- prod-apply.sh retire after the current pilot's logins and builds exist:
--
--   psql -v keep_key=pilot-N -v keep_roles=role1,role2 -f retire-builds.sql
--
-- Earlier pilot builds (build key pilot-<n> other than keep_key) leave the
-- running state, so the worker refuses them and the watch stops expecting
-- them to follow the stream; earlier pilot logins lose LOGIN. Nothing is
-- deleted: their shadow rows, checkpoints and inbox stay as evidence.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('ld.keep_key', :'keep_key', true), set_config('ld.keep_roles', :'keep_roles', true);
DO $$
DECLARE
  keep_key text := current_setting('ld.keep_key');
  keep text[] := string_to_array(current_setting('ld.keep_roles'), ',');
  r record;
BEGIN
  IF keep_key !~ '^pilot-[0-9]{1,6}$' OR cardinality(keep) = 0
     OR EXISTS (SELECT 1 FROM unnest(keep) k WHERE k !~ '^ld_fund_shadow_[a-z0-9_]{1,40}$') THEN
    RAISE EXCEPTION 'fund-shadow: invalid input';
  END IF;
  UPDATE projection_builds SET status = 'abandoned', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
   WHERE "projectionName" = 'finance.fund-balance' AND mode = 'shadow' AND status = 'running'
     AND "buildKey" ~ '^pilot-[0-9]+$' AND "buildKey" <> keep_key;
  -- Pilot logins only: marked by provision-role.sql, or the unmarked login of
  -- pilot-1 (2026-10-25). Other roles that merely share the prefix stay.
  FOR r IN SELECT rolname FROM pg_roles
           WHERE (shobj_description(oid, 'pg_authid') = 'leaddrive fund shadow pilot' OR rolname = 'ld_fund_shadow_pilot')
             AND rolcanlogin AND NOT (rolname = ANY (keep)) LOOP
    EXECUTE format('ALTER ROLE %I NOLOGIN', r.rolname);
  END LOOP;
END $$;
COMMIT;
SELECT 'fund_shadow_retired builds=' || (SELECT count(*) FROM projection_builds WHERE "projectionName" = 'finance.fund-balance'
    AND mode = 'shadow' AND status = 'abandoned' AND "buildKey" ~ '^pilot-')
  || ' logins_off=' || (SELECT count(*) FROM pg_roles WHERE NOT rolcanlogin
    AND (shobj_description(oid, 'pg_authid') = 'leaddrive fund shadow pilot' OR rolname = 'ld_fund_shadow_pilot'));
