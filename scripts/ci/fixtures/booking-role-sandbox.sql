-- Disposable hosted browser stand only, after Prisma and actual Booking DDL.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'booking_role_sandbox' THEN
    RAISE EXCEPTION 'Exact disposable Booking database required';
  END IF;
END $$;
CREATE ROLE booking_role_sandbox LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT CONNECT ON DATABASE booking_role_sandbox TO booking_role_sandbox;
GRANT USAGE ON SCHEMA public TO booking_role_sandbox;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO booking_role_sandbox;
-- Real credential login only; no business-table writes are granted.
GRANT UPDATE ("lastLogin", "loginCount", "updatedAt") ON public.users TO booking_role_sandbox;
-- Ordinary navigation persists only the synthetic user's favorites/recents.
-- This UI preference table is not a Booking/Task business fact.
GRANT INSERT, UPDATE ON public.user_preferences TO booking_role_sandbox;
DO $$ DECLARE target record; BEGIN
  FOR target IN
    SELECT DISTINCT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
      AND a.attname='organizationId' AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',target.relname);
    EXECUTE format('CREATE POLICY booking_browser_tenant ON public.%I USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',target.relname);
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='booking_role_sandbox' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole))
    OR has_table_privilege('booking_role_sandbox','public.bookings','UPDATE')
    OR has_table_privilege('booking_role_sandbox','public.tasks','INSERT') THEN
    RAISE EXCEPTION 'Sandbox application role exceeds read-only boundary';
  END IF;
END $$;
COMMIT;
