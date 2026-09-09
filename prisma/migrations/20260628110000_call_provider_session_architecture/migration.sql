-- Provider-separated call architecture primitives for multi-tenant/multi-agent calling.
-- Existing CallLog rows remain valid; new columns are nullable for a safe rollout.

ALTER TABLE "call_logs"
  ADD COLUMN IF NOT EXISTS "channelConfigId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "queueId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerCallId" TEXT;

CREATE INDEX IF NOT EXISTS "call_logs_org_channel_config_idx"
  ON "call_logs" ("organizationId", "channelConfigId");

CREATE INDEX IF NOT EXISTS "call_logs_org_provider_status_idx"
  ON "call_logs" ("organizationId", "provider", "status");

CREATE INDEX IF NOT EXISTS "call_logs_org_provider_call_idx"
  ON "call_logs" ("organizationId", "provider", "providerCallId");

DROP INDEX IF EXISTS "call_logs_callSid_key";

CREATE UNIQUE INDEX IF NOT EXISTS "call_logs_org_provider_call_key"
  ON "call_logs" ("organizationId", "provider", "providerCallId")
  WHERE "providerCallId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "call_logs_org_claimed_by_idx"
  ON "call_logs" ("organizationId", "claimedByUserId");

CREATE INDEX IF NOT EXISTS "call_logs_org_call_sid_idx"
  ON "call_logs" ("organizationId", "callSid");

CREATE TABLE IF NOT EXISTS "call_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "callLogId" TEXT,
  "provider" TEXT NOT NULL,
  "providerCallId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_events_org_provider_call_event_hash_key"
  ON "call_events" ("organizationId", "provider", "providerCallId", "eventHash");

CREATE INDEX IF NOT EXISTS "call_events_org_provider_call_idx"
  ON "call_events" ("organizationId", "provider", "providerCallId");

CREATE INDEX IF NOT EXISTS "call_events_org_call_log_idx"
  ON "call_events" ("organizationId", "callLogId");

CREATE INDEX IF NOT EXISTS "call_events_org_event_type_idx"
  ON "call_events" ("organizationId", "eventType");

ALTER TABLE "call_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_events" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "call_events";
CREATE POLICY tenant_isolation ON "call_events"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_events_organizationId_fkey'
  ) THEN
    ALTER TABLE "call_events"
      ADD CONSTRAINT "call_events_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_events_callLogId_fkey'
  ) THEN
    ALTER TABLE "call_events"
      ADD CONSTRAINT "call_events_callLogId_fkey"
      FOREIGN KEY ("callLogId") REFERENCES "call_logs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
