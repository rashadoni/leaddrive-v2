/**
 * D8 Loyalty — shared validation limits.
 *
 * Pulled into a dedicated module so the route validators AND the admin
 * UI client-side echo of these bounds read the same constants. If you
 * change one, both move in lock-step (architect-flagged drift in
 * Phase B review: `tiers/page.tsx` was hardcoding `10` literally —
 * Phase C exports a shared symbol so the parity is enforced at the
 * import level, not by copy).
 *
 * These are API-layer defensive bounds. DB CHECK constraints enforce
 * only `> 0` / `>= 0` — an admin with raw SQL access can still bypass.
 * Defense-in-depth: tighten the migration CHECK if the trust boundary
 * tightens.
 */

/**
 * Hard ceiling on LoyaltyTier.multiplier. Protects against admin typo
 * (1.5x → 1500x — would detonate the program's point liability).
 */
export const MAX_TIER_MULTIPLIER = 10.0

/**
 * Hard ceiling on LoyaltyEarnRule.pointsRate (points per currency unit).
 */
export const MAX_POINTS_RATE = 1000

/**
 * Hard ceiling on LoyaltyEarnRule.pointsFlat (flat points award per trigger).
 */
export const MAX_POINTS_FLAT = 1_000_000

/**
 * Hard ceiling on LoyaltyEarnRule.minOrderAmount. 1B is well above any
 * realistic tenant transaction.
 */
export const MAX_MIN_ORDER_AMOUNT = 1_000_000_000

/**
 * Max length of LoyaltyTier.code. Mirrors DB CHECK length(code) <= 32.
 */
export const MAX_TIER_CODE_LEN = 32

/**
 * Max length of LoyaltyTier.name / LoyaltyEarnRule.name.
 */
export const MAX_NAME_LEN = 100

/**
 * Max length of LoyaltyTier.description / reason strings.
 */
export const MAX_DESC_LEN = 500

/**
 * Max length of LoyaltyEarnRule.productCategory.
 */
export const MAX_CATEGORY_LEN = 100

/**
 * Tier code allow-list pattern. Mirrors DB CHECK regex.
 */
export const TIER_CODE_RE = /^[a-z][a-z0-9_]*$/

/**
 * LoyaltyEarnRule.trigger allow-list. Mirrors DB CHECK enum.
 */
export const EARN_RULE_TRIGGERS = [
  "purchase",
  "deal_won",
  "signup",
  "referral",
  "birthday",
  "review",
  "survey",
  "custom",
] as const

export type EarnRuleTrigger = (typeof EARN_RULE_TRIGGERS)[number]

export function isValidEarnRuleTrigger(s: string): s is EarnRuleTrigger {
  return (EARN_RULE_TRIGGERS as readonly string[]).includes(s)
}
