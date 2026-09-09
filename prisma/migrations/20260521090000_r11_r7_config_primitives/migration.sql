-- R11 + R7 per-tenant config primitives — same shape as PR #91 (C5).
--
-- Two more per-tenant config tables in this single migration:
--   • `media_pacing_config` — R11 ad-campaign pacing thresholds.
--     Slice-1 hardcodes OVER_PACE_THRESHOLD=1.1 / UNDER_PACE_THRESHOLD=0.9
--     in `ad-pacing-calculator.ts`. Per-tenant override lets marketing
--     teams tighten/loosen these by business rules (e.g. premium
--     advertiser accepts only ±5% deviation).
--   • `insurance_rating_config` — R7 premium rate-table overrides.
--     Slice-1 hardcodes BASE_RATES + RISK_MULTIPLIERS + DEDUCTIBLE_CREDIT_RATES
--     in `premium-calculator.ts`. Per-tenant overrides let regulated-
--     insurance carriers honor state DOI tariff filings without code
--     changes (each state has different baseline rates).
--
-- Same defensive-merge pattern as C5: defaults baked in helper,
-- per-org row optional, malformed JSONB falls back to defaults.
-- No immutability trigger (config tables, not audit logs).

-- ═══════════════════════════════════════════════════════════════════
-- R11 Media — pacing config
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "media_pacing_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Over-pace threshold (default 1.1 = 110% of expected spend).
     * Used by `isOverPaced` flag in ad-pacing-calculator. CHECK: > 1.0.
     * NULL = use slice-1 default.
     */
    "overPaceThreshold" DOUBLE PRECISION,
    /**
     * Under-pace threshold (default 0.9 = 90% of expected spend).
     * CHECK: 0 < value < 1.0. NULL = use slice-1 default.
     */
    "underPaceThreshold" DOUBLE PRECISION,
    /**
     * Extensible JSONB for per-campaign or per-placement-slot
     * threshold overrides. Slice-3 may use this for time-of-day
     * pacing curves. Shape today: free-form key/value; slice-3 will
     * formalize.
     */
    "perCampaignOverrides" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_pacing_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_pacing_config_org_uniq"
  ON "media_pacing_config"("organizationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_pacing_config_over_check') THEN
    ALTER TABLE "media_pacing_config"
      ADD CONSTRAINT "media_pacing_config_over_check"
      CHECK ("overPaceThreshold" IS NULL OR "overPaceThreshold" > 1.0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_pacing_config_under_check') THEN
    ALTER TABLE "media_pacing_config"
      ADD CONSTRAINT "media_pacing_config_under_check"
      CHECK ("underPaceThreshold" IS NULL OR ("underPaceThreshold" > 0 AND "underPaceThreshold" < 1.0));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_pacing_config_organizationId_fkey') THEN
    ALTER TABLE "media_pacing_config"
      ADD CONSTRAINT "media_pacing_config_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- R7 Insurance — premium rating config
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "insurance_rating_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Per-LineOfBusiness base rate overrides. JSONB shape:
     *   { "auto": 0.015, "home": 0.008, "life": 0.002, "health": 0.025,
     *     "commercial": 0.012, "umbrella": 0.001, "marine": 0.014 }
     * Missing keys fall back to slice-1 defaults in premium-calculator.ts.
     * Per-state filings will override these per-region (slice-3 may add
     * a per-state version).
     */
    "baseRates" JSONB NOT NULL DEFAULT '{}',
    /**
     * Per-RiskTier multiplier overrides. JSONB shape:
     *   { "preferred": 0.8, "standard": 1.0, "substandard": 1.4 }
     * "declined" is NOT overridable — its NaN sentinel is enforced
     * by calculator code path.
     */
    "riskMultipliers" JSONB NOT NULL DEFAULT '{}',
    /**
     * Per-LineOfBusiness deductible-credit-rate overrides. JSONB shape:
     *   { "auto": 0.1, "home": 0.1, ... "life": 0, "health": 0, "umbrella": 0 }
     */
    "deductibleCreditRates" JSONB NOT NULL DEFAULT '{}',
    /**
     * Reserved for slice-3: full rate-table arrays for actuarial
     * granularity (coverage-limit × age × territory tables that
     * regulated filings require). Shape TBD; left as opaque JSON
     * so slice-3 schema is additive.
     */
    "rateTablesV2" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "insurance_rating_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "insurance_rating_config_org_uniq"
  ON "insurance_rating_config"("organizationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_rating_config_organizationId_fkey') THEN
    ALTER TABLE "insurance_rating_config"
      ADD CONSTRAINT "insurance_rating_config_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
