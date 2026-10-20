-- The guide's voice (owner, 2026-10-20: «Кнопка "спросить голосом"»): a
-- Da Vinci answer spoken in the guide's voice is ASSISTANT_VOICED, a question
-- the prospect said into the microphone and Google turned into text is
-- ASSISTANT_HEARD. Each row is the CLAIM made before Google is called
-- (src/lib/demo-center/assistant-voice.ts), so the voice budget — ten minutes
-- per demo, 300 a day across demos — is summed from these rows under one
-- advisory lock. Their metadata is the seconds and an outcome, never the
-- question, the answer or the audio.
--
-- The list below is the full current one (20261021090000_demo_social_connections)
-- plus exactly these two values; `demo-center-db-constraints.test.ts` replays
-- every demo migration and inserts every type the code writes.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_access_events" DROP CONSTRAINT IF EXISTS "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'EMAIL_CONFIRMED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED', 'ASSISTANT_VOICED', 'ASSISTANT_HEARD',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'WHATSAPP_WELCOME_SENT', 'WHATSAPP_PROVEN', 'WHATSAPP_AI_REPLIED', 'WHATSAPP_CLOSED',
  'WHATSAPP_TICKET_OPENED',
  'SOCIAL_CONNECTED', 'SOCIAL_PROVEN', 'SOCIAL_AI_REPLIED', 'SOCIAL_RELEASED', 'SOCIAL_RELEASE_INCOMPLETE',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
