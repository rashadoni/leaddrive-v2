\set ON_ERROR_STOP on

-- Run as a PostgreSQL DBA only after the settings in postgresql.conf.example
-- are active. This script creates no replication slot and starts no connector.
-- The CDC password must be set out of band by the production secret manager.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  setting_value BIGINT;
BEGIN
  IF current_setting('server_version_num')::INTEGER < 160000 THEN
    RAISE EXCEPTION 'event CDC requires the production PostgreSQL 16 baseline or newer';
  END IF;

  IF current_setting('wal_level') <> 'logical' THEN
    RAISE EXCEPTION 'wal_level must be logical before CDC preparation (currently %)',
      current_setting('wal_level');
  END IF;

  SELECT setting::BIGINT INTO setting_value
    FROM pg_settings WHERE name = 'max_replication_slots';
  IF setting_value < 4 THEN
    RAISE EXCEPTION 'max_replication_slots must be at least 4 (currently %)', setting_value;
  END IF;

  SELECT setting::BIGINT INTO setting_value
    FROM pg_settings WHERE name = 'max_wal_senders';
  IF setting_value < 4 THEN
    RAISE EXCEPTION 'max_wal_senders must be at least 4 (currently %)', setting_value;
  END IF;

  -- pg_settings reports this setting in MB. Unlimited (-1) can fill the
  -- primary disk during a connector outage, while a tiny cap invalidates the
  -- slot before operators can recover it.
  SELECT setting::BIGINT INTO setting_value
    FROM pg_settings WHERE name = 'max_slot_wal_keep_size';
  IF setting_value = -1 OR setting_value < 4096 THEN
    RAISE EXCEPTION
      'max_slot_wal_keep_size must be finite and at least 4096 MB (currently % MB)',
      setting_value;
  END IF;

  IF to_regclass('public.event_outbox') IS NULL THEN
    RAISE EXCEPTION 'public.event_outbox is missing; apply the event-platform migration first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
  ) THEN
    RAISE EXCEPTION 'prepare-cdc.sql must run as a PostgreSQL DBA/superuser';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_replication_slots
     WHERE slot_name = 'leaddrive_event_outbox_prod'
       AND (slot_type <> 'logical'
            OR plugin IS DISTINCT FROM 'pgoutput'
            OR database IS DISTINCT FROM current_database())
  ) THEN
    RAISE EXCEPTION 'existing leaddrive_event_outbox_prod slot has incompatible identity';
  END IF;
END
$preflight$;

DO $role$
DECLARE
  membership RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leaddrive_event_cdc') THEN
    CREATE ROLE leaddrive_event_cdc
      LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      CONNECTION LIMIT 4;
  END IF;

  -- Remove both directions. If CDC is a member of another role it can escape
  -- its least-privilege grants; if any runtime role is a member of CDC it can
  -- SET ROLE into the cross-tenant outbox policy. NOINHERIT does not prevent
  -- SET ROLE, so role attributes alone are not a boundary.
  FOR membership IN
    SELECT granted_role.rolname AS granted_role,
           member_role.rolname AS member_role
      FROM pg_auth_members memberships
      JOIN pg_roles granted_role ON granted_role.oid = memberships.roleid
      JOIN pg_roles member_role ON member_role.oid = memberships.member
     WHERE granted_role.rolname = 'leaddrive_event_cdc'
        OR member_role.rolname = 'leaddrive_event_cdc'
  LOOP
    IF membership.member_role = 'leaddrive_event_cdc' THEN
      EXECUTE format('REVOKE %I FROM leaddrive_event_cdc', membership.granted_role);
    ELSE
      EXECUTE format('REVOKE leaddrive_event_cdc FROM %I', membership.member_role);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members memberships
      JOIN pg_roles granted_role ON granted_role.oid = memberships.roleid
      JOIN pg_roles member_role ON member_role.oid = memberships.member
     WHERE granted_role.rolname = 'leaddrive_event_cdc'
        OR member_role.rolname = 'leaddrive_event_cdc'
  ) THEN
    RAISE EXCEPTION 'leaddrive_event_cdc must have no inbound or outbound role memberships';
  END IF;
END
$role$;

