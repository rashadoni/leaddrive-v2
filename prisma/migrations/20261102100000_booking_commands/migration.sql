BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "booking_pages" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
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
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_org_fkey" FOREIGN KEY ("organizationId", "hostUserId") REFERENCES users("organizationId", id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_version_check" CHECK (version >= 0);
CREATE UNIQUE INDEX "booking_pages_org_id_key" ON booking_pages("organizationId", id);
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_bookingPageId_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookingPageId_fkey" FOREIGN KEY ("organizationId", "bookingPageId") REFERENCES "booking_pages"("organizationId", id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX "bookings_org_id_key" ON bookings("organizationId", id);
CREATE UNIQUE INDEX "bookings_managed_task_key" ON "bookings"("organizationId", "taskId") WHERE "taskId" IS NOT NULL;

-- New code serializes all host reservations; this also protects interval overlap at the DB boundary.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_interval_exclusion"
  EXCLUDE USING gist ("organizationId" WITH =, "hostUserId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'confirmed');

CREATE TABLE "booking_secrets" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "recoveryHash" TEXT NOT NULL,
  "responseCipher" TEXT,
  "responseExpiresAt" TIMESTAMP(3) NOT NULL,
  "deliveryCipher" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "booking_secrets_organizationId_responseExpiresAt_idx" ON "booking_secrets"("organizationId", "responseExpiresAt");
CREATE TABLE "booking_integration_bindings" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "bookingId" TEXT NOT NULL,
  FOREIGN KEY ("organizationId", "bookingId") REFERENCES bookings("organizationId", id) ON DELETE CASCADE,
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
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "bookingId" TEXT NOT NULL,
  FOREIGN KEY ("organizationId", "bookingId") REFERENCES bookings("organizationId", id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "eventId") REFERENCES domain_events("organizationId", id) ON DELETE CASCADE
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

-- Every task writer, including bulk/AI/import/direct Prisma, observes this ownership boundary.
CREATE FUNCTION booking_managed_task_guard_fn() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.booking_task_writer', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId")
     AND EXISTS (SELECT 1 FROM bookings WHERE "organizationId" = OLD."organizationId" AND "taskId" = OLD.id)
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
-- writer cannot commit a new reservation or overwrite canonical fields after cutover.
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
    RAISE EXCEPTION 'A booking cannot be deleted by an ordinary writer' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO current_booking FROM public.bookings WHERE id = NEW.id AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking disappeared before its event guard' USING ERRCODE = 'check_violation';
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
