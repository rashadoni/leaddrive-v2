-- Fund shadow pilot: the restricted login and the shadow build of ONE
-- organization, in the production database. Run as the postgres superuser by
-- provision.sh fund-shadow-prod (psql -v ON_ERROR_STOP=1, single transaction):
--
--   psql -v org=... -v role=... -v build_id=... -v build_key=... -v code_sha=... -f provision-role.sql
--   with the SCRAM-SHA-256 verifier of the password as the first line of stdin.
--   The plaintext password never reaches the server: provision.sh computes the
--   verifier, so no statement, log or pg_stat_activity row can carry it.
--
-- The same grants and RESTRICTIVE policies as newBuild() in
-- src/__tests__/fixtures/fund-shadow-postgres.ts, which the shadow consumer is
-- tested against. Idempotent: a second run with the same values changes
-- nothing; different values for an existing role or build key fail.
\set ON_ERROR_STOP 1
\prompt '' verifier
BEGIN;
-- Its result row would echo the inputs (the verifier among them) to the log.
\o /dev/null
SELECT set_config('ld.org', :'org', true), set_config('ld.role', :'role', true),
  set_config('ld.build_id', :'build_id', true), set_config('ld.build_key', :'build_key', true),
  set_config('ld.code_sha', :'code_sha', true), set_config('ld.verifier', :'verifier', true);
\o

DO $$
DECLARE
  org text := current_setting('ld.org');
  role text := current_setting('ld.role');
  build uuid := current_setting('ld.build_id')::uuid;
  build_key text := current_setting('ld.build_key');
  code_sha text := current_setting('ld.code_sha');
  t text;
  existing record;
BEGIN
  IF org !~ '^[A-Za-z0-9_-]{1,64}$' OR role !~ '^ld_fund_shadow_[a-z0-9_]{1,40}$'
     OR build_key !~ '^[a-z0-9-]{1,64}$' OR code_sha !~ '^[0-9a-f]{40}$'
     OR current_setting('ld.verifier') !~ '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' THEN
    RAISE EXCEPTION 'fund-shadow: invalid input';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = org) THEN
    RAISE EXCEPTION 'fund-shadow: organization % not found', org;
  END IF;
  -- RESTRICTIVE policies narrow PERMISSIVE ones; without row security on, they
  -- would not apply at all and the login would see every tenant.
  FOREACH t IN ARRAY ARRAY['event_outbox', 'event_aggregate_heads', 'funds', 'domain_events', 'fund_balance_projections',
                           'projection_builds', 'projection_checkpoints', 'consumer_inbox'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION 'fund-shadow: % has no forced row level security', t;
    END IF;
  END LOOP;

  SELECT rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolreplication INTO existing
    FROM pg_roles WHERE rolname = role;
  IF NOT FOUND THEN
    EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      role, current_setting('ld.verifier'));
  ELSIF existing.rolsuper OR existing.rolbypassrls OR existing.rolinherit OR existing.rolcreatedb
     OR existing.rolcreaterole OR existing.rolreplication THEN
    RAISE EXCEPTION 'fund-shadow: role % exists without the restrictions', role;
  ELSE
    EXECUTE format('ALTER ROLE %I PASSWORD %L', role, current_setting('ld.verifier'));
  END IF;
  EXECUTE format('ALTER ROLE %I CONNECTION LIMIT 2', role);
  -- retire-builds.sql switches off only logins carrying this mark.
  EXECUTE format('COMMENT ON ROLE %I IS %L', role, 'leaddrive fund shadow pilot');

  -- The build the consumer checks: shadow, running, effects fenced, full history.
  SELECT id, "organizationId", "projectionName", "projectionVersion", "codeSha", mode INTO existing
    FROM projection_builds WHERE "organizationId" = org AND "projectionName" = 'finance.fund-balance' AND "buildKey" = build_key;
  IF NOT FOUND THEN
    INSERT INTO projection_builds (id, "organizationId", "projectionName", "projectionVersion", "buildKey", "codeSha", mode, "effectsFenced", "updatedAt")
      VALUES (build, org, 'finance.fund-balance', 2, build_key, code_sha, 'shadow', true, CURRENT_TIMESTAMP);
    UPDATE projection_builds SET status = 'running', "startedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = build;
  ELSIF existing.id <> build OR existing."projectionVersion" <> 2 OR existing."codeSha" <> code_sha OR existing.mode <> 'shadow' THEN
    RAISE EXCEPTION 'fund-shadow: build key % exists with other values', build_key;
  END IF;
