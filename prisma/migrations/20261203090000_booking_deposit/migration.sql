-- A deposit holds the time: the service says what it is, and the visit keeps
-- what was actually asked for. Every column is nullable or has a default, so a
-- release that does not know them keeps writing and reading both tables.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "depositAmount" DECIMAL(14, 2),
  ADD COLUMN "depositPercent" INTEGER,
  ADD COLUMN "depositFreeHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "bookings"
  ADD COLUMN "depositAmount" DECIMAL(14, 2),
  ADD COLUMN "depositStatus" TEXT,
  ADD COLUMN "depositPaidAt" TIMESTAMP(3);
