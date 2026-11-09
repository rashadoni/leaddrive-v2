-- AI providers through one gateway (src/lib/ai/gateway, owner 2026-11-09):
-- an organization's own provider keys, a numbers-only journal of every paid
-- AI call, and the per-client switch "AI on the platform's keys".

ALTER TABLE "organizations" ADD COLUMN "aiPlatformKey" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "tenant_ai_credentials" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "keyHint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unchecked',
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_ai_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_ai_credentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_ai_credentials_provider_check" CHECK ("provider" IN ('anthropic', 'gemini', 'openai', 'voyage', 'google_vision', 'google_speech')),
  CONSTRAINT "tenant_ai_credentials_status_check" CHECK ("status" IN ('ok', 'invalid', 'unchecked'))
);
CREATE UNIQUE INDEX "tenant_ai_credentials_organizationId_provider_key" ON "tenant_ai_credentials"("organizationId", "provider");

CREATE TABLE "ai_usage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "agentId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
  "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "keySource" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_usage_keySource_check" CHECK ("keySource" IN ('platform', 'tenant'))
);
CREATE INDEX "ai_usage_organizationId_createdAt_idx" ON "ai_usage"("organizationId", "createdAt");
CREATE INDEX "ai_usage_organizationId_agentId_createdAt_idx" ON "ai_usage"("organizationId", "agentId", "createdAt");

ALTER TABLE "tenant_ai_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_ai_credentials"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
