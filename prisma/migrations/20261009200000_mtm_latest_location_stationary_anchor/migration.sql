-- «Стоит N минут» on the live map. The latest-location projection — one row
-- per employee — also remembers his current stop: where it began, when, and
-- when a trustworthy still point last confirmed it. Four nullable columns,
-- written by advanceMtmAgentLatestLocation with every GPS point
-- (src/lib/mtm/stationary-anchor.ts holds the rules).
--
-- Additive and without a backfill: rows written before this migration stay
-- «not known» until the employee's next still point, and the count starts
-- from that point, not from when he really stopped. The table's FORCE RLS
-- policy already covers new columns; it is not touched here. They are derived
-- from the row's own coordinates and expire with it (30-day retention).

SET lock_timeout = '3s';

ALTER TABLE "mtm_agent_latest_locations"
  ADD COLUMN IF NOT EXISTS "stationarySince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stationaryLatitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "stationaryLongitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "stationaryConfirmedAt" TIMESTAMP(3);
