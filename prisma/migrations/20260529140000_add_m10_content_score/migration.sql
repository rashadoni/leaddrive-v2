-- M10 Content Performance AI — slice-1.
--
-- Persistent content quality score per (entityType, entityId). Slice-1
-- only declares the data layer + pure compute helper; slice-2 wires the
-- refresh cron, slice-3 ships UI badges.
--
-- Polymorphic by design — intentionally mirrors T9 HealthScore
-- (prisma/schema.prisma:12220) so the slice-2 cron can reuse the
-- (orgId, entityType, entityId) upsert paradigm copy-paste. Shared
-- lifecycle (lastComputedAt) across Campaign / CampaignVariant /
-- EmailTemplate beats sibling tables. CHECK list mirrored in
-- `src/lib/content-perf/types.ts` — change both together or drift
-- surfaces as opaque constraint-violation 500s.

CREATE TABLE "content_scores" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entityType"     TEXT NOT NULL,
  "entityId"       TEXT NOT NULL,
  "score"          INTEGER NOT NULL,
  "factors"        JSONB NOT NULL DEFAULT '{}',
  "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "content_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_scores_entity_type_chk"
    CHECK ("entityType" IN ('email_template', 'campaign', 'campaign_variant')),
  CONSTRAINT "content_scores_score_range_chk"
    CHECK ("score" >= 0 AND "score" <= 100)
);

CREATE UNIQUE INDEX "content_scores_unique"
  ON "content_scores"("organizationId", "entityType", "entityId");
CREATE INDEX "content_scores_org_type_score_idx"
  ON "content_scores"("organizationId", "entityType", "score");

ALTER TABLE "content_scores"
  ADD CONSTRAINT "content_scores_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
