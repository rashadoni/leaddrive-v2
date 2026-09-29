-- The demo assistant now answers some questions from prepared, approved text
-- (src/lib/demo-center/assistant/prepared-answers.ts), picked by a decision
-- model. Those answers are recorded as ASSISTANT_PREPARED: kept apart from
-- ASSISTANT_ASKED because only the latter spends the 50-question Da Vinci
-- allowance. The list stays closed — widened by exactly this one value;
-- `src/__tests__/demo-center-db-constraints.test.ts` inserts every type the
-- code writes into a real Postgres in CI.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED', 'ASSISTANT_PREPARED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
