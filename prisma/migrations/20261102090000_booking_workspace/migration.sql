-- Explicit coordinator access. No existing employee is granted team access by migration.
CREATE TABLE "booking_coordinator_grants" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "coordinatorUserId" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "canManage" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_coordinator_grants_coordinator_fkey" FOREIGN KEY ("organizationId", "coordinatorUserId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "booking_coordinator_grants_host_fkey" FOREIGN KEY ("organizationId", "hostUserId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "booking_coordinator_grants_creator_fkey" FOREIGN KEY ("organizationId", "createdBy") REFERENCES "users"("organizationId", "id")
);
CREATE UNIQUE INDEX "booking_coordinator_grants_identity_key" ON "booking_coordinator_grants"("organizationId", "coordinatorUserId", "hostUserId");
CREATE INDEX "booking_coordinator_grants_host_idx" ON "booking_coordinator_grants"("organizationId", "hostUserId");
ALTER TABLE "booking_coordinator_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_coordinator_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_coordinator_grants"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE INDEX "bookings_org_start_id_idx" ON "bookings"("organizationId", "startsAt", "id");
CREATE INDEX "bookings_org_host_start_id_idx" ON "bookings"("organizationId", "hostUserId", "startsAt", "id");
