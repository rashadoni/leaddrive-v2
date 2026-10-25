-- Frozen optional Time metadata for an explicitly reviewed cross-module enrollment.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE identity_onboarding_intents ADD COLUMN "timeEnrollment" JSONB;
ALTER TABLE identity_onboarding_intents ADD CONSTRAINT identity_onboarding_time_shape CHECK (
 "timeEnrollment" IS NULL OR (application='TIME' AND jsonb_typeof("timeEnrollment")='object')
);
-- The existing immutable-row trigger includes this new column automatically.
COMMIT;
