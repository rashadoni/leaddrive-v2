-- The demo's Service Desk on the prospect's own WhatsApp (owner, 2026-10-18:
-- «сделай возможность для тикетинг системы»; a ticket only on the prospect's
-- own press: «только по его кнопке»). After the press («Mesajımdan bilet
-- açılsın») the next message from the proven phone opens a real ticket in the
-- demo's sales organisation, marked «demo»; the thread keeps its id, so the
-- demo page shows that ticket and no other — never one found by the phone.
--
-- `ticketClaimedAt` lets one of two messages arriving together create the
-- ticket; the other waits for its id.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_whatsapp_threads"
  ADD COLUMN "ticketModeAt" TIMESTAMP(3),
  ADD COLUMN "ticketClaimedAt" TIMESTAMP(3),
  ADD COLUMN "ticketId" TEXT;

CREATE UNIQUE INDEX "demo_whatsapp_threads_ticket_key" ON "demo_whatsapp_threads"("ticketId");

-- Ticket mode only on a proven thread, and a ticket only in ticket mode.
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_ticket_mode_check" CHECK ("ticketModeAt" IS NULL OR "provenAt" IS NOT NULL);
ALTER TABLE "demo_whatsapp_threads"
  ADD CONSTRAINT "demo_whatsapp_threads_ticket_check" CHECK ("ticketId" IS NULL OR "ticketModeAt" IS NOT NULL);

-- The ticket's opening in the access trail.
ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'EMAIL_CONFIRMED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'WHATSAPP_WELCOME_SENT', 'WHATSAPP_PROVEN', 'WHATSAPP_AI_REPLIED', 'WHATSAPP_CLOSED',
  'WHATSAPP_TICKET_OPENED',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
