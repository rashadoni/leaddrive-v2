CREATE TABLE "mtm_contact_create_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "specialtyName" TEXT,
  "phone" TEXT,
  "clinicName" TEXT NOT NULL,
  "address" TEXT,
  "notes" TEXT,
  "duplicateSnapshot" JSONB,
  "approvedContactId" TEXT,
  "approvedCustomerId" TEXT,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_contact_create_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_contact_create_requests_org_idempotency_key" UNIQUE ("organizationId", "idempotencyKey"),
  CONSTRAINT "mtm_contact_create_requests_org_fk" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_contact_create_requests_agent_fk" FOREIGN KEY ("organizationId", "requestedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_contact_create_requests_contact_fk" FOREIGN KEY ("organizationId", "approvedContactId") REFERENCES "mtm_contacts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_contact_create_requests_customer_fk" FOREIGN KEY ("organizationId", "approvedCustomerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mtm_contact_create_requests_org_status_submitted_idx" ON "mtm_contact_create_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_contact_create_requests_agent_status_idx" ON "mtm_contact_create_requests"("requestedByAgentId", "status");
CREATE INDEX "mtm_contact_create_requests_approved_contact_idx" ON "mtm_contact_create_requests"("approvedContactId");

ALTER TABLE "mtm_contact_create_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_create_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_contact_create_requests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
