/**
 * Findings 15 and 16, third pass.
 *
 * The customer's 2026-08-28 re-test marked both closed. They were not: the
 * shared bounds landed on the create schemas and on the core CRM money fields,
 * and the update schemas beside them kept a bare `z.number()`. Create bounded,
 * update unbounded is not a partial fix — it is no fix, because the attacker
 * simply does both calls.
 *
 * These tests are written against the money that ends up in the database, not
 * against the schema text, so they stay meaningful if the validation moves.
 */
import { describe, expect, it } from "vitest"
import {
  invoiceDiscountError,
  leadScoreSchema,
  nonNegativeHoursSchema,
  normalizeTaxRate,
  percentageSchema,
  taxRateSchema,
} from "@/lib/validation/numeric"
import { calculateInvoiceTotals } from "@/lib/invoice-calculations"

const ITEMS = [{ quantity: 1, unitPrice: 1000, discount: 0 }]

describe("invoice discount can no longer move money the wrong way", () => {
  // The concrete bug: `afterDiscount = subtotal - discountAmount`, so a
  // NEGATIVE discountValue adds to the invoice instead of subtracting.
  it("refuses a negative percentage discount, which used to inflate the total", () => {
    const totals = calculateInvoiceTotals(ITEMS, "percentage", -100, 0, false)
    expect(totals.totalAmount).toBe(2000) // 1000 subtotal → 2000 billed

    expect(invoiceDiscountError("percentage", -100)).toMatch(/non-negative/i)
  })

  it("refuses a percentage discount above 100, which used to produce a negative total", () => {
    const totals = calculateInvoiceTotals(ITEMS, "percentage", 500, 0, false)
    expect(totals.totalAmount).toBe(-4000)

    expect(invoiceDiscountError("percentage", 500)).toMatch(/cannot exceed 100/i)
  })

  // The mirror image, and the reason this is not just `min(0).max(100)`: the
  // invoice PUT schema DID cap discountValue at 100 unconditionally, which
  // rejected a legitimate fixed discount. Tightening the create path by copying
  // that bound would have shipped the same bug to a second route.
  it("allows a large FIXED discount, which the old blanket max(100) rejected", () => {
    expect(invoiceDiscountError("fixed", 500, 1000)).toBeNull()
  })

  it("still refuses a fixed discount past its own ceiling", () => {
    expect(invoiceDiscountError("fixed", 1e15)).toMatch(/too large/i)
  })

  // Bounding the two forms separately is NOT enough, which the first version of
  // this change got wrong: a fixed discount below the ceiling but above the
  // invoice still drives totalAmount negative — the same shape as the original
  // finding, reached through the other discountType.
  it("refuses any discount larger than the invoice it is applied to", () => {
    const totals = calculateInvoiceTotals(ITEMS, "fixed", 999_999, 0, false)
    expect(totals.totalAmount).toBe(-998_999)

    expect(invoiceDiscountError("fixed", 999_999, 1000)).toMatch(/exceed the invoice/i)
    expect(invoiceDiscountError("percentage", 100, 1000)).toBeNull()
  })

  it("refuses non-finite values on either type", () => {
    expect(invoiceDiscountError("percentage", Number.NaN)).toMatch(/non-negative/i)
    expect(invoiceDiscountError("fixed", Number.POSITIVE_INFINITY)).toMatch(/non-negative/i)
  })

  it("accepts the ordinary cases untouched", () => {
    expect(invoiceDiscountError("percentage", 0)).toBeNull()
    expect(invoiceDiscountError("percentage", 100)).toBeNull()
    expect(invoiceDiscountError("fixed", 0)).toBeNull()
  })
})

describe("tax rate cannot inflate the total, in either stored form", () => {
  // `taxAmount = afterDiscount * taxRate` — no division by 100. So the raw
  // value is a multiplier, and a bound of 100 would permit a 10 000% tax.
  it("shows what an unnormalized rate of 100 would have billed", () => {
    const totals = calculateInvoiceTotals(ITEMS, "percentage", 0, 100, true)
    expect(totals.totalAmount).toBe(101_000)
  })

  // The bound is 100 rather than 1 because production disagrees with the
  // contract: 43 of 84 invoices store 18, not 0.18. Rejecting them would break
  // re-saving live invoices over a data problem their owner did not cause, so
  // the normalizer — not the schema — is what bounds the arithmetic.
  it("normalizes the legacy percentage form instead of rejecting it", () => {
    expect(normalizeTaxRate(18)).toBeCloseTo(0.18)
    expect(taxRateSchema.safeParse(18).success).toBe(true)

    const totals = calculateInvoiceTotals(ITEMS, "percentage", 0, normalizeTaxRate(18), true)
    expect(totals.totalAmount).toBe(1180)
  })

  it("caps a hostile rate at 100%, whichever form it is written in", () => {
    expect(normalizeTaxRate(100)).toBe(1)
    const totals = calculateInvoiceTotals(ITEMS, "percentage", 0, normalizeTaxRate(100), true)
    expect(totals.totalAmount).toBe(2000) // 100% tax, not 10 000%
  })

  it("leaves the decimal form the UI sends untouched", () => {
    expect(normalizeTaxRate(0.18)).toBe(0.18)
    expect(normalizeTaxRate(1)).toBe(1)
    expect(normalizeTaxRate(0)).toBe(0)
  })

  it("rejects negative and non-finite rates at both layers", () => {
    expect(taxRateSchema.safeParse(-0.18).success).toBe(false)
    expect(taxRateSchema.safeParse(101).success).toBe(false)
    expect(taxRateSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(taxRateSchema.safeParse(Number.NaN).success).toBe(false)
    expect(normalizeTaxRate(-5)).toBe(0)
    expect(normalizeTaxRate(Number.NaN)).toBe(0)
  })
})

describe("the remaining shared bounds", () => {
  it("percentageSchema covers 0..100 inclusive and nothing outside", () => {
    expect(percentageSchema.safeParse(0).success).toBe(true)
    expect(percentageSchema.safeParse(100).success).toBe(true)
    expect(percentageSchema.safeParse(-1).success).toBe(false)
    expect(percentageSchema.safeParse(101).success).toBe(false)
  })

  it("leadScoreSchema matches the 0..100 integer the scorer clamps to", () => {
    expect(leadScoreSchema.safeParse(0).success).toBe(true)
    expect(leadScoreSchema.safeParse(100).success).toBe(true)
    expect(leadScoreSchema.safeParse(101).success).toBe(false)
    expect(leadScoreSchema.safeParse(-1).success).toBe(false)
    expect(leadScoreSchema.safeParse(50.5).success).toBe(false)
  })

  it("nonNegativeHoursSchema rejects negatives, which subtract from project rollups", () => {
    expect(nonNegativeHoursSchema.safeParse(0).success).toBe(true)
    expect(nonNegativeHoursSchema.safeParse(7.5).success).toBe(true)
    expect(nonNegativeHoursSchema.safeParse(-1).success).toBe(false)
    expect(nonNegativeHoursSchema.safeParse(1e308).success).toBe(false)
  })
})
