-- A read-only timetable for a screen on the wall of a salon or an office.
--
-- The address carries the token, so the token IS the permission: it is unique,
-- it is revoked by flipping isActive (nothing is deleted — a screen that stops
-- working must leave a trace of who turned it off and when), and the row holds
-- nothing a passer-by could not read off the screen anyway.
--
-- FORCE RLS like every tenant table: the public page reads it through a bypass
-- of its own, by token, and never by organization.
CREATE TABLE "booking_board_links" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "hostIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "columns" INTEGER NOT NULL DEFAULT 2,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "booking_board_links_creator_fkey" FOREIGN KEY ("organizationId", "createdBy") REFERENCES "users"("organizationId", "id") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_board_links_token_key" ON "booking_board_links"("token");
CREATE INDEX "booking_board_links_org_idx" ON "booking_board_links"("organizationId", "isActive");
ALTER TABLE "booking_board_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_board_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_board_links"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
