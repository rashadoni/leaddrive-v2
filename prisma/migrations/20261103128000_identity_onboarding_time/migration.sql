-- Frozen optional Time metadata for an explicitly reviewed cross-module enrollment.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE identity_onboarding_intents ADD COLUMN "timeEnrollment" JSONB;
ALTER TABLE identity_onboarding_intents ADD CONSTRAINT identity_onboarding_time_shape CHECK (
 "timeEnrollment" IS NULL OR (application='TIME' AND jsonb_typeof("timeEnrollment")='object')
);
-- A person may be moving to Time without retaining any old application.
-- The application service only permits cutover with atomic Time completion.
ALTER TABLE identity_onboarding_intents DROP CONSTRAINT identity_onboarding_intents_applications_check;
ALTER TABLE identity_onboarding_intents ADD CONSTRAINT identity_onboarding_applications_shape CHECK (
 jsonb_typeof(applications)='array' AND jsonb_array_length(applications) BETWEEN 0 AND 3
 AND (jsonb_array_length(applications)>0 OR "timeEnrollment" IS NOT NULL)
);
-- The existing immutable-row trigger includes this new column automatically.
COMMIT;
