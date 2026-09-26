-- A verified demo prospect becomes exactly one lead in LeadDrive's own CRM.
-- The link lives on the request, in the control plane: it points into another
-- tenant, so there is deliberately no foreign key, and no public route selects
-- these columns. All columns are nullable; there are no rows to backfill
-- (no demo grant had been verified when this shipped).
ALTER TABLE "demo_requests"
  ADD COLUMN "internalLeadId" TEXT,
  ADD COLUMN "internalLeadOrganizationId" TEXT,
  ADD COLUMN "leadLinkStatus" TEXT,
  ADD COLUMN "leadLinkedAt" TIMESTAMP(3),
  ADD COLUMN "leadLinkUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "leadLinkError" TEXT;

ALTER TABLE "demo_requests"
  ADD CONSTRAINT "demo_requests_lead_link_status_check"
  CHECK ("leadLinkStatus" IS NULL OR "leadLinkStatus" IN ('PENDING', 'LINKED', 'FAILED', 'UNCONFIGURED'));

-- A LINKED row must say which lead, in which organisation.
ALTER TABLE "demo_requests"
  ADD CONSTRAINT "demo_requests_lead_link_target_check"
  CHECK ("leadLinkStatus" IS DISTINCT FROM 'LINKED' OR ("internalLeadId" IS NOT NULL AND "internalLeadOrganizationId" IS NOT NULL));
