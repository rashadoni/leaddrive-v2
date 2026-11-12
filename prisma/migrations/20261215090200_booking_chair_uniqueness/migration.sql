-- One chair, one confirmed meeting per start time — the last guard behind the
-- per-chair lock in src/lib/booking/create.ts.
--
-- Until now a chair was always a master, so the guard read `hostUserId` alone.
-- A meeting on a ROOM also carries a master, for the record, and two rooms are
-- two chairs: booking both at ten o'clock is right, and the old index called it
-- a double booking. So the rule is split in two, and each half says exactly
-- what it always meant:
--
--   • a meeting that is not on a room is its master's, one per start;
--   • a meeting on a room is the room's, one per start.
--
-- For every row a release without resources can write — `resourceId` null —
-- the first index is the old one, unchanged.
DROP INDEX IF EXISTS "bookings_host_start_confirmed_key";
CREATE UNIQUE INDEX "bookings_host_start_confirmed_key"
  ON "bookings"("organizationId", "hostUserId", "startsAt") WHERE "status" = 'confirmed' AND "resourceId" IS NULL;
CREATE UNIQUE INDEX "bookings_resource_start_confirmed_key"
  ON "bookings"("organizationId", "resourceId", "startsAt") WHERE "status" = 'confirmed' AND "resourceId" IS NOT NULL;

-- The same split, one layer down: the database's own overlap guard.
--
-- `bookings_confirmed_interval_exclusion` stops a master's two confirmed
-- meetings from overlapping at all, not merely from starting together. A
-- meeting on a room carries a master for the record, so two rooms in use at
-- the same hour looked to it like one master in two places. Each half now says
-- what it always meant, and for a row with no room — everything a release
-- without resources writes — the first is the old constraint, unchanged.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_confirmed_interval_exclusion";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_interval_exclusion"
  EXCLUDE USING gist ("organizationId" WITH =, "hostUserId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'confirmed' AND "resourceId" IS NULL);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_interval_exclusion"
  EXCLUDE USING gist ("organizationId" WITH =, "resourceId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'confirmed' AND "resourceId" IS NOT NULL);
