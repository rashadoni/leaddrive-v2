\set ON_ERROR_STOP on

-- Read-only assertions for the DISPOSABLE PostgreSQL 16 transport fixture.
-- Apply the unchanged foundation as event_migrator and unchanged prepare-cdc.sql
-- as event_test first. No roles, grants, policies, publications or data are changed.
-- This proves current ordinary-SQL privileges, not an outbox-only security
-- boundary for a compromised REPLICATION principal or future default grants.
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $cdc_boundary$
DECLARE
  cdc_oid OID;
  app_oid OID;
  migrator_oid OID;
  outbox_oid OID;
  publication_oid OID;
  relation RECORD;
  permission TEXT;
  effective_privilege BOOLEAN;
  canonical_tables TEXT[] := ARRAY[
    'event_command_receipts', 'event_aggregate_heads', 'domain_events',
    'event_outbox', 'consumer_inbox', 'projection_builds',
    'projection_checkpoints', 'effect_outbox', 'effect_attempts',
    'effect_reconciliations', 'event_platform_cutover_gates'
  ];
BEGIN
  IF current_database() <> 'event_platform_test'
     OR current_user <> 'event_test'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'CDC boundary assertions require the disposable test DBA/database';
  END IF;
  IF current_setting('server_version_num')::INTEGER < 160000
     OR current_setting('server_version_num')::INTEGER >= 170000 THEN
    RAISE EXCEPTION 'CDC boundary assertions require the PostgreSQL 16 fixture';
  END IF;

  SELECT oid INTO cdc_oid FROM pg_roles
   WHERE rolname = 'leaddrive_event_cdc'
     AND rolcanlogin AND rolreplication AND rolconnlimit = 4
     AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolinherit AND NOT rolbypassrls;
  IF cdc_oid IS NULL THEN
    RAISE EXCEPTION 'CDC role attributes do not match the fixture contract';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = cdc_oid OR member = cdc_oid) THEN
    RAISE EXCEPTION 'CDC role must have zero inbound and outbound memberships';
  END IF;

  SELECT oid INTO app_oid FROM pg_roles
   WHERE rolname = 'event_app' AND rolcanlogin AND rolinherit
     AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolbypassrls;
  SELECT oid INTO migrator_oid FROM pg_roles
   WHERE rolname = 'event_migrator' AND rolcanlogin AND rolinherit AND rolbypassrls
     AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
  IF app_oid IS NULL OR migrator_oid IS NULL OR app_oid = migrator_oid THEN
    RAISE EXCEPTION 'Fixture requires distinct app and non-superuser migration roles';
  END IF;
  IF NOT pg_has_role(migrator_oid, app_oid, 'USAGE')
     OR pg_has_role(app_oid, migrator_oid, 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role must inherit the app anchor owner, never the reverse';
  END IF;
  IF NOT has_database_privilege(migrator_oid, current_database(), 'CREATE')
     OR NOT has_schema_privilege(migrator_oid, 'public', 'CREATE')
     OR NOT has_schema_privilege(migrator_oid, 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Migration role lacks fixture extension/schema creation privileges';
  END IF;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('organizations', 'funds')
         AND c.relkind = 'r' AND c.relowner = app_oid) <> 2 THEN
    RAISE EXCEPTION 'Fixture organizations and funds anchors must be app-owned';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY(canonical_tables)
         AND c.relkind = 'r' AND c.relowner = migrator_oid
         AND c.relrowsecurity AND c.relforcerowsecurity) <> cardinality(canonical_tables) THEN
    RAISE EXCEPTION 'All canonical tables must be migration-owned with ENABLE and FORCE RLS';
  END IF;
  outbox_oid := 'public.event_outbox'::regclass;

  IF NOT has_database_privilege(cdc_oid, current_database(), 'CONNECT')
     OR NOT has_schema_privilege(cdc_oid, 'public', 'USAGE')
     OR has_schema_privilege(cdc_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'CDC requires CONNECT/USAGE but must not create objects in public';
  END IF;

  -- has_*_privilege checks effective privileges, including PUBLIC. Checking
  -- column privileges separately avoids overlooking column-only grant leakage.
  FOR relation IN
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    FOREACH permission IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      effective_privilege := has_table_privilege(cdc_oid, relation.oid, permission);
      IF permission IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
        effective_privilege := effective_privilege
          OR has_any_column_privilege(cdc_oid, relation.oid, permission);
      END IF;
      IF effective_privilege IS DISTINCT FROM (relation.oid = outbox_oid AND permission = 'SELECT') THEN
        RAISE EXCEPTION 'CDC effective table/column privileges exceed SELECT-only event_outbox';
      END IF;
    END LOOP;
  END LOOP;
  -- Do not rely on WHERE/AND evaluation order. PostgreSQL may call the
  -- sequence-only privilege function on a non-sequence before filtering it.
  FOR relation IN
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    IF has_sequence_privilege(cdc_oid, relation.oid, 'USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'CDC must not have effective public-sequence privileges';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = outbox_oid AND polname = 'event_outbox_cdc_select'
       AND polcmd = 'r' AND polpermissive
       AND polroles = ARRAY[cdc_oid]::OID[]
       AND pg_get_expr(polqual, polrelid) = 'true' AND polwithcheck IS NULL
  ) THEN
    RAISE EXCEPTION 'CDC cross-tenant policy must be an explicit SELECT-only role policy';
  END IF;

  SELECT oid INTO publication_oid FROM pg_publication
   WHERE pubname = 'leaddrive_event_outbox'
     AND NOT puballtables AND pubinsert
     AND NOT pubupdate AND NOT pubdelete AND NOT pubtruncate AND NOT pubviaroot;
  IF publication_oid IS NULL THEN
    RAISE EXCEPTION 'CDC publication must be INSERT-only with no all-tables or partition-root expansion';
  END IF;
  IF (SELECT count(*) FROM pg_publication_rel WHERE prpubid = publication_oid) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_publication_rel
        WHERE prpubid = publication_oid AND prrelid = outbox_oid
          AND prqual IS NULL AND prattrs IS NULL
     )
     OR EXISTS (SELECT 1 FROM pg_publication_namespace WHERE pnpubid = publication_oid) THEN
    RAISE EXCEPTION 'CDC publication must contain exactly the full, unfiltered event_outbox table';
  END IF;
END;
$cdc_boundary$;

SELECT 'cdc_boundary_metadata_pass' AS result;
COMMIT;
