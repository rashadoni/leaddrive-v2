-- C9 Marketing Attribution — write-path additive migration.
--
-- Adds two nullable columns + indexes so the attribution engine can be fed
-- from real data. Purely additive: no data rewrite, no changes to the
-- existing append-only / coherence / lifecycle triggers from
-- 20260519130000_marketing_attribution.
--
--   1. events.campaignId   — optional link so event participation becomes a
--                            campaign touchpoint (channel "event").
--   2. campaign_touchpoints.sourceKey — deterministic idempotency key for
--                            derived touchpoints, backed by a partial UNIQUE
--                            index so createMany({skipDuplicates}) is safe and
--                            never fires the append-only UPDATE trigger.

-- 1. events.campaignId ────────────────────────────────────────────────────
ALTER TABLE "events" ADD COLUMN "campaignId" TEXT;

ALTER TABLE "events"
  ADD CONSTRAINT "events_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_organizationId_campaignId_idx"
  ON "events"("organizationId", "campaignId");

-- 2. campaign_touchpoints.sourceKey ───────────────────────────────────────
ALTER TABLE "campaign_touchpoints" ADD COLUMN "sourceKey" TEXT;

-- Partial UNIQUE — one derived touchpoint per (org, sourceKey); ad-hoc
-- touchpoints (sourceKey NULL) are unconstrained.
CREATE UNIQUE INDEX "campaign_touchpoints_org_source_key_uniq"
  ON "campaign_touchpoints"("organizationId", "sourceKey")
  WHERE "sourceKey" IS NOT NULL;
