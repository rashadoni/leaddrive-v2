-- Voice control (ElevenAgents) — session, transcript and minute-budget tables.
--
-- All three are tenant tables and go up WITH RLS from birth. Nothing in the
-- test suite guards RLS coverage for a non-`mtm_` table (mtm-rls-coverage only
-- matches @@map("mtm_…")), so the policies below are hand-verified rather than
-- generated-and-checked.
--
-- Policy text is the canonical one from scripts/rls/generate-rls-policies.mjs:
-- bare `tenant_isolation` (NOT "<table>_tenant_isolation" — the emergency
-- rollback in scripts/rls/disable-batch-*.sql only drops the bare name), with
-- the app.rls_bypass OR-branch in BOTH clauses so runWithRlsBypass keeps
-- working. Omitting that branch would silently break 400+ bypass call sites,
-- including clearTenantContent's demo purge, which would then report success
-- while leaving rows behind.
--
-- No backfill: the tables are new, so the DO-block snapshot/disable/restore
-- recipe does not apply.

SET lock_timeout = '3s';

CREATE TABLE "voice_sessions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "elevenlabsConversationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "locale" TEXT NOT NULL DEFAULT 'ru',
  "reservedSeconds" INTEGER NOT NULL,
  "billedSeconds" INTEGER NOT NULL DEFAULT 0,
  "toolCallCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_sessions_status_check"
    CHECK ("status" IN ('active', 'ended', 'abandoned')),
  CONSTRAINT "voice_sessions_seconds_check"
    CHECK ("reservedSeconds" > 0 AND "billedSeconds" >= 0 AND "toolCallCount" >= 0)
);

CREATE TABLE "voice_session_turns" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "voiceSessionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "toolName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_session_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_session_turns_role_check"
    CHECK ("role" IN ('user', 'agent', 'tool'))
);

CREATE TABLE "voice_monthly_usage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "reservedSeconds" INTEGER NOT NULL DEFAULT 0,
  "settledSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_monthly_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_monthly_usage_seconds_check"
    CHECK ("reservedSeconds" >= 0 AND "settledSeconds" >= 0)
);

-- The composite unique is what lets turns reference their session by
-- ("organizationId", "id"), keeping the tenant key on the FK itself.
CREATE UNIQUE INDEX "voice_sessions_org_id_key" ON "voice_sessions"("organizationId", "id");
CREATE INDEX "voice_sessions_org_status_idx" ON "voice_sessions"("organizationId", "status");
CREATE INDEX "voice_sessions_reaper_idx" ON "voice_sessions"("status", "lastHeartbeatAt");
CREATE INDEX "voice_session_turns_org_session_idx" ON "voice_session_turns"("organizationId", "voiceSessionId");
CREATE UNIQUE INDEX "voice_monthly_usage_org_user_month_key" ON "voice_monthly_usage"("organizationId", "userId", "yearMonth");

ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "voice_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_session_turns"
  ADD CONSTRAINT "voice_session_turns_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_session_turns"
  ADD CONSTRAINT "voice_session_turns_organizationId_voiceSessionId_fkey"
  FOREIGN KEY ("organizationId", "voiceSessionId")
  REFERENCES "voice_sessions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_monthly_usage"
  ADD CONSTRAINT "voice_monthly_usage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_sessions";
CREATE POLICY tenant_isolation ON "voice_sessions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "voice_session_turns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_session_turns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_session_turns";
CREATE POLICY tenant_isolation ON "voice_session_turns"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "voice_monthly_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_monthly_usage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "voice_monthly_usage";
CREATE POLICY tenant_isolation ON "voice_monthly_usage"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
