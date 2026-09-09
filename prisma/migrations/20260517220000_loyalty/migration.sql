-- D8: Promo Codes / Loyalty Management (Phase 6 Block A).
-- Salesforce Loyalty Management analogue. Slice 1 ships the core
-- primitives:
--   • PromoCode + PromoCodeRedemption — discount-code engine with
--     usage caps + per-customer caps + min-order-amount + validity
--     window + currency-correct semantics.
--   • LoyaltyAccount + LoyaltyTransaction — per-(org, contact)
--     points balance + append-only earn/redeem/expire audit. Lifetime
--     points (monotonic) drive tier upgrades; current balance is the
--     redeemable wallet.
--
-- Slice 2 wires API routes + the LoyaltyTier config table + EarnRule
-- config. Slice 3 wires cron for tier-recompute + points-expiry +
-- referral-credit, plus checkout integration that auto-redeems
-- and emits PromoCodeRedemption rows.

-- ── PromoCode ──────────────────────────────────────────────────
-- `code` is the human-readable string a customer enters (e.g.
-- "SUMMER25"). Unique per tenant — two tenants can both have
-- "SUMMER25" pointing at different campaigns.
--
-- discountType: 'percentage' (off any currency, capped at 100) or
-- 'fixed' (a specific amount in `currency`).
--
-- Validity window (validFrom <= now <= validUntil) is enforced by
-- the helper at apply-time. Usage caps (`usageLimit` total +
-- `perCustomerLimit` per contact) are enforced by the validator
-- using PromoCodeRedemption counts.
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    /** 'percentage' | 'fixed' (CHECK enum below). */
    "discountType" TEXT NOT NULL,
    /** For percentage: 0..100. For fixed: amount in `currency`. */
    "discountValue" DOUBLE PRECISION NOT NULL,
    /** Only meaningful for fixed-amount codes. NULL for percentage codes. */
    "currency" TEXT,
    /** Optional minimum order subtotal (inclusive) to apply this code. */
    "minOrderAmount" DOUBLE PRECISION,
    /** Total redemption cap across all customers. NULL = unlimited. */
    "usageLimit" INTEGER,
    /** Per-customer redemption cap. NULL = unlimited (subject to total `usageLimit`). */
    "perCustomerLimit" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_discount_type_check"
  CHECK ("discountType" IN ('percentage', 'fixed'));

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_discount_value_check"
  CHECK ("discountValue" > 0);

-- Percentage codes are capped at 100% — anything above is meaningless
-- (a 105%-off code would credit the customer for buying nothing,
-- which is a refund channel, not a discount).
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_percentage_cap_check"
  CHECK (
    "discountType" <> 'percentage'
    OR ("discountValue" > 0 AND "discountValue" <= 100)
  );

-- Currency must be set for fixed-amount codes, NULL for percentage
-- codes (percentages are currency-agnostic — 25% off applies to any
-- order regardless of currency).
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_currency_coherence_check"
  CHECK (
    ("discountType" = 'percentage' AND "currency" IS NULL)
    OR ("discountType" = 'fixed' AND "currency" IS NOT NULL)
  );

-- Min-order-amount and usage limits must be non-negative when set.
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_min_order_check"
  CHECK ("minOrderAmount" IS NULL OR "minOrderAmount" >= 0);

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_usage_limit_check"
  CHECK ("usageLimit" IS NULL OR "usageLimit" > 0);

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_per_customer_limit_check"
  CHECK ("perCustomerLimit" IS NULL OR "perCustomerLimit" > 0);

-- Validity window — if both are set, from <= until.
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_validity_order_check"
  CHECK (
    "validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" <= "validUntil"
  );

