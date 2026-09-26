-- C9 action-time location metadata is an additive v4 mobile transport
-- contract. Existing v1-v3 immutable facts remain valid and are not rewritten.
ALTER TABLE "mtm_agent_workday_events"
  DROP CONSTRAINT "mtm_agent_workday_events_schema_version_check";

ALTER TABLE "mtm_agent_workday_events"
  ADD CONSTRAINT "mtm_agent_workday_events_schema_version_check"
  CHECK ("schemaVersion" IN (1, 2, 3, 4));
