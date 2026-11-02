-- «Часы не те?»: an agent at a place whose «часы приёма» are wrong proposes
-- the real ones from the spot; a manager accepts them or leaves the old ones.
-- The agent never changes a place himself (owner, 2026-10-02). Asked for by
-- the owner on 2026-11-02 (mockup «MTM: часы приёма клиентов»).
--
-- A new table and nothing else: no existing row is touched, and the previous
-- build, which does not know the table, never reads it.

SET lock_timeout = '3s';

CREATE TABLE "mtm_customer_hours_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "idempotencyKey" TEXT NOT NULL,
  "previousHours" JSONB,
  "proposedHours" JSONB NOT NULL,
  "comment" TEXT,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_customer_hours_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_customer_hours_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a request points only at a place and an
  -- agent of its own organization, and it leaves with either.
  CONSTRAINT "mtm_customer_hours_requests_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_customer_hours_requests_organizationId_requestedByAgen_fkey" FOREIGN KEY ("organizationId", "requestedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_customer_hours_requests_organizationId_idempotencyKey_key" ON "mtm_customer_hours_requests"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_customer_hours_requests_organizationId_status_submittedAt_idx" ON "mtm_customer_hours_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_customer_hours_requests_organizationId_customerId_submittedAt_idx" ON "mtm_customer_hours_requests"("organizationId", "customerId", "submittedAt");
CREATE INDEX "mtm_customer_hours_requests_organizationId_requestedByAgentId_submittedAt_idx" ON "mtm_customer_hours_requests"("organizationId", "requestedByAgentId", "submittedAt");
-- One question about a place's hours at a time: the database holds it.
CREATE UNIQUE INDEX "mtm_customer_hours_requests_one_waiting_per_customer" ON "mtm_customer_hours_requests"("organizationId", "customerId") WHERE "status" = 'SUBMITTED';

ALTER TABLE "mtm_customer_hours_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_hours_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_customer_hours_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Rollback is forward-safe: roll back the application code and keep the
-- table. Without the code nothing reads or writes it.