CREATE UNIQUE INDEX "promo_codes_org_code_uniq" ON "promo_codes"("organizationId", "code");
CREATE INDEX "promo_codes_org_active_idx" ON "promo_codes"("organizationId", "isActive");
CREATE INDEX "promo_codes_validity_idx" ON "promo_codes"("validFrom", "validUntil");

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "promo_codes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PromoCodeRedemption ────────────────────────────────────────
-- One row per redemption. Tracked separately from Invoice / BuyerOrder
-- so a single order with multiple line-level promos (slice 3) can
-- emit multiple audit rows AND the validator's "how-many-times-has-
-- this-customer-used-this-code" check has an indexed source.
--
-- `discountApplied` is the actual discount value calculated at apply
-- time — preserves the audit trail even if PromoCode.discountValue
-- later changes.
CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    /** Optional — anonymous redemption (guest checkout) is allowed; both NULL = anonymous. */
    -- Contact FK is loose; route validates same-tenant ownership at
    -- write time. Matches the D2 Cart.contactId precedent
    -- (schema.prisma:4824) — anonymous / guest redemption is a
    -- supported path, so a strict FK with ON DELETE SET NULL would
    -- only matter for the registered-customer case.
    "contactId" TEXT,
    /** Optional — invoiceId or orderId reference at apply time. */
    "referenceId" TEXT,
    /** Snapshot of actual discount applied (in `currency`). Audit-immutable. */
    "discountApplied" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "promo_code_redemptions"
  ADD CONSTRAINT "promo_code_redemptions_discount_check"
  CHECK ("discountApplied" >= 0);

CREATE INDEX "promo_code_redemptions_code_redeemed_idx" ON "promo_code_redemptions"("promoCodeId", "redeemedAt");
CREATE INDEX "promo_code_redemptions_code_contact_idx" ON "promo_code_redemptions"("promoCodeId", "contactId");
CREATE INDEX "promo_code_redemptions_org_redeemed_idx" ON "promo_code_redemptions"("organizationId", "redeemedAt");
CREATE INDEX "promo_code_redemptions_reference_idx" ON "promo_code_redemptions"("referenceId");

ALTER TABLE "promo_code_redemptions"
  ADD CONSTRAINT "promo_code_redemptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions"
  ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey"
  FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── LoyaltyAccount ─────────────────────────────────────────────
-- Per-(org, contact) wallet. `points` is the current redeemable
-- balance; `lifetimePoints` is the monotonic accumulator that drives
-- tier upgrades (never decremented by redemptions / expirations).
-- `tier` is a string slug matching the slice-2 LoyaltyTier.code config
-- — slice 1 stores the value as flat text since the config table
-- isn't shipped yet.
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    -- Contact FK is loose; route validates same-tenant ownership at
    -- write time (mirrors D2 Cart pattern at schema.prisma:4824).
    -- Hard FK with `ON DELETE RESTRICT` would block contact deletion
    -- in a way that adds operator friction with limited upside —
    -- archive-then-delete on customer-data-erasure (GDPR) flows
    -- handles this via app logic that nulls the loyalty wallet first.
    "contactId" TEXT NOT NULL,
    /** Current redeemable balance. Non-negative. */
    "points" INTEGER NOT NULL DEFAULT 0,
    /** Monotonic — total points ever earned (not decremented by redemption / expiry). Drives tier. */
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    /** Tier slug, e.g. "bronze" / "silver" / "gold". NULL until first earn lands. */
    "tier" TEXT,
    /** When the current tier was reached. NULL while tier is NULL. */
    "tierUpgradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_points_check"
  CHECK ("points" >= 0);

ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_lifetime_check"
  CHECK ("lifetimePoints" >= 0);

-- Lifetime can never be less than current — current is a subset of
-- lifetime by definition (you can't redeem more than you've earned).
ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_lifetime_ge_points_check"
  CHECK ("lifetimePoints" >= "points");

-- tier-coherence: tier and tierUpgradedAt go together (both set or both NULL).
ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_tier_coherence_check"
  CHECK (
    ("tier" IS NULL AND "tierUpgradedAt" IS NULL)
    OR ("tier" IS NOT NULL AND "tierUpgradedAt" IS NOT NULL)
  );

-- One account per (tenant, contact).
CREATE UNIQUE INDEX "loyalty_accounts_org_contact_uniq" ON "loyalty_accounts"("organizationId", "contactId");
CREATE INDEX "loyalty_accounts_org_tier_idx" ON "loyalty_accounts"("organizationId", "tier");

