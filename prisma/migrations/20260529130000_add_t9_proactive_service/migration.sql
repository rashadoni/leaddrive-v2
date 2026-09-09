-- T9 Proactive Service — slice-1.
--
-- Persisted customer health snapshot + triggered alert queue. Slice-1
-- only declares the data layer + pure compute helper; slice-2 wires
-- the refresh cron and threshold-based alert emission. Existing churn
-- risk computation (`/api/v1/calculated-insights/route.ts:216`) and
-- engagementScore columns will feed the score computation.
--
-- DB CHECK constraints fail-fast on enum typos / out-of-range scores
-- before they reach the application layer.
--
-- Polymorphism rationale: `entityType` is a CHECK-bound string instead
-- of a per-target FK because alerts must point at Contact / Company /
-- Deal interchangeably and a single shared lifecycle
-- (acknowledged/dismissed) is cheaper than 3 sibling tables. Referential
-- integrity is enforced at the route layer when reading the alert
-- joins the right table by `entityType`. The CHECK list is mirrored in
-- `src/lib/proactive/types.ts` (TRIGGER_TYPES / SEVERITIES / ENTITY_TYPES)
-- — change both together in one commit or drift will surface as opaque
-- constraint-violation 500s.

CREATE TABLE "health_scores" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entityType"     TEXT NOT NULL,
  "entityId"       TEXT NOT NULL,
  "score"          INTEGER NOT NULL,
  "factors"        JSONB NOT NULL DEFAULT '{}',
  "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "health_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "health_scores_entity_type_chk"
    CHECK ("entityType" IN ('contact', 'company', 'deal')),
  CONSTRAINT "health_scores_score_range_chk"
    CHECK ("score" >= 0 AND "score" <= 100)
);

CREATE UNIQUE INDEX "health_scores_unique"
  ON "health_scores"("organizationId", "entityType", "entityId");
CREATE INDEX "health_scores_org_type_score_idx"
  ON "health_scores"("organizationId", "entityType", "score");

ALTER TABLE "health_scores"
  ADD CONSTRAINT "health_scores_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proactive_alerts" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "triggerType"    TEXT NOT NULL,
  "severity"       TEXT NOT NULL DEFAULT 'warning',
  "entityType"     TEXT NOT NULL,
  "entityId"       TEXT NOT NULL,
  "message"        TEXT NOT NULL,
  "context"        JSONB NOT NULL DEFAULT '{}',
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "dismissedAt"    TIMESTAMP(3),
  "dismissedBy"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "proactive_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proactive_alerts_trigger_type_chk"
    CHECK ("triggerType" IN ('churn_risk', 'health_drop', 'engagement_low',
                              'payment_overdue', 'contract_expiring',
                              'no_activity', 'custom')),
  CONSTRAINT "proactive_alerts_severity_chk"
    CHECK ("severity" IN ('info', 'warning', 'critical')),
  CONSTRAINT "proactive_alerts_entity_type_chk"
    CHECK ("entityType" IN ('contact', 'company', 'deal'))
);

-- Partial index — `dismissedAt IS NULL` is the dominant filter for the
-- "active alerts" hot path on Contact/Company detail pages. Indexing
-- only un-dismissed rows keeps the index small (most-recent alerts
-- only) and avoids carrying dismissed history in the b-tree.
CREATE INDEX "proactive_alerts_active_idx"
  ON "proactive_alerts"("organizationId", "entityType", "entityId")
  WHERE "dismissedAt" IS NULL;
CREATE INDEX "proactive_alerts_severity_idx"
  ON "proactive_alerts"("organizationId", "severity", "createdAt");

ALTER TABLE "proactive_alerts"
  ADD CONSTRAINT "proactive_alerts_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
