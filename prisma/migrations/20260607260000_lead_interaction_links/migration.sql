-- Lead interaction links (Slice 3): nullable `leadId` + composite index on the
-- four interaction tables, so the lead timeline can UNION calls / emails /
-- channel messages / tickets by lead (in addition to Activity/Task/FormSubmission).
--
-- Additive + backward-compatible: the column is NULL on every existing row, so
-- there is nothing to validate and no rewrite. No FK constraint — consistent with
-- the loose lead-linkage pattern already used (Activity/Task → lead via relatedId)
-- and with email_logs/channel_messages' existing plain `contactId`. Writers
-- populate `leadId` going forward (Slice 3b); no fuzzy backfill.

ALTER TABLE "call_logs" ADD COLUMN "leadId" TEXT;
CREATE INDEX "call_logs_organizationId_leadId_idx" ON "call_logs"("organizationId", "leadId");

ALTER TABLE "email_logs" ADD COLUMN "leadId" TEXT;
CREATE INDEX "email_logs_organizationId_leadId_idx" ON "email_logs"("organizationId", "leadId");

ALTER TABLE "channel_messages" ADD COLUMN "leadId" TEXT;
CREATE INDEX "channel_messages_organizationId_leadId_idx" ON "channel_messages"("organizationId", "leadId");

ALTER TABLE "tickets" ADD COLUMN "leadId" TEXT;
CREATE INDEX "tickets_organizationId_leadId_idx" ON "tickets"("organizationId", "leadId");
