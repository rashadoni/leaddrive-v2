-- Where a push can actually be delivered: one row per installation.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets. The previous MTM table shipped with a different name and
-- failed closed in both directions until 2026-09-20; the guard in
-- src/__tests__/migration-rls-setting-name.test.ts exists because of it.

CREATE TABLE "mtm_device_tokens" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "deviceId" TEXT,
  "appVersion" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_device_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_device_tokens_org_token_key" UNIQUE ("organizationId", "token"),
  CONSTRAINT "mtm_device_tokens_org_fk" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_device_tokens_agent_fk" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mtm_device_tokens_org_agent_active_idx" ON "mtm_device_tokens"("organizationId", "agentId", "disabledAt");

ALTER TABLE "mtm_device_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_device_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_device_tokens"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
