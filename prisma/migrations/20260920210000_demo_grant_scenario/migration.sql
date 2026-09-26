-- A grant can now carry a guided scenario instead of a module playlist.
--
-- Both columns are nullable on purpose: every grant issued before this
-- migration keeps opening the module player it was issued for. A grant is
-- one or the other, never a half-configured mix, which is what the CHECK
-- enforces — a scenario id without its version would leave the player
-- guessing which manifest the prospect was actually granted.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_grants" ADD COLUMN "scenarioId" TEXT;
ALTER TABLE "demo_grants" ADD COLUMN "scenarioVersion" INTEGER;

ALTER TABLE "demo_grants" ADD CONSTRAINT "demo_grants_scenario_pair_check" CHECK (
  ("scenarioId" IS NULL AND "scenarioVersion" IS NULL)
  OR ("scenarioId" IS NOT NULL AND "scenarioVersion" IS NOT NULL AND "scenarioVersion" > 0)
);

-- Finding the grants issued for a scenario is an admin report, not a hot
-- path; a partial index keeps it off every row that has no scenario.
CREATE INDEX "demo_grants_scenario_idx" ON "demo_grants"("scenarioId", "createdAt")
  WHERE "scenarioId" IS NOT NULL;

COMMIT;
