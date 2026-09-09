# D8 Loyalty Cloud — track roadmap

> Per-track status tracker for the D8 Loyalty / Promo Codes feature.
> Cross-references `memory/project_loyalty_slice2_design.md` (the
> "hard blockers before checkout integration" list).

## Slice-1 (shipped)

- Prisma schema: `LoyaltyAccount`, `LoyaltyTransaction`, `PromoCode`,
  `PromoCodeRedemption` (migration `20260517220000_loyalty`)
- Pure helpers in `src/lib/loyalty/`:
  - `points-engine.ts` — `earnPoints` / `redeemPoints` / `expirePoints` / `adjustPoints`
  - `tier-calculator.ts` — `calculateTier(lifetimePoints, tiers)` → tier code
  - `discount-calculator.ts` — promo code + subtotal → absolute discount
  - `promo-validator.ts` — sync rejection-tagged validator
- 55 unit tests covering all four helpers + edge cases

## Slice-2-mini (shipped this session)

Operator dashboard surface — read-only health view + admin manual ops.

- `GET /api/v1/loyalty-overview` — tier distribution, top-10, 30d totals,
  recent transactions
- `GET /api/v1/loyalty-accounts/[id]` — per-account drilldown
- `POST /api/v1/loyalty-accounts/[id]/earn` — manual credit (CAS-protected)
- `POST /api/v1/loyalty-accounts/[id]/redeem` — manual redeem (CAS-protected)
- `/loyalty/dashboard` — KPIs + tiers + top members + recent tx
- `/loyalty/accounts/[id]` — per-member detail + earn/redeem forms
- Tour-guide + "Did you know" tips in en/ru/az
- Sidebar entry under Marketing (Award icon)

CAS pattern: optimistic-concurrency `updateMany` with current-value
WHERE guard, retried up to 3 times. Defends against two concurrent
admin earns/redeems applying with stale snapshots.

## Slice-2-full (NEXT — separate PR)

These are blockers for shipping any storefront / checkout integration
with loyalty. Manual admin operations (the slice-2-mini surface) work
without them.

### Hard items (P0 before checkout integration)

1. **`LoyaltyTier` config table** — schema, admin UI, replace
   tier-calculator's `tiers` parameter with DB lookup. Enables real
   tier upgrade evaluation.
   - Fields: `id, organizationId, code, name, minLifetimePoints,
     multiplier, benefits Json, isActive`
   - UNIQUE `(organizationId, code)`, CHECK `minLifetimePoints >= 0`,
     CHECK `multiplier > 0`
2. **`EarnRule` config table** — defines how many points a transaction
   awards. Without it, storefront purchase → loyalty earn has no rule.
   - Fields: `id, organizationId, trigger, pointsRate, pointsFlat,
     minOrderAmount, productCategory, isActive`
   - `trigger IN ('purchase', 'signup', 'referral', 'birthday', ...)`
3. **Concurrent-redemption race against `usageLimit`** (checkout-side
   only — manual admin endpoints don't touch usageLimit). Wrap promo
   redemption in `prisma.$transaction` + `SELECT ... FOR UPDATE` on
   the parent `PromoCode` row.
4. **Anonymous-redemption fraud vector**. Public-checkout flow MUST
   require `contactId` if `perCustomerLimit != null`, or rate-limit
   by IP/fingerprint on the `/api/v1/public/commerce/checkout` route.
5. **Float → Decimal/cents** for `PromoCode.discountValue`,
   `PromoCode.minOrderAmount`, `PromoCodeRedemption.discountApplied`.
   Migrate **alongside D5 Payments** in one PR (otherwise drift).
6. **Tier-multiplier rounding rule** for storefront earn when tier
   gives non-integer multiplier (gold 1.5× on a 99-point earn).
   Pick `Math.floor` (conservative) or partial-vesting before any
   tier-bonus earn ships.

### Soft items

7. `PromoCodeRedemption.referenceType` discriminator column
8. Points-expiry cron (per-tenant config: "points expire N days
   after earn"; sweep + emit `expire` transactions)
9. Tier-downgrade cron (trailing-12-month aggregation for programs
   that downgrade on inactivity)

## Slice-3 (later)

- Storefront / commerce checkout integration calling the API
- Per-member loyalty card / wallet view on the public portal
- AI-driven retention campaigns triggered by churn-risk
- Referral attribution chain (member-of-member earning)

## Status snapshot

| Item | Status |
|------|--------|
| Schema + helpers | ✅ slice-1 |
| Tests | ✅ 55 unit |
| Operator dashboard | ✅ slice-2-mini |
| Per-account detail | ✅ slice-2-mini |
| Manual earn/redeem | ✅ slice-2-mini |
| Tour-guide + tips | ✅ slice-2-mini |
| LoyaltyTier table | ✅ Phase A (slice-2-full) |
| LoyaltyTier admin UI | ✅ Phase B (slice-2-full) |
| EarnRule table | ✅ Phase A (slice-2-full) |
| EarnRule admin UI | ✅ Phase B (slice-2-full) |
| Tier-calculator wired to DB | ✅ Phase C (slice-2-full) |
| Sync earn → tier upgrade | ✅ Phase C (slice-2-full) |
| Tier multiplier rule (Math.floor) | ✅ Phase C (slice-2-full) |
| Orphan-tier cleanup on DELETE | ✅ Phase C (slice-2-full) |
| Shared MAX_* limits module | ✅ Phase C (slice-2-full) |
| Storefront earn pipeline | ✅ Phase D (slice-2-full) |
| Promo-redeem race primitive (`acquirePromoCodeLock`) | ✅ Phase D (slice-2-full) |
| Anonymous-fraud gate primitive | ✅ Phase D (slice-2-full) |
| Promo-code admin CRUD + UI | ✅ Phase D-2 (slice-2-full) |
| Promo-code redeem endpoint (consumes lock + gate) | ✅ Phase D-2 (slice-2-full) |
| Public-checkout integration | ❌ deferred until checkout flow exists |
| Expiry cron | ✅ Phase E (slice-2-full) — migration 20260525220000_d8_loyalty_expiry_cron |
| Tier-downgrade cron | ❌ slice-3 |
| Float → Decimal | ✅ Phase F — migration 20260525210000_d8_promo_float_to_decimal |
