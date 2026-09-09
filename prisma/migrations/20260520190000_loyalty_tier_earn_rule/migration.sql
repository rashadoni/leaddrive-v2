-- D8 Loyalty — slice-2-full Phase A.
-- Two config tables that unlock the rest of the program:
--   * loyalty_tiers      — per-tenant tier ladder (bronze/silver/gold/...)
--   * loyalty_earn_rules — how purchases / signups / referrals award points
-- Per memory/project_loyalty_slice2_design.md items 3 + 4 (hard blockers).

-- ═══════════════════════════════════════════════════════════════
-- 1. loyalty_tiers
-- ═══════════════════════════════════════════════════════════════
-- Per-tenant tier ladder. Slice-1 tier-calculator helper accepted
-- `tiers` as a parameter; slice-2-full reads from this table and the
-- cron worker re-evaluates LoyaltyAccount.tier on threshold crossings.

CREATE TABLE IF NOT EXISTS "loyalty_tiers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Tier slug — referenced by LoyaltyAccount.tier. UNIQUE per org. */
    "code" TEXT NOT NULL,
    /** Display name (UI label). */
    "name" TEXT NOT NULL,
    /** Optional description shown on admin / portal. */
    "description" TEXT,
    /**
     * Lifetime-points threshold to enter this tier. Lower bound
     * inclusive. CHECK: >= 0. The cron worker orders tiers by this
     * column ASC and walks until it finds the highest threshold the
     * member has crossed.
     */
    "minLifetimePoints" INTEGER NOT NULL,
    /**
     * Earn-rate multiplier on storefront purchases (1.0 = base rate,
     * 1.5 = 50% bonus). CHECK: > 0. Tier-multiplier rounding rule
     * (Math.floor for slice-2 — conservative, customer-unfavourable
     * but no float drift) lives in the earn-pipeline code path.
     */
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    /**
     * Optional benefits JSONB — free-form per-tier perks the slice-3
     * portal may render (e.g. "priority_support": true, "free_shipping": true).
     */
    "benefits" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CHECK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_tiers_min_lifetime_check') THEN
    ALTER TABLE "loyalty_tiers"
      ADD CONSTRAINT "loyalty_tiers_min_lifetime_check"
      CHECK ("minLifetimePoints" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_tiers_multiplier_check') THEN
    ALTER TABLE "loyalty_tiers"
      ADD CONSTRAINT "loyalty_tiers_multiplier_check"
      CHECK ("multiplier" > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_tiers_code_format_check') THEN
    ALTER TABLE "loyalty_tiers"
      ADD CONSTRAINT "loyalty_tiers_code_format_check"
      CHECK ("code" ~ '^[a-z][a-z0-9_]*$' AND length("code") <= 32);
  END IF;
END $$;

-- Unique: (org, code). One tier slug per org. Different orgs can use
-- the same "gold" code.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_tiers_org_code_uniq"
  ON "loyalty_tiers"("organizationId", "code");

-- Hot path: tier-resolver scans tiers ascending by threshold within
-- an org.
CREATE INDEX IF NOT EXISTS "loyalty_tiers_org_threshold_idx"
  ON "loyalty_tiers"("organizationId", "minLifetimePoints");

-- FK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_tiers_organizationId_fkey') THEN
    ALTER TABLE "loyalty_tiers"
      ADD CONSTRAINT "loyalty_tiers_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. loyalty_earn_rules
-- ═══════════════════════════════════════════════════════════════
-- How a transaction (purchase / signup / referral / birthday / ...)
-- translates into points. Storefront-integration code reads this
-- table when emitting an earn event.

CREATE TABLE IF NOT EXISTS "loyalty_earn_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Display name for admin UI ("Standard purchase rule"). */
    "name" TEXT NOT NULL,
    /**
     * Trigger taxonomy (DB CHECK):
     *   purchase  | signup    | referral
     *   birthday  | review    | survey
     *   custom    — slice-3 extension via metadata
     */
    "trigger" TEXT NOT NULL,
    /**
     * Points awarded per 1 unit of `currency`. NULL = no per-amount
     * earn (use pointsFlat for flat awards like signup bonus).
     * CHECK: pointsRate IS NULL OR pointsRate >= 0.
     */
    "pointsRate" DOUBLE PRECISION,
    /**
     * Flat points award (signup bonus, referral bonus, birthday).
     * Overrides pointsRate if both set (slice-2 priority order:
     * flat first, then rate-times-amount).
     * CHECK: pointsFlat IS NULL OR pointsFlat >= 0.
     */
    "pointsFlat" INTEGER,
    /**
     * Minimum order amount (in tenant's primary currency) for the
     * rule to fire. NULL = no minimum. CHECK: NULL OR >= 0.
     */
    "minOrderAmount" DOUBLE PRECISION,
    /**
     * Optional product / promotion category filter — slice-3 may use
     * for category-targeted earn boosts.
     */
    "productCategory" TEXT,
    /**
     * Priority for tie-breaking when multiple rules match a trigger.
     * Higher wins. Slice-2 cron picks the highest-priority active
     * rule per trigger; if multiple still tie, by createdAt ASC.
     */
    "priority" INTEGER NOT NULL DEFAULT 0,
    /**
     * Tier-multiplier applies on top of this rule's earn (default
     * true). Set false for "guaranteed flat bonus" rules where the
     * tier shouldn't double-dip (e.g. signup bonus).
     */
    "applyTierMultiplier" BOOLEAN NOT NULL DEFAULT true,
    /** Whether rule is currently in effect. */
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    /**
     * Optional validity window — when set, rule only fires between
     * these dates. NULL = no window.
     */
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    /** Metadata for slice-3 extensions (custom triggers, AB tests). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loyalty_earn_rules_pkey" PRIMARY KEY ("id")
);

-- CHECK: trigger allow-list (slice-2 frozen set; slice-3 may extend)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_trigger_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_trigger_check"
      CHECK ("trigger" IN (
        'purchase', 'signup', 'referral',
        'birthday', 'review', 'survey', 'custom'
      ));
  END IF;
END $$;

-- CHECK: at least one of pointsRate / pointsFlat is set (rule must
-- award something). Both can be set — flat wins (priority order is
-- enforced by application code, not DB).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_award_present_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_award_present_check"
      CHECK ("pointsRate" IS NOT NULL OR "pointsFlat" IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_rate_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_rate_check"
      CHECK ("pointsRate" IS NULL OR "pointsRate" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_flat_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_flat_check"
      CHECK ("pointsFlat" IS NULL OR "pointsFlat" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_minorder_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_minorder_check"
      CHECK ("minOrderAmount" IS NULL OR "minOrderAmount" >= 0);
  END IF;
END $$;

-- CHECK: validity window coherence (validFrom <= validUntil if both set)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_validity_check') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_validity_check"
      CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" <= "validUntil");
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "loyalty_earn_rules_org_trigger_active_idx"
  ON "loyalty_earn_rules"("organizationId", "trigger", "isActive");
CREATE INDEX IF NOT EXISTS "loyalty_earn_rules_org_priority_idx"
  ON "loyalty_earn_rules"("organizationId", "priority");

-- FK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_earn_rules_organizationId_fkey') THEN
    ALTER TABLE "loyalty_earn_rules"
      ADD CONSTRAINT "loyalty_earn_rules_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
