-- Durable, tenant-scoped receipts for additive Route Field v1 route commands.
--
-- This migration is deliberately server-first and additive. It does not alter
-- frozen v1 sync/push state, the mutation outbox, or the read-only v2 stream.
-- A completed command commits its route mutation, notification outbox rows and
-- this receipt in one transaction; infrastructure failures leave no terminal
-- receipt to replay. Rollback is operational: stop admitting the new command
-- endpoint and retain receipts until their bounded expiry. Do not delete the
-- legacy outbox or MtmSyncOperation rows.

SET lock_timeout = '3s';

CREATE TABLE "mtm_mobile_route_command_receipts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "targetRouteId" TEXT,
  "requestHash" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_mobile_route_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_mobile_route_command_receipts_agent_id_length"
    CHECK (char_length("agentId") BETWEEN 1 AND 128),
  CONSTRAINT "mtm_mobile_route_command_receipts_device_id_length"
    CHECK (char_length("deviceId") BETWEEN 1 AND 128),
  CONSTRAINT "mtm_mobile_route_command_receipts_operation_id_length"
    CHECK (char_length("operationId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_mobile_route_command_receipts_command"
    CHECK ("command" IN ('CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH')),
  CONSTRAINT "mtm_mobile_route_command_receipts_target_route_id_length"
    CHECK ("targetRouteId" IS NULL OR char_length("targetRouteId") BETWEEN 1 AND 128),
  CONSTRAINT "mtm_mobile_route_command_receipts_hash_sha256"
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mtm_mobile_route_command_receipts_outcome"
    CHECK ("outcome" IN ('APPLIED', 'CONFLICT')),
  CONSTRAINT "mtm_mobile_route_command_receipts_response_status"
    CHECK ("responseStatus" BETWEEN 200 AND 499),
  CONSTRAINT "mtm_mobile_route_command_receipts_expiry_after_completion"
    CHECK ("expiresAt" > "completedAt")
);

ALTER TABLE "mtm_mobile_route_command_receipts"
  ADD CONSTRAINT "mtm_mobile_route_command_receipts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One operation ID can have exactly one terminal result in a tenant. Agent,
-- device, target and request hash are still checked on every replay; a UUID
-- collision or cross-device reuse fails closed rather than returning data.
CREATE UNIQUE INDEX "mtm_mobile_route_command_receipts_organizationId_op_key"
  ON "mtm_mobile_route_command_receipts"("organizationId", "operationId");
CREATE INDEX "mtm_mobile_route_command_receipts_tenant_expiry_idx"
  ON "mtm_mobile_route_command_receipts"("organizationId", "expiresAt", "id");
CREATE INDEX "mtm_mobile_route_command_receipts_lookup_idx"
  ON "mtm_mobile_route_command_receipts"("organizationId", "agentId", "deviceId", "createdAt");

-- Retention scheduling is global, opaque bypass-only state. The bounded
-- tenant-first reaper added with application code fails closed if this seed is
-- absent; it never falls back to a global delete.
INSERT INTO "mtm_mobile_sync_retention_cursors" ("jobName") VALUES
  ('route-commands')
ON CONFLICT ("jobName") DO NOTHING;

-- Receipts belong to one tenant and must be RLS-protected from the first
-- deployment. The bypass arm is for the bounded retention job only.
ALTER TABLE "mtm_mobile_route_command_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_route_command_receipts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_route_command_receipts";
CREATE POLICY tenant_isolation ON "mtm_mobile_route_command_receipts"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
