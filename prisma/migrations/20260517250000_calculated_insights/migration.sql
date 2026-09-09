-- G3: Calculated Insights (Phase 6 Block B slice 1).
-- Salesforce Calculated Insights analogue. Materialized computed
-- metrics on top of G1 UnifiedProfile: LTV, churn risk, engagement
-- score, days-since-last-purchase, etc.
--
-- Slice 1 ships:
--   • CalculatedInsightDef — per-tenant insight registry (key, name,
--     kind, refresh schedule).
--   • ProfileInsight — materialized (profileId, insightDefId) → value
--     row, refreshed by slice-2 cron.
--   • 4 pure calculators: LTV / churn risk / engagement score /
--     days-since-last-purchase.
--
-- Slice 2 wires:
--   • Refresh cron walking all UnifiedProfiles + invoking calculators
--   • API routes for browsing computed insights
--   • Custom formula path (reuses N4 formula-field engine when it lands).
-- Slice 3 wires per-tenant tuning + segmentation (G4) consumption.

-- ── CalculatedInsightDef ───────────────────────────────────────
-- Per-tenant registry of which insights to compute. Each row defines
-- one named metric (e.g. key="ltv") with its kind (pre-built name vs
-- custom formula), refresh cadence, and active flag.
--
-- Pre-built insights have `kind='pre_built'` + `key` matching a
-- known calculator (slice-1: ltv / churn_risk / engagement_score /
-- days_since_last_purchase). Custom insights have `kind='custom'` +
-- `formula` string (slice-2 evaluates against N4 formula-field engine).
CREATE TABLE "calculated_insight_defs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Human-readable identifier — UNIQUE per tenant. Allowed chars match the slug regex (used as URL path + scope tag). */
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /** 'pre_built' | 'custom' (DB CHECK enum). */
    "kind" TEXT NOT NULL,
    /** Reserved for custom formulas — slice-2 evaluator consumes. NULL for pre_built. */
    "formula" TEXT,
    /** Cron-style schedule; slice-2 refresh cron honors. Defaults to nightly. */
    "refreshSchedule" TEXT NOT NULL DEFAULT '0 2 * * *',
    /**
     * Per-def tuning bag. Slice-1 calculators (LTV / churn / engagement)
     * read hardcoded constants (EXPECTED_LIFETIME_MONTHS, CHURN_INFLECTION_
     * MULTIPLIER, RECENCY_DECAY_DAYS, etc.); slice-2 will accept overrides
     * from here. Shipping the column now prevents migration churn when
     * subscription-aware churn variant + B2B/B2C LTV horizon land.
     */
    "params" JSONB NOT NULL DEFAULT '{}',
    /**
     * Materialized-value semantic — drives the slice-2 admin UI's
     * formatting ("$1,234" vs "78%" vs "score 0..100" vs "5d ago").
     */
    "valueType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calculated_insight_defs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "calculated_insight_defs"
  ADD CONSTRAINT "calculated_insight_defs_kind_check"
  CHECK ("kind" IN ('pre_built', 'custom'));

-- key must be URL-safe + non-empty + length ≤ 64. Matches the slug
-- pattern used by D2 Storefront — alnum + underscores, no consecutive
-- separators (caller convention; slice-1 helpers normalize input).
ALTER TABLE "calculated_insight_defs"
  ADD CONSTRAINT "calculated_insight_defs_key_check"
  CHECK ("key" ~ '^[a-z0-9][a-z0-9_]{0,62}[a-z0-9]$' OR length("key") = 1);

-- valueType drives admin-UI rendering. Caller-side enum; the SQL CHECK
-- prevents typos from poisoning the rendering layer with unknown values.
ALTER TABLE "calculated_insight_defs"
  ADD CONSTRAINT "calculated_insight_defs_value_type_check"
  CHECK ("valueType" IN ('currency', 'percentage', 'score', 'days', 'count'));

