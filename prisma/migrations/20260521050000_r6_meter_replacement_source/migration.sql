-- R6 Energy & Utilities — `meter_replacement` ReadingSource value.
--
-- Slice-1 `meter_readings.source` enum had 5 values:
--   manual | amr | ami | estimated | corrected
--
-- Counter rollback was only allowed via source='corrected' with a
-- required `supersedesReadingId` linkage — fine for "we mis-read"
-- but conflated with "we installed a new physical meter" where the
-- counter legitimately restarts from 0 without superseding any
-- particular prior reading.
--
-- This migration:
--   1. Adds `meter_replacement` to the source CHECK enum.
--   2. The existing `meter_readings_correction_coherence_check`
--      remains unchanged — it gates only source='corrected', so
--      `meter_replacement` is exempt from supersedesReadingId by
--      construction.
--
-- The helper `src/lib/energy-utilities/meter-reading-validator.ts`
-- is updated in the same PR to allow counter rollback when
-- source='meter_replacement' (no supersedesReadingId required).
--
-- Idempotent via DO-block + pg_constraint existence check.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meter_readings_source_check'
  ) THEN
    ALTER TABLE "meter_readings"
      DROP CONSTRAINT "meter_readings_source_check";
  END IF;
END $$;

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_source_check"
  CHECK ("source" IN ('manual', 'amr', 'ami', 'estimated', 'corrected', 'meter_replacement'));
