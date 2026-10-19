-- A prospect's own Facebook Page, connected to the demo for one day, and the
-- messages of the one person who proves himself with the demo's code
-- (docs/DEMO_CENTER.md, «Live social connections»).
--
-- This migration ships the release side first and nothing that connects: a
-- Page can be connected only once the code that unbinds it is in production.
-- `demo_social_connections` is one row per connection attempt. It holds the
-- prospect's Meta user and Page tokens (encrypted, never plaintext — the CHECK
-- below), and every secret and identifier on it is wiped at release, when
-- `scrubbedAt` is set. What survives is the row's timestamps, its reason,
-- Meta's answers as short codes, and its counts.
--
-- The release unsubscribes the Page from our app and never takes back the
-- person's whole Meta grant: `/me/accounts` does not list Pages reached
-- through a business portfolio, so a revoke could never be proven not to cut
-- an organisation's Page tokens. The authorization stays with the person.
--
-- Control plane, like every demo table: no organisation owns these rows, FORCE
-- RLS behind the system-bypass policy. Nothing here or in the code that writes
-- it touches a tenant table.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "demo_social_connections" (
  "id" TEXT NOT NULL,
  "grantId" TEXT,
  "platform" TEXT NOT NULL DEFAULT 'facebook',
  "appConfigId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "oauthStateHash" TEXT,
  "metaUserId" TEXT,
  "userTokenCipher" TEXT,
  "pageTokenCipher" TEXT,
  "pendingPages" JSONB,
  "pageId" TEXT,
  "pageName" TEXT,
  "linkedInstagramId" TEXT,
  "provenSenderId" TEXT,
  "subscribedAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "provenAt" TIMESTAMP(3),
  "aiReplies" INTEGER NOT NULL DEFAULT 0,
  "lastAiReplyAt" TIMESTAMP(3),
  "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
  "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releaseRequestedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "releaseLeaseUntil" TIMESTAMP(3),
  "releaseAttempts" INTEGER NOT NULL DEFAULT 0,
  "releaseError" TEXT,
  "unsubscribeOutcome" TEXT,
  "grantRevokeOutcome" TEXT,
  "scrubbedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_social_connections_pkey" PRIMARY KEY ("id")
);

-- SET NULL, not CASCADE: deleting a grant must never delete the only record
-- that a Page is still bound to our app. The row stays and is released as
-- `grant_gone`.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "demo_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One live connection per grant and platform, and one per Page. Partial, so a
-- wiped row never blocks the next demo of the same Page. Prisma cannot declare
-- a partial index; prisma/schema.prisma points here.
CREATE UNIQUE INDEX "demo_social_connections_live_grant_key"
  ON "demo_social_connections"("grantId", "platform") WHERE "scrubbedAt" IS NULL;
CREATE UNIQUE INDEX "demo_social_connections_live_page_key"
  ON "demo_social_connections"("platform", "pageId") WHERE "scrubbedAt" IS NULL;
-- The release cron reads only rows still holding something.
CREATE INDEX "demo_social_connections_open_expiry_idx"
  ON "demo_social_connections"("expiresAt") WHERE "scrubbedAt" IS NULL;