-- kind-coherence: 'pre_built' has NULL formula, 'custom' has non-NULL formula.
ALTER TABLE "calculated_insight_defs"
  ADD CONSTRAINT "calculated_insight_defs_kind_coherence_check"
  CHECK (
    ("kind" = 'pre_built' AND "formula" IS NULL)
    OR ("kind" = 'custom' AND "formula" IS NOT NULL)
  );

CREATE UNIQUE INDEX "calculated_insight_defs_org_key_uniq" ON "calculated_insight_defs"("organizationId", "key");
CREATE INDEX "calculated_insight_defs_org_active_idx" ON "calculated_insight_defs"("organizationId", "isActive");

ALTER TABLE "calculated_insight_defs"
  ADD CONSTRAINT "calculated_insight_defs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ProfileInsight ─────────────────────────────────────────────
-- Materialized value of an insight for a specific UnifiedProfile.
-- One row per (profileId, insightDefId) — the slice-2 refresh cron
-- UPSERTs as it recomputes. `previousValue` snapshots the prior
-- value before each refresh so slice-3 trend analysis can compute
-- deltas without a separate history table (history is in slice-3
-- if cohort tracking demands it; slice-1 just keeps the most recent
-- N-1 value for UI delta indicator).
CREATE TABLE "profile_insights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unifiedProfileId" TEXT NOT NULL,
    "insightDefId" TEXT NOT NULL,
    -- ⚠️ SLICE-2 P0 BLOCKER — Float→Decimal: LTV-class insights write
    -- a sum-of-paid-invoices value here; slice-3 cohort aggregation
    -- sums ACROSS profiles, compounding IEEE-754 drift. Migrate to
    -- Decimal alongside D5 Payments + G1 UnifiedProfile.totalSpent
    -- (see memory/project_payments_slice2_p0.md — same migration set).
    /** Numeric value — interpretation depends on valueType on the def row. */
    "value" DOUBLE PRECISION NOT NULL,
    /** Previous value before this refresh — null on first compute. */
    "previousValue" DOUBLE PRECISION,
    /**
     * Confidence 0..1 — calculators emit lower scores when input data
     * is sparse (e.g. churn risk with 0 prior orders has near-zero
     * confidence). Slice-2 segmentation may filter by minimum confidence.
     */
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    /**
     * Free-form metadata bag — slice-1 LTV uses it to store input
     * snapshots (`{totalSpent, lifetimeOrderCount, monthsSinceFirstSeen}`);
     * slice-2 admin UI surfaces these for explainability.
     */
    "computeMetadata" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "profile_insights_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "profile_insights"
  ADD CONSTRAINT "profile_insights_confidence_check"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

-- value is unconstrained because different insight kinds have different
-- ranges (LTV is non-negative dollars; engagement is 0..100; churn risk
-- is 0..1; days_since is non-negative integer days). Per-calculator
-- helpers enforce ranges before write.

-- One materialized value per (profile, insightDef). Refresh cron
-- UPSERTs onto this index.
CREATE UNIQUE INDEX "profile_insights_profile_def_uniq" ON "profile_insights"("unifiedProfileId", "insightDefId");

CREATE INDEX "profile_insights_org_def_idx" ON "profile_insights"("organizationId", "insightDefId");
CREATE INDEX "profile_insights_org_computed_idx" ON "profile_insights"("organizationId", "computedAt");
CREATE INDEX "profile_insights_def_value_idx" ON "profile_insights"("insightDefId", "value");

ALTER TABLE "profile_insights"
  ADD CONSTRAINT "profile_insights_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_insights"
  ADD CONSTRAINT "profile_insights_unifiedProfileId_fkey"
  FOREIGN KEY ("unifiedProfileId") REFERENCES "unified_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_insights"
  ADD CONSTRAINT "profile_insights_insightDefId_fkey"
  FOREIGN KEY ("insightDefId") REFERENCES "calculated_insight_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
