-- R2 Health no_show follow-up — extend timestamps-immutable trigger.
--
-- PR #77 added `noShowAt TIMESTAMP(3)` to health_encounters but did NOT
-- extend the existing `health_encounters_timestamps_immutable_trigger`
-- (defined in migration 20260519230000_fix_health_fk_order). That
-- trigger protects checkedInAt / startedAt / completedAt / cancelledAt
-- as terminal-once-set; without this follow-up, an operator could
-- overwrite noShowAt on a row already in `no_show` status, breaking
-- audit-trail uniformity with the other terminal timestamps.
--
-- This migration replaces the function body to include noShowAt in
-- the immutability check (CREATE OR REPLACE FUNCTION — same trigger
-- attaches automatically). Idempotent.
--
-- Architect-flagged in batch review of PR #77 + PR #78. No prod
-- regression today (no route writes no_show yet) but closes the
-- terminal-timestamp invariant gap so future writer code can't
-- silently introduce inconsistency.

CREATE OR REPLACE FUNCTION health_encounters_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."checkedInAt" IS NOT NULL AND NEW."checkedInAt" IS DISTINCT FROM OLD."checkedInAt" THEN
    RAISE EXCEPTION 'health_encounters.checkedInAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'health_encounters.startedAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'health_encounters.completedAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'health_encounters.cancelledAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."noShowAt" IS NOT NULL AND NEW."noShowAt" IS DISTINCT FROM OLD."noShowAt" THEN
    RAISE EXCEPTION 'health_encounters.noShowAt is immutable once set (encounter %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
