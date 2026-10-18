-- The demo's live WhatsApp thread with the AI agent (owner, 2026-10-18: «по
-- омни-каналу… ему приходит сообщение, он отвечает, AI agent отвечает, в конце
-- дня отвязка»). One row per grant: the session's code, when that code arrived
-- from exactly the request's phone (the proof that the person viewing the demo
-- holds the phone), the welcome template if one was sent, how many answers the
-- demo's agent gave, and when the thread closed. Control plane, like every demo
-- table: FORCE RLS behind the system-bypass policy.
--
-- `liveWhatsAppEnabled` separates the thread from the AI call: the call still
-- needs the owner's switch and the station's limit; the thread is offered to
-- every prospect. Existing grants keep their meaning: the call switch still
-- opens the thread for them (src/lib/demo-center/demo-whatsapp.ts).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_grants" ADD COLUMN "liveWhatsAppEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "demo_whatsapp_threads" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "welcomeSentAt" TIMESTAMP(3),
  "welcomeWaMessageId" TEXT,
  "provenAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "aiReplies" INTEGER NOT NULL DEFAULT 0,
  "lastAiReplyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_whatsapp_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_whatsapp_threads_grant_key" ON "demo_whatsapp_threads"("grantId");
CREATE UNIQUE INDEX "demo_whatsapp_threads_code_key" ON "demo_whatsapp_threads"("code");
CREATE INDEX "demo_whatsapp_threads_phone_idx" ON "demo_whatsapp_threads"("phoneE164", "provenAt");

ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "demo_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Azerbaijani mobiles only, as everywhere in the demo's live contact.
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_phone_check" CHECK ("phoneE164" ~ '^\+994[0-9]{9}$');
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_code_check" CHECK ("code" ~ '^LD-[0-9A-F]{6}$');
-- A thread answers only once proven, and only until it expires.
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_expiry_check" CHECK ("expiresAt" IS NULL OR "provenAt" IS NOT NULL);
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_ai_replies_check" CHECK ("aiReplies" BETWEEN 0 AND 50);
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_close_check" CHECK ("closedAt" IS NULL OR "closeReason" IS NOT NULL);

ALTER TABLE "demo_whatsapp_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "demo_whatsapp_threads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "demo_whatsapp_threads_system_bypass" ON "demo_whatsapp_threads"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

DO $$
DECLARE app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'organizations';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_whatsapp_threads TO %I', app_owner);
  END IF;
END $$;

-- The thread's steps in the access trail.
ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'EMAIL_CONFIRMED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'WHATSAPP_WELCOME_SENT', 'WHATSAPP_PROVEN', 'WHATSAPP_AI_REPLIED', 'WHATSAPP_CLOSED',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
