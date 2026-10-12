-- «Клиент здесь»: a field agent who has come to a customer and finds its pin
-- in the wrong place asks, from the spot, for the pin to be moved. One row per
-- request: where the pin stood, where the agent says the customer is, where
-- the agent's own phone was and how sure it was. A manager accepts the new
-- place or leaves the old one; the agent never changes a customer himself
-- (owner, 2026-10-02). Asked for by the owner on 2026-10-12.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).
--
-- A new table and nothing else: no existing row is touched, and the previous
-- build, which does not know the table, never reads it.

SET lock_timeout = '3s';

CREATE TABLE "mtm_customer_location_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "idempotencyKey" TEXT NOT NULL,
  "previousLatitude" DOUBLE PRECISION,
  "previousLongitude" DOUBLE PRECISION,
  "proposedLatitude" DOUBLE PRECISION NOT NULL,
  "proposedLongitude" DOUBLE PRECISION NOT NULL,
  "agentLatitude" DOUBLE PRECISION NOT NULL,
  "agentLongitude" DOUBLE PRECISION NOT NULL,
  "agentAccuracyMeters" DOUBLE PRECISION NOT NULL,
  "agentFixAt" TIMESTAMP(3) NOT NULL,
  "movedMeters" INTEGER,
  "agentToProposedMeters" INTEGER NOT NULL,
  "comment" TEXT,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_customer_location_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_customer_location_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a request can only point at a customer
  -- and an agent of its own organization, and it leaves with either.
  CONSTRAINT "mtm_customer_location_requests_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_customer_location_requests_organizationId_requestedByA_fkey" FOREIGN KEY ("organizationId", "requestedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A point on the globe, and never 0,0: that is «no coordinates» written as
  -- a number, and a customer moved there would be in the Gulf of Guinea.
  CONSTRAINT "mtm_customer_location_requests_proposed_check" CHECK (
    "proposedLatitude" BETWEEN -90 AND 90 AND "proposedLongitude" BETWEEN -180 AND 180
    AND NOT ("proposedLatitude" = 0 AND "proposedLongitude" = 0)
  ),
  CONSTRAINT "mtm_customer_location_requests_agent_check" CHECK (
    "agentLatitude" BETWEEN -90 AND 90 AND "agentLongitude" BETWEEN -180 AND 180
    AND NOT ("agentLatitude" = 0 AND "agentLongitude" = 0)
    AND "agentAccuracyMeters" >= 0
  ),
  -- Both or neither: half a pin is not a pin.
  CONSTRAINT "mtm_customer_location_requests_previous_check" CHECK (
    ("previousLatitude" IS NULL) = ("previousLongitude" IS NULL)
  ),
  CONSTRAINT "mtm_customer_location_requests_meters_check" CHECK (
    "agentToProposedMeters" >= 0 AND ("movedMeters" IS NULL OR "movedMeters" >= 0)
  )
);

CREATE UNIQUE INDEX "mtm_customer_location_requests_organizationId_idempotencyKey_key" ON "mtm_customer_location_requests"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_customer_location_requests_organizationId_status_submittedAt_idx" ON "mtm_customer_location_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_customer_location_requests_organizationId_customerId_submittedAt_idx" ON "mtm_customer_location_requests"("organizationId", "customerId", "submittedAt");
CREATE INDEX "mtm_customer_location_requests_organizationId_requestedByAgentId_submittedAt_idx" ON "mtm_customer_location_requests"("organizationId", "requestedByAgentId", "submittedAt");
-- One question about a customer at a time. Two agents at the same door, or
-- one agent pressing twice, make one request: the second is told it is
-- already waiting. The database holds this, not a read before the write.
CREATE UNIQUE INDEX "mtm_customer_location_requests_one_waiting_per_customer" ON "mtm_customer_location_requests"("organizationId", "customerId") WHERE "status" = 'SUBMITTED';

ALTER TABLE "mtm_customer_location_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_location_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_customer_location_requests"
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
