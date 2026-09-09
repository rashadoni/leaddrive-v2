-- Index Lead phone columns for inbound lead-matching (Slice 3b perf).
-- matchInboundLeadId runs per inbound call (when no contact matched) and per
-- inbound WhatsApp from an unknown sender; its Tier-1 exact lookups on
-- phone / phoneWhatsApp are now index-served (org-scoped) instead of scanning.
-- Additive, no data change. CREATE INDEX briefly SHARE-locks "leads" during the
-- build (fast on a moderate table); switch to CONCURRENTLY only if leads is huge.
CREATE INDEX "leads_organizationId_phone_idx" ON "leads"("organizationId", "phone");
CREATE INDEX "leads_organizationId_phoneWhatsApp_idx" ON "leads"("organizationId", "phoneWhatsApp");
