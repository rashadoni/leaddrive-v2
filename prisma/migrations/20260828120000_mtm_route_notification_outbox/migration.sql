-- R5: durable, tenant-scoped post-commit delivery for route notifications.
--
-- Rollback is intentionally additive: stop the cron, suppress or drain PENDING
-- rows, then roll back application code. Do not drop this table or the nullable
-- source key from mtm_notifications; that would destroy delivery evidence and
-- re-open duplicate-delivery risk for rows already committed.

SET lock_timeout = '3s';

CREATE TYPE "MtmRouteNotificationOutboxStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'SUPPRESSED',
  'FAILED'
);

CREATE TABLE "mtm_route_notification_outbox" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "type" TEXT NOT NULL DEFAULT 'info',
  "metadata" JSONB,
  "status" "MtmRouteNotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "suppressedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_route_notification_outbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mtm_notifications" ADD COLUMN "outboxId" TEXT;

CREATE UNIQUE INDEX "mtm_route_notification_outbox_org_id_key"
  ON "mtm_route_notification_outbox"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_route_notification_outbox_org_dedupe_key"
  ON "mtm_route_notification_outbox"("organizationId", "dedupeKey");
CREATE INDEX "mtm_route_notification_outbox_dispatch_idx"
  ON "mtm_route_notification_outbox"("status", "availableAt", "leaseUntil");
CREATE INDEX "mtm_route_notification_outbox_org_status_created_idx"
  ON "mtm_route_notification_outbox"("organizationId", "status", "createdAt");
CREATE INDEX "mtm_route_notification_outbox_agent_created_idx"
  ON "mtm_route_notification_outbox"("agentId", "createdAt");
CREATE UNIQUE INDEX "mtm_notifications_org_outbox_key"
  ON "mtm_notifications"("organizationId", "outboxId");

ALTER TABLE "mtm_route_notification_outbox"
  ADD CONSTRAINT "mtm_route_notification_outbox_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_route_notification_outbox"
  ADD CONSTRAINT "mtm_route_notification_outbox_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_notifications"
  ADD CONSTRAINT "mtm_notifications_organizationId_outboxId_fkey"
  FOREIGN KEY ("organizationId", "outboxId")
  REFERENCES "mtm_route_notification_outbox"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- New tenant tables must be protected in the migration itself. The bypass
-- clause is required by runWithRlsBypass() workers and is asserted in CI.
ALTER TABLE "mtm_route_notification_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_notification_outbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_notification_outbox";
DROP POLICY IF EXISTS "mtm_route_notification_outbox_tenant_isolation" ON "mtm_route_notification_outbox";
CREATE POLICY tenant_isolation ON "mtm_route_notification_outbox"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
