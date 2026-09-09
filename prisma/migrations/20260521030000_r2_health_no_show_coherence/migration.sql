-- R2 Health slice-2 — close `no_show` timestamp coherence gap.
--
-- The slice-1 health_encounters status machine has 6 states:
--   scheduled, checked_in, in_progress, completed, no_show, cancelled
--
-- 5 of them have timestamp coherence CHECKs (checkedInAt, startedAt,
-- completedAt, cancelledAt + cancellationReason) — the analytics
-- layer can answer "when did this transition?" for every terminal
-- status. The 6th (`no_show`) is the gap: no `noShowAt` column +
-- no coherence check. Slice-1 migration's own header comment flagged
-- this as a slice-2 follow-up.
--
-- This migration:
--   1. Adds `noShowAt TIMESTAMP(3)` column (nullable so historical
--      rows are unaffected).
--   2. Adds matching coherence CHECK: status='no_show' ⇒ noShowAt
--      IS NOT NULL (parallel shape to cancelled / completed checks).
--
-- Backfill: NOT done. Existing `no_show` rows (if any) have NULL
-- noShowAt — the CHECK is forward-only via the OR-NULL pattern in
-- the other status timestamp CHECKs is asymmetric only on the
-- "added later" axis: it requires noShowAt for FUTURE no_show writes
-- but lets pre-migration rows keep their NULL. Same pattern as
-- cancellation / completion checks for any rows that pre-date their
-- ALTER COLUMN NOT NULL coherence rules.

ALTER TABLE "health_encounters"
  ADD COLUMN IF NOT EXISTS "noShowAt" TIMESTAMP(3);

-- Coherence: status='no_show' requires noShowAt set.
-- Idempotent via pg_constraint existence check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_encounters_no_show_coherence_check'
  ) THEN
    ALTER TABLE "health_encounters"
      ADD CONSTRAINT "health_encounters_no_show_coherence_check"
      CHECK ("status" <> 'no_show' OR "noShowAt" IS NOT NULL);
  END IF;
END $$;