END $$;

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), current_setting('ld.role')) \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', current_setting('ld.role')) \gexec
SELECT format('GRANT SELECT ON event_outbox, event_aggregate_heads, funds, domain_events, fund_balance_projections, projection_builds, projection_checkpoints, consumer_inbox TO %I', current_setting('ld.role')) \gexec
SELECT format('GRANT INSERT ON fund_balance_projections, projection_checkpoints, consumer_inbox TO %I', current_setting('ld.role')) \gexec
SELECT format('GRANT UPDATE (balance, currency, "aggregateVersion", "lastEventId", evidence) ON fund_balance_projections TO %I', current_setting('ld.role')) \gexec
SELECT format('GRANT UPDATE ("sourceOffset", "lastEventId", "updatedAt") ON projection_checkpoints TO %I', current_setting('ld.role')) \gexec
SELECT format('GRANT UPDATE ("createdAt") ON projection_builds TO %I', current_setting('ld.role')) \gexec

DO $$
DECLARE
  org text := current_setting('ld.org');
  role text := current_setting('ld.role');
  build text := current_setting('ld.build_id');
  build_key text := current_setting('ld.build_key');
  t text;
  boundary text;
  shadow text;
  policy record;
BEGIN
  -- Policy name = role (one per table), so a rerun replaces, never duplicates.
  FOR policy IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname IN (role, role || '_read', role || '_insert', role || '_update') LOOP
    EXECUTE format('DROP POLICY %I ON %I', policy.policyname, policy.tablename);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['event_outbox', 'event_aggregate_heads', 'funds', 'domain_events'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE TO %I USING ("organizationId" = %L) WITH CHECK ("organizationId" = %L)',
      role, t, role, org, org);
  END LOOP;
  FOR t, boundary IN VALUES
    ('projection_builds', format('"organizationId" = %L AND id = %L::uuid', org, build)),
    ('projection_checkpoints', format('"organizationId" = %L AND "buildId" = %L::uuid', org, build)),
    ('consumer_inbox', format('"organizationId" = %L AND "consumerName" = %L AND "consumerVersion" = 1', org, 'fund-shadow:' || lower(build)))
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE TO %I USING (%s) WITH CHECK (%s)', role, t, role, boundary, boundary);
  END LOOP;
  shadow := format('"organizationId" = %L AND status = %L AND "projectionVersion" = 2 AND "buildKey" = %L', org, 'shadow', build_key);
  EXECUTE format('CREATE POLICY %I ON fund_balance_projections AS RESTRICTIVE FOR SELECT TO %I USING ((%s) OR ("organizationId" = %L AND status = %L AND "projectionVersion" = 1))',
    role || '_read', role, shadow, org, 'active');
  EXECUTE format('CREATE POLICY %I ON fund_balance_projections AS RESTRICTIVE FOR INSERT TO %I WITH CHECK (%s)', role || '_insert', role, shadow);
  EXECUTE format('CREATE POLICY %I ON fund_balance_projections AS RESTRICTIVE FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', role || '_update', role, shadow, shadow);
END $$;
COMMIT;
SELECT 'fund_shadow_role=' || rolname || ' build=' || b.id || ' status=' || b.status
  FROM pg_roles r, projection_builds b WHERE r.rolname = :'role' AND b.id = :'build_id'::uuid;
