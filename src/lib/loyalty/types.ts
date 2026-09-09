/**
 * Promo Codes / Loyalty types — D8 Phase 6 Block A slice 1.
 *
 * Salesforce Loyalty Management analogue. Four pure-helper workflows:
 *
 *   1. PromoCode validator — given a code + order context, decide
 *      whether the code applies (active / in-window / under usage caps
 *      / min-order met / currency-compatible).
 *   2. Discount calculator — given an order subtotal + a valid code,
 *      compute the absolute discount amount (percentage × subtotal,
 *      OR fixed amount, capped at subtotal).
 *   3. Points engine — earn (add points + lifetime), redeem (debit
 *      points only — lifetime untouched), expire / adjust.
 *   4. Tier calculator — given lifetimePoints + tier-tier config,
 *      resolve the effective tier slug.
 */

/* ─── PromoCode discount types ────────────────────────────────────────── */

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

/* ─── PromoCode validator inputs ──────────────────────────────────────── */

export interface PromoCodeRow {
  id: string
  code: string
  discountType: DiscountType
  discountValue: number
  /** Required for `fixed`; NULL for `percentage`. */
  currency: string | null
  minOrderAmount: number | null
  usageLimit: number | null
  perCustomerLimit: number | null
  validFrom: Date | null
  validUntil: Date | null
  isActive: boolean
}

export interface OrderContext {
  /** Order subtotal BEFORE this code is applied. */
  subtotal: number
  currency: string
  /** Optional — anonymous redemption allowed. */
  contactId: string | null
}

export interface RedemptionCounts {
  /** How many times the code has been redeemed across all customers. */
  total: number
  /** How many times this specific contact has redeemed it. Pass 0 if anonymous. */
  byContact: number
}

export interface ValidatePromoInput {
  code: PromoCodeRow
  order: OrderContext
  counts: RedemptionCounts
  /** Caller-supplied — testability. Defaults to now() in the helper. */
  asOf?: Date
}

export type ValidatePromoResult =
  | { ok: true }
  | { ok: false; reason: PromoRejectionReason; message: string }

/**
 * Tagged rejection reasons so the route layer can produce specific UX
 * (e.g. "code expired" vs "min order not met" vs "already redeemed").
 */
export type PromoRejectionReason =
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "currency_mismatch"
  | "min_order_not_met"
  | "usage_limit_exceeded"
  | "per_customer_limit_exceeded"
  | "malformed_code"

/* ─── Discount calculator ─────────────────────────────────────────────── */

export interface CalculateDiscountInput {
  code: PromoCodeRow
  /** Order subtotal — discount is capped at this value (no negative totals). */
  subtotal: number
}

export interface DiscountAmount {
  /** Absolute discount in the order's currency, 2dp-rounded, capped at subtotal. */
  amount: number
  /** Whether the calculation was capped (true when the raw discount > subtotal). */
  capped: boolean
}

/* ─── Loyalty transaction types ───────────────────────────────────────── */

export const LOYALTY_TRANSACTION_TYPES = [
  "earn",
  "redeem",
  "expire",
  "adjustment_credit",
  "adjustment_debit",
] as const

export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number]

/**
 * For each transaction type:
 *   sign: required sign of `delta`
 *   touchesLifetime: whether the operation contributes to lifetimePoints
 *     (only `earn`; redemptions / expirations / adjustments do NOT)
 */
export const LOYALTY_TYPE_RULES: Readonly<
  Record<LoyaltyTransactionType, { sign: "positive" | "negative"; touchesLifetime: boolean }>
> = {
  earn: { sign: "positive", touchesLifetime: true },
  redeem: { sign: "negative", touchesLifetime: false },
  expire: { sign: "negative", touchesLifetime: false },
  adjustment_credit: { sign: "positive", touchesLifetime: false },
  adjustment_debit: { sign: "negative", touchesLifetime: false },
}

/* ─── Points-engine inputs ────────────────────────────────────────────── */

export interface PointsBalance {
  points: number
  lifetimePoints: number
}

export interface EarnPointsInput {
  current: PointsBalance
  /** Positive integer. */
  points: number
  /**
   * Optional — for partial-vesting earn flows (e.g. signup bonus that
   * is awarded but doesn't count toward tier). Defaults to `points`
   * (full lifetime contribution). Must be 0 <= lifetimePoints <= points.
   */
  lifetimePoints?: number
}

export interface RedeemPointsInput {
  current: PointsBalance
  /** Positive integer. Must be <= current.points. */
  points: number
}

export interface ExpirePointsInput {
  current: PointsBalance
  /** Positive integer. Must be <= current.points (can't expire more than balance). */
  points: number
}

export interface AdjustPointsInput {
  current: PointsBalance
  /**
   * Signed — positive for credit, negative for debit. Debit must satisfy
   * `|delta| <= current.points`. Lifetime is NOT affected (per LOYALTY_TYPE_RULES).
   */
  delta: number
}

export interface PointsMutationOk {
  ok: true
  next: PointsBalance
  /**
   * The transaction-row inputs for the audit write:
   *   `delta` — signed change to `points`
   *   `lifetimeDelta` — increment to `lifetimePoints` (only > 0 for earn)
   *   `type` — fixed per-helper
   */
  type: LoyaltyTransactionType
  delta: number
  lifetimeDelta: number
}

export interface PointsMutationFail {
  ok: false
  error: string
}

export type PointsMutationResult = PointsMutationOk | PointsMutationFail

/* ─── Tier calculator ─────────────────────────────────────────────────── */

/**
 * A tier definition — slice-2 LoyaltyTier config row. Slice-1 helpers
 * accept it as a parameter so they don't need the config table yet.
 */
export interface TierDefinition {
  /** Tier slug ("bronze" / "silver" / "gold"). */
  code: string
  /** Lifetime-points threshold to enter this tier. Lower bound inclusive. */
  minLifetimePoints: number
}

export interface CalculateTierInput {
  /** Tenant's tier configuration, in any order — helper sorts. */
  tiers: readonly TierDefinition[]
  lifetimePoints: number
}

export type CalculateTierResult =
  | { kind: "tier"; code: string }
  | { kind: "none"; reason: string }
