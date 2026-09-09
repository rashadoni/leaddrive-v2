/**
 * PromoCode validator — D8 Phase 6 Block A slice 1.
 *
 * Pure synchronous. Given a code + order context + redemption counts,
 * returns a tagged-rejection result so the route layer can produce
 * specific UX (not just "code invalid"). Slice-2 checkout integration
 * pipes through this BEFORE calculating the discount + writing the
 * redemption audit row.
 *
 * The redemption counts are passed in (not fetched here) so the
 * caller controls the SELECT — typically `count()` queries against
 * PromoCodeRedemption scoped to (promoCodeId) for total and
 * (promoCodeId, contactId) for per-customer.
 *
 * Rejection precedence (matters for UX clarity):
 *   1. inactive       — kills the code entirely
 *   2. malformed_code — DB CHECK should have prevented but defensive
 *   3. not_yet_valid  — validity-window lower bound
 *   4. expired        — validity-window upper bound
 *   5. currency_mismatch — fixed-amount code in wrong currency
 *   6. min_order_not_met — subtotal too low
 *   7. usage_limit_exceeded   — global cap hit
 *   8. per_customer_limit_exceeded — per-contact cap hit
 *
 * Multiple failures pick the first in this order — the operator
 * fixes upstream issues before downstream ones.
 */
import type {
  PromoRejectionReason,
  ValidatePromoInput,
  ValidatePromoResult,
} from "./types"

function reject(
  reason: PromoRejectionReason,
  message: string
): ValidatePromoResult {
  return { ok: false, reason, message }
}

export function validatePromoApplication(
  input: ValidatePromoInput
): ValidatePromoResult {
  const { code, order, counts } = input
  const asOf = input.asOf ?? new Date()

  // 1. Inactive — kills the code entirely.
  if (!code.isActive) {
    return reject("inactive", `Code "${code.code}" is not active`)
  }

  // 2. Malformed — DB CHECK should have prevented, but defensive.
  if (!Number.isFinite(code.discountValue) || code.discountValue <= 0) {
    return reject("malformed_code", `Code "${code.code}" has invalid discountValue`)
  }
  if (code.discountType === "percentage" && code.discountValue > 100) {
    return reject("malformed_code", `Code "${code.code}" percentage > 100`)
  }
  if (code.discountType === "fixed" && !code.currency) {
    return reject("malformed_code", `Code "${code.code}" is fixed-amount but has no currency`)
  }

  // 3-4. Validity window.
  if (code.validFrom && asOf < code.validFrom) {
    return reject(
      "not_yet_valid",
      `Code "${code.code}" is not yet valid (starts ${code.validFrom.toISOString()})`
    )
  }
  if (code.validUntil && asOf > code.validUntil) {
    return reject(
      "expired",
      `Code "${code.code}" expired at ${code.validUntil.toISOString()}`
    )
  }

  // 5. Currency match (only matters for fixed-amount codes — percentage
  // is currency-agnostic).
  if (code.discountType === "fixed" && code.currency !== order.currency) {
    return reject(
      "currency_mismatch",
      `Code "${code.code}" is denominated in ${code.currency} but order is in ${order.currency}`
    )
  }

  // 6. Min order amount.
  if (code.minOrderAmount != null && order.subtotal < code.minOrderAmount) {
    return reject(
      "min_order_not_met",
      `Code "${code.code}" requires minimum order ${code.minOrderAmount} ${code.currency ?? order.currency}; subtotal is ${order.subtotal}`
    )
  }

  // 7. Global usage limit.
  if (code.usageLimit != null && counts.total >= code.usageLimit) {
    return reject(
      "usage_limit_exceeded",
      `Code "${code.code}" has reached its usage limit of ${code.usageLimit}`
    )
  }

  // 8. Per-customer limit. Anonymous redemptions skip this check —
  // they're constrained only by the global usage limit. (Slice-2 may
  // tighten this for tenants who want "one redemption per IP" or
  // similar guest-throttling, but slice 1 trusts the validator's
  // contract: per-customer = per-contact.)
  if (code.perCustomerLimit != null && order.contactId != null) {
    if (counts.byContact >= code.perCustomerLimit) {
      return reject(
        "per_customer_limit_exceeded",
        `Contact "${order.contactId}" has reached the per-customer limit of ${code.perCustomerLimit} for code "${code.code}"`
      )
    }
  }

  return { ok: true }
}
