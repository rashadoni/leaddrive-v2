-- A time the client chose that the salon, by its own rules, wants to see
-- before it becomes a meeting. The offer stays, holding the chair, until a
-- person confirms or declines it — so the client keeps their place while the
-- administrator decides, and nobody else is offered that time meanwhile.
SET lock_timeout='3s';

ALTER TABLE "booking_offers"
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- 'pending' joins the statuses a row may hold.
ALTER TABLE "booking_offers" DROP CONSTRAINT IF EXISTS "booking_offers_status_check";
ALTER TABLE "booking_offers" ADD CONSTRAINT "booking_offers_status_check"
  CHECK (status IN ('offered','pending','booked','taken','expired','superseded','declined'));

CREATE INDEX "booking_offers_pending_idx" ON booking_offers("organizationId", "startsAt") WHERE status = 'pending';
