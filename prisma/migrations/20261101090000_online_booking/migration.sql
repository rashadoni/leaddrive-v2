-- Online booking: a public link where a customer picks a free time
-- (/book/<slug>) and the meeting it creates. Both tables are tenant data
-- under the usual FORCE row-level security; the public routes find the
-- organization by slug or cancel token under the bypass and then work under
-- that organization's scope.
CREATE TABLE "booking_pages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
  "minNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
  "maxDaysAhead" INTEGER NOT NULL DEFAULT 14,
  "locationType" TEXT NOT NULL DEFAULT 'office',
  "locationText" TEXT,
  "hostIds" TEXT[],
  "weekly" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_pages_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_pages_slug_check" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  CONSTRAINT "booking_pages_duration_check" CHECK ("durationMinutes" BETWEEN 5 AND 480),
  CONSTRAINT "booking_pages_buffer_check" CHECK ("bufferMinutes" BETWEEN 0 AND 240),
  CONSTRAINT "booking_pages_notice_check" CHECK ("minNoticeMinutes" BETWEEN 0 AND 20160),
  CONSTRAINT "booking_pages_ahead_check" CHECK ("maxDaysAhead" BETWEEN 1 AND 120),
  CONSTRAINT "booking_pages_location_check" CHECK ("locationType" IN ('office', 'phone', 'online'))
);
CREATE UNIQUE INDEX "booking_pages_slug_key" ON "booking_pages"("slug");
CREATE INDEX "booking_pages_organizationId_idx" ON "booking_pages"("organizationId");

CREATE TABLE "bookings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bookingPageId" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "cancelTokenHash" TEXT NOT NULL,
  "leadId" TEXT,
  "taskId" TEXT,
  "googleEventId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bookings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bookings_bookingPageId_fkey"
    FOREIGN KEY ("bookingPageId") REFERENCES "booking_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bookings_status_check" CHECK ("status" IN ('confirmed', 'cancelled')),
  CONSTRAINT "bookings_time_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "bookings_cancelled_check" CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "bookings_cancelTokenHash_key" ON "bookings"("cancelTokenHash");
CREATE INDEX "bookings_organizationId_hostUserId_startsAt_idx" ON "bookings"("organizationId", "hostUserId", "startsAt");
CREATE INDEX "bookings_bookingPageId_startsAt_idx" ON "bookings"("bookingPageId", "startsAt");
-- One host, one confirmed meeting per start time: the last guard behind the
-- per-host lock in src/lib/booking/book.ts.
CREATE UNIQUE INDEX "bookings_host_start_confirmed_key"
  ON "bookings"("organizationId", "hostUserId", "startsAt") WHERE "status" = 'confirmed';

ALTER TABLE "booking_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_pages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_pages"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bookings"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
