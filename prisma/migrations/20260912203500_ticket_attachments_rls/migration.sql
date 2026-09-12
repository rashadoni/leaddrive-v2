-- Ticket attachments carry tenant-owned file metadata. Enforce the same
-- fail-closed database boundary as the other organization-scoped tables.
ALTER TABLE "ticket_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_attachments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_attachments";
CREATE POLICY tenant_isolation ON "ticket_attachments"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
