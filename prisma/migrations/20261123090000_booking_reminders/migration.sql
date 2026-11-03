-- Reminders before a meeting, and what the client answered.
--
-- A salon loses more to an empty chair than to anything else, and the cheapest
-- way to keep it full is to ask the day before. All four columns are nullable:
-- every meeting that exists today simply has no reminder yet.
SET lock_timeout = '3s';

ALTER TABLE "bookings"
  ADD COLUMN "remindedDayAt" TIMESTAMP(3),
  ADD COLUMN "remindedHourAt" TIMESTAMP(3),
  ADD COLUMN "clientConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "clientConfirmedVia" TEXT;

-- Times offered to move an existing meeting: taking one cancels that meeting.
ALTER TABLE "booking_offers" ADD COLUMN "replacesBookingId" TEXT;

-- The reminder job asks for confirmed meetings in a window that still need one.
CREATE INDEX "bookings_reminder_due_idx" ON bookings("organizationId", "startsAt")
  WHERE status = 'confirmed';