-- Lifetime-monotonicity trigger. CHECK constraints can't reference
-- OLD vs NEW values, so the "lifetimePoints never decreases"
-- invariant — load-bearing for tier eligibility — needs a trigger.
-- The points-engine helper enforces this at the app layer, but a
-- raw SQL fix-up or future migration could otherwise silently zero
-- out a customer's tier eligibility (architect P1 closure).
--
-- Special-case: an admin-driven RESET (e.g. data corruption recovery,
-- GDPR erasure) can bypass this trigger by deleting the row entirely;
-- there is no path to "shrink" lifetimePoints by design.
CREATE OR REPLACE FUNCTION loyalty_accounts_lifetime_monotonic_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."lifetimePoints" < OLD."lifetimePoints" THEN
    RAISE EXCEPTION 'loyalty_accounts.lifetimePoints is monotonic; cannot decrease from % to % (account %)',
      OLD."lifetimePoints", NEW."lifetimePoints", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loyalty_accounts_lifetime_monotonic_trigger
  BEFORE UPDATE ON "loyalty_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION loyalty_accounts_lifetime_monotonic_fn();

ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LoyaltyTransaction ─────────────────────────────────────────
-- Append-only audit. `delta` is SIGNED:
--   earn / adjustment_credit → positive
--   redeem / expire / adjustment_debit → negative
-- The points-engine helper enforces this; the DB CHECK is the
-- backstop. `lifetimeDelta` is non-negative — only earn adds to
-- lifetime; redeem/expire/adjustment do NOT change lifetime.
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    /** Signed: positive for earn / credit-adjustment, negative for redeem / expire / debit-adjustment. */
    "delta" INTEGER NOT NULL,
    /** Increment to lifetimePoints. Only earn paths set this > 0; all other types must pass 0. */
    "lifetimeDelta" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    /** App-level reference (invoiceId / orderId / etc.). */
    "referenceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_type_check"
  CHECK ("type" IN ('earn', 'redeem', 'expire', 'adjustment_credit', 'adjustment_debit'));

-- delta must be nonzero — zero-delta audit rows are noise.
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_delta_nonzero_check"
  CHECK ("delta" <> 0);

-- Sign-vs-type coherence (mirrors D7 stock_movements_sign_check).
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_sign_check"
  CHECK (
    (("type" IN ('earn', 'adjustment_credit')) AND "delta" > 0)
    OR (("type" IN ('redeem', 'expire', 'adjustment_debit')) AND "delta" < 0)
  );

-- lifetimeDelta non-negative AND only earn paths populate it. A row
-- where type='redeem' but lifetimeDelta != 0 would corrupt the
-- lifetime accumulator. Helper enforces this too.
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_lifetime_delta_check"
  CHECK ("lifetimeDelta" >= 0);

-- Lifetime-coherence: only `earn` populates lifetimeDelta (> 0), and
-- `lifetimeDelta <= delta` is sound because `earn` is the only
-- positive-delta type per sign_check above — so `delta > 0` in this
-- branch is implicit. Slice-2 partial-vesting earns (signup bonus,
-- referral) pass lifetimeDelta < delta; full-vesting earns (regular
-- purchase) pass lifetimeDelta = delta.
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_lifetime_coherence_check"
  CHECK (
    ("type" = 'earn' AND "lifetimeDelta" > 0 AND "lifetimeDelta" <= "delta")
    OR ("type" <> 'earn' AND "lifetimeDelta" = 0)
  );

CREATE INDEX "loyalty_transactions_account_created_idx" ON "loyalty_transactions"("loyaltyAccountId", "createdAt");
CREATE INDEX "loyalty_transactions_org_type_idx" ON "loyalty_transactions"("organizationId", "type");
CREATE INDEX "loyalty_transactions_reference_idx" ON "loyalty_transactions"("referenceId");

ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_transactions"
  ADD CONSTRAINT "loyalty_transactions_loyaltyAccountId_fkey"
  FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
