-- The admin's switch for one demo: may the prospect connect his own Facebook
-- Page to it for the day (docs/DEMO_CENTER.md, «Live social connections»).
-- Ticked at issue time next to the live call, as that one is, and recorded in
-- the ISSUED event's metadata. Off for every existing grant and for every
-- grant the public form issues by itself.
--
-- The connection itself lives in demo_social_connections
-- (20261021090000_demo_social_connections); this column only opens the door.
-- It does nothing unless the server also names the demo's Meta app
-- (DEMO_SOCIAL_META_APP_CONFIG_ID).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_grants" ADD COLUMN "liveSocialEnabled" BOOLEAN NOT NULL DEFAULT false;
-- Only the guided story has the inbox chapters the Page is shown in.
ALTER TABLE "demo_grants"
  ADD CONSTRAINT "demo_grants_live_social_scenario_check" CHECK (NOT "liveSocialEnabled" OR "scenarioId" IS NOT NULL);

COMMIT;
