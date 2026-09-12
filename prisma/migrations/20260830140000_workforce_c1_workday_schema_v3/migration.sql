-- C1 compatibility expansion: schema v3 binds a snapshotted schedule segment
-- into the workday request digest. Existing v1/v2 facts remain exactly as
-- stored; this migration only broadens the accepted immutable ledger version.
--
-- Do not backfill requestHash, provenance, review state, or segment identity.
-- A historical event without those facts remains LEGACY_UNKNOWN evidence.

SET lock_timeout = '3s';

ALTER TABLE "mtm_agent_workday_events"
  DROP CONSTRAINT IF EXISTS "mtm_agent_workday_events_schema_version_check";

ALTER TABLE "mtm_agent_workday_events"
  ADD CONSTRAINT "mtm_agent_workday_events_schema_version_check"
  CHECK ("schemaVersion" IN (1, 2, 3));
