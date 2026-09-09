-- C9 #18 — CampaignInfluence.kind: distinguish realized (won) attribution from
-- projected (pipeline) attribution on open deals. Additive + NOT NULL DEFAULT
-- 'won', so every existing influence row (all from closed-won deals) is
-- correctly labelled realized with no backfill.

ALTER TABLE "campaign_influences" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'won';

ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_kind_check"
  CHECK ("kind" IN ('won', 'pipeline'));
