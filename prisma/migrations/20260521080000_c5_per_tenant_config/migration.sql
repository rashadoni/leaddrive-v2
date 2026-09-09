-- C5 Account Engagement slice-2 — per-tenant config tables.
--
-- Slice-1 ships hardcoded weight tables in two pure helpers:
--   • ICP_COMPONENT_BY_TIER + BAND_COMPONENT in
--     src/lib/account-engagement/account-grade-calculator.ts
--   • Per-SignalKind weights in intent-signal-classifier.ts
--
-- Inventory memo item C5 line 282-286 lists this as slice-2:
--   "Per-tenant config table for component weights" +
--   "Per-tenant target/disqualified industry lists".
--
-- This migration ships the storage layer (two tables); helper
-- module `src/lib/account-engagement/config-loader.ts` exposes
-- typed loaders that merge defaults with per-org overrides; route
-- wiring (the cron + route consumer paths) is the slice-2-mini
-- follow-up (same pattern as P0 #1 / P0 #3 / item 15.5).
--
-- Both tables are CONFIG (not append-only) — operators may edit
-- weights as their go-to-market evolves. No immutability trigger.
-- Updates are tracked via updatedAt; full history is operator's
-- problem (they can keep change-management at the policy layer
-- or wire a CDC trigger in slice-3 if audit is needed).

CREATE TABLE IF NOT EXISTS "account_grade_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * ICP-tier weight overrides. JSONB shape:
     *   { "tier_1": 30, "tier_2": 22, "tier_3": 14, "tier_4": 6, "unscored": 0 }
     * Missing keys fall back to the hardcoded defaults in
     * account-grade-calculator.ts.
     */
    "icpComponentByTier" JSONB NOT NULL DEFAULT '{}',
    /**
     * Employee-band weight overrides. JSONB shape:
     *   { "strategic": 25, "enterprise": 20, "mid_market": 14, "small": 8, "micro": 3 }
     */
    "bandComponent" JSONB NOT NULL DEFAULT '{}',
    /**
     * Target-industry list (positive signal). Free-form strings;
     * caller matches case-sensitively against MarketingAccount.industry.
     * NULL = use empty list (no target filtering).
     */
    "targetIndustries" TEXT[] NOT NULL DEFAULT '{}',
    /**
     * Disqualified-industry list (negative signal). Caller
     * subtracts from grade when account.industry ∈ list.
     */
    "disqualifiedIndustries" TEXT[] NOT NULL DEFAULT '{}',
    /**
     * Per-tenant grade-threshold overrides for letter grade mapping.
     * JSONB: { "A": 80, "B": 60, "C": 40, "D": 20 }. Default thresholds
     * baked in helper; this overrides them.
     */
    "gradeThresholds" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_grade_config_pkey" PRIMARY KEY ("id")
);

-- One config row per tenant (caller upserts).
CREATE UNIQUE INDEX IF NOT EXISTS "account_grade_config_org_uniq"
  ON "account_grade_config"("organizationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_grade_config_organizationId_fkey') THEN
    ALTER TABLE "account_grade_config"
      ADD CONSTRAINT "account_grade_config_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "intent_signal_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Per-SignalKind weight overrides. JSONB shape:
     *   { "chat_high_intent": 25, "form_submission": 20,
     *     "demo_request": 30, "pricing_page_view": 15, ... }
     * Default weights baked in intent-signal-classifier.ts. Per-org
     * config merges on top.
     */
    "signalWeights" JSONB NOT NULL DEFAULT '{}',
    /**
     * Per-SignalKind MQL-qualifying flag override. JSONB shape:
     *   { "chat_high_intent": true, "form_submission": true, ... }
     * Defaults to the helper's hardcoded MQL allow-list; this
     * overrides per-tenant (e.g. tenant disables form_submission as
     * MQL trigger because their forms are too noisy).
     */
    "mqlQualifyingByKind" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lookback window for intent-signal recency scoring (days).
     * Default 30. NULL = use helper default.
     */
    "lookbackDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "intent_signal_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "intent_signal_config_org_uniq"
  ON "intent_signal_config"("organizationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intent_signal_config_lookback_check') THEN
    ALTER TABLE "intent_signal_config"
      ADD CONSTRAINT "intent_signal_config_lookback_check"
      CHECK ("lookbackDays" IS NULL OR ("lookbackDays" >= 1 AND "lookbackDays" <= 365));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intent_signal_config_organizationId_fkey') THEN
    ALTER TABLE "intent_signal_config"
      ADD CONSTRAINT "intent_signal_config_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
