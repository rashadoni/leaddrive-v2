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
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_bookingPageId_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookingPageId_fkey" FOREIGN KEY ("bookingPageId") REFERENCES "booking_pages"(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
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
CREATE FUNCTION booking_managed_task_guard_fn() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

COMMIT;