ALTER ROLE leaddrive_event_cdc
  LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  CONNECTION LIMIT 4;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM leaddrive_event_cdc;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM leaddrive_event_cdc;
REVOKE CREATE ON SCHEMA public FROM leaddrive_event_cdc;
GRANT CONNECT ON DATABASE :"DBNAME" TO leaddrive_event_cdc;
GRANT USAGE ON SCHEMA public TO leaddrive_event_cdc;
GRANT SELECT ON TABLE public."event_outbox" TO leaddrive_event_cdc;

-- The connector is intentionally cross-tenant, but only for the immutable
-- outbox. This named SELECT policy makes the exceptional boundary explicit;
-- it grants no INSERT, UPDATE, DELETE, or access to domain tables.
DROP POLICY IF EXISTS event_outbox_cdc_select ON public."event_outbox";
CREATE POLICY event_outbox_cdc_select
  ON public."event_outbox"
  FOR SELECT
  TO leaddrive_event_cdc
  USING (true);

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'leaddrive_event_outbox'
  ) THEN
    CREATE PUBLICATION leaddrive_event_outbox
      FOR TABLE ONLY public."event_outbox"
      WITH (publish = 'insert', publish_via_partition_root = false);
  END IF;
END
$publication$;

ALTER PUBLICATION leaddrive_event_outbox
  SET TABLE ONLY public."event_outbox";
ALTER PUBLICATION leaddrive_event_outbox
  SET (publish = 'insert', publish_via_partition_root = false);

DO $verify$
DECLARE
  unexpected_tables TEXT;
  publication_table_count INTEGER;
  publication_flags RECORD;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY schemaname, tablename)
    INTO unexpected_tables
    FROM pg_publication_tables
   WHERE pubname = 'leaddrive_event_outbox'
     AND (schemaname, tablename) IS DISTINCT FROM ('public', 'event_outbox');
  IF unexpected_tables IS NOT NULL THEN
    RAISE EXCEPTION 'CDC publication includes unexpected tables: %', unexpected_tables;
  END IF;

  SELECT count(*) INTO publication_table_count
    FROM pg_publication_tables
   WHERE pubname = 'leaddrive_event_outbox'
     AND schemaname = 'public'
     AND tablename = 'event_outbox';
  IF publication_table_count <> 1 THEN
    RAISE EXCEPTION 'CDC publication does not contain exactly public.event_outbox';
  END IF;

  SELECT pubinsert, pubupdate, pubdelete, pubtruncate
    INTO publication_flags
    FROM pg_publication
   WHERE pubname = 'leaddrive_event_outbox';
  IF publication_flags.pubinsert IS DISTINCT FROM true
     OR publication_flags.pubupdate IS DISTINCT FROM false
     OR publication_flags.pubdelete IS DISTINCT FROM false
     OR publication_flags.pubtruncate IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CDC publication must publish INSERT operations only';
  END IF;

  IF NOT has_table_privilege('leaddrive_event_cdc', 'public.event_outbox', 'SELECT') THEN
    RAISE EXCEPTION 'CDC role cannot SELECT event_outbox for its initial snapshot';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'leaddrive_event_cdc'
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls
            OR NOT rolreplication OR NOT rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'CDC role attributes violate the least-privilege contract';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members memberships
      JOIN pg_roles granted_role ON granted_role.oid = memberships.roleid
      JOIN pg_roles member_role ON member_role.oid = memberships.member
     WHERE granted_role.rolname = 'leaddrive_event_cdc'
        OR member_role.rolname = 'leaddrive_event_cdc'
  ) THEN
    RAISE EXCEPTION 'CDC role has an inbound/outbound membership after preparation';
  END IF;
END
$verify$;

COMMIT;

-- Evidence query: save this output in the activation change record.
SELECT current_database() AS database,
       current_setting('wal_level') AS wal_level,
       current_setting('max_replication_slots') AS max_replication_slots,
       current_setting('max_slot_wal_keep_size') AS max_slot_wal_keep_size;
SELECT pubname, pubinsert, pubupdate, pubdelete, pubtruncate
  FROM pg_publication WHERE pubname = 'leaddrive_event_outbox';
SELECT schemaname, tablename
  FROM pg_publication_tables WHERE pubname = 'leaddrive_event_outbox';
