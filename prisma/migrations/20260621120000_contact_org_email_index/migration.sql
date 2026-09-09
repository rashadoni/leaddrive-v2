-- C9 perf: composite index for the email-resolve hooks
--   contact.findFirst({ where: { organizationId, email } })
-- used by the form-submit touchpoint hook + the event/deal hooks. Previously these fell back to the
-- organizationId-only index and filtered `email` in memory per org. Pure additive index — no data change.
-- Tenant contact books here are moderate, so a plain (non-CONCURRENT) build's brief write-lock is negligible;
-- it also keeps the file inside Prisma's migration transaction (CONCURRENTLY cannot run in a tx).
CREATE INDEX "contacts_organizationId_email_idx" ON "contacts"("organizationId", "email");
