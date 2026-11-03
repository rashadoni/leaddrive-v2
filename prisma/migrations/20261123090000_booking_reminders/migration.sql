-- Reminders before a meeting, and what the client answered.
--
-- A salon loses more to an empty chair than to anything else, and the cheapest
-- way to keep it full is to ask the day before. This lives in its own table,
-- not on `bookings`: a canonical booking may only change through its own
-- events, and a reminder is delivery bookkeeping, not a change to what the
-- client and the salon agreed.
SET lock_timeout = '3s';

CREATE TABLE booking_reminders (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "bookingId" TEXT NOT NULL UNIQUE,
 "remindedDayAt" TIMESTAMP(3),
 "remindedHourAt" TIMESTAMP(3),
 "clientConfirmedAt" TIMESTAMP(3),
 "clientConfirmedVia" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "booking_reminders_organizationId_idx" ON booking_reminders("organizationId");

ALTER TABLE "booking_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_reminders"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- Times offered to move an existing meeting: taking one cancels that meeting.
ALTER TABLE "booking_offers" ADD COLUMN "replacesBookingId" TEXT;
