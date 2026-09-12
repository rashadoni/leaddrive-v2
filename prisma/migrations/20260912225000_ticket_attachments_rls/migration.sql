-- Ticket attachments carry an explicit tenant key. Enforce it at the database
-- boundary as well as in application queries. This closes the gap left by the
-- table's initial migration and is non-destructive/reversible.
ALTER TABLE "ticket_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_attachments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_attachments";
CREATE POLICY tenant_isolation ON "ticket_attachments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
