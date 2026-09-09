import { z } from "zod"

/**
 * Shared ceiling for user-entered CRM financial values.
 *
 * The limit is deliberately below Number.MAX_SAFE_INTEGER so values remain
 * stable across Float-backed models, JSON responses, analytics and exports.
 * It also leaves room for large enterprise contracts without accepting
 * overflow-style payloads such as 1e276.
 */
export const MAX_CRM_FINANCIAL_AMOUNT = 999_999_999_999.99
export const MAX_CRM_COUNT = 100_000_000

/**
 * Ceiling for a fixed-amount discount, matching MAX_DISCOUNT_FIXED in
 * src/app/api/v1/promo-codes/route.ts so the two discount surfaces agree.
 */
export const MAX_FIXED_DISCOUNT = 1_000_000

export const nonNegativeFinancialAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_CRM_FINANCIAL_AMOUNT)

export const nonNegativeCountSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .max(MAX_CRM_COUNT)

function coerceNonBlankNumericString(value: unknown): unknown {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? Number(trimmed) : value
}

/**
 * Form-friendly variant for the few legacy endpoints that accept numeric
 * strings. Blank strings and non-numeric strings still fail validation.
 */
export const coercedNonNegativeFinancialAmountSchema = z.preprocess(
  coerceNonBlankNumericString,
  nonNegativeFinancialAmountSchema,
)

/**
 * Percentage expressed the way a human writes it: 12.5 means 12.5%.
 *
 * Used for the per-line `discount` fields, which `calculateItemTotal`
 * (src/lib/invoice-calculations.ts) divides by 100. Capped at 100 because a
 * discount above the line total makes the line negative.
 */
export const percentageSchema = z.number().finite().min(0).max(100)

/**
 * Invoice tax rate.
 *
 * The intended contract is a DECIMAL MULTIPLIER — 0.18 means 18%, as stated at
 * src/lib/tax/types.ts and as the invoice UI sends. `calculateInvoiceTotals`
 * uses the value raw (`taxAmount = afterDiscount * taxRate`, no division), so a
 * rate of 100 would bill 10 000% and inflate the total by 101x.
 *
 * The ceiling is nevertheless 100, not 1, because production disagrees with the
 * contract: of 84 invoices, 43 store `taxRate = 18` rather than 0.18, and 43 of
 * 61 recurring invoices do the same (counted per-organization on 2026-08-28 —
 * a naive count returns 0 because these tables are FORCE RLS and fail closed
 * without `app.org_id`). Their stored `taxAmount` is nonetheless subtotal×0.18,
 * so the money is right and only the unit is wrong. Rejecting them would break
 * re-saves of live invoices for a data problem they did not cause.
 *
 * `normalizeTaxRate` below is what actually bounds the arithmetic. Once the
 * stored rows are migrated (see docs/security/…), this can drop to max(1) and
 * the normalizer can become an assertion.
 */
export const taxRateSchema = z.number().finite().min(0).max(100)

/**
 * Resolve a stored or submitted tax rate to the multiplier the math expects.
 *
 * A value above 1 is the legacy percentage form and is divided by 100. This is
 * not a new convention — `src/app/(dashboard)/invoices/[id]/page.tsx` already
 * renders `taxRate <= 1 ? rate * 100 : rate` for exactly this reason. Applying
 * the same rule at the point of calculation is what stops those 43 invoices
 * from recomputing at 1800% the moment someone saves one, and it caps any
 * submitted rate at 100% however it was expressed.
 */
export function normalizeTaxRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return rate > 1 ? rate / 100 : rate
}

/**
 * Lead score, 0–100 integer.
 *
 * Matches both the column (`Company.leadScore Int`) and the only writer that
 * computes it, `src/lib/ai/lead-scoring.ts`, which clamps to
 * `Math.max(0, Math.min(100, …))`. Hand-written values had no bound at all.
 */
export const leadScoreSchema = z.number().finite().int().min(0).max(100)

/**
 * Is this discount header valid for the type it is paired with?
 *
 * `discountValue` means two different things depending on `discountType`
 * (see `calculateInvoiceTotals`), so a single zod bound cannot express it:
 *
 *   percentage → a percentage; above 100 drives the total negative
 *   fixed      → a money amount; capping it at 100 would reject a legitimate
 *                500-unit discount, which is exactly what the invoice PUT
 *                schema used to do
 *
 * Returns an error message, or null when the pair is coherent. Non-negative,
 * finite and the money ceiling are enforced by the schema; this adds only the
 * part that depends on the other field.
 */
export function invoiceDiscountError(
  discountType: "percentage" | "fixed",
  discountValue: number,
  subtotal?: number,
): string | null {
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return "Discount must be a non-negative number"
  }
  if (discountType === "percentage") {
    if (discountValue > 100) return "A percentage discount cannot exceed 100"
  } else if (discountValue > MAX_FIXED_DISCOUNT) {
    return "Discount is too large"
  }
  // The bound that actually matters. Capping the two forms separately still
  // lets a fixed discount exceed the invoice it is applied to and drive
  // totalAmount negative, which was the whole shape of the original finding.
  if (subtotal !== undefined && Number.isFinite(subtotal)) {
    const amount = discountType === "percentage" ? subtotal * (discountValue / 100) : discountValue
    if (amount > subtotal) return "Discount cannot exceed the invoice subtotal"
  }
  return null
}

/**
 * Logged or estimated effort in hours.
 *
 * Bounded well above any real task (roughly eleven years of continuous work)
 * while still rejecting negatives and overflow-style payloads. Task hours feed
 * project rollups, so a negative value silently subtracts from the total.
 */
export const nonNegativeHoursSchema = z.number().finite().min(0).max(100_000)
