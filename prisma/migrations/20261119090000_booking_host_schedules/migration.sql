-- A master's own working days. The booking page says when a service is
-- offered; this says when the person who performs it is actually there. In a
-- salon the two differ every week: the page is open Monday to Saturday, and
-- Leyla does not work Tuesdays.
--
-- A host with no row keeps the page's hours, which is exactly today's
-- behaviour, so nothing changes for an organization that never opens this
-- screen.
SET lock_timeout='3s';

CREATE TABLE booking_host_schedules (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 -- { "0".."6": [{ start: "HH:mm", end: "HH:mm" }] } on the organization's
 -- clock, 0 = Sunday — the same shape booking_pages.weekly uses, so one
 -- reader parses both.
 weekly JSONB NOT NULL,
 "createdBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","userId")
);

CREATE INDEX booking_host_schedules_org_idx ON booking_host_schedules("organizationId");

ALTER TABLE "booking_host_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_host_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_host_schedules"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
