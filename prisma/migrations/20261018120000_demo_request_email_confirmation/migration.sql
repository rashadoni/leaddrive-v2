-- A demo request reaches the owner only once its address is proven: the
-- prospect opened the link sent to that mailbox and pressed «Təsdiqlə və
-- demonu aç» (owner, 2026-10-18, after a request with an invented address
-- landed in his inbox). `emailConfirmedAt` is that moment, and the claim on
-- it is what makes the owner's notification go out exactly once.
--
-- Pressing the button is recorded as EMAIL_CONFIRMED. The six-digit code it
-- replaces stays in the allowed list for the rows already written.
--
-- `formChallengeSalt` is the form's solved bot check, stored with the request
-- it let in; unique, so one solved challenge never opens a second request
-- (src/lib/demo-center/form-challenge.ts). Null on every earlier row.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_requests" ADD COLUMN "emailConfirmedAt" TIMESTAMP(3);
ALTER TABLE "demo_requests" ADD COLUMN "formChallengeSalt" TEXT;
CREATE UNIQUE INDEX "demo_requests_form_challenge_salt_key" ON "demo_requests"("formChallengeSalt");

ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'EMAIL_CONFIRMED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

-- An address the code already proved is confirmed from that moment. Both
-- tables are under FORCE ROW LEVEL SECURITY with a system-bypass policy, so
-- the backfill runs under the bypass for this transaction only.
SELECT set_config('app.rls_bypass', 'on', true);

UPDATE "demo_requests" AS r
   SET "emailConfirmedAt" = v."firstVerifiedAt"
  FROM (
    SELECT "requestId", MIN("verifiedAt") AS "firstVerifiedAt"
      FROM "demo_grants"
     WHERE "verifiedAt" IS NOT NULL
     GROUP BY "requestId"
  ) AS v
 WHERE r."id" = v."requestId";

COMMIT;