-- Facebook now; Instagram later by widening this list.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_platform_check" CHECK ("platform" IN ('facebook'));
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_code_check" CHECK ("code" ~ '^LD-[0-9A-F]{6}$');
-- A token is stored only as encryptToken's ciphertext. decryptToken returns
-- any value without the prefix as plaintext, so only this can guarantee it.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_user_token_check" CHECK ("userTokenCipher" IS NULL OR "userTokenCipher" LIKE 'v1:%');
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_page_token_check" CHECK ("pageTokenCipher" IS NULL OR "pageTokenCipher" LIKE 'v1:%');
-- A Page token is useless, and its release impossible, without its Page.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_page_token_page_check" CHECK ("pageTokenCipher" IS NULL OR "pageId" IS NOT NULL);
-- A Page id is Meta's number; it goes into a Graph path.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_page_id_check" CHECK ("pageId" IS NULL OR "pageId" ~ '^[0-9]{1,32}$');
-- The Instagram account linked to the Page, as Meta's number. Its DMs ride the
-- Page's subscription, and an organisation's Instagram channel or monitored
-- account is stored under this id, not the Page's: the release checks both.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_linked_instagram_id_check" CHECK ("linkedInstagramId" IS NULL OR "linkedInstagramId" ~ '^[0-9]{1,32}$');
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_pending_pages_check" CHECK ("pendingPages" IS NULL OR jsonb_typeof("pendingPages") = 'array');
-- A connection lasts one Baku day at most (demoWhatsAppThreadEnds caps it at 23 hours).
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_expiry_check" CHECK ("expiresAt" <= "createdAt" + INTERVAL '24 hours');
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_ai_replies_check" CHECK ("aiReplies" BETWEEN 0 AND 20);
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_counts_check" CHECK ("aiInputTokens" >= 0 AND "aiOutputTokens" >= 0 AND "releaseAttempts" >= 0);
-- Why a connection ended (DEMO_SOCIAL_RELEASE_REASONS), recorded with the
-- moment the release was first asked for, and never one without the other.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_release_reason_check" CHECK ("releaseReason" IS NULL OR "releaseReason" IN (
    'disconnected', 'deauthorized', 'grant_gone', 'revoked', 'finished', 'session_over', 'connect_abandoned', 'day_over'
  ));
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_release_request_check" CHECK (("releaseRequestedAt" IS NULL) = ("releaseReason" IS NULL));
-- A short code of ours (http_500, meta_190, net_timeout), never Meta's text.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_release_error_check" CHECK ("releaseError" IS NULL OR "releaseError" ~ '^(http|meta|net)_[0-9a-z_]{1,32}$');
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_unsubscribe_outcome_check" CHECK ("unsubscribeOutcome" IS NULL OR "unsubscribeOutcome" IN (
    'removed', 'gone', 'not_subscribed', 'kept_claimed', 'token_invalid', 'refused', 'decrypt_failed', 'unreachable'
  ));
-- What became of the person's Meta grant. Nothing is ever sent for it: the
-- grant stays with the person by design when we held a user token, and there
-- is nothing to keep when we did not.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_grant_revoke_outcome_check" CHECK ("grantRevokeOutcome" IS NULL OR "grantRevokeOutcome" IN (
    'kept_by_design', 'no_token'
  ));
-- A wiped row holds no secret and no identifier, says why it ended, what Meta
-- answered to the unsubscribe, and what became of the grant.
ALTER TABLE "demo_social_connections"
  ADD CONSTRAINT "demo_social_connections_scrubbed_check" CHECK ("scrubbedAt" IS NULL OR (
    "oauthStateHash" IS NULL AND "metaUserId" IS NULL
    AND "userTokenCipher" IS NULL AND "pageTokenCipher" IS NULL
    AND "pendingPages" IS NULL AND "pageId" IS NULL AND "pageName" IS NULL AND "linkedInstagramId" IS NULL
    AND "provenSenderId" IS NULL
    AND "releaseReason" IS NOT NULL
    AND "unsubscribeOutcome" IS NOT NULL AND "grantRevokeOutcome" IS NOT NULL
  ));

-- Only the proven sender's messages and our replies; all deleted at release.
CREATE TABLE "demo_social_messages" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "externalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_social_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "demo_social_messages"
  ADD CONSTRAINT "demo_social_messages_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "demo_social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Meta delivers a webhook more than once; the second copy is refused.
CREATE UNIQUE INDEX "demo_social_messages_connection_external_key" ON "demo_social_messages"("connectionId", "externalId");
CREATE INDEX "demo_social_messages_connection_time_idx" ON "demo_social_messages"("connectionId", "createdAt");

ALTER TABLE "demo_social_messages"
  ADD CONSTRAINT "demo_social_messages_direction_check" CHECK ("direction" IN ('inbound', 'outbound'));
ALTER TABLE "demo_social_messages"
  ADD CONSTRAINT "demo_social_messages_text_check" CHECK (char_length("text") <= 1000);

ALTER TABLE "demo_social_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_social_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "demo_social_connections_system_bypass" ON "demo_social_connections"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "demo_social_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_social_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "demo_social_messages_system_bypass" ON "demo_social_messages"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

DO $$
DECLARE app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'organizations';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_social_connections TO %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_social_messages TO %I', app_owner);
  END IF;
END $$;

-- The connection's steps in the access trail. Their metadata carries the
-- platform, the reason, Meta's answers and the consent version — never a Page
-- id, a sender id, a name or a message.
ALTER TABLE "demo_access_events" DROP CONSTRAINT IF EXISTS "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'EMAIL_CONFIRMED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'WHATSAPP_WELCOME_SENT', 'WHATSAPP_PROVEN', 'WHATSAPP_AI_REPLIED', 'WHATSAPP_CLOSED',
  'WHATSAPP_TICKET_OPENED',
  'SOCIAL_CONNECTED', 'SOCIAL_PROVEN', 'SOCIAL_AI_REPLIED', 'SOCIAL_RELEASED', 'SOCIAL_RELEASE_INCOMPLETE',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
