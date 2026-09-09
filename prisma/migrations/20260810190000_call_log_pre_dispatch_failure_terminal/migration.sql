-- Close historical outbound attempts that failed before the provider ever
-- accepted them.
--
-- The exact-phone fence blocks a new call while an attempt has no proven
-- terminal truth: providerOutcome IS NULL AND endedAt IS NULL. Today's dispatch
-- path already records a definite provider rejection as terminal
-- (status/providerOutcome = 'failed' plus endedAt), so it never creates such a
-- row. Older code wrote only the status, leaving providerOutcome and endedAt
-- empty, and those rows fence their phone permanently: on production a single
-- number carried 21 of them and neither an AI call nor an ordinary click-to-call
-- could be placed to it.
--
-- Only rows without a providerCallId are touched. Without a provider call id the
-- provider never accepted the attempt, so there is nothing in flight and no
-- redial risk -- which is exactly the case the current code marks terminal. An
-- attempt that did reach the provider keeps its fence untouched.
--
-- endedAt is taken from when the attempt actually happened rather than now(), so
-- the backfill does not invent a fresh end time for a call from July.
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  remaining_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'call_logs'::regclass;

  ALTER TABLE "call_logs" DISABLE ROW LEVEL SECURITY;

  UPDATE "call_logs" AS cl
  SET
    "providerOutcome" = 'failed',
    "endedAt" = COALESCE(cl."startedAt", cl."createdAt")
  WHERE cl."direction" = 'outbound'
    AND cl."status" = 'failed'
    AND cl."providerOutcome" IS NULL
    AND cl."endedAt" IS NULL
    AND cl."providerCallId" IS NULL;

  SELECT COUNT(*)
  INTO remaining_count
  FROM "call_logs" AS cl
  WHERE cl."direction" = 'outbound'
    AND cl."status" = 'failed'
    AND cl."providerOutcome" IS NULL
    AND cl."endedAt" IS NULL
    AND cl."providerCallId" IS NULL;

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Pre-dispatch call failures remain after RLS-safe backfill: %', remaining_count;
  END IF;

  IF had_rls THEN
    ALTER TABLE "call_logs" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "call_logs" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "call_logs" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "call_logs" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
