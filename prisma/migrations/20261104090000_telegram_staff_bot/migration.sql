-- Telegram bot for employees (task 8): an organization's own bot, the
-- employees' linked accounts, one-time link tokens and writes awaiting
-- «Təsdiqlə». All four are tenant tables under FORCE RLS.

CREATE TABLE "telegram_staff_bots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "webhookSecretHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdateId" BIGINT NOT NULL DEFAULT 0,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_staff_bots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_staff_bots_organizationId_key" ON "telegram_staff_bots"("organizationId");
CREATE UNIQUE INDEX "telegram_staff_bots_telegramBotId_key" ON "telegram_staff_bots"("telegramBotId");
ALTER TABLE "telegram_staff_bots" ADD CONSTRAINT "telegram_staff_bots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_staff_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "chatId" TEXT NOT NULL,
    "recentTurns" JSONB,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_staff_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_staff_links_userId_key" ON "telegram_staff_links"("userId");
CREATE UNIQUE INDEX "telegram_staff_links_botId_telegramUserId_key" ON "telegram_staff_links"("botId", "telegramUserId");
CREATE INDEX "telegram_staff_links_organizationId_idx" ON "telegram_staff_links"("organizationId");
ALTER TABLE "telegram_staff_links" ADD CONSTRAINT "telegram_staff_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_staff_links" ADD CONSTRAINT "telegram_staff_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "telegram_staff_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_staff_links" ADD CONSTRAINT "telegram_staff_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_staff_link_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_staff_link_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_staff_link_tokens_tokenHash_key" ON "telegram_staff_link_tokens"("tokenHash");
CREATE INDEX "telegram_staff_link_tokens_organizationId_userId_idx" ON "telegram_staff_link_tokens"("organizationId", "userId");
ALTER TABLE "telegram_staff_link_tokens" ADD CONSTRAINT "telegram_staff_link_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_staff_link_tokens" ADD CONSTRAINT "telegram_staff_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_staff_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resultId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "telegram_staff_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_staff_actions_kind_check" CHECK ("kind" IN ('create_lead', 'create_task')),
    CONSTRAINT "telegram_staff_actions_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'cancelled', 'expired', 'failed'))
);
CREATE INDEX "telegram_staff_actions_organizationId_status_idx" ON "telegram_staff_actions"("organizationId", "status");
CREATE INDEX "telegram_staff_actions_linkId_idx" ON "telegram_staff_actions"("linkId");
ALTER TABLE "telegram_staff_actions" ADD CONSTRAINT "telegram_staff_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_staff_actions" ADD CONSTRAINT "telegram_staff_actions_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "telegram_staff_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telegram_staff_bots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_staff_bots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "telegram_staff_bots"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "telegram_staff_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_staff_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "telegram_staff_links"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "telegram_staff_link_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_staff_link_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "telegram_staff_link_tokens"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "telegram_staff_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_staff_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "telegram_staff_actions"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
