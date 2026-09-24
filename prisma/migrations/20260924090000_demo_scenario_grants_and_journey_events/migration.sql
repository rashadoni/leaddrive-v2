-- The guided demo could not be issued or recorded — on prod since 2026-09-20.
--
-- 1. A scenario grant carries a story, not a module playlist: the issue
--    schema refuses a request that names both, so such a grant is written
--    with `moduleIds` = '{}'. `demo_grants_modules_nonempty_check` still
--    demanded 1..19 modules, so every scenario grant — the admin's «Issue»
--    in its default journey mode and every link the public form issues by
--    itself — failed the insert, rolled back, and left the request at
--    SUBMITTED. Prod had 0 grants on 2026-09-24. The check now says what the
--    code means: a grant is one or the other, never both, never neither.
--
-- 2. The guided player reports its moves as `journey.*` / `video.*`, and the
--    events route stores them as the event type. The allow-list admitted only
--    the module player's UPPERCASE types, so every stored move would fail its
--    transaction, roll back the session heartbeat with it, and the owner
--    would read «0 steps» for a prospect who walked the whole story. The list
--    stays closed — widened by exactly the eight names the route can insert
--    (`REPORTED_JOURNEY_EVENTS`, src/lib/demo-center/journey/telemetry.ts).
--
-- Both tables are empty on prod, so the new checks validate nothing old.
-- `src/__tests__/demo-center-db-constraints.test.ts` replays every demo
-- migration on a real Postgres in CI and issues a scenario grant through the
-- real code, so the next mismatch fails a check instead of a prospect.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_grants" DROP CONSTRAINT "demo_grants_modules_nonempty_check";

ALTER TABLE "demo_grants" ADD CONSTRAINT "demo_grants_modules_or_scenario_check" CHECK (
  ("scenarioId" IS NOT NULL AND cardinality("moduleIds") = 0)
  OR ("scenarioId" IS NULL AND cardinality("moduleIds") BETWEEN 1 AND 19)
);

ALTER TABLE "demo_access_events" DROP CONSTRAINT "demo_access_events_type_check";

ALTER TABLE "demo_access_events" ADD CONSTRAINT "demo_access_events_type_check" CHECK ("eventType" IN (
  'ISSUED', 'SENT', 'DELIVERY_FAILED', 'LINK_OPENED', 'OTP_SENT',
  'OTP_VERIFIED', 'SESSION_STARTED', 'MODULE_OPENED', 'STEP_VIEWED',
  'COMPLETED', 'EXPIRED', 'REVOKED', 'DENIED',
  'ASSISTANT_ASKED',
  'PHONE_CODE_SENT', 'PHONE_VERIFIED',
  'journey.section_opened', 'journey.step_completed', 'journey.step_skipped',
  'journey.transition', 'journey.completed',
  'video.started', 'video.completed', 'video.error'
));

COMMIT;
