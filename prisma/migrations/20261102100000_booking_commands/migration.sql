BEGIN;
SET LOCAL lock_timeout = '5s';
-- BEGIN BOOKING RELEASE STATE
-- Global deployment metadata, not customer data. The web role may only read
-- the mode. Migration authority may activate it exactly once; never reset it.
CREATE TABLE public.booking_workspace_release (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enforced BOOLEAN NOT NULL DEFAULT false,
  "activatedArtifactSha" TEXT,
  "activatedAt" TIMESTAMP(3),
  CHECK ((NOT enforced AND "activatedArtifactSha" IS NULL AND "activatedAt" IS NULL)
    OR (enforced AND "activatedArtifactSha" IS NOT NULL AND "activatedArtifactSha" ~ '^[0-9a-f]{40}$' AND "activatedAt" IS NOT NULL))
);
INSERT INTO public.booking_workspace_release (id) VALUES (1);
ALTER TABLE public.booking_workspace_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_workspace_release FORCE ROW LEVEL SECURITY;
CREATE POLICY release_mode_read ON public.booking_workspace_release FOR SELECT USING (true);
GRANT SELECT ON public.booking_workspace_release TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.booking_workspace_release FROM PUBLIC;
CREATE FUNCTION booking_release_monotonic_guard_fn() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Booking release state cannot be removed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.enforced OR NOT NEW.enforced OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Booking enforcement may only be activated once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_release_monotonic_guard BEFORE UPDATE OR DELETE ON public.booking_workspace_release
FOR EACH ROW EXECUTE FUNCTION booking_release_monotonic_guard_fn();
CREATE TRIGGER booking_release_no_truncate BEFORE TRUNCATE ON public.booking_workspace_release
FOR EACH STATEMENT EXECUTE FUNCTION booking_release_monotonic_guard_fn();
-- END BOOKING RELEASE STATE
ALTER TABLE "booking_pages" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
-- Old page editors do not know the new version field. Increment it at the DB
-- boundary too, so a late old PATCH cannot evade a canonical preflight check.
CREATE FUNCTION booking_page_expand_version_fn() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'Booking page version cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version = OLD.version AND (to_jsonb(NEW) - ARRAY['version','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version','updatedAt']) THEN
    NEW.version:=OLD.version+1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_page_expand_version BEFORE UPDATE ON public.booking_pages
FOR EACH ROW EXECUTE FUNCTION booking_page_expand_version_fn();

ALTER TABLE "bookings"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'public_link',
  ADD COLUMN "secretId" TEXT,
  ADD COLUMN "adAttribution" JSONB,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "outcomeNote" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "bufferBefore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bufferAfter" INTEGER NOT NULL DEFAULT 0;
-- Legacy rows never stored their own buffer. Preserve the currently known
-- page rule as derived metadata instead of silently resetting it to zero.
UPDATE bookings b SET "bufferBefore" = p."bufferMinutes", "bufferAfter" = p."bufferMinutes"
FROM booking_pages p WHERE p.id = b."bookingPageId" AND p."organizationId" = b."organizationId";
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_org_fkey" FOREIGN KEY ("organizationId", "hostUserId") REFERENCES users("organizationId", id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_version_check" CHECK (version >= 0);
CREATE UNIQUE INDEX "booking_pages_org_id_key" ON booking_pages("organizationId", id);
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_bookingPageId_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookingPageId_fkey" FOREIGN KEY ("organizationId", "bookingPageId") REFERENCES "booking_pages"("organizationId", id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX "bookings_org_id_key" ON bookings("organizationId", id);
CREATE UNIQUE INDEX "bookings_managed_task_key" ON "bookings"("organizationId", "taskId") WHERE "taskId" IS NOT NULL;

-- An old writer can still run during expand A. Capture its actual current
-- page buffer at INSERT rather than leaving the new columns at zero.
CREATE FUNCTION booking_expand_legacy_buffer_fn() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
DECLARE page_buffer INTEGER;
BEGIN
  IF NEW.version = 0 THEN
    SELECT "bufferMinutes" INTO page_buffer FROM public.booking_pages
      WHERE id=NEW."bookingPageId" AND "organizationId"=NEW."organizationId";
    IF FOUND THEN NEW."bufferBefore":=page_buffer; NEW."bufferAfter":=page_buffer; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_expand_legacy_buffer BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION booking_expand_legacy_buffer_fn();

