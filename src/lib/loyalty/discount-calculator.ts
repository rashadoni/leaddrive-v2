/**
 * Discount calculator — D8 Phase 6 Block A slice 1.
 *
 * Given a validated PromoCode + an order subtotal, compute the
 * absolute discount in the order's currency. Caps at subtotal so we
 * never produce a negative order total (a 50%-off code on a $5 order
 * MAY produce a $2.50 discount; a $20-off code on a $5 order produces
 * a $5 discount, NOT $20 — the customer doesn't pocket the difference).
 *
 * 2dp rounding. Assumes input has already passed
 * `validatePromoApplication` — caller's responsibility.
 *
 * Pure synchronous.
 */
import type { CalculateDiscountInput, DiscountAmount } from "./types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateDiscount(
  input: CalculateDiscountInput
): DiscountAmount {
  const { code, subtotal } = input

  if (!Number.isFinite(subtotal) || subtotal < 0) {
    // Defensive — validator should have caught this, but if a caller
    // bypasses the validator we don't want to produce a NaN discount.
    return { amount: 0, capped: false }
  }

  // Floor subtotal to 2dp BEFORE cap comparison. Architect P3 closure:
  // a caller-supplied subtotal like 50.005 (sub-cent precision from
  // upstream tax math) would otherwise let a 100%-off code produce
  // a discount of 50.01 (round-up), exceeding the actual order
  // value. Flooring caps the discount at the true tendered amount.
  // Caller convention: ALWAYS pass already-rounded subtotal — this
  // floor is defense-in-depth, not the primary contract.
  const subtotalCapped = Math.floor(subtotal * 100) / 100

  let raw: number
  if (code.discountType === "percentage") {
    raw = subtotalCapped * (code.discountValue / 100)
  } else {
    // fixed
    raw = code.discountValue
  }

  const rounded = round2(raw)
  if (rounded >= subtotalCapped) {
    // Cap at subtotal — order total can never go negative.
    return { amount: subtotalCapped, capped: true }
  }
  return { amount: rounded, capped: false }
}
