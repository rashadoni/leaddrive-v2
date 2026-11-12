-- What a service may be booked on, beside its masters, and which room a meeting
-- took. Both are additions a release that does not know them never fills:
-- `resourceIds` defaults to empty, which is what every service meant before,
-- and `resourceId` is null on every meeting ever made, which says the same —
-- it belongs to its master and to nobody else.
--
-- Kept apart from the table that holds the resources themselves so that the
-- booking release contract can read this file and see only added columns
-- (scripts/booking/release-contract.mjs, `additiveMigration`).
ALTER TABLE "booking_pages" ADD COLUMN "resourceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Which room this meeting took. Null is every meeting ever made until now: it
-- belongs to its master and to nobody else, exactly as before.
ALTER TABLE "bookings" ADD COLUMN "resourceId" TEXT;
ALTER TABLE "booking_offers" ADD COLUMN "resourceId" TEXT;
CREATE INDEX "bookings_resource_idx" ON "bookings"("organizationId", "resourceId", "startsAt");
CREATE INDEX "booking_offers_resource_idx" ON "booking_offers"("organizationId", "resourceId", "startsAt");
