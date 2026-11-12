-- A thing with a schedule that is not a person: a meeting room, a chair, a
-- table, a machine.
--
-- The module was built for salons, so everything bookable was a user: a
-- «master». A coworking books rooms and nobody does them, and the only way to
-- say that today is to create a fake employee — one that takes a seat in the
-- plan, needs a role and could sign in (owner, 2026-11-12).
--
-- A resource is NOT a user, deliberately: nothing outside booking has to learn
-- about it, so no list of people, no assignee picker and no login path can
-- start showing rooms by accident.
--
-- Two bookings of the same room are the same conflict two bookings of the same
-- master are, so a booking points at its resource and the free-time search
-- reads that column exactly as it reads hostUserId.
CREATE TABLE "booking_resources" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  -- When it may be booked at all. Null = whenever the service itself is open,
  -- which is how a host with no schedule of their own already behaves.
  "weekly" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "booking_resources_org_idx" ON "booking_resources"("organizationId", "isActive");
ALTER TABLE "booking_resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_resources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_resources"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
