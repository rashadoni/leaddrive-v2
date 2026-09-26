-- The guided demo's assistant records each answered question on the grant's
-- own append-only trail, which is also where its 50-question quota is
-- counted from. `demo_access_events_type_check` did not admit that event
-- type, so the first question a prospect asked would have failed the insert
-- after the model had already been called and paid for.
--
-- The constraint is the right shape — an unreviewed event type has no
-- business appearing in the access trail — so it is widened by exactly one
-- value rather than dropped. `src/__tests__/demo-journey-assistant.test.ts`
-- now reads this file and fails if the code ever writes a type the check
-- does not list.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED'
));

COMMIT;