-- New code serializes all host reservations; this also protects interval overlap at the DB boundary.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_interval_exclusion"
  EXCLUDE USING gist ("organizationId" WITH =, "hostUserId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'confirmed');

CREATE TABLE "booking_secrets" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "recoveryHash" TEXT NOT NULL,
  "responseCipher" TEXT,
  "responseExpiresAt" TIMESTAMP(3) NOT NULL,
  "deliveryCipher" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "booking_secrets_organizationId_responseExpiresAt_idx" ON "booking_secrets"("organizationId", "responseExpiresAt");
CREATE TABLE "booking_integration_bindings" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "bookingId" TEXT NOT NULL,
  FOREIGN KEY ("organizationId", "bookingId") REFERENCES bookings("organizationId", id) ON DELETE CASCADE ON UPDATE CASCADE,
  "hostUserId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  generation TEXT NOT NULL,
  "providerEventId" TEXT,
  "desiredVersion" INTEGER NOT NULL,
  "appliedVersion" INTEGER NOT NULL DEFAULT 0,
  "desiredState" TEXT NOT NULL DEFAULT 'present' CHECK ("desiredState" IN ('present', 'absent')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'synced', 'unavailable', 'reconciliation_required')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "booking_bindings_generation_key" ON "booking_integration_bindings"("organizationId", "bookingId", generation);
CREATE INDEX "booking_integration_bindings_organizationId_bookingId_idx" ON "booking_integration_bindings"("organizationId", "bookingId");
CREATE TABLE "booking_change_notes" (
  "eventId" UUID PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "bookingId" TEXT NOT NULL,
  FOREIGN KEY ("organizationId", "bookingId") REFERENCES bookings("organizationId", id) ON DELETE CASCADE ON UPDATE CASCADE,
  data JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "eventId") REFERENCES domain_events("organizationId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_change_notes_organizationId_eventId_key" ON booking_change_notes("organizationId", "eventId");
CREATE INDEX "booking_change_notes_organizationId_bookingId_idx" ON booking_change_notes("organizationId", "bookingId");
DO $policy$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['booking_secrets', 'booking_integration_bindings', 'booking_change_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', table_name);
  END LOOP;
END;
$policy$;

-- Expand A protects canonical mirrors. Activated B also protects untouched legacy mirrors.
CREATE FUNCTION booking_managed_task_guard_fn() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.booking_task_writer', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId")
     AND EXISTS (SELECT 1 FROM bookings WHERE "organizationId" = OLD."organizationId" AND "taskId" = OLD.id AND (version > 0 OR COALESCE((SELECT enforced FROM public.booking_workspace_release WHERE id=1), true)))
  THEN
    RAISE EXCEPTION 'This task is managed by a booking; update the meeting instead' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_managed_task_guard BEFORE UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION booking_managed_task_guard_fn();

-- Validate the final transaction state, not intermediate row versions while a
-- command appends its event. Existing version=0 rows remain readable; an old
-- writer cannot overwrite canonical fields. Strict B closes version-zero writes too.
CREATE FUNCTION booking_event_head_guard_fn() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  current_booking public.bookings%ROWTYPE;
  head_version BIGINT;
  event_data JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."organizationId" ELSE NEW."organizationId" END) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.version = 0 AND NOT COALESCE((SELECT enforced FROM public.booking_workspace_release WHERE id=1), true) THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'A booking cannot be deleted by an ordinary writer' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO current_booking FROM public.bookings WHERE id = NEW.id AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking disappeared before its event guard' USING ERRCODE = 'check_violation';
  END IF;
  -- Expand release A permits only never-canonical legacy rows. A positive
  -- aggregate can never be downgraded back into this compatibility window.
  IF current_booking.version = 0 THEN
    IF TG_OP = 'UPDATE' AND OLD.version > 0 THEN
      RAISE EXCEPTION 'A canonical booking cannot return to legacy version zero' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT COALESCE((SELECT enforced FROM public.booking_workspace_release WHERE id=1), true) THEN RETURN NULL; END IF;
  END IF;
  SELECT h."currentVersion", e.data INTO head_version, event_data
    FROM public.event_aggregate_heads h JOIN public.domain_events e
      ON e.id = h."lastEventId" AND e."organizationId" = h."organizationId"
    WHERE h."organizationId" = current_booking."organizationId"
      AND h."aggregateType" = 'booking' AND h."aggregateId" = current_booking.id;
  IF current_booking.version < 1 OR head_version IS DISTINCT FROM current_booking.version::bigint
     OR event_data->>'bookingId' IS DISTINCT FROM current_booking.id
     OR event_data->>'hostUserId' IS DISTINCT FROM current_booking."hostUserId"
     OR event_data->>'status' IS DISTINCT FROM current_booking.status
     OR (event_data->>'startsAt')::timestamptz AT TIME ZONE 'UTC' IS DISTINCT FROM current_booking."startsAt"
     OR (event_data->>'endsAt')::timestamptz AT TIME ZONE 'UTC' IS DISTINCT FROM current_booking."endsAt"
  THEN
    RAISE EXCEPTION 'Booking requires a matching canonical event and aggregate head' USING ERRCODE = 'check_violation';
  END IF;
  -- Keep legacy broken links readable/cancellable, but never attach a new
  -- foreign-tenant or missing CRM projection. Ordinary writers cannot rebind mirrors.
  IF (TG_OP = 'INSERT' OR current_booking."taskId" IS DISTINCT FROM OLD."taskId")
     AND current_booking."taskId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = current_booking."taskId" AND "organizationId" = current_booking."organizationId")
  THEN RAISE EXCEPTION 'Booking task must belong to its organization' USING ERRCODE = 'check_violation'; END IF;
  IF (TG_OP = 'INSERT' OR current_booking."leadId" IS DISTINCT FROM OLD."leadId")
     AND current_booking."leadId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = current_booking."leadId" AND "organizationId" = current_booking."organizationId")
  THEN RAISE EXCEPTION 'Booking lead must belong to its organization' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['taskId','leadId','googleEventId','updatedAt','version'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['taskId','leadId','googleEventId','updatedAt','version'])
     AND current_booking.version <= OLD.version
  THEN
    RAISE EXCEPTION 'Canonical booking changes require a new event version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER booking_event_head_guard
AFTER INSERT OR UPDATE OR DELETE ON public.bookings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION booking_event_head_guard_fn();

COMMIT;
