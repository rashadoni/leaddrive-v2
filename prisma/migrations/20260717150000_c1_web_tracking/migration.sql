-- C1 (Creatio 10X roadmap) — anonymous web tracking: per-tenant snippet config,
-- visitor sessions and raw actions. All three are tenant tables → FORCE RLS with
-- the standard tenant_isolation policy (public ingest writes run via runWithTenant
-- after publicKey → org resolution).

CREATE TABLE "web_tracking_configs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "publicKey" TEXT NOT NULL,
  "allowedOrigins" TEXT[] NOT NULL DEFAULT '{}',
  "retentionDays" INTEGER NOT NULL DEFAULT 180,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "web_tracking_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_tracking_configs_retention_check" CHECK ("retentionDays" BETWEEN 1 AND 3650),
  CONSTRAINT "web_tracking_configs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "web_sessions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "contactId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "entryUrl" TEXT,
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "userAgent" TEXT,

  CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_sessions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "web_actions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'pageview',
  "name" TEXT,
  "url" TEXT,
  "referrer" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "web_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_actions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "web_actions_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "web_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "web_tracking_configs_organizationId_key" ON "web_tracking_configs"("organizationId");
CREATE UNIQUE INDEX "web_tracking_configs_publicKey_key" ON "web_tracking_configs"("publicKey");
CREATE INDEX "web_tracking_configs_publicKey_idx" ON "web_tracking_configs"("publicKey");

CREATE INDEX "web_sessions_organizationId_visitorId_lastSeenAt_idx"
  ON "web_sessions"("organizationId", "visitorId", "lastSeenAt");
CREATE INDEX "web_sessions_organizationId_contactId_idx"
  ON "web_sessions"("organizationId", "contactId");
CREATE INDEX "web_sessions_organizationId_lastSeenAt_idx"
  ON "web_sessions"("organizationId", "lastSeenAt");

CREATE INDEX "web_actions_organizationId_visitorId_createdAt_idx"
  ON "web_actions"("organizationId", "visitorId", "createdAt");
CREATE INDEX "web_actions_sessionId_idx" ON "web_actions"("sessionId");
CREATE INDEX "web_actions_organizationId_createdAt_idx"
  ON "web_actions"("organizationId", "createdAt");

ALTER TABLE "web_tracking_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_tracking_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "web_tracking_configs_tenant_isolation"
  ON "web_tracking_configs"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "web_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "web_sessions_tenant_isolation"
  ON "web_sessions"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "web_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "web_actions_tenant_isolation"
  ON "web_actions"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
